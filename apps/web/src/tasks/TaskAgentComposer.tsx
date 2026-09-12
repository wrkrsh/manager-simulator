import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_SERVER_SETTINGS,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ChatAttachment,
  type ScopedThreadRef,
  type Task,
  type ThreadEnvMode,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";
import { resolveDefaultThreadEnvMode } from "@t3tools/shared/threadEnvMode";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  ArrowUpIcon,
  ExpandIcon,
  FileIcon,
  GitBranchIcon,
  PaperclipIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import { readFileAsDataUrl } from "../components/ChatView.logic";
import {
  classifyComposerAttachmentFile,
  fileAttachmentCapabilityBlockReason,
  fileAttachmentStagingLimit,
  normalizeComposerImageFileMimeType,
} from "../components/chat/composerAttachmentFiles";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import type { ComposerFileAttachment, ComposerImageAttachment } from "../composerDraftStore";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "../lib/attachmentUploadQueue";
import { prepareImageForAttachment } from "../lib/imageCompression";
import { readT3ProjectFileDefaultThreadEnvMode } from "../lib/t3ProjectFileDefaults";
import { cn, randomUUID } from "../lib/utils";
import { environmentServerConfigsAtom } from "../state/server";
import { vcsEnvironment } from "../state/vcs";
import { AgentBadge, type TaskAgentPresentation } from "./agentPresentation";
import type { TaskContextSibling } from "./tasks.logic";
import { useHandOffTaskToDraft } from "./useHandOffTaskToDraft";
import { useStartTaskThread } from "./useStartTaskThread";

