import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ModelSelection,
  type ProviderInstanceId,
  type TaskAgent,
  type TaskAgentId,
} from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { EnvironmentMachineIcon } from "../components/EnvironmentMachineIcon";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { getTriggerDisplayModelName } from "../components/chat/providerIconUtils";
import { cn } from "../lib/utils";
import {
  deriveProviderEntriesByEnvironment,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { useEnvironments } from "../state/environments";

export interface ProviderEntryLookup {
  (environmentId: EnvironmentId, instanceId: ProviderInstanceId): ProviderInstanceEntry | null;
}

/** Instance ids are per environment, so lookups must carry the environment. */
export function useProviderEntryLookup(): ProviderEntryLookup {
  const { environments } = useEnvironments();
  const entriesByEnvironment = useMemo(
    () =>
      deriveProviderEntriesByEnvironment(
        environments.map(
          (environment) =>
            [environment.environmentId, environment.serverConfig?.providers ?? []] as const,
        ),
      ),
    [environments],
  );
  return useCallback(
    (environmentId, instanceId) => entriesByEnvironment.get(environmentId)?.get(instanceId) ?? null,
    [entriesByEnvironment],
  );
}

export interface EnvironmentBadgeInfo {
  readonly label: string;
  readonly machineKind: EnvironmentMachineKind;
}

export function useEnvironmentBadges(): ReadonlyMap<EnvironmentId, EnvironmentBadgeInfo> {
  const { environments } = useEnvironments();
  return useMemo(
    () =>
      new Map(
        environments.map((environment) => [
          environment.environmentId,
          {
            label: environment.label,
            machineKind: resolveEnvironmentMachineKind(environment.serverConfig),
          },
        ]),
      ),
    [environments],
  );
}

export function modelLabelFor(
  entry: ProviderInstanceEntry | null,
  selection: ModelSelection,
): string {
  const model = entry?.models.find((candidate) => candidate.slug === selection.model);
  return model ? getTriggerDisplayModelName(model) : selection.model;
}

export function optionsLabelFor(selection: ModelSelection): string | null {
  const options = selection.options ?? [];
  if (options.length === 0) {
    return null;
  }
  return options.map((option) => `${option.id}: ${String(option.value)}`).join(" · ");
}

export interface TaskAgentPresentation {
  readonly agent: TaskAgent;
  readonly entry: ProviderInstanceEntry | null;
  readonly instanceName: string;
  readonly modelLabel: string;
  readonly optionsLabel: string | null;
  readonly environmentLabel: string;
  readonly machineKind: EnvironmentMachineKind;
}

export function useAgentPresentations(
  agents: ReadonlyArray<TaskAgent>,
): ReadonlyMap<TaskAgentId, TaskAgentPresentation> {
  const lookupEntry = useProviderEntryLookup();
  const environmentBadges = useEnvironmentBadges();
  return useMemo(
    () =>
      new Map(
        agents.map((agent) => {
          const entry = lookupEntry(agent.environmentId, agent.modelSelection.instanceId);
          const badge = environmentBadges.get(agent.environmentId);
          return [
            agent.id,
            {
              agent,
              entry,
              instanceName: entry?.displayName ?? agent.modelSelection.instanceId,
              modelLabel: modelLabelFor(entry, agent.modelSelection),
              optionsLabel: optionsLabelFor(agent.modelSelection),
              environmentLabel: badge?.label ?? "Offline environment",
              machineKind: badge?.machineKind ?? "server",
            } satisfies TaskAgentPresentation,
          ];
        }),
      ),
    [agents, environmentBadges, lookupEntry],
  );
}

/**
 * Provider logo with the environment's machine glyph tucked in the corner.
 * Used for toolbar chips, drag previews, and thread avatars on task rows.
 */
export function AgentBadge({
  entry,
  instanceName,
  machineKind,
  size = "md",
  className,
  statusDotClassName,
}: {
  readonly entry: ProviderInstanceEntry | null;
  readonly instanceName: string;
  readonly machineKind: EnvironmentMachineKind | null;
  readonly size?: "sm" | "md";
  readonly className?: string;
  readonly statusDotClassName?: string | undefined;
}) {
  const driverKind = entry?.driverKind;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-foreground",
        size === "md" ? "size-9" : "size-6 rounded-md",
        className,
      )}
    >
      {driverKind ? (
        <ProviderInstanceIcon
          driverKind={driverKind}
          displayName={instanceName}
          accentColor={entry?.accentColor}
          iconClassName={size === "md" ? "size-5" : "size-3.5"}
          {...(statusDotClassName ? { statusDotClassName } : {})}
        />
      ) : (
        <span
          className={cn(
            "font-semibold uppercase leading-none text-muted-foreground",
            size === "md" ? "text-[11px]" : "text-[9px]",
          )}
        >
          {instanceName.slice(0, 2)}
        </span>
      )}
      {machineKind ? (
        <span
          className={cn(
            "pointer-events-none absolute -right-1 -bottom-1 flex items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground",
            size === "md" ? "size-4" : "size-3",
          )}
          aria-hidden
        >
          <EnvironmentMachineIcon
            kind={machineKind}
            className={size === "md" ? "size-2.5" : "size-2"}
          />
        </span>
      ) : null}
    </span>
  );
}
