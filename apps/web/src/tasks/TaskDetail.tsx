import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type EnvironmentId,
  type ScopedThreadRef,
  type Task,
  type TaskAgent,
  type TaskAgentId,
  type TaskPatch,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, Trash2Icon, UnlinkIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { ProjectFavicon } from "../components/ProjectFavicon";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";
import { ThreadRowLeadingStatus } from "../components/ThreadStatusIndicators";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { toastManager } from "../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { requestConfirmDialog } from "../confirmDialog";
import { cn } from "../lib/utils";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import {
  AgentBadge,
  useEnvironmentBadges,
  type ProviderEntryLookup,
  type TaskAgentPresentation,
} from "./agentPresentation";
import { TaskAgentComposer } from "./TaskAgentComposer";
import { TaskStatusDot } from "./TaskRow";
import {
  evaluateAgentDrop,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  type TaskContextSibling,
} from "./tasks.logic";
import { threadDragId } from "./tasksDnd";
import { tasksEnvironment } from "./tasksState";

function TaskThreadRow({
  shell,
  lookupEntry,
  onOpen,
  onUnlink,
}: {
  readonly shell: EnvironmentThreadShell;
  readonly lookupEntry: ProviderEntryLookup;
  readonly onOpen: () => void;
  readonly onUnlink: () => void;
}) {
  const entry = lookupEntry(shell.environmentId, shell.modelSelection.instanceId);
  const environmentBadges = useEnvironmentBadges();
  // Draggable so a thread can move to another task or onto the "No task"
  // header, the same gestures the loose list supports.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: threadDragId(shell.environmentId, shell.id),
    data: { kind: "thread", environmentId: shell.environmentId, threadId: shell.id },
  });
  return (
    <li
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50",
        isDragging && "opacity-40",
      )}
    >
      <button
        ref={setNodeRef}
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-2 text-left text-sm outline-none focus-visible:underline active:cursor-grabbing"
        {...listeners}
        {...attributes}
      >
        <AgentBadge
          size="sm"
          entry={entry}
          instanceName={entry?.displayName ?? shell.modelSelection.instanceId}
          machineKind={environmentBadges.get(shell.environmentId)?.machineKind ?? null}
        />
        <span className="min-w-0 flex-1 truncate text-foreground">{shell.title}</span>
        <ThreadRowLeadingStatus thread={shell} />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatRelativeTimeLabel(shell.updatedAt)}
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Remove this thread from the task"
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              onClick={onUnlink}
            />
          }
        >
          <UnlinkIcon />
        </TooltipTrigger>
        <TooltipPopup side="top">Remove from task</TooltipPopup>
      </Tooltip>
    </li>
  );
}