type StagedAttachment = ComposerImageAttachment | ComposerFileAttachment;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function revokePreviews(attachments: ReadonlyArray<StagedAttachment>): void {
  for (const attachment of attachments) {
    if (attachment.type === "image" && attachment.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

function hasFiles(transfer: DataTransfer | null): boolean {
  return transfer !== null && Array.from(transfer.types).includes("Files");
}

/**
 * The prompt box that appears once an agent lands on a task. It creates the
 * thread and its first turn, with pasted or dropped attachments; follow-ups
 * and everything else the full composer offers live in the chat view, which
 * "Open in full composer" hands the same assignment to.
 */
export function TaskAgentComposer({
  task,
  project,
  agent,
  siblingThreads,
  onCancel,
  onStarted,
}: {
  readonly task: Task;
  readonly project: EnvironmentProject;
  readonly agent: TaskAgentPresentation;
  readonly siblingThreads: ReadonlyArray<TaskContextSibling>;
  readonly onCancel: () => void;
  readonly onStarted: (threadRef: ScopedThreadRef) => void;
}) {
  const startTaskThread = useStartTaskThread();
  const handOffToDraft = useHandOffTaskToDraft();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const vcsStatus = Option.getOrNull(
    AsyncResult.value(
      useAtomValue(
        vcsEnvironment.status({
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot },
        }),
      ),
    ),
  );
  const isRepo = vcsStatus?.isRepo ?? false;
  const currentBranch = vcsStatus?.refName ?? null;
  const [prompt, setPrompt] = useState("");
  const [envMode, setEnvMode] = useState<ThreadEnvMode | null>(null);
  const [attachments, setAttachments] = useState<ReadonlyArray<StagedAttachment>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"idle" | "adding" | "starting" | "handing-off">("idle");
  const [dropActive, setDropActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef(attachments);
  const releaseOnUnmountRef = useRef(true);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const environmentConfig = serverConfigs.get(project.environmentId) ?? null;
  const attachmentUploadsCapabilityKnown = environmentConfig !== null;
  const supportsAttachmentUploads =
    environmentConfig?.environment.capabilities.attachmentUploads === true;
  const maxFileAttachmentBytes =
    environmentConfig?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null;
  const fileStagingLimit = fileAttachmentStagingLimit({
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    maxFileAttachmentBytes,
  });

  // Resolve the project's default workspace mode once, the same way a new
  // draft does; an explicit toggle by the user afterwards wins.
  useEffect(() => {
    let cancelled = false;
    const globalDefault =
      serverConfigs.get(project.environmentId)?.settings.defaultThreadEnvMode ??
      DEFAULT_SERVER_SETTINGS.defaultThreadEnvMode;
    const resolve = async () => {
      const projectFile =
        project.defaultThreadEnvMode == null
          ? await readT3ProjectFileDefaultThreadEnvMode(
              project.environmentId,
              project.workspaceRoot,
            )
          : null;
      if (cancelled) return;
      setEnvMode(
        (current) =>
          current ??
          resolveDefaultThreadEnvMode({
            projectSetting: project.defaultThreadEnvMode,
            projectFile,
            globalDefault,
          }),
      );
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [project.defaultThreadEnvMode, project.environmentId, project.workspaceRoot, serverConfigs]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Staged files that never left this box are discarded with it. Ones that
  // were sent or handed to a draft are owned elsewhere by then.
  useEffect(
    () => () => {
      if (releaseOnUnmountRef.current) {
        releaseDraftAttachments(attachmentsRef.current);
        revokePreviews(attachmentsRef.current);
      }
    },
    [],
  );

  const effectiveEnvMode: ThreadEnvMode = isRepo ? (envMode ?? "local") : "local";
  const canSend = (prompt.trim().length > 0 || attachments.length > 0) && busy === "idle";

  const addFiles = async (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    setBusy("adding");
    const accepted: StagedAttachment[] = [];
    let problem: string | null = null;
    let count = attachmentsRef.current.length;
    for (const file of files) {
      if (count >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
        problem = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`;
        break;
      }
      const kind = classifyComposerAttachmentFile(file);
      if (kind === "unsupported-image") {
        problem = `'${file.name}' is not a supported image type. Attach GIF, HEIC, HEIF, JPEG, PNG, or WebP images.`;
        continue;
      }
      if (kind === "image") {
        const prepared = await prepareImageForAttachment(
          normalizeComposerImageFileMimeType(file),
          PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
        );
        if (!prepared.ok) {
          problem =
            prepared.reason === "unreadable"
              ? `'${file.name}' could not be read as an image.`
              : `'${file.name}' is too large to attach, even after compression.`;
          continue;
        }
        accepted.push({
          type: "image",
          id: randomUUID(),
          name: prepared.file.name || "image",
          mimeType: prepared.file.type,
          sizeBytes: prepared.file.size,
          previewUrl: URL.createObjectURL(prepared.file),
          file: prepared.file,
        });
      } else {
        if (fileStagingLimit === null) {
          problem = "This server does not support file attachments.";
          continue;
        }
        if (file.size <= 0) {
          problem = `'${file.name}' is empty or could not be read.`;
          continue;
        }
        if (file.size > fileStagingLimit) {
          problem = `'${file.name}' is larger than this server accepts (${formatBytes(fileStagingLimit)}).`;
          continue;
        }
        accepted.push({
          type: "file",
          id: randomUUID(),
          name: file.name || "file",
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          file,
        });
      }
      count += 1;
    }
    if (accepted.length > 0) {
      setAttachments((current) => [...current, ...accepted]);
    }
    setError(problem);
    setBusy("idle");
    textareaRef.current?.focus();
  };

  const removeAttachment = (attachment: StagedAttachment) => {
    releaseDraftAttachments([attachment]);
    revokePreviews([attachment]);
    setAttachments((current) => current.filter((candidate) => candidate.id !== attachment.id));
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropActive(false);
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const prepareAttachmentsForSend = async (): Promise<
    | { ok: true; attachments: Array<ChatAttachment | UploadChatImageAttachment> }
    | { ok: false; error: string }
  > => {
    const staged = attachmentsRef.current;
    if (staged.length === 0) return { ok: true, attachments: [] };
    const files = staged.filter((attachment) => attachment.type === "file");
    const blockReason = fileAttachmentCapabilityBlockReason({
      files,
      attachmentUploadsCapabilityKnown,
      supportsAttachmentUploads,
      maxFileAttachmentBytes,
    });
    if (blockReason !== null) return { ok: false, error: blockReason };
    if (supportsAttachmentUploads) {
      for (const attachment of staged) {
        startAttachmentUpload({ environmentId: project.environmentId, image: attachment });
      }
      await awaitAttachmentUploads(staged.map((attachment) => attachment.id));
      const uploaded = getUploadedAttachments({
        environmentId: project.environmentId,
        images: staged,
      });
      if (uploaded === null) {
        return { ok: false, error: "An attachment failed to upload. Remove it and try again." };
      }
      return { ok: true, attachments: uploaded };
    }
    const inline: UploadChatImageAttachment[] = [];
    for (const attachment of staged) {
      if (attachment.type !== "image") {
        return { ok: false, error: "This server does not support file attachments." };
      }
      inline.push({
        type: "image",
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        dataUrl: await readFileAsDataUrl(attachment.file),
        ...(attachment.source ? { source: attachment.source } : {}),
      });
    }
    return { ok: true, attachments: inline };
  };

  const send = async () => {
    if (!canSend) return;
    setBusy("starting");
    setError(null);
    const prepared = await prepareAttachmentsForSend();
    if (!prepared.ok) {
      setError(prepared.error);
      setBusy("idle");
      return;
    }
    const result = await startTaskThread({
      task,
      project,
      agent: agent.agent,
      prompt,
      envMode: effectiveEnvMode,
      baseBranch: currentBranch,
      siblingThreads,
      attachments: prepared.attachments,
    });
    if (!result.ok) {
      setError(result.error);
      setBusy("idle");
      return;
    }
    // The turn owns the uploads now; drop the local staging copies.
    releaseOnUnmountRef.current = false;
    releaseDraftAttachments(attachmentsRef.current);
    revokePreviews(attachmentsRef.current);
    onStarted(result.threadRef);
  };

  const handOff = async () => {
    if (busy !== "idle") return;
    setBusy("handing-off");
    setError(null);
    // The draft takes over the staged files, previews included.
    releaseOnUnmountRef.current = false;
    const moved = await handOffToDraft({
      task,
      project,
      agent: agent.agent,
      envMode: effectiveEnvMode,
      siblingThreads,
      prompt,
      attachments: attachmentsRef.current,
    });
    if (!moved) {
      releaseOnUnmountRef.current = true;
      setError("Couldn’t open the composer for this project.");
      setBusy("idle");
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/40 p-3 shadow-xs/5 transition-colors",
        dropActive && "border-primary/60 bg-primary/5",
      )}
      onDragOver={(event) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropActive(false);
      }}
      onDrop={onDrop}
    >
      <div className="mb-2 flex items-center gap-2">
        <AgentBadge
          size="sm"
          entry={agent.entry}
          instanceName={agent.instanceName}
          machineKind={agent.machineKind}
        />
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-medium text-foreground">{agent.modelLabel}</span>
          <span className="text-muted-foreground"> · {agent.environmentLabel}</span>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Open in full composer"
                disabled={busy !== "idle"}
                onClick={() => void handOff()}
              />
            }
          >
            <ExpandIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">
            Open in the full composer for mentions, skills, and model options
          </TooltipPopup>
        </Tooltip>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Cancel"
          disabled={busy === "starting" || busy === "handing-off"}
          onClick={onCancel}
        >
          <XIcon />
        </Button>
      </div>
      <Textarea
        ref={textareaRef}
        size="sm"
        value={prompt}
        disabled={busy === "starting" || busy === "handing-off"}
        placeholder={`What should this agent do for "${task.title}"? The task details are sent along.`}
        aria-label="Prompt for the agent"
        onChange={(event) => setPrompt(event.currentTarget.value)}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      {attachments.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="group relative flex h-12 items-center gap-2 rounded-md border border-border/60 bg-background pr-7 pl-1 text-xs"
            >
              {attachment.type === "image" ? (
                <img
                  src={attachment.previewUrl}
                  alt={attachment.name}
                  className="size-10 rounded object-cover"
                />
              ) : (
                <span className="flex size-10 items-center justify-center rounded bg-muted text-muted-foreground">
                  <FileIcon className="size-4" />
                </span>
              )}
              <span className="flex max-w-40 flex-col">
                <span className="truncate text-foreground">{attachment.name}</span>
                <span className="text-muted-foreground">{formatBytes(attachment.sizeBytes)}</span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => removeAttachment(attachment)}
                className="absolute top-1 right-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isRepo ? (
          <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5 text-xs whitespace-nowrap">
            <button
              type="button"
              onClick={() => setEnvMode("local")}
              className={cn(
                "rounded px-2 py-0.5",
                effectiveEnvMode === "local"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Local checkout
            </button>
            <button
              type="button"
              onClick={() => setEnvMode("worktree")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5",
                effectiveEnvMode === "worktree"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <GitBranchIcon className="size-3" />
              New worktree
            </button>
          </div>
        ) : null}
        {effectiveEnvMode === "worktree" && currentBranch ? (
          <span className="truncate text-xs text-muted-foreground">from {currentBranch}</span>
        ) : null}
        <span className="flex-1" />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void addFiles(files);
          }}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Attach files"
                disabled={busy !== "idle"}
                onClick={() => fileInputRef.current?.click()}
              />
            }
          >
            <PaperclipIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">Attach files, or paste and drop them here</TooltipPopup>
        </Tooltip>
        <Button size="sm" disabled={!canSend} onClick={() => void send()}>
          {busy === "starting" ? <Spinner className="size-3.5" /> : <ArrowUpIcon />}
          Start agent
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-destructive-foreground">{error}</p> : null}
    </div>
  );
}
