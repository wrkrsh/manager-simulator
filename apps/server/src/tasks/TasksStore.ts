/**
 * TasksStore — durable tasks and the agent toolbar for the fork's task view.
 *
 * One JSON file in the state directory, rewritten atomically on every change,
 * cached in memory, and fanned out to subscribers as whole snapshots. Tasks
 * are few and small, so a whole-snapshot protocol is simpler than events and
 * keeps this module independent of the orchestration event store.
 *
 * @module TasksStore
 */
import * as NodeCrypto from "node:crypto";

import {
  Task,
  TaskAgent,
  TaskAgentId,
  TaskId,
  TaskNotFoundError,
  TasksSnapshot,
  TasksStoreError,
  type TaskAgentAddInput,
  type TaskAgentRemoveInput,
  type TaskCreateInput,
  type TaskDeleteInput,
  type TaskLinkThreadInput,
  type TaskUnlinkThreadInput,
  type TaskUpdateInput,
} from "@t3tools/contracts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";

export const TASKS_FILE_NAME = "tasks.json";

const EMPTY_SNAPSHOT: TasksSnapshot = { revision: 0, tasks: [], agents: [] };

const TasksSnapshotJson = fromJsonStringPretty(TasksSnapshot);
const decodeSnapshotJson = Schema.decodeUnknownEffect(TasksSnapshotJson);
const encodeSnapshotJson = Schema.encodeEffect(TasksSnapshotJson);

export class TasksStore extends Context.Service<
  TasksStore,
  {
    readonly getSnapshot: Effect.Effect<TasksSnapshot, TasksStoreError>;
    /** The current snapshot first, then every later revision. */
    readonly streamSnapshots: Stream.Stream<TasksSnapshot, TasksStoreError>;
    readonly createTask: (input: TaskCreateInput) => Effect.Effect<Task, TasksStoreError>;
    readonly updateTask: (
      input: TaskUpdateInput,
    ) => Effect.Effect<TasksSnapshot, TasksStoreError | TaskNotFoundError>;
    readonly deleteTask: (input: TaskDeleteInput) => Effect.Effect<TasksSnapshot, TasksStoreError>;
    /** Moves the thread onto the task, unlinking it from any other task first. */
    readonly linkThread: (
      input: TaskLinkThreadInput,
    ) => Effect.Effect<TasksSnapshot, TasksStoreError | TaskNotFoundError>;
    readonly unlinkThread: (
      input: TaskUnlinkThreadInput,
    ) => Effect.Effect<TasksSnapshot, TasksStoreError>;
    /** Idempotent: pinning the same model on the same environment twice returns the existing agent. */
    readonly addAgent: (input: TaskAgentAddInput) => Effect.Effect<TaskAgent, TasksStoreError>;
    readonly removeAgent: (
      input: TaskAgentRemoveInput,
    ) => Effect.Effect<TasksSnapshot, TasksStoreError>;
  }
>()("t3/tasks/TasksStore") {}

function isSameThread(
  link: { readonly environmentId: string; readonly threadId: string },
  target: { readonly environmentId: string; readonly threadId: string },
): boolean {
  return link.environmentId === target.environmentId && link.threadId === target.threadId;
}

/** Drops the thread from every task that holds it, stamping only tasks that changed. */
function withThreadUnlinked(
  tasks: ReadonlyArray<Task>,
  target: { readonly environmentId: string; readonly threadId: string },
  now: string,
): ReadonlyArray<Task> {
  return tasks.map((task) => {
    if (!task.threads.some((link) => isSameThread(link, target))) {
      return task;
    }
    return {
      ...task,
      threads: task.threads.filter((link) => !isSameThread(link, target)),
      updatedAt: now,
    };
  });
}

