import { Link, useLocation } from "@tanstack/react-router";
import { ListTodoIcon } from "lucide-react";

import { SidebarMenuButton } from "../components/ui/sidebar";
import { usePendingTaskLinkReconciler } from "./pendingTaskLinks";

/** Entry to the fork's task view, pinned above the thread list in the sidebar. */
export function TasksSidebarLink() {
  // Drafts handed off from a task get linked here too, so a send from the
  // chat view is recorded even when the tasks view is not open.
  usePendingTaskLinkReconciler();
  const pathname = useLocation({ select: (location) => location.pathname });
  const isActive = pathname === "/tasks" || pathname.startsWith("/tasks/");
  return (
    <SidebarMenuButton
      isActive={isActive}
      render={<Link to="/tasks" />}
      className="focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
    >
      <ListTodoIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Tasks</span>
    </SidebarMenuButton>
  );
}
