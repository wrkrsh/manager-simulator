import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TasksSnapshot,
  ThreadId,
  type TaskAgentAddInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as TasksStore from "./TasksStore.ts";

const makeTasksLayer = (baseDir?: string) =>
  TasksStore.layer.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), baseDir ?? { prefix: "t3code-tasks-test-" }),
      ),
    ),
  );

const environmentId = EnvironmentId.make("env-1");
const projectRef = { environmentId, projectId: ProjectId.make("project-1") };
const threadRef = (id: string) => ({ environmentId, threadId: ThreadId.make(id) });

const decodeTasksFile = Schema.decodeUnknownEffect(Schema.fromJsonString(TasksSnapshot));

const readTasksFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const raw = yield* fs.readFileString(path.join(stateDir, TasksStore.TASKS_FILE_NAME));
  return yield* decodeTasksFile(raw);
});

it.layer(NodeServices.layer)("tasks store", (it) => {
  it.effect("starts empty and persists created tasks to disk", () =>
    Effect.gen(function* () {
      const store = yield* TasksStore.TasksStore;
      assert.deepEqual(yield* store.getSnapshot, { revision: 0, tasks: [], agents: [] });

      const task = yield* store.createTask({ title: "Ship it", project: projectRef });
      assert.equal(task.status, "todo");
      assert.equal(task.priority, "none");
      assert.equal(task.description, "");
      assert.deepEqual(task.threads, []);

      const persisted = yield* readTasksFile;
      assert.equal(persisted.revision, 1);
      assert.equal(persisted.tasks[0]?.id, task.id);
    }).pipe(Effect.provide(makeTasksLayer())),
  );

  it.effect("linking a thread moves it between tasks and starts the target", () =>
    Effect.gen(function* () {
      const store = yield* TasksStore.TasksStore;
      const first = yield* store.createTask({ title: "First", project: projectRef });
      const second = yield* store.createTask({
        title: "Second",
        project: projectRef,
        status: "backlog",
      });

      yield* store.linkThread({ taskId: first.id, ...threadRef("thread-a") });
      const moved = yield* store.linkThread({ taskId: second.id, ...threadRef("thread-a") });

      const firstAfter = moved.tasks.find((task) => task.id === first.id);
      const secondAfter = moved.tasks.find((task) => task.id === second.id);
      assert.deepEqual(firstAfter?.threads, []);
      assert.equal(secondAfter?.threads.length, 1);
      assert.equal(secondAfter?.threads[0]?.threadId, "thread-a");
      // Both were started by a link; done and canceled would have stayed put.
      assert.equal(firstAfter?.status, "in_progress");
      assert.equal(secondAfter?.status, "in_progress");

      const unlinked = yield* store.unlinkThread(threadRef("thread-a"));
      assert.isTrue(unlinked.tasks.every((task) => task.threads.length === 0));
      assert.equal(unlinked.revision, 5);
      assert.equal((yield* readTasksFile).revision, 5);
    }).pipe(Effect.provide(makeTasksLayer())),
  );

  it.effect("does not reopen finished tasks when a thread is linked", () =>
    Effect.gen(function* () {
      const store = yield* TasksStore.TasksStore;
      const done = yield* store.createTask({ title: "Done", status: "done" });
      const linked = yield* store.linkThread({ taskId: done.id, ...threadRef("thread-b") });
      assert.equal(linked.tasks[0]?.status, "done");
    }).pipe(Effect.provide(makeTasksLayer())),
  );

  it.effect("updates fields through a patch and rejects unknown tasks", () =>
    Effect.gen(function* () {
      const store = yield* TasksStore.TasksStore;
      const task = yield* store.createTask({ title: "Draft" });
      const updated = yield* store.updateTask({
        taskId: task.id,
        patch: { title: "Renamed", priority: "high", description: "Details", project: projectRef },
      });
      const after = updated.tasks[0];
      assert.equal(after?.title, "Renamed");
      assert.equal(after?.priority, "high");
      assert.equal(after?.description, "Details");
      assert.deepEqual(after?.project, projectRef);
      assert.equal(after?.status, "todo");

      const missing = yield* store
        .updateTask({ taskId: TaskId.make("missing"), patch: { title: "x" } })
        .pipe(Effect.flip);
      assert.equal(missing._tag, "TaskNotFoundError");

      const deleted = yield* store.deleteTask({ taskId: task.id });
      assert.deepEqual(deleted.tasks, []);
    }).pipe(Effect.provide(makeTasksLayer())),
  );

  it.effect("dedupes toolbar agents by environment, instance, model, and options", () =>
    Effect.gen(function* () {
      const store = yield* TasksStore.TasksStore;
      const input: TaskAgentAddInput = {
        environmentId,
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5",
          options: [{ id: "effort", value: "high" }],
        },
      };
      const first = yield* store.addAgent(input);
      const again = yield* store.addAgent(input);
      assert.equal(again.id, first.id);

      const other = yield* store.addAgent({
        ...input,
        modelSelection: { ...input.modelSelection, options: [{ id: "effort", value: "low" }] },
      });
      assert.notEqual(other.id, first.id);
      assert.equal((yield* store.getSnapshot).agents.length, 2);

      const removed = yield* store.removeAgent({ agentId: first.id });
      assert.deepEqual(
        removed.agents.map((agent) => agent.id),
        [other.id],
      );
    }).pipe(Effect.provide(makeTasksLayer())),
  );

  it.effect("streams the current snapshot first and then later revisions", () =>
    Effect.gen(function* () {
      const store = yield* TasksStore.TasksStore;
      yield* store.createTask({ title: "Existing" });

      // The first emission triggers a write, which must reach the same
      // subscription: the store subscribes before it reads the snapshot.
      const revisions = yield* store.streamSnapshots.pipe(
        Stream.tap((snapshot) =>
          snapshot.revision === 1 ? store.createTask({ title: "Second" }) : Effect.void,
        ),
        Stream.map((snapshot) => snapshot.revision),
        Stream.take(2),
        Stream.runCollect,
      );
      assert.deepEqual([...revisions], [1, 2]);
    }).pipe(Effect.provide(makeTasksLayer())),
  );

  it.effect("reloads persisted state in a fresh store", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-tasks-reload-" });
      const created = yield* Effect.gen(function* () {
        const store = yield* TasksStore.TasksStore;
        return yield* store.createTask({ title: "Persisted", project: projectRef });
      }).pipe(Effect.provide(makeTasksLayer(baseDir)));

      const reloaded = yield* Effect.gen(function* () {
        const store = yield* TasksStore.TasksStore;
        return yield* store.getSnapshot;
      }).pipe(Effect.provide(makeTasksLayer(baseDir)));
      assert.equal(reloaded.revision, 1);
      assert.equal(reloaded.tasks[0]?.id, created.id);
      assert.deepEqual(reloaded.tasks[0]?.project, projectRef);
    }).pipe(Effect.scoped),
  );

  it.effect("fails instead of discarding a corrupt tasks file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir } = yield* ServerConfig.ServerConfig;
      yield* fs.writeFileString(path.join(stateDir, TasksStore.TASKS_FILE_NAME), "{ not-json");

      const store = yield* TasksStore.TasksStore;
      const failure = yield* store.getSnapshot.pipe(Effect.flip);
      assert.equal(failure._tag, "TasksStoreError");
      assert.include(failure.detail, "invalid tasks file");
    }).pipe(Effect.provide(makeTasksLayer())),
  );
});
