import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, TaskId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect } from "react";
import { create } from "zustand";

import { useComposerDraftStore } from "../composerDraftStore";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { useThreadShells } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { tasksEnvironment, tasksHomeEnvironmentIdAtom } from "./tasksState";

const STORAGE_KEY = "t3code:tasks:pending-links:v1";

/**
 * A draft handed off to the full composer will become this thread once sent.
 * The task link is written when the thread exists; until then the draft is
 * the user's, and discarding it must not leave a dangling link on the task.
 */
const PendingTaskLink = Schema.Struct({
  taskId: TaskId,
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
type PendingTaskLink = typeof PendingTaskLink.Type;
const PendingTaskLinks = Schema.Array(PendingTaskLink);

function readPersisted(): ReadonlyArray<PendingTaskLink> {
  try {
    return getLocalStorageItem(STORAGE_KEY, PendingTaskLinks) ?? [];
  } catch {
    return [];
  }
}

function persist(links: ReadonlyArray<PendingTaskLink>): void {
  try {
    setLocalStorageItem(STORAGE_KEY, links, PendingTaskLinks);
  } catch {
    // Local storage is best effort; the in-memory list still drives this session.
  }
}

interface PendingTaskLinkStore {
  readonly links: ReadonlyArray<PendingTaskLink>;
  readonly add: (link: PendingTaskLink) => void;
  readonly remove: (link: Pick<PendingTaskLink, "environmentId" | "threadId">) => void;
}

const usePendingTaskLinkStore = create<PendingTaskLinkStore>((set) => ({
  links: readPersisted(),
  add: (link) =>
    set((state) => {
      const next = [
        ...state.links.filter(
          (existing) =>
            existing.environmentId !== link.environmentId || existing.threadId !== link.threadId,
        ),
        link,
      ];
      persist(next);
      return { links: next };
    }),
  remove: (link) =>
    set((state) => {
      const next = state.links.filter(
        (existing) =>
          existing.environmentId !== link.environmentId || existing.threadId !== link.threadId,
      );
      if (next.length === state.links.length) return state;
      persist(next);
      return { links: next };
    }),
}));

export function registerPendingTaskLink(link: PendingTaskLink): void {
  usePendingTaskLinkStore.getState().add(link);
}

/**
 * Links handed-off drafts to their task once the thread appears, and forgets
 * links whose draft was discarded before it was ever sent. Mounted wherever
 * the tasks feature is on screen; every instance is idempotent.
 */
export function usePendingTaskLinkReconciler(): void {
  const links = usePendingTaskLinkStore((state) => state.links);
  const remove = usePendingTaskLinkStore((state) => state.remove);
  const shells = useThreadShells();
  const tasksEnvironmentId = useAtomValue(tasksHomeEnvironmentIdAtom);
  const linkThread = useAtomCommand(tasksEnvironment.linkThread, { reportFailure: false });

  useEffect(() => {
    if (links.length === 0 || tasksEnvironmentId === null) return;
    for (const link of links) {
      const ref = scopeThreadRef(link.environmentId, link.threadId);
      const shell = shells.find(
        (candidate) =>
          candidate.environmentId === ref.environmentId && candidate.id === ref.threadId,
      );
      if (shell) {
        remove(link);
        void linkThread({
          environmentId: tasksEnvironmentId,
          input: {
            taskId: link.taskId,
            environmentId: link.environmentId,
            threadId: link.threadId,
          },
        });
        continue;
      }
      // No thread and no draft means the user threw the draft away.
      if (useComposerDraftStore.getState().getDraftSessionByRef(ref) === null) {
        remove(link);
      }
    }
  }, [linkThread, links, remove, shells, tasksEnvironmentId]);
}