function AssignAgentMenu({
  task,
  agents,
  presentations,
  onPick,
}: {
  readonly task: Task;
  readonly agents: ReadonlyArray<TaskAgent>;
  readonly presentations: ReadonlyMap<TaskAgentId, TaskAgentPresentation>;
  readonly onPick: (agentId: TaskAgentId) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="xs" variant="outline" />}>
        <BotIcon />
        Assign agent
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" className="w-72 p-1">
        {agents.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Add a model to the agent toolbar first.
          </p>
        ) : (
          <ul aria-label="Agents">
            {agents.map((agent) => {
              const presentation = presentations.get(agent.id);
              if (!presentation) return null;
              const verdict = evaluateAgentDrop(agent, task);
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    disabled={!verdict.ok}
                    onClick={() => {
                      onPick(agent.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <AgentBadge
                      size="sm"
                      entry={presentation.entry}
                      instanceName={presentation.instanceName}
                      machineKind={presentation.machineKind}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        <span className="text-foreground">{presentation.modelLabel}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {presentation.environmentLabel}
                        </span>
                      </span>
                      {verdict.ok ? null : (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {verdict.reason}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverPopup>
    </Popover>
  );
}

export function TaskDetail({
  task,
  project,
  projects,
  threads,
  missingCount,
  agents,
  agentPresentations,
  pendingAgentId,
  onPendingAgentChange,
  lookupEntry,
  tasksEnvironmentId,
  onClose,
  onDeleted,
}: {
  readonly task: Task;
  readonly project: EnvironmentProject | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly missingCount: number;
  readonly agents: ReadonlyArray<TaskAgent>;
  readonly agentPresentations: ReadonlyMap<TaskAgentId, TaskAgentPresentation>;
  /** The agent dropped on this task whose prompt is still being written. */
  readonly pendingAgentId: TaskAgentId | null;
  readonly onPendingAgentChange: (agentId: TaskAgentId | null) => void;
  readonly lookupEntry: ProviderEntryLookup;
  readonly tasksEnvironmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const navigate = useNavigate();
  const updateTask = useAtomCommand(tasksEnvironment.update);
  const removeTask = useAtomCommand(tasksEnvironment.remove);
  const unlinkThread = useAtomCommand(tasksEnvironment.unlinkThread);
  const { setNodeRef, isOver } = useDroppable({
    id: `task-detail:${task.id}`,
    data: { kind: "task", taskId: task.id },
  });

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  // Another client may edit the task while it is open here: follow the server
  // value whenever it changes, which also covers this client's own commits.
  const [seenTitle, setSeenTitle] = useState(task.title);
  const [seenDescription, setSeenDescription] = useState(task.description);
  if (seenTitle !== task.title) {
    setSeenTitle(task.title);
    setTitle(task.title);
  }
  if (seenDescription !== task.description) {
    setSeenDescription(task.description);
    setDescription(task.description);
  }

  const patch = (value: TaskPatch) => {
    void updateTask({
      environmentId: tasksEnvironmentId,
      input: { taskId: task.id, patch: value },
    });
  };
  const commitTitle = () => {
    const next = title.trim();
    if (next.length === 0) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title) patch({ title: next });
  };
  const commitDescription = () => {
    if (description !== task.description) patch({ description });
  };

  const projectOptions = useMemo(
    () => [...projects].toSorted((left, right) => left.title.localeCompare(right.title)),
    [projects],
  );
  const projectKey = task.project
    ? scopedProjectKey(scopeProjectRef(task.project.environmentId, task.project.projectId))
    : "";

  const openThread = (ref: ScopedThreadRef) => {
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  const siblingThreads: ReadonlyArray<TaskContextSibling> = threads.map((shell) => ({
    title: shell.title,
    status: resolveThreadStatusPill({ thread: shell })?.label ?? null,
  }));
  const pendingAgent = pendingAgentId ? (agentPresentations.get(pendingAgentId) ?? null) : null;

  const deleteTask = async () => {
    const confirmed = await (requestConfirmDialog(
      "Delete this task? Its threads stay available in the sidebar.",
    ) ?? Promise.resolve(true));
    if (!confirmed) return;
    const result = await removeTask({
      environmentId: tasksEnvironmentId,
      input: { taskId: task.id },
    });
    if (result._tag === "Success") onDeleted();
  };

  return (
    <section
      ref={setNodeRef}
      aria-label={`Task: ${task.title}`}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden border-border/60 bg-background md:w-[26rem] md:shrink-0 md:border-l",
        isOver && "bg-primary/5",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <Select
          value={task.status}
          onValueChange={(value) => {
            if (value) patch({ status: value as Task["status"] });
          }}
        >
          <SelectTrigger size="sm" aria-label="Status" className="min-w-0">
            <SelectValue>
              <span className="flex items-center gap-1.5">
                <TaskStatusDot status={task.status} className="text-muted-foreground/70" />
                {TASK_STATUS_META[task.status].label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {TASK_STATUSES.map((status) => (
              <SelectItem hideIndicator key={status} value={status}>
                <span className="flex items-center gap-1.5">
                  <TaskStatusDot status={status} className="text-muted-foreground/70" />
                  {TASK_STATUS_META[status].label}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={task.priority}
          onValueChange={(value) => {
            if (value) patch({ priority: value as Task["priority"] });
          }}
        >
          <SelectTrigger size="sm" aria-label="Priority" className="min-w-0">
            <SelectValue>{TASK_PRIORITY_META[task.priority].label}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {TASK_PRIORITIES.map((priority) => (
              <SelectItem hideIndicator key={priority} value={priority}>
                {TASK_PRIORITY_META[priority].label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Delete task"
                onClick={() => void deleteTask()}
              />
            }
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Delete task</TooltipPopup>
        </Tooltip>
        <Button size="icon-xs" variant="ghost-muted" aria-label="Close task" onClick={onClose}>
          <XIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Input
          nativeInput
          unstyled
          value={title}
          aria-label="Task title"
          onChange={(event) => setTitle(event.currentTarget.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setTitle(task.title);
              event.currentTarget.blur();
            }
          }}
          className="w-full bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-placeholder"
        />

        <div className="mt-2">
          <Select
            value={projectKey}
            onValueChange={(value) => {
              const selected = projectOptions.find(
                (candidate) =>
                  scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id)) ===
                  value,
              );
              patch({
                project: selected
                  ? { environmentId: selected.environmentId, projectId: selected.id }
                  : null,
              });
            }}
          >
            <SelectTrigger size="sm" aria-label="Project" className="max-w-full">
              <SelectValue>
                {project ? (
                  <span className="flex items-center gap-1.5">
                    <ProjectFavicon project={project} className="size-3.5" />
                    <span className="truncate">{project.title}</span>
                  </span>
                ) : (
                  "Choose a project"
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {projectOptions.map((candidate) => (
                <SelectItem
                  hideIndicator
                  key={scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id))}
                  value={scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id))}
                >
                  <span className="flex items-center gap-1.5">
                    <ProjectFavicon project={candidate} className="size-3.5" />
                    <span className="truncate">{candidate.title}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        <Textarea
          size="sm"
          value={description}
          aria-label="Task description"
          placeholder="Add a description. Agents receive it with their first prompt."
          onChange={(event) => setDescription(event.currentTarget.value)}
          onBlur={commitDescription}
          className="mt-3"
        />

        <h3 className="mt-5 mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Threads
        </h3>
        {threads.length === 0 && missingCount === 0 ? (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            No agent has worked on this yet.
          </p>
        ) : (
          <ul className="-mx-2">
            {threads.map((shell) => (
              <TaskThreadRow
                key={`${shell.environmentId}:${shell.id}`}
                shell={shell}
                lookupEntry={lookupEntry}
                onOpen={() => openThread(scopeThreadRef(shell.environmentId, shell.id))}
                onUnlink={() => {
                  void unlinkThread({
                    environmentId: tasksEnvironmentId,
                    input: { environmentId: shell.environmentId, threadId: shell.id },
                  });
                }}
              />
            ))}
          </ul>
        )}
        {missingCount > 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {missingCount === 1
              ? "1 linked thread is unavailable right now."
              : `${missingCount} linked threads are unavailable right now.`}
          </p>
        ) : null}

        <div className="mt-4">
          {pendingAgent && project ? (
            <TaskAgentComposer
              key={pendingAgent.agent.id}
              task={task}
              project={project}
              agent={pendingAgent}
              siblingThreads={siblingThreads}
              onCancel={() => onPendingAgentChange(null)}
              onStarted={(threadRef) => {
                onPendingAgentChange(null);
                toastManager.add({
                  type: "success",
                  title: "Agent started",
                  description: `${pendingAgent.modelLabel} is working on “${task.title}”.`,
                  timeout: 4_000,
                });
                void threadRef;
              }}
            />
          ) : project ? (
            <div
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground",
                isOver && "border-primary/60 bg-primary/5",
              )}
            >
              <span>Drag an agent from the toolbar onto this task to put it to work.</span>
              <AssignAgentMenu
                task={task}
                agents={agents}
                presentations={agentPresentations}
                onPick={onPendingAgentChange}
              />
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              Choose a project so agents know where to work.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
