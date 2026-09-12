import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { TASKS_WS_METHODS, type EnvironmentId, type TasksSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { formatEnvironmentQueryError } from "../state/query";

export const EMPTY_TASKS_SNAPSHOT: TasksSnapshot = { revision: 0, tasks: [], agents: [] };

export const tasksEnvironment = {
  snapshot: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "environment-data:tasks:snapshot",
    tag: TASKS_WS_METHODS.tasksSubscribe,
    // Stays warm across navigation so coming back to the view is instant.
    idleTtlMs: 30 * 60_000,
  }),
  create: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:tasks:create",
    tag: TASKS_WS_METHODS.tasksCreate,
  }),
  update: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:tasks:update",
    tag: TASKS_WS_METHODS.tasksUpdate,
  }),
  remove: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:tasks:delete",
    tag: TASKS_WS_METHODS.tasksDelete,
  }),
  linkThread: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:tasks:link-thread",
    tag: TASKS_WS_METHODS.tasksLinkThread,
  }),
  unlinkThread: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:tasks:unlink-thread",
    tag: TASKS_WS_METHODS.tasksUnlinkThread,
  }),
  addAgent: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:tasks:add-agent",
    tag: TASKS_WS_METHODS.tasksAddAgent,
  }),
  removeAgent: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:tasks:remove-agent",
    tag: TASKS_WS_METHODS.tasksRemoveAgent,
  }),
};

/**
 * Tasks live on one server. The primary environment owns them; the hosted app
 * has no primary, so the first catalog entry stands in.
 */
export const tasksHomeEnvironmentIdAtom = Atom.make((get): EnvironmentId | null => {
  const primary = get(primaryEnvironmentIdAtom);
  if (primary !== null) {
    return primary;
  }
  for (const environmentId of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    return environmentId;
  }
  return null;
}).pipe(Atom.withLabel("web-tasks-home-environment-id"));

export interface TasksState {
  readonly environmentId: EnvironmentId | null;
  readonly snapshot: TasksSnapshot;
  /** True until the first snapshot arrives; later refreshes keep the old one on screen. */
  readonly isLoading: boolean;
  readonly error: string | null;
}

const NO_ENVIRONMENT_STATE: TasksState = {
  environmentId: null,
  snapshot: EMPTY_TASKS_SNAPSHOT,
  isLoading: false,
  error: null,
};

export const tasksStateAtom = Atom.make((get): TasksState => {
  const environmentId = get(tasksHomeEnvironmentIdAtom);
  if (environmentId === null) {
    return NO_ENVIRONMENT_STATE;
  }
  const result = get(tasksEnvironment.snapshot({ environmentId, input: {} }));
  const snapshot = Option.getOrNull(AsyncResult.value(result));
  return {
    environmentId,
    snapshot: snapshot ?? EMPTY_TASKS_SNAPSHOT,
    isLoading: snapshot === null && result._tag !== "Failure",
    error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
  };
}).pipe(Atom.withLabel("web-tasks-state"));

export function useTasksState(): TasksState {
  return useAtomValue(tasksStateAtom);
}
