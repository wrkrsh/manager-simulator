# Tasks

Tasks are the home screen. A task is a unit of work such as "Ship the login page"; the
threads that work on it are listed underneath it, so you can see at a glance which agents
are on which piece of work and how far along they are.

Tasks are stored on your primary T3 Code server, so every desktop and browser connected to
that server sees the same list, and edits made on one show up on the others as they happen.

## Create a task

Press **New task**, give it a title, and pick the project its agents should work in; Enter
creates it. Open a task to add a description, change its status or priority, or move it to
another project. The description is sent to every agent that starts on the task, so put the
goal and any constraints there instead of repeating them in each prompt.

## Put an agent on a task

The toolbar above the list holds the models you use most. Press **+** to add one: choose an
environment, a provider, and a model. Hover a chip to see the full model, options, and
environment it runs on.

Drag a chip onto a task. A prompt box opens under the task; describe what this agent should
do and press Enter. T3 Code creates a thread in the task's project, sends the task title,
description, and a list of the other threads already on the task ahead of your prompt, and
starts the agent. Choose **New worktree** before sending when the work needs its own branch.
Paste, drop, or attach images and files to send them with the prompt.

For mentions, skills, model options, or a specific branch, press **Open in full composer**.
The assignment moves into the regular chat composer with the task context and any
attachments already in place, and the thread joins the task when you send it.

The task moves to **In progress** when its first agent starts. Mark it **Done** or
**Canceled** yourself when the work is finished.

An agent can only be dropped on a task whose project lives on the same environment. Tasks
without a project accept no agents until you choose one.

If you would rather not drag, open the task and use **Assign agent**.

## Threads on a task

Click a thread under a task to open the full conversation. Use **Remove from task** on a
thread to detach it; it stays available in the sidebar.

Threads that no task owns are listed under **No task** at the bottom of the view, including
threads started from the sidebar or by `npx t3`. Drag one onto a task to adopt it. Drag a
task's thread onto another task to move it, or onto the **No task** header to detach it.
