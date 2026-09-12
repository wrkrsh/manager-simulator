import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_SERVER_SETTINGS,
  type ChatAttachment,
  type ScopedThreadRef,
  type Task,
  type TaskAgent,
  type ThreadEnvMode,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { useCallback } from "react";

import { newMessageId, newThreadId, randomHex } from "../lib/utils";
import { environmentServerConfigsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { buildTaskContextPrompt, type TaskContextSibling } from "./tasks.logic";
import { tasksEnvironment, tasksHomeEnvironmentIdAtom } from "./tasksState";

const MAX_THREAD_TITLE_LENGTH = 80;

function threadTitleFromTask(title: string): string {
  return title.length <= MAX_THREAD_TITLE_LENGTH
    ? title
    : `${title.slice(0, MAX_THREAD_TITLE_LENGTH - 1).trimEnd()}…`;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface StartTaskThreadInput {
  readonly task: Task;
  readonly project: EnvironmentProject;
  readonly agent: TaskAgent;
  readonly prompt: string;
  readonly envMode: ThreadEnvMode;
  /** The checkout to branch from when `envMode` is "worktree". */
  readonly baseBranch: string | null;
  readonly siblingThreads: ReadonlyArray<TaskContextSibling>;
  /** Already uploaded, or inline data URLs when the server cannot take uploads. */
  readonly attachments: ReadonlyArray<ChatAttachment | UploadChatImageAttachment>;
}

export type StartTaskThreadResult =
  | { readonly ok: true; readonly threadRef: ScopedThreadRef; readonly linkError: string | null }
  | { readonly ok: false; readonly error: string };

/**
 * Creates a thread in the task's project and starts its first turn with the
 * task context ahead of the prompt, then records the thread on the task. The
 * thread id is minted here so the link can be written even if the shell
 * snapshot lags behind the command.
 */
export function useStartTaskThread() {
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const linkThread = useAtomCommand(tasksEnvironment.linkThread, { reportFailure: false });
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const tasksHomeEnvironmentId = useAtomValue(tasksHomeEnvironmentIdAtom);

  return useCallback(
    async (input: StartTaskThreadInput): Promise<StartTaskThreadResult> => {
      const { task, project, agent } = input;
      if (tasksHomeEnvironmentId === null) {
        return { ok: false, error: "No environment is connected." };
      }
      const useWorktree = input.envMode === "worktree";
      if (useWorktree && input.baseBranch === null) {
        return { ok: false, error: "Select a base branch before starting in a new worktree." };
      }
      const settings =
        serverConfigs.get(project.environmentId)?.settings ?? DEFAULT_SERVER_SETTINGS;
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const title = threadTitleFromTask(task.title);
      const text = buildTaskContextPrompt({
        task,
        projectTitle: project.title,
        siblingThreads: input.siblingThreads,
        prompt: input.prompt,
      });

      const started = await startTurn({
        environmentId: project.environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text,
            attachments: [...input.attachments],
          },
          modelSelection: agent.modelSelection,
          titleSeed: title,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          bootstrap: {
            createThread: {
              projectId: project.id,
              title,
              modelSelection: agent.modelSelection,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              branch: useWorktree ? input.baseBranch : null,
              worktreePath: null,
              createdAt,
            },
            ...(useWorktree && input.baseBranch !== null
              ? {
                  prepareWorktree: {
                    projectCwd: project.workspaceRoot,
                    baseBranch: input.baseBranch,
                    branch: buildTemporaryWorktreeBranchName(randomHex),
                    ...(settings.newWorktreesStartFromOrigin ? { startFromOrigin: true } : {}),
                  },
                  runSetupScript: true,
                }
              : {}),
          },
          createdAt,
        },
      });
      if (started._tag === "Failure") {
        return { ok: false, error: describeFailure(squashAtomCommandFailure(started)) };
      }

      const threadRef = scopeThreadRef(project.environmentId, threadId);
      const linked = await linkThread({
        environmentId: tasksHomeEnvironmentId,
        input: { taskId: task.id, environmentId: project.environmentId, threadId },
      });
      return {
        ok: true,
        threadRef,
        linkError:
          linked._tag === "Failure" ? describeFailure(squashAtomCommandFailure(linked)) : null,
      };
    },
    [linkThread, serverConfigs, startTurn, tasksHomeEnvironmentId],
  );
}
