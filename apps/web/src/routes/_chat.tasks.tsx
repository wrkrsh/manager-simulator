import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { TasksView } from "../tasks/TasksView";

interface TasksSearch {
  readonly task?: string;
}

function TasksRouteView() {
  const { task } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <TasksView
      selectedTaskId={task ?? null}
      onSelectTask={(taskId) => {
        void navigate({
          to: "/tasks",
          search: taskId === null ? {} : { task: taskId },
          replace: true,
        });
      }}
    />
  );
}

export const Route = createFileRoute("/_chat/tasks")({
  validateSearch: (raw: Record<string, unknown>): TasksSearch =>
    typeof raw.task === "string" && raw.task.length > 0 ? { task: raw.task } : {},
  component: TasksRouteView,
});
