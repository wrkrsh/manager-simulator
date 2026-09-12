/**
 * Tasks — the fork's Linear-style work items that group threads.
 *
 * A task is a durable record owned by one server (the client's "tasks home"
 * environment). It references projects and threads by scoped ids, so a task
 * can hold threads from any connected environment. Threads themselves know
 * nothing about tasks; the mapping lives only here. Keeping the whole feature
 * in this file plus the `tasks/` modules on the server and web keeps upstream
 * merges to a handful of additive lines (see `docs/internals/tasks.md`).
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

export const TaskId = TrimmedNonEmptyString.pipe(Schema.brand("TaskId"));
export type TaskId = typeof TaskId.Type;

export const TaskAgentId = TrimmedNonEmptyString.pipe(Schema.brand("TaskAgentId"));
export type TaskAgentId = typeof TaskAgentId.Type;

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "done", "canceled"] as const;
export const TaskStatus = Schema.Literals(TASK_STATUSES);
export type TaskStatus = typeof TaskStatus.Type;

export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export const TaskPriority = Schema.Literals(TASK_PRIORITIES);
export type TaskPriority = typeof TaskPriority.Type;

export const MAX_TASK_TITLE_LENGTH = 200;
export const MAX_TASK_DESCRIPTION_LENGTH = 20_000;

export const TaskTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_TASK_TITLE_LENGTH));
export const TaskDescription = Schema.String.check(Schema.isMaxLength(MAX_TASK_DESCRIPTION_LENGTH));

/** The project a task's threads are created in. Threads require a project. */
export const TaskProjectRef = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export type TaskProjectRef = typeof TaskProjectRef.Type;

export const TaskThreadLink = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  linkedAt: IsoDateTime,
});
export type TaskThreadLink = typeof TaskThreadLink.Type;

