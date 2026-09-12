import { useDroppable } from "@dnd-kit/core";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { Task } from "@t3tools/contracts";
import { AlertTriangleIcon } from "lucide-react";

import { ProjectFavicon } from "../components/ProjectFavicon";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { AgentBadge, useEnvironmentBadges, type ProviderEntryLookup } from "./agentPresentation";
import { TASK_PRIORITY_META, TASK_STATUS_META } from "./tasks.logic";
import { taskDropId } from "./tasksDnd";

export function TaskStatusDot({
  status,
  className,
}: {
  readonly status: Task["status"];
  readonly className?: string;
}) {
  const meta = TASK_STATUS_META[status];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-2",
        status === "done" || status === "canceled" ? "border-transparent" : "border-current",
        className,
      )}
      style={{ color: undefined }}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          meta.dotClass,
          status === "done" || status === "canceled" ? "size-3.5" : undefined,
        )}
      />
    </span>
  );
}

const MAX_VISIBLE_THREAD_AVATARS = 4;

export function TaskThreadAvatars({
  threads,
  lookupEntry,
  missingCount,
}: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly lookupEntry: ProviderEntryLookup;
  readonly missingCount: number;
}) {
  const environmentBadges = useEnvironmentBadges();
  const visible = threads.slice(0, MAX_VISIBLE_THREAD_AVATARS);
  const overflow = threads.length - visible.length;
  if (threads.length === 0 && missingCount === 0) {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-1">
      {visible.map((shell) => {
        const entry = lookupEntry(shell.environmentId, shell.modelSelection.instanceId);
        const pill = resolveThreadStatusPill({ thread: shell });
        return (
          <Tooltip key={`${shell.environmentId}:${shell.id}`}>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <AgentBadge
                size="sm"
                entry={entry}
                instanceName={entry?.displayName ?? shell.modelSelection.instanceId}
                machineKind={environmentBadges.get(shell.environmentId)?.machineKind ?? null}
                statusDotClassName={
                  pill ? cn(pill.dotClass, pill.pulse && "animate-status-pulse") : undefined
                }
              />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {shell.title}
              {pill ? ` · ${pill.label}` : ""}
            </TooltipPopup>
          </Tooltip>
        );
      })}
      {overflow > 0 ? (
        <span className="text-[11px] font-medium text-muted-foreground">+{overflow}</span>
      ) : null}
      {missingCount > 0 ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex text-muted-foreground" />}>
            <AlertTriangleIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {missingCount === 1
              ? "1 linked thread is unavailable (deleted or its environment is offline)."
              : `${missingCount} linked threads are unavailable (deleted or their environment is offline).`}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}

export function TaskRow({
  task,
  project,
  threads,
  missingCount,
  lookupEntry,
  selected,
  dropState,
  onSelect,
}: {
  readonly task: Task;
  readonly project: EnvironmentProject | null;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly missingCount: number;
  readonly lookupEntry: ProviderEntryLookup;
  readonly selected: boolean;
  /** How this row should react to the item currently being dragged, if any. */
  readonly dropState: "idle" | "valid" | "invalid";
  readonly onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: taskDropId(task.id),
    data: { kind: "task", taskId: task.id },
  });
  const priority = TASK_PRIORITY_META[task.priority];
  return (
    <li ref={setNodeRef}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex h-11 w-full items-center gap-3 border-b border-border/50 px-4 text-left text-sm outline-none transition-colors focus-visible:bg-accent/60 sm:px-5",
          selected ? "bg-accent/70" : "hover:bg-accent/40",
          dropState === "valid" && "ring-1 ring-inset ring-ring/40",
          dropState === "valid" && isOver && "bg-primary/10 ring-2 ring-primary/60",
          dropState === "invalid" && isOver && "cursor-not-allowed bg-destructive/5",
          dropState === "invalid" && "opacity-60",
        )}
      >
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <TaskStatusDot status={task.status} className="text-muted-foreground/70" />
          </TooltipTrigger>
          <TooltipPopup side="top">{TASK_STATUS_META[task.status].label}</TooltipPopup>
        </Tooltip>
        {task.priority !== "none" ? (
          <span
            className={cn(
              "w-6 shrink-0 text-center font-mono text-[11px] font-semibold",
              task.priority === "urgent"
                ? "text-destructive-foreground"
                : task.priority === "high"
                  ? "text-warning-foreground"
                  : "text-muted-foreground",
            )}
            aria-label={priority.label}
          >
            {priority.short}
          </span>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium",
            (task.status === "done" || task.status === "canceled") &&
              "text-muted-foreground line-through decoration-muted-foreground/40",
          )}
        >
          {task.title}
        </span>
        <TaskThreadAvatars
          threads={threads}
          lookupEntry={lookupEntry}
          missingCount={missingCount}
        />
        {project ? (
          <span className="hidden max-w-40 shrink-0 items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
            <ProjectFavicon project={project} className="size-3.5" />
            <span className="truncate">{project.title}</span>
          </span>
        ) : (
          <span className="hidden shrink-0 text-xs text-muted-foreground/70 md:inline">
            No project
          </span>
        )}
        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {formatRelativeTimeLabel(task.updatedAt)}
        </span>
      </button>
    </li>
  );
}
