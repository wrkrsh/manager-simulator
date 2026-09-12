import { useDraggable } from "@dnd-kit/core";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId, TaskAgent } from "@t3tools/contracts";
import { PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { getDisplayModelName } from "../components/chat/providerIconUtils";
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
import { cn, normalizeSearchText } from "../lib/utils";
import {
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { useEnvironments } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { AgentBadge, useAgentPresentations, type TaskAgentPresentation } from "./agentPresentation";
import { agentDragId } from "./tasksDnd";
import { tasksEnvironment, tasksHomeEnvironmentIdAtom } from "./tasksState";

function AgentChip({
  presentation,
  onRemove,
}: {
  readonly presentation: TaskAgentPresentation;
  readonly onRemove: () => void;
}) {
  const { agent } = presentation;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: agentDragId(agent.id),
    data: { kind: "agent", agentId: agent.id },
  });
  const label = `${presentation.modelLabel} on ${presentation.environmentLabel}`;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={250}
        render={
          <button
            ref={setNodeRef}
            type="button"
            aria-label={`${label}. Drag onto a task to assign it.`}
            className={cn(
              "inline-flex cursor-grab touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:cursor-grabbing",
              isDragging && "opacity-40",
            )}
            {...listeners}
            {...attributes}
          />
        }
      >
        <AgentBadge
          entry={presentation.entry}
          instanceName={presentation.instanceName}
          machineKind={presentation.machineKind}
        />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" className="w-64 p-3">
        <div className="flex items-start gap-3">
          <AgentBadge
            entry={presentation.entry}
            instanceName={presentation.instanceName}
            machineKind={presentation.machineKind}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">
              {presentation.modelLabel}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {presentation.instanceName}
            </div>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Model</dt>
          <dd className="truncate font-mono text-foreground">{agent.modelSelection.model}</dd>
          <dt className="text-muted-foreground">Environment</dt>
          <dd className="truncate text-foreground">{presentation.environmentLabel}</dd>
          {presentation.optionsLabel ? (
            <>
              <dt className="text-muted-foreground">Options</dt>
              <dd className="truncate text-foreground">{presentation.optionsLabel}</dd>
            </>
          ) : null}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Drag onto a task to put this agent to work on it.
        </p>
        <div className="mt-3 flex justify-end">
          <Button size="xs" variant="ghost-muted" onClick={onRemove}>
            <Trash2Icon />
            Remove from toolbar
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function AddAgentPopover({ tasksEnvironmentId }: { readonly tasksEnvironmentId: EnvironmentId }) {
  const { environments } = useEnvironments();
  const addAgent = useAtomCommand(tasksEnvironment.addAgent);
  const [open, setOpen] = useState(false);
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const [query, setQuery] = useState("");

  const connectedEnvironments = useMemo(
    () => environments.filter((environment) => environment.serverConfig !== null),
    [environments],
  );
  const effectiveEnvironmentId =
    environmentId !== null &&
    connectedEnvironments.some((environment) => environment.environmentId === environmentId)
      ? environmentId
      : (connectedEnvironments.find(
          (environment) => environment.environmentId === tasksEnvironmentId,
        )?.environmentId ??
        connectedEnvironments[0]?.environmentId ??
        null);
  const selectedEnvironment =
    connectedEnvironments.find(
      (environment) => environment.environmentId === effectiveEnvironmentId,
    ) ?? null;
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        deriveProviderInstanceEntries(selectedEnvironment?.serverConfig?.providers ?? []).filter(
          isProviderInstancePickerReady,
        ),
      ),
    [selectedEnvironment],
  );
  const selectedEntry: ProviderInstanceEntry | null =
    entries.find((entry) => entry.instanceId === instanceId) ?? entries[0] ?? null;
  const normalizedQuery = normalizeSearchText(query);
  const models = useMemo(() => {
    const all = selectedEntry?.models.filter((model) => model.isLegacy !== true) ?? [];
    if (normalizedQuery.length === 0) {
      return all;
    }
    return all.filter((model) =>
      normalizeSearchText(`${getDisplayModelName(model)} ${model.slug}`).includes(normalizedQuery),
    );
  }, [normalizedQuery, selectedEntry]);

  const pin = (model: string) => {
    if (effectiveEnvironmentId === null || selectedEntry === null) {
      return;
    }
    void addAgent({
      environmentId: tasksEnvironmentId,
      input: {
        environmentId: effectiveEnvironmentId,
        modelSelection: { instanceId: selectedEntry.instanceId, model },
      },
    });
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="icon"
            variant="outline"
            aria-label="Add an agent to the toolbar"
            className="size-9 rounded-lg border-dashed"
          />
        }
      >
        <PlusIcon />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" className="w-[22rem] p-0">
        <div className="border-b border-border/60 p-2">
          {connectedEnvironments.length > 1 ? (
            <Select
              value={effectiveEnvironmentId ?? ""}
              onValueChange={(value) => {
                setEnvironmentId(value ? (value as EnvironmentId) : null);
                setInstanceId(null);
              }}
            >
              <SelectTrigger size="sm" className="mb-2 w-full" aria-label="Environment">
                <SelectValue>{selectedEnvironment?.label ?? "Choose an environment"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {connectedEnvironments.map((environment) => (
                  <SelectItem
                    hideIndicator
                    key={environment.environmentId}
                    value={environment.environmentId}
                  >
                    {environment.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
          {entries.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {entries.map((entry) => {
                const active = entry.instanceId === selectedEntry?.instanceId;
                return (
                  <button
                    key={entry.instanceId}
                    type="button"
                    onClick={() => setInstanceId(entry.instanceId)}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                      active
                        ? "border-border bg-accent text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <ProviderInstanceIcon
                      driverKind={entry.driverKind}
                      displayName={entry.displayName}
                      accentColor={entry.accentColor}
                      iconClassName="size-3.5"
                    />
                    {entry.displayName}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {selectedEnvironment
                ? "No ready providers on this environment. Set one up in Settings → Providers."
                : "Connect an environment to add agents."}
            </p>
          )}
        </div>
        {selectedEntry ? (
          <>
            <div className="flex items-center gap-2 border-b border-border/60 px-3">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                nativeInput
                unstyled
                autoFocus
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search models"
                aria-label="Search models"
                className="h-8 text-sm"
              />
            </div>
            <ul className="max-h-64 overflow-y-auto p-1" aria-label="Models">
              {models.length === 0 ? (
                <li className="px-2 py-3 text-xs text-muted-foreground">No matching models.</li>
              ) : (
                models.map((model) => (
                  <li key={model.slug}>
                    <button
                      type="button"
                      onClick={() => pin(model.slug)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="truncate text-foreground">{getDisplayModelName(model)}</span>
                      <span className="shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                        {model.slug}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

export function AgentToolbar({ agents }: { readonly agents: ReadonlyArray<TaskAgent> }) {
  const tasksEnvironmentId = useAtomValue(tasksHomeEnvironmentIdAtom);
  const presentations = useAgentPresentations(agents);
  const removeAgent = useAtomCommand(tasksEnvironment.removeAgent);

  if (tasksEnvironmentId === null) {
    return null;
  }

  return (
    <div
      className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2 sm:px-5"
      aria-label="Agent toolbar"
    >
      <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Agents
      </span>
      {agents.map((agent) => {
        const presentation = presentations.get(agent.id);
        return presentation ? (
          <AgentChip
            key={agent.id}
            presentation={presentation}
            onRemove={() => {
              void removeAgent({
                environmentId: tasksEnvironmentId,
                input: { agentId: agent.id },
              });
            }}
          />
        ) : null;
      })}
      <AddAgentPopover tasksEnvironmentId={tasksEnvironmentId} />
      {agents.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          Add a model, then drag it onto a task to start an agent.
        </span>
      ) : null}
    </div>
  );
}
