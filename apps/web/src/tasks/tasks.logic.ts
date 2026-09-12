import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  Task,
  TaskAgent,
  TaskId,
  TaskPriority,
  TaskStatus,
  ThreadId,
} from "@t3tools/contracts";

export interface TaskStatusMeta {
  readonly label: string;
  /** Sort position in the list; work in flight first, finished work last. */
  readonly order: number;
  readonly dotClass: string;
}

export const TASK_STATUS_META: Readonly<Record<TaskStatus, TaskStatusMeta>> = {
  in_progress: { label: "In progress", order: 0, dotClass: "bg-amber-500 dark:bg-amber-300" },
  todo: { label: "Todo", order: 1, dotClass: "bg-sky-500 dark:bg-sky-300" },
  backlog: { label: "Backlog", order: 2, dotClass: "bg-muted-foreground/50" },
  done: { label: "Done", order: 3, dotClass: "bg-emerald-500 dark:bg-emerald-300" },
  canceled: { label: "Canceled", order: 4, dotClass: "bg-muted-foreground/30" },
};

export const TASK_STATUS_ORDER: ReadonlyArray<TaskStatus> = [
  "in_progress",
  "todo",
  "backlog",
  "done",
  "canceled",
];

export interface TaskPriorityMeta {
  readonly label: string;
  readonly short: string;
  readonly order: number;
}

export const TASK_PRIORITY_META: Readonly<Record<TaskPriority, TaskPriorityMeta>> = {
  urgent: { label: "Urgent", short: "P0", order: 0 },
  high: { label: "High", short: "P1", order: 1 },
  medium: { label: "Medium", short: "P2", order: 2 },
  low: { label: "Low", short: "P3", order: 3 },
  none: { label: "No priority", short: "—", order: 4 },
};

export const TASK_PRIORITY_ORDER: ReadonlyArray<TaskPriority> = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export type TaskListFilter = "active" | "done" | "all";

export function isFinishedTaskStatus(status: TaskStatus): boolean {
  return status === "done" || status === "canceled";
}

export function matchesTaskFilter(task: Task, filter: TaskListFilter): boolean {
  switch (filter) {
    case "active":
      return !isFinishedTaskStatus(task.status);
    case "done":
      return isFinishedTaskStatus(task.status);
    case "all":
      return true;
  }
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Status first, then priority, then most recently touched. Stable on id. */
export function sortTasks(tasks: ReadonlyArray<Task>): ReadonlyArray<Task> {
  return [...tasks].toSorted(
    (left, right) =>
      TASK_STATUS_META[left.status].order - TASK_STATUS_META[right.status].order ||
      TASK_PRIORITY_META[left.priority].order - TASK_PRIORITY_META[right.priority].order ||
      timestampMs(right.updatedAt) - timestampMs(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
}

export function taskThreadKey(link: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): string {
  return scopedThreadKey(scopeThreadRef(link.environmentId, link.threadId));
}

export interface TaskThreadIndex {
  readonly taskIdByThreadKey: ReadonlyMap<string, TaskId>;
  /** Live shells for each task's links, in link order. Links whose thread is gone are skipped. */
  readonly threadsByTaskId: ReadonlyMap<TaskId, ReadonlyArray<EnvironmentThreadShell>>;
  /** Links with no live shell: deleted threads or environments that are offline. */
  readonly missingCountByTaskId: ReadonlyMap<TaskId, number>;
}

export function indexTaskThreads(
  tasks: ReadonlyArray<Task>,
  shells: ReadonlyArray<EnvironmentThreadShell>,
): TaskThreadIndex {
  const shellByKey = new Map<string, EnvironmentThreadShell>();
  for (const shell of shells) {
    shellByKey.set(
      taskThreadKey({ environmentId: shell.environmentId, threadId: shell.id }),
      shell,
    );
  }
  const taskIdByThreadKey = new Map<string, TaskId>();
  const threadsByTaskId = new Map<TaskId, ReadonlyArray<EnvironmentThreadShell>>();
  const missingCountByTaskId = new Map<TaskId, number>();
  for (const task of tasks) {
    const live: EnvironmentThreadShell[] = [];
    let missing = 0;
    for (const link of task.threads) {
      const key = taskThreadKey(link);
      taskIdByThreadKey.set(key, task.id);
      const shell = shellByKey.get(key);
      if (shell === undefined) {
        missing += 1;
      } else {
        live.push(shell);
      }
    }
    threadsByTaskId.set(task.id, live);
    if (missing > 0) {
      missingCountByTaskId.set(task.id, missing);
    }
  }
  return { taskIdByThreadKey, threadsByTaskId, missingCountByTaskId };
}

/** Active threads that no task owns, newest first. Archived threads stay in the sidebar's archive. */
export function selectLooseThreads(
  shells: ReadonlyArray<EnvironmentThreadShell>,
  taskIdByThreadKey: ReadonlyMap<string, TaskId>,
): ReadonlyArray<EnvironmentThreadShell> {
  return shells
    .filter(
      (shell) =>
        shell.archivedAt === null &&
        !taskIdByThreadKey.has(
          taskThreadKey({ environmentId: shell.environmentId, threadId: shell.id }),
        ),
    )
    .toSorted(
      (left, right) =>
        timestampMs(right.updatedAt) - timestampMs(left.updatedAt) ||
        left.id.localeCompare(right.id),
    );
}

export type AgentDropVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** A thread is created in the task's project, so the agent must live on that project's environment. */
export function evaluateAgentDrop(agent: TaskAgent, task: Task): AgentDropVerdict {
  if (task.project === null) {
    return { ok: false, reason: "Pick a project for this task before assigning an agent." };
  }
  if (agent.environmentId !== task.project.environmentId) {
    return {
      ok: false,
      reason: "This agent runs on a different environment than the task's project.",
    };
  }
  return { ok: true };
}

export interface TaskContextSibling {
  readonly title: string;
  readonly status: string | null;
}

/**
 * The first message an agent receives. The task itself and what other agents
 * have already been asked to do come first, then the user's own prompt, so the
 * agent can avoid duplicating work without the user restating the task.
 */
export function buildTaskContextPrompt(input: {
  readonly task: Task;
  readonly projectTitle: string | null;
  readonly siblingThreads: ReadonlyArray<TaskContextSibling>;
  readonly prompt: string;
}): string {
  const { task } = input;
  const lines: string[] = [`Task: ${task.title}`];
  const statusLine =
    task.priority === "none"
      ? `Status: ${TASK_STATUS_META[task.status].label}`
      : `Status: ${TASK_STATUS_META[task.status].label} · Priority: ${TASK_PRIORITY_META[task.priority].label}`;
  lines.push(statusLine);
  if (input.projectTitle !== null) {
    lines.push(`Project: ${input.projectTitle}`);
  }
  const description = task.description.trim();
  if (description.length > 0) {
    lines.push("", "Description:", description);
  }
  if (input.siblingThreads.length > 0) {
    lines.push("", "Other threads already working on this task:");
    for (const sibling of input.siblingThreads) {
      lines.push(
        sibling.status === null ? `- ${sibling.title}` : `- ${sibling.title} (${sibling.status})`,
      );
    }
  }
  const prompt = input.prompt.trim();
  lines.push("", "---", "", prompt);
  return lines.join("\n");
}
