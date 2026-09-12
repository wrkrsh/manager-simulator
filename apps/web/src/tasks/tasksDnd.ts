import type { Active, Over } from "@dnd-kit/core";
import type { EnvironmentId, TaskAgentId, TaskId, ThreadId } from "@t3tools/contracts";

export type TaskDragData =
  | { readonly kind: "agent"; readonly agentId: TaskAgentId }
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

export type TaskDropData =
  | { readonly kind: "task"; readonly taskId: TaskId }
  | { readonly kind: "loose" };

export const LOOSE_THREADS_DROP_ID = "tasks:loose";

export function agentDragId(agentId: TaskAgentId): string {
  return `agent:${agentId}`;
}

export function threadDragId(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `thread:${environmentId}:${threadId}`;
}

export function taskDropId(taskId: TaskId): string {
  return `task:${taskId}`;
}

export function readDragData(active: Active | null): TaskDragData | null {
  const data = active?.data.current;
  if (!data || (data.kind !== "agent" && data.kind !== "thread")) {
    return null;
  }
  return data as TaskDragData;
}

export function readDropData(over: Over | null): TaskDropData | null {
  const data = over?.data.current;
  if (!data || (data.kind !== "task" && data.kind !== "loose")) {
    return null;
  }
  return data as TaskDropData;
}
