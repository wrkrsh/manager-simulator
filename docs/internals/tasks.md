# Tasks (fork)

This repository is a fork of T3 Code that adds a task view and makes it the home screen.
The feature is deliberately a sidecar to the upstream design so `git merge upstream/main`
stays routine: threads and the orchestration event store know nothing about tasks, and the
feature lives in its own modules.

## Where it lives

- [`packages/contracts/src/task.ts`](../../packages/contracts/src/task.ts): the `Task`,
  `TaskAgent`, and `TasksSnapshot` schemas plus the `tasks.*` RPCs.
- [`apps/server/src/tasks/`](../../apps/server/src/tasks/): a JSON-file store with a
  whole-snapshot change stream, and the RPC handlers with their authorization scopes.
- [`apps/web/src/tasks/`](../../apps/web/src/tasks/): the view, the toolbar, and the
  atoms that subscribe to the store on the client's "tasks home" environment.

## Why a snapshot file and not orchestration events

Tasks are few, small, and edited by hand, and they reference threads across environments.
Adding them as orchestration events would mean a decider, projector, and SQLite migration,
and migrations are numbered sequentially: every upstream migration would collide with ours.
One atomically written `tasks.json` in the state directory, cached in memory and streamed as
whole snapshots, is enough and touches none of that.

Tasks are stored on one server, the client's primary environment (the first catalog entry
for the hosted app). Thread and project references carry their environment id, so a task
on that server can hold threads that run elsewhere.

## Upstream touch points

These are the only edits to upstream-owned files. Check them first when a merge conflicts.

| File                                        | Edit                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`             | imports `TasksRpcs` and spreads it into `WsRpcGroup`                        |
| `packages/contracts/src/index.ts`           | exports `./task.ts`                                                         |
| `packages/client-runtime/src/rpc/client.ts` | adds `tasks.subscribe` to `EnvironmentSubscriptionRpcTag`                   |
| `apps/server/src/server.ts`                 | provides `TasksStore.layer` next to the keybindings layer                   |
| `apps/server/src/ws.ts`                     | yields `TasksStore` and spreads `makeTasksRpcHandlers` into the handler map |
| `apps/server/src/auth/RpcAuthorization.ts`  | spreads `TASKS_RPC_REQUIRED_SCOPES` into the scope map                      |
| `apps/server/src/server.test.ts`            | mocks `TasksStore` in the app-under-test harness                            |
| `apps/web/src/routes/_chat.index.tsx`       | redirects `/` to `/tasks`; the draft-landing code was removed               |
| `apps/web/src/components/Sidebar.tsx`       | renders `TasksSidebarLink` above the search row                             |
| `apps/web/src/routeTree.gen.ts`             | generated; regenerate rather than merge by hand                             |

The `EnvironmentSubscriptionRpcTag` union is hand-maintained upstream. A new stream RPC that
is not listed there is typed as unary on the client and fails to compile, which is the
signal to add it.

## The home screen and the CLI's bootstrapped thread

Upstream's root route jumps to the thread `npx t3` creates on boot when the welcome payload
arrives while the client sits on `/`. The fork leaves that check untouched, and because `/`
redirects to `/tasks` at once, the jump no longer fires: the bootstrapped thread appears
under "No task" instead. Widening the check to `/tasks` was tried and reverted, because
every fresh load of the home, including a second browser tab, bounced to that thread.

## Thread creation from a task

The inline composer starts a thread the same way the chat composer does: one
`thread.turn.start` with a `createThread` bootstrap, and a `prepareWorktree` bootstrap when
the user picked a worktree. The thread id is minted on the client so the task link can be
written immediately after the command succeeds, without waiting for the shell snapshot. The
task title, description, and sibling thread titles are prefixed to the user's first message
as plain text; there is no separate system-prompt channel per thread. Attachments go through
the shared upload queue in `lib/attachmentUploadQueue.ts` exactly as the chat composer's do.

"Open in full composer" hands the same assignment to a regular draft through
`useNewThreadHandler`, sets the draft's model and prompt, and moves staged attachments into
the draft store. The thread does not exist until the user sends, so the task link is
recorded in `localStorage` as a pending link and written by `usePendingTaskLinkReconciler`
when the thread's shell appears. A pending link whose draft was discarded is dropped. The
reconciler runs inside `TasksSidebarLink`, which the default sidebar renders on every chat
route, so a send from the chat view is recorded without the tasks view open. The legacy
sidebar does not render it; a hand-off sent while that sidebar is enabled is linked the
next time the tasks view mounts.
