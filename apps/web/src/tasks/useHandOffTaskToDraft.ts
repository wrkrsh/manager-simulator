import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { Task, TaskAgent, ThreadEnvMode } from "@t3tools/contracts";
import { useCallback } from "react";

import {
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
} from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { registerPendingTaskLink } from "./pendingTaskLinks";
import { buildTaskContextPrompt, type TaskContextSibling } from "./tasks.logic";

/**
 * Moves an assignment into the regular chat composer for everything the
 * inline prompt box does not offer: mentions, skills, model options, branch
 * choice. The task context is placed in the draft as editable text, staged
 * attachments come along, and the thread is linked to the task once the
 * draft is sent.
 */
export function useHandOffTaskToDraft() {
  const handleNewThread = useNewThreadHandler();

  return useCallback(
    async (input: {
      readonly task: Task;
      readonly project: EnvironmentProject;
      readonly agent: TaskAgent;
      readonly envMode: ThreadEnvMode;
      readonly siblingThreads: ReadonlyArray<TaskContextSibling>;
      readonly prompt: string;
      readonly attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>;
    }): Promise<boolean> => {
      const opened = await handleNewThread(
        scopeProjectRef(input.project.environmentId, input.project.id),
        { envMode: input.envMode },
      );
      if (!opened) {
        return false;
      }
      const store = useComposerDraftStore.getState();
      store.setModelSelection(opened.draftId, input.agent.modelSelection, {
        explicit: true,
        replaceOptions: true,
      });
      store.setPrompt(
        opened.draftId,
        buildTaskContextPrompt({
          task: input.task,
          projectTitle: input.project.title,
          siblingThreads: input.siblingThreads,
          prompt: input.prompt,
        }),
      );
      const images = input.attachments.filter(
        (attachment): attachment is ComposerImageAttachment => attachment.type === "image",
      );
      const files = input.attachments.filter(
        (attachment): attachment is ComposerFileAttachment => attachment.type === "file",
      );
      if (images.length > 0) store.addImages(opened.draftId, images);
      if (files.length > 0) store.addFiles(opened.draftId, files);
      registerPendingTaskLink({
        taskId: input.task.id,
        environmentId: input.project.environmentId,
        threadId: opened.threadId,
      });
      return true;
    },
    [handleNewThread],
  );
}