export const Task = Schema.Struct({
  id: TaskId,
  title: TaskTitle,
  description: TaskDescription,
  status: TaskStatus,
  priority: TaskPriority,
  project: Schema.NullOr(TaskProjectRef),
  /** Threads working on this task, oldest first. A thread belongs to at most one task. */
  threads: Schema.Array(TaskThreadLink),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Task = typeof Task.Type;

/** A model pinned to the agent toolbar, ready to be dropped on a task. */
export const TaskAgent = Schema.Struct({
  id: TaskAgentId,
  environmentId: EnvironmentId,
  modelSelection: ModelSelection,
  createdAt: IsoDateTime,
});
export type TaskAgent = typeof TaskAgent.Type;

export const TasksSnapshot = Schema.Struct({
  /** Monotonic per store; lets subscribers drop stale emissions. */
  revision: NonNegativeInt,
  tasks: Schema.Array(Task),
  agents: Schema.Array(TaskAgent),
});
export type TasksSnapshot = typeof TasksSnapshot.Type;

export const TaskCreateInput = Schema.Struct({
  title: TaskTitle,
  description: Schema.optional(TaskDescription),
  status: Schema.optional(TaskStatus),
  priority: Schema.optional(TaskPriority),
  project: Schema.optional(Schema.NullOr(TaskProjectRef)),
});
export type TaskCreateInput = typeof TaskCreateInput.Type;

export const TaskPatch = Schema.Struct({
  title: Schema.optional(TaskTitle),
  description: Schema.optional(TaskDescription),
  status: Schema.optional(TaskStatus),
  priority: Schema.optional(TaskPriority),
  project: Schema.optional(Schema.NullOr(TaskProjectRef)),
});
export type TaskPatch = typeof TaskPatch.Type;

export const TaskUpdateInput = Schema.Struct({
  taskId: TaskId,
  patch: TaskPatch,
});
export type TaskUpdateInput = typeof TaskUpdateInput.Type;

export const TaskDeleteInput = Schema.Struct({
  taskId: TaskId,
});
export type TaskDeleteInput = typeof TaskDeleteInput.Type;

export const TaskLinkThreadInput = Schema.Struct({
  taskId: TaskId,
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type TaskLinkThreadInput = typeof TaskLinkThreadInput.Type;

/** Unlinks the thread from whichever task holds it. */
export const TaskUnlinkThreadInput = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type TaskUnlinkThreadInput = typeof TaskUnlinkThreadInput.Type;

export const TaskAgentAddInput = Schema.Struct({
  environmentId: EnvironmentId,
  modelSelection: ModelSelection,
});
export type TaskAgentAddInput = typeof TaskAgentAddInput.Type;

export const TaskAgentRemoveInput = Schema.Struct({
  agentId: TaskAgentId,
});
export type TaskAgentRemoveInput = typeof TaskAgentRemoveInput.Type;

export class TasksStoreError extends Schema.TaggedError<TasksStoreError>()("TasksStoreError", {
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Tasks store error: ${this.detail}`;
  }
}

export class TaskNotFoundError extends Schema.TaggedError<TaskNotFoundError>()(
  "TaskNotFoundError",
  {
    taskId: TaskId,
  },
) {
  override get message(): string {
    return `Task ${this.taskId} does not exist.`;
  }
}

export const TASKS_WS_METHODS = {
  tasksGetSnapshot: "tasks.getSnapshot",
  tasksSubscribe: "tasks.subscribe",
  tasksCreate: "tasks.create",
  tasksUpdate: "tasks.update",
  tasksDelete: "tasks.delete",
  tasksLinkThread: "tasks.linkThread",
  tasksUnlinkThread: "tasks.unlinkThread",
  tasksAddAgent: "tasks.addAgent",
  tasksRemoveAgent: "tasks.removeAgent",
} as const;
export type TasksWsMethod = (typeof TASKS_WS_METHODS)[keyof typeof TASKS_WS_METHODS];

const TasksRpcError = Schema.Union([TasksStoreError, EnvironmentAuthorizationError]);
const TasksTaskRpcError = Schema.Union([
  TasksStoreError,
  TaskNotFoundError,
  EnvironmentAuthorizationError,
]);

const WsTasksGetSnapshotRpc = Rpc.make(TASKS_WS_METHODS.tasksGetSnapshot, {
  payload: Schema.Struct({}),
  success: TasksSnapshot,
  error: TasksRpcError,
});

/** Emits the current snapshot first, then every later revision. */
const WsTasksSubscribeRpc = Rpc.make(TASKS_WS_METHODS.tasksSubscribe, {
  payload: Schema.Struct({}),
  success: TasksSnapshot,
  error: TasksRpcError,
  stream: true,
});

const WsTasksCreateRpc = Rpc.make(TASKS_WS_METHODS.tasksCreate, {
  payload: TaskCreateInput,
  success: Task,
  error: TasksRpcError,
});

const WsTasksUpdateRpc = Rpc.make(TASKS_WS_METHODS.tasksUpdate, {
  payload: TaskUpdateInput,
  success: TasksSnapshot,
  error: TasksTaskRpcError,
});

const WsTasksDeleteRpc = Rpc.make(TASKS_WS_METHODS.tasksDelete, {
  payload: TaskDeleteInput,
  success: TasksSnapshot,
  error: TasksRpcError,
});

const WsTasksLinkThreadRpc = Rpc.make(TASKS_WS_METHODS.tasksLinkThread, {
  payload: TaskLinkThreadInput,
  success: TasksSnapshot,
  error: TasksTaskRpcError,
});

const WsTasksUnlinkThreadRpc = Rpc.make(TASKS_WS_METHODS.tasksUnlinkThread, {
  payload: TaskUnlinkThreadInput,
  success: TasksSnapshot,
  error: TasksRpcError,
});

const WsTasksAddAgentRpc = Rpc.make(TASKS_WS_METHODS.tasksAddAgent, {
  payload: TaskAgentAddInput,
  success: TaskAgent,
  error: TasksRpcError,
});

const WsTasksRemoveAgentRpc = Rpc.make(TASKS_WS_METHODS.tasksRemoveAgent, {
  payload: TaskAgentRemoveInput,
  success: TasksSnapshot,
  error: TasksRpcError,
});

/** Spread into `WsRpcGroup` so the fork adds one line to the upstream group. */
export const TasksRpcs = [
  WsTasksGetSnapshotRpc,
  WsTasksSubscribeRpc,
  WsTasksCreateRpc,
  WsTasksUpdateRpc,
  WsTasksDeleteRpc,
  WsTasksLinkThreadRpc,
  WsTasksUnlinkThreadRpc,
  WsTasksAddAgentRpc,
  WsTasksRemoveAgentRpc,
] as const;
