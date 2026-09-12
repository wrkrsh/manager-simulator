import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  scopeThreadRef,
  scopedProjectKey,
  scopeProjectRef,
} from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentMachineKind } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { ThreadRowLeadingStatus } from "../components/ThreadStatusIndicators";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { AgentBadge, useEnvironmentBadges, type ProviderEntryLookup } from "./agentPresentation";
import { LOOSE_THREADS_DROP_ID, threadDragId } from "./tasksDnd";

const INITIAL_VISIBLE_THREADS = 25;

function LooseThreadRow({
  shell,
  projectTitle,
  lookupEntry,
  machineKind,
  onOpen,
}: {
  readonly shell: EnvironmentThreadShell;
  readonly projectTitle: string | null;
  readonly lookupEntry: ProviderEntryLookup;
  readonly machineKind: EnvironmentMachineKind | null;
  readonly onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: threadDragId(shell.environmentId, shell.id),
    data: { kind: "thread", environmentId: shell.environmentId, threadId: shell.id },
  });
  const entry = lookupEntry(shell.environmentId, shell.modelSelection.instanceId);
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        onClick={onOpen}
        className={cn(
          "flex h-10 w-full cursor-grab touch-none items-center gap-3 border-b border-border/40 px-4 text-left text-sm outline-none hover:bg-accent/40 focus-visible:bg-accent/60 active:cursor-grabbing sm:px-5",
          isDragging && "opacity-40",
        )}
        {...listeners}
        {...attributes}
      >
        <AgentBadge
          size="sm"
          entry={entry}
          instanceName={entry?.displayName ?? shell.modelSelection.instanceId}
          machineKind={machineKind}
        />
        <span className="min-w-0 flex-1 truncate text-foreground">{shell.title}</span>
        <ThreadRowLeadingStatus thread={shell} />
        {projectTitle ? (
          <span className="hidden max-w-40 shrink-0 truncate text-xs text-muted-foreground md:inline">
            {projectTitle}
          </span>
        ) : null}
        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {formatRelativeTimeLabel(shell.updatedAt)}
        </span>
      </button>
    </li>
  );
}

/**
 * Threads no task owns. Dropping a task's thread on the header takes it back
 * out of its task, the reverse of dropping a thread onto a task row.
 */
export function LooseThreads({
  threads,
  projects,
  lookupEntry,
  acceptsDrop,
}: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly lookupEntry: ProviderEntryLookup;
  /** True while a thread that belongs to a task is being dragged. */
  readonly acceptsDrop: boolean;
}) {
  const navigate = useNavigate();
  const environmentBadges = useEnvironmentBadges();
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const { setNodeRef, isOver } = useDroppable({
    id: LOOSE_THREADS_DROP_ID,
    data: { kind: "loose" },
  });
  const projectTitleByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project.title,
        ]),
      ),
    [projects],
  );
  const visible = showAll ? threads : threads.slice(0, INITIAL_VISIBLE_THREADS);

  return (
    <section aria-label="Threads without a task">
      <button
        ref={setNodeRef}
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className={cn(
          "flex h-9 w-full items-center gap-2 border-y border-border/60 bg-muted/30 px-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-5",
          acceptsDrop && "ring-1 ring-inset ring-ring/40",
          acceptsDrop && isOver && "bg-primary/10 ring-2 ring-primary/60",
        )}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        No task
        <span className="font-normal normal-case tracking-normal">· {threads.length}</span>
        {acceptsDrop ? (
          <span className="ml-auto font-normal normal-case tracking-normal">
            Drop here to remove from its task
          </span>
        ) : null}
      </button>
      {expanded ? (
        <>
          {threads.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground sm:px-5">
              Every thread belongs to a task.
            </p>
          ) : (
            <ul>
              {visible.map((shell) => (
                <LooseThreadRow
                  key={`${shell.environmentId}:${shell.id}`}
                  shell={shell}
                  projectTitle={
                    projectTitleByKey.get(
                      scopedProjectKey(scopeProjectRef(shell.environmentId, shell.projectId)),
                    ) ?? null
                  }
                  lookupEntry={lookupEntry}
                  machineKind={environmentBadges.get(shell.environmentId)?.machineKind ?? null}
                  onOpen={() => {
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(scopeThreadRef(shell.environmentId, shell.id)),
                    });
                  }}
                />
              ))}
            </ul>
          )}
          {!showAll && threads.length > visible.length ? (
            <div className="px-4 py-2 sm:px-5">
              <Button size="xs" variant="ghost-muted" onClick={() => setShowAll(true)}>
                Show all {threads.length}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
