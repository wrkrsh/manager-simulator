/**
 * TasksRpc — websocket handlers and authorization scopes for the tasks RPCs.
 *
 * Built here so `ws.ts` and `RpcAuthorization.ts` each need a single spread
 * line for the whole feature.
 */
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  TASKS_WS_METHODS,
  type AuthEnvironmentScope,
  type EnvironmentAuthorizationError,
  type TaskAgentAddInput,
  type TaskAgentRemoveInput,
  type TaskCreateInput,
  type TaskDeleteInput,
  type TaskLinkThreadInput,
  type TasksWsMethod,
  type TaskUnlinkThreadInput,
  type TaskUpdateInput,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { TasksStore } from "./TasksStore.ts";

export const TASKS_RPC_REQUIRED_SCOPES = {
  [TASKS_WS_METHODS.tasksGetSnapshot]: AuthOrchestrationReadScope,
  [TASKS_WS_METHODS.tasksSubscribe]: AuthOrchestrationReadScope,
  [TASKS_WS_METHODS.tasksCreate]: AuthOrchestrationOperateScope,
  [TASKS_WS_METHODS.tasksUpdate]: AuthOrchestrationOperateScope,
  [TASKS_WS_METHODS.tasksDelete]: AuthOrchestrationOperateScope,
  [TASKS_WS_METHODS.tasksLinkThread]: AuthOrchestrationOperateScope,
  [TASKS_WS_METHODS.tasksUnlinkThread]: AuthOrchestrationOperateScope,
  [TASKS_WS_METHODS.tasksAddAgent]: AuthOrchestrationOperateScope,
  [TASKS_WS_METHODS.tasksRemoveAgent]: AuthOrchestrationOperateScope,
} as const satisfies Readonly<Record<TasksWsMethod, AuthEnvironmentScope>>;

/** The per-connection `observeRpcEffect` / `observeRpcStream` closures from `ws.ts`. */
export interface TasksRpcObservers {
  readonly effect: <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
  readonly stream: <A, E, R>(
    method: string,
    stream: Stream.Stream<A, E, R>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Stream.Stream<A, E | EnvironmentAuthorizationError, R>;
}

const TRACE_ATTRIBUTES = { "rpc.aggregate": "tasks" } as const;

export function makeTasksRpcHandlers(tasks: TasksStore["Service"], observe: TasksRpcObservers) {
  return {
    [TASKS_WS_METHODS.tasksGetSnapshot]: () =>
      observe.effect(TASKS_WS_METHODS.tasksGetSnapshot, tasks.getSnapshot, TRACE_ATTRIBUTES),
    [TASKS_WS_METHODS.tasksSubscribe]: () =>
      observe.stream(TASKS_WS_METHODS.tasksSubscribe, tasks.streamSnapshots, TRACE_ATTRIBUTES),
    [TASKS_WS_METHODS.tasksCreate]: (input: TaskCreateInput) =>
      observe.effect(TASKS_WS_METHODS.tasksCreate, tasks.createTask(input), TRACE_ATTRIBUTES),
    [TASKS_WS_METHODS.tasksUpdate]: (input: TaskUpdateInput) =>
      observe.effect(TASKS_WS_METHODS.tasksUpdate, tasks.updateTask(input), TRACE_ATTRIBUTES),
    [TASKS_WS_METHODS.tasksDelete]: (input: TaskDeleteInput) =>
      observe.effect(TASKS_WS_METHODS.tasksDelete, tasks.deleteTask(input), TRACE_ATTRIBUTES),
    [TASKS_WS_METHODS.tasksLinkThread]: (input: TaskLinkThreadInput) =>
      observe.effect(TASKS_WS_METHODS.tasksLinkThread, tasks.linkThread(input), TRACE_ATTRIBUTES),
    [TASKS_WS_METHODS.tasksUnlinkThread]: (input: TaskUnlinkThreadInput) =>
      observe.effect(
        TASKS_WS_METHODS.tasksUnlinkThread,
        tasks.unlinkThread(input),
        TRACE_ATTRIBUTES,
      ),
    [TASKS_WS_METHODS.tasksAddAgent]: (input: TaskAgentAddInput) =>
      observe.effect(TASKS_WS_METHODS.tasksAddAgent, tasks.addAgent(input), TRACE_ATTRIBUTES),
    [TASKS_WS_METHODS.tasksRemoveAgent]: (input: TaskAgentRemoveInput) =>
      observe.effect(TASKS_WS_METHODS.tasksRemoveAgent, tasks.removeAgent(input), TRACE_ATTRIBUTES),
  };
}
