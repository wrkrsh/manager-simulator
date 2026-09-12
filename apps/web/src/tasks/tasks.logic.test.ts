import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  TaskAgentId,
  TaskId,
  ThreadId,
  type Task,
  type TaskAgent,
} from "@t3tools/contracts";

import {
  buildTaskContextPrompt,
  evaluateAgentDrop,
  indexTaskThreads,
  matchesTaskFilter,
  selectLooseThreads,
  sortTasks,
} from "./tasks.logic";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");

function makeTask(overrides: Omit<Partial<Task>, "id"> & { id: string }): Task {
  return {
    id: TaskId.make(overrides.id),
    title: overrides.title ?? "Task",
    description: overrides.description ?? "",
    status: overrides.status ?? "todo",
    priority: overrides.priority ?? "none",
    project:
      overrides.project !== undefined
        ? overrides.project
        : { environmentId: envA, projectId: ProjectId.make("project") },
    threads: overrides.threads ?? [],
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function makeShell(
  overrides: Omit<Partial<EnvironmentThreadShell>, "id"> & { id: string },
): EnvironmentThreadShell {
  return {
    environmentId: overrides.environmentId ?? envA,
    id: ThreadId.make(overrides.id),
    projectId: ProjectId.make("project"),
    title: overrides.title ?? overrides.id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as EnvironmentThreadShell;
}

const agent: TaskAgent = {
  id: TaskAgentId.make("agent"),
  environmentId: envA,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("sortTasks", () => {
  it("orders by status, then priority, then most recent", () => {
    const sorted = sortTasks([
      makeTask({ id: "done", status: "done", priority: "urgent" }),
      makeTask({ id: "todo-low", status: "todo", priority: "low" }),
      makeTask({
        id: "todo-high-old",
        status: "todo",
        priority: "high",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeTask({
        id: "todo-high-new",
        status: "todo",
        priority: "high",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
      makeTask({ id: "working", status: "in_progress" }),
    ]);
    expect(sorted.map((task) => task.id)).toEqual([
      "working",
      "todo-high-new",
      "todo-high-old",
      "todo-low",
      "done",
    ]);
  });
});

describe("matchesTaskFilter", () => {
  it("splits finished work from active work", () => {
    expect(matchesTaskFilter(makeTask({ id: "a", status: "canceled" }), "active")).toBe(false);
    expect(matchesTaskFilter(makeTask({ id: "a", status: "canceled" }), "done")).toBe(true);
    expect(matchesTaskFilter(makeTask({ id: "a", status: "backlog" }), "active")).toBe(true);
    expect(matchesTaskFilter(makeTask({ id: "a", status: "backlog" }), "all")).toBe(true);
  });
});

describe("indexTaskThreads and selectLooseThreads", () => {
  it("attaches live shells to their task and counts links without a shell", () => {
    const task = makeTask({
      id: "task",
      threads: [
        {
          environmentId: envA,
          threadId: ThreadId.make("t1"),
          linkedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          environmentId: envB,
          threadId: ThreadId.make("gone"),
          linkedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const shells = [
      makeShell({ id: "t1" }),
      makeShell({ id: "loose-new", updatedAt: "2026-03-01T00:00:00.000Z" }),
      makeShell({ id: "loose-old", updatedAt: "2026-02-01T00:00:00.000Z" }),
      makeShell({ id: "archived", archivedAt: "2026-02-01T00:00:00.000Z" }),
      // Same thread id on another environment is a different thread.
      makeShell({ id: "t1", environmentId: envB, updatedAt: "2026-04-01T00:00:00.000Z" }),
    ];
    const index = indexTaskThreads([task], shells);
    expect(index.threadsByTaskId.get(task.id)?.map((shell) => shell.id)).toEqual(["t1"]);
    expect(index.missingCountByTaskId.get(task.id)).toBe(1);

    const loose = selectLooseThreads(shells, index.taskIdByThreadKey);
    expect(loose.map((shell) => `${shell.environmentId}:${shell.id}`)).toEqual([
      "env-b:t1",
      "env-a:loose-new",
      "env-a:loose-old",
    ]);
  });
});

describe("evaluateAgentDrop", () => {
  it("requires a project on the task's environment", () => {
    expect(evaluateAgentDrop(agent, makeTask({ id: "a" }))).toEqual({ ok: true });
    expect(evaluateAgentDrop(agent, makeTask({ id: "a", project: null })).ok).toBe(false);
    expect(
      evaluateAgentDrop(
        agent,
        makeTask({ id: "a", project: { environmentId: envB, projectId: ProjectId.make("p") } }),
      ).ok,
    ).toBe(false);
  });
});

describe("buildTaskContextPrompt", () => {
  it("leads with the task, lists sibling threads, and ends with the prompt", () => {
    const text = buildTaskContextPrompt({
      task: makeTask({
        id: "a",
        title: "Ship login",
        description: "  Use the new form.  ",
        status: "in_progress",
        priority: "high",
      }),
      projectTitle: "farlang",
      siblingThreads: [
        { title: "Fix CSS", status: "Completed" },
        { title: "Write tests", status: null },
      ],
      prompt: "Wire the submit button.",
    });
    expect(text).toBe(
      [
        "Task: Ship login",
        "Status: In progress · Priority: High",
        "Project: farlang",
        "",
        "Description:",
        "Use the new form.",
        "",
        "Other threads already working on this task:",
        "- Fix CSS (Completed)",
        "- Write tests",
        "",
        "---",
        "",
        "Wire the submit button.",
      ].join("\n"),
    );
  });

  it("omits empty sections", () => {
    const text = buildTaskContextPrompt({
      task: makeTask({ id: "a", title: "Quick fix" }),
      projectTitle: null,
      siblingThreads: [],
      prompt: "Do it.",
    });
    expect(text).toBe(["Task: Quick fix", "Status: Todo", "", "---", "", "Do it."].join("\n"));
  });
});
