import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { Task, TaskAgentId, TaskId } from "@t3tools/contracts";
import { ListTodoIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { SidebarInset } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { useProjects, useThreadShells } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { AgentBadge, useAgentPresentations, useProviderEntryLookup } from "./agentPresentation";
import { AgentToolbar } from "./AgentToolbar";
import { LooseThreads } from "./LooseThreads";
import { usePendingTaskLinkReconciler } from "./pendingTaskLinks";
import { TaskDetail } from "./TaskDetail";
import { TaskRow } from "./TaskRow";
import {
  evaluateAgentDrop,
  indexTaskThreads,
  matchesTaskFilter,
  selectLooseThreads,
  sortTasks,
  taskThreadKey,
  type TaskListFilter,
} from "./tasks.logic";
import { readDragData, readDropData, type TaskDragData } from "./tasksDnd";
import { tasksEnvironment, useTasksState } from "./tasksState";

const FILTERS: ReadonlyArray<{ readonly value: TaskListFilter; readonly label: string }> = [
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

function projectKeyOf(project: EnvironmentProject): string {
  return scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
}

function NewTaskForm({
  projects,
  defaultProject,
  onCreate,
  onCancel,
}: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly defaultProject: EnvironmentProject | null;
  readonly onCreate: (input: {
    title: string;
    project: EnvironmentProject | null;
  }) => Promise<boolean>;
  readonly onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [projectKey, setProjectKey] = useState(defaultProject ? projectKeyOf(defaultProject) : "");
  const [submitting, setSubmitting] = useState(false);
  const project = projects.find((candidate) => projectKeyOf(candidate) === projectKey) ?? null;
  const canSubmit = title.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const created = await onCreate({ title: title.trim(), project });
    setSubmitting(false);
    if (created) setTitle("");
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-card/30 px-4 py-2 sm:px-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        autoFocus
        size="sm"
        value={title}
        placeholder="Task title"
        aria-label="New task title"
        disabled={submitting}
        onChange={(event) => setTitle(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
        className="min-w-48 flex-1"
      />
      <Select value={projectKey} onValueChange={(value) => setProjectKey(value ?? "")}>
        <SelectTrigger size="sm" aria-label="Project" className="w-48">
          <SelectValue>
            <span className="truncate">{project?.title ?? "No project"}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          <SelectItem hideIndicator value="">
            No project
          </SelectItem>
          {projects.map((candidate) => (
            <SelectItem hideIndicator key={projectKeyOf(candidate)} value={projectKeyOf(candidate)}>
              {candidate.title}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Button type="submit" size="sm" disabled={!canSubmit}>
        Create
      </Button>
      <Button type="button" size="sm" variant="ghost-muted" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

export function TasksView({
  selectedTaskId,
  onSelectTask,
}: {
  readonly selectedTaskId: string | null;
  readonly onSelectTask: (taskId: TaskId | null) => void;
}) {
  const { environmentId: tasksEnvironmentId, snapshot, isLoading, error } = useTasksState();
  usePendingTaskLinkReconciler();
  const shells = useThreadShells();
  const projects = useProjects();
  const lookupEntry = useProviderEntryLookup();
  const agentPresentations = useAgentPresentations(snapshot.agents);
  const createTask = useAtomCommand(tasksEnvironment.create);
  const linkThread = useAtomCommand(tasksEnvironment.linkThread);
  const unlinkThread = useAtomCommand(tasksEnvironment.unlinkThread);

  const [filter, setFilter] = useState<TaskListFilter>("active");
  const [creating, setCreating] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState<{
    readonly taskId: TaskId;
    readonly agentId: TaskAgentId;
  } | null>(null);
  const [activeDrag, setActiveDrag] = useState<TaskDragData | null>(null);

  const index = useMemo(() => indexTaskThreads(snapshot.tasks, shells), [snapshot.tasks, shells]);
  const looseThreads = useMemo(
    () => selectLooseThreads(shells, index.taskIdByThreadKey),
    [index.taskIdByThreadKey, shells],
  );
  const visibleTasks = useMemo(
    () => sortTasks(snapshot.tasks.filter((task) => matchesTaskFilter(task, filter))),
    [filter, snapshot.tasks],
  );
  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [projectKeyOf(project), project] as const)),
    [projects],
  );
  const sortedProjects = useMemo(
    () => [...projects].toSorted((left, right) => left.title.localeCompare(right.title)),
    [projects],
  );
  const projectFor = useCallback(
    (task: Task): EnvironmentProject | null =>
      task.project
        ? (projectByKey.get(
            scopedProjectKey(scopeProjectRef(task.project.environmentId, task.project.projectId)),
          ) ?? null)
        : null,
    [projectByKey],
  );
  const selectedTask = snapshot.tasks.find((task) => task.id === selectedTaskId) ?? null;

  // A pending prompt belongs to one task and one agent; if either is gone
  // (task deleted, agent removed, selection moved) it no longer applies.
  const activeAssignment =
    pendingAssignment !== null &&
    pendingAssignment.taskId === selectedTask?.id &&
    snapshot.agents.some((agent) => agent.id === pendingAssignment.agentId)
      ? pendingAssignment
      : null;

  const draggedAgent =
    activeDrag?.kind === "agent"
      ? (snapshot.agents.find((agent) => agent.id === activeDrag.agentId) ?? null)
      : null;
  const draggedThreadOwnerTaskId =
    activeDrag?.kind === "thread"
      ? (index.taskIdByThreadKey.get(taskThreadKey(activeDrag)) ?? null)
      : null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDrag(readDragData(event.active));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const drag = readDragData(event.active);
      const drop = readDropData(event.over);
      setActiveDrag(null);
      if (drag === null || drop === null || tasksEnvironmentId === null) return;

      if (drag.kind === "agent") {
        if (drop.kind !== "task") return;
        const agent = snapshot.agents.find((candidate) => candidate.id === drag.agentId);
        const task = snapshot.tasks.find((candidate) => candidate.id === drop.taskId);
        if (!agent || !task) return;
        const verdict = evaluateAgentDrop(agent, task);
        if (!verdict.ok) {
          toastManager.add({
            type: "warning",
            title: "Can’t assign this agent",
            description: verdict.reason,
          });
          return;
        }
        onSelectTask(task.id);
        setPendingAssignment({ taskId: task.id, agentId: agent.id });
        return;
      }

      const link = { environmentId: drag.environmentId, threadId: drag.threadId };
      if (drop.kind === "task") {
        if (index.taskIdByThreadKey.get(taskThreadKey(link)) === drop.taskId) return;
        void linkThread({
          environmentId: tasksEnvironmentId,
          input: { taskId: drop.taskId, ...link },
        });
      } else if (index.taskIdByThreadKey.has(taskThreadKey(link))) {
        void unlinkThread({ environmentId: tasksEnvironmentId, input: link });
      }
    },
    [
      index.taskIdByThreadKey,
      linkThread,
      onSelectTask,
      snapshot.agents,
      snapshot.tasks,
      tasksEnvironmentId,
      unlinkThread,
    ],
  );

  const handleCreate = useCallback(
    async (input: { title: string; project: EnvironmentProject | null }) => {
      if (tasksEnvironmentId === null) return false;
      const result = await createTask({
        environmentId: tasksEnvironmentId,
        input: {
          title: input.title,
          project: input.project
            ? { environmentId: input.project.environmentId, projectId: input.project.id }
            : null,
        },
      });
      if (result._tag !== "Success") return false;
      setCreating(false);
      onSelectTask(result.value.id);
      return true;
    },
    [createTask, onSelectTask, tasksEnvironmentId],
  );

  const dropStateFor = (task: Task): "idle" | "valid" | "invalid" => {
    if (draggedAgent) return evaluateAgentDrop(draggedAgent, task).ok ? "valid" : "invalid";
    if (activeDrag?.kind === "thread")
      return draggedThreadOwnerTaskId === task.id ? "idle" : "valid";
    return "idle";
  };

  const defaultProject =
    (selectedTask ? projectFor(selectedTask) : null) ?? sortedProjects[0] ?? null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspacePageHeader electron={isElectron} className="border-b border-border/60">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
              <h1 className="truncate text-sm font-medium">Tasks</h1>
              <div
                role="radiogroup"
                aria-label="Filter tasks"
                className="ml-2 flex items-center gap-0.5 rounded-md border border-border/60 p-0.5"
              >
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={filter === option.value}
                    onClick={() => setFilter(option.value)}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs",
                      filter === option.value
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <Button
              size="sm"
              disabled={tasksEnvironmentId === null}
              onClick={() => setCreating(true)}
              className="no-drag-region"
            >
              <PlusIcon />
              New task
            </Button>
          </WorkspacePageHeader>

          <AgentToolbar agents={snapshot.agents} />

          {error ? (
            <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive-foreground sm:px-5">
              Tasks are unavailable: {error}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1 overflow-y-auto",
                selectedTask && "max-md:hidden",
              )}
            >
              {creating ? (
                <NewTaskForm
                  projects={sortedProjects}
                  defaultProject={defaultProject}
                  onCreate={handleCreate}
                  onCancel={() => setCreating(false)}
                />
              ) : null}
              {tasksEnvironmentId === null ? (
                <Empty className="py-16">
                  <EmptyHeader>
                    <EmptyTitle>Connect an environment</EmptyTitle>
                    <EmptyDescription>
                      Tasks are stored on your primary T3 Code server.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : snapshot.tasks.length === 0 && !isLoading && !creating ? (
                <Empty className="py-16">
                  <EmptyHeader>
                    <EmptyTitle>No tasks yet</EmptyTitle>
                    <EmptyDescription>
                      Create a task, add a model to the agent toolbar, then drag the agent onto the
                      task to start work.
                    </EmptyDescription>
                    <div className="mt-4 flex justify-center gap-2">
                      <Button size="sm" onClick={() => setCreating(true)}>
                        <PlusIcon />
                        New task
                      </Button>
                      {projects.length === 0 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openCommandPalette({ open: "add-project" })}
                        >
                          Add project
                        </Button>
                      ) : null}
                    </div>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul aria-label="Tasks">
                  {visibleTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      project={projectFor(task)}
                      threads={index.threadsByTaskId.get(task.id) ?? []}
                      missingCount={index.missingCountByTaskId.get(task.id) ?? 0}
                      lookupEntry={lookupEntry}
                      selected={task.id === selectedTask?.id}
                      dropState={dropStateFor(task)}
                      onSelect={() => onSelectTask(task.id === selectedTask?.id ? null : task.id)}
                    />
                  ))}
                  {visibleTasks.length === 0 && snapshot.tasks.length > 0 ? (
                    <li className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
                      Nothing matches this filter.
                    </li>
                  ) : null}
                </ul>
              )}
              {tasksEnvironmentId !== null ? (
                <LooseThreads
                  threads={looseThreads}
                  projects={projects}
                  lookupEntry={lookupEntry}
                  acceptsDrop={activeDrag?.kind === "thread" && draggedThreadOwnerTaskId !== null}
                />
              ) : null}
            </div>
            {selectedTask && tasksEnvironmentId !== null ? (
              <TaskDetail
                key={selectedTask.id}
                task={selectedTask}
                project={projectFor(selectedTask)}
                projects={sortedProjects}
                threads={index.threadsByTaskId.get(selectedTask.id) ?? []}
                missingCount={index.missingCountByTaskId.get(selectedTask.id) ?? 0}
                agents={snapshot.agents}
                agentPresentations={agentPresentations}
                pendingAgentId={activeAssignment?.agentId ?? null}
                onPendingAgentChange={(agentId) =>
                  setPendingAssignment(agentId ? { taskId: selectedTask.id, agentId } : null)
                }
                lookupEntry={lookupEntry}
                tasksEnvironmentId={tasksEnvironmentId}
                onClose={() => onSelectTask(null)}
                onDeleted={() => onSelectTask(null)}
              />
            ) : null}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {draggedAgent ? (
            (() => {
              const presentation = agentPresentations.get(draggedAgent.id);
              return presentation ? (
                <AgentBadge
                  entry={presentation.entry}
                  instanceName={presentation.instanceName}
                  machineKind={presentation.machineKind}
                  className="shadow-lg"
                />
              ) : null;
            })()
          ) : activeDrag?.kind === "thread" ? (
            <div className="max-w-64 truncate rounded-md border border-border bg-popover px-2 py-1 text-sm shadow-lg">
              {shells.find(
                (shell) =>
                  shell.environmentId === activeDrag.environmentId &&
                  shell.id === activeDrag.threadId,
              )?.title ?? "Thread"}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </SidebarInset>
  );
}