function agentSelectionKey(agent: TaskAgentAddInput): string {
  const options = [...(agent.modelSelection.options ?? [])]
    .map((option) => [option.id, option.value] as const)
    .toSorted(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([
    agent.environmentId,
    agent.modelSelection.instanceId,
    agent.modelSelection.model,
    options,
  ]);
}

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(stateDir, TASKS_FILE_NAME);
  const mutex = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<TasksSnapshot>();
  const stateRef = yield* Ref.make<TasksSnapshot | null>(null);

  const storeError = (detail: string) => (cause: unknown) => new TasksStoreError({ detail, cause });

  const loadFromDisk = Effect.gen(function* () {
    const exists = yield* fs
      .exists(filePath)
      .pipe(Effect.mapError(storeError(`failed to access ${filePath}`)));
    if (!exists) {
      return EMPTY_SNAPSHOT;
    }
    const raw = yield* fs
      .readFileString(filePath)
      .pipe(Effect.mapError(storeError(`failed to read ${filePath}`)));
    // A corrupt file fails loudly instead of being replaced by an empty
    // store: silently starting over would erase the user's tasks.
    return yield* decodeSnapshotJson(raw).pipe(
      Effect.mapError(storeError(`invalid tasks file at ${filePath}`)),
    );
  });

  const current = Effect.gen(function* () {
    const cached = yield* Ref.get(stateRef);
    if (cached !== null) {
      return cached;
    }
    const loaded = yield* loadFromDisk;
    yield* Ref.set(stateRef, loaded);
    return loaded;
  });

  const persist = (snapshot: TasksSnapshot) =>
    encodeSnapshotJson(snapshot).pipe(
      Effect.flatMap((encoded) =>
        writeFileStringAtomically({ filePath, contents: `${encoded}\n` }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        ),
      ),
      Effect.mapError(storeError(`failed to write ${filePath}`)),
    );

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  interface Change<A> {
    readonly tasks?: ReadonlyArray<Task>;
    readonly agents?: ReadonlyArray<TaskAgent>;
    readonly result: A;
  }

  // Every write reads the latest state, persists, then publishes, all under
  // one permit so revisions stay monotonic and subscribers never see a
  // snapshot the file does not hold.
  const mutate = <A, E>(
    step: (snapshot: TasksSnapshot, now: string) => Effect.Effect<Change<A>, E>,
  ) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const previous = yield* current;
        const now = yield* nowIso;
        const change = yield* step(previous, now);
        const next: TasksSnapshot = {
          revision: previous.revision + 1,
          tasks: change.tasks ?? previous.tasks,
          agents: change.agents ?? previous.agents,
        };
        yield* persist(next);
        yield* Ref.set(stateRef, next);
        yield* PubSub.publish(changes, next);
        return { snapshot: next, result: change.result };
      }),
    );

  const requireTask = (
    tasks: ReadonlyArray<Task>,
    taskId: TaskId,
  ): Effect.Effect<Task, TaskNotFoundError> => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    return task === undefined
      ? Effect.fail(new TaskNotFoundError({ taskId }))
      : Effect.succeed(task);
  };

  return {
    getSnapshot: current,
    get streamSnapshots() {
      return Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before reading so a write between the two cannot be
          // missed; the revision filter drops what the snapshot already holds.
          const subscription = yield* PubSub.subscribe(changes);
          const snapshot = yield* current;
          return Stream.concat(
            Stream.make(snapshot),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((update) => update.revision > snapshot.revision),
            ),
          );
        }),
      );
    },
    createTask: (input) =>
      mutate((snapshot, now) => {
        const task: Task = {
          id: TaskId.make(NodeCrypto.randomUUID()),
          title: input.title,
          description: input.description ?? "",
          status: input.status ?? "todo",
          priority: input.priority ?? "none",
          project: input.project ?? null,
          threads: [],
          createdAt: now,
          updatedAt: now,
        };
        return Effect.succeed({ tasks: [...snapshot.tasks, task], result: task });
      }).pipe(Effect.map(({ result }) => result)),
    updateTask: (input) =>
      mutate((snapshot, now) =>
        requireTask(snapshot.tasks, input.taskId).pipe(
          Effect.map((existing) => {
            const updated: Task = {
              ...existing,
              ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
              ...(input.patch.description !== undefined
                ? { description: input.patch.description }
                : {}),
              ...(input.patch.status !== undefined ? { status: input.patch.status } : {}),
              ...(input.patch.priority !== undefined ? { priority: input.patch.priority } : {}),
              ...(input.patch.project !== undefined ? { project: input.patch.project } : {}),
              updatedAt: now,
            };
            return {
              tasks: snapshot.tasks.map((task) => (task.id === updated.id ? updated : task)),
              result: undefined,
            };
          }),
        ),
      ).pipe(Effect.map(({ snapshot }) => snapshot)),
    deleteTask: (input) =>
      mutate((snapshot) =>
        Effect.succeed({
          tasks: snapshot.tasks.filter((task) => task.id !== input.taskId),
          result: undefined,
        }),
      ).pipe(Effect.map(({ snapshot }) => snapshot)),
    linkThread: (input) =>
      mutate((snapshot, now) =>
        requireTask(snapshot.tasks, input.taskId).pipe(
          Effect.map(() => {
            const tasks = withThreadUnlinked(snapshot.tasks, input, now).map((task) => {
              if (task.id !== input.taskId) {
                return task;
              }
              return {
                ...task,
                threads: [
                  ...task.threads,
                  {
                    environmentId: input.environmentId,
                    threadId: input.threadId,
                    linkedAt: now,
                  },
                ],
                // An agent starting on a task means the task is being worked
                // on. Done and canceled are the user's call and stay put.
                status:
                  task.status === "backlog" || task.status === "todo" ? "in_progress" : task.status,
                updatedAt: now,
              };
            });
            return { tasks, result: undefined };
          }),
        ),
      ).pipe(Effect.map(({ snapshot }) => snapshot)),
    unlinkThread: (input) =>
      mutate((snapshot, now) =>
        Effect.succeed({
          tasks: withThreadUnlinked(snapshot.tasks, input, now),
          result: undefined,
        }),
      ).pipe(Effect.map(({ snapshot }) => snapshot)),
    addAgent: (input) =>
      mutate((snapshot, now) => {
        const key = agentSelectionKey(input);
        const existing = snapshot.agents.find((agent) => agentSelectionKey(agent) === key);
        if (existing !== undefined) {
          return Effect.succeed({ result: existing });
        }
        const agent: TaskAgent = {
          id: TaskAgentId.make(NodeCrypto.randomUUID()),
          environmentId: input.environmentId,
          modelSelection: input.modelSelection,
          createdAt: now,
        };
        return Effect.succeed({ agents: [...snapshot.agents, agent], result: agent });
      }).pipe(Effect.map(({ result }) => result)),
    removeAgent: (input) =>
      mutate((snapshot) =>
        Effect.succeed({
          agents: snapshot.agents.filter((agent) => agent.id !== input.agentId),
          result: undefined,
        }),
      ).pipe(Effect.map(({ snapshot }) => snapshot)),
  } satisfies TasksStore["Service"];
});

export const layer = Layer.effect(TasksStore, make);
