import type { LinearIssue } from "@t3tools/contracts";
import { UserRoundIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { assigneeInitials } from "./linearIssueRow.logic";

export function LinearIssueStateBadge({
  state,
  className,
}: {
  state: LinearIssue["state"];
  className?: string;
}) {
  if (state === null) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        // Linear defines each workflow state's color; showing it keeps states recognizable.
        style={{ backgroundColor: state.color }}
      />
      <span className="truncate">{state.name}</span>
    </span>
  );
}

export function LinearIssueAssigneeBadge({
  assignee,
  className,
}: {
  assignee: LinearIssue["assignee"];
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1", className)}
      aria-label={assignee === null ? "Unassigned" : `Assigned to ${assignee.name}`}
    >
      {assignee === null ? (
        <UserRoundIcon aria-hidden className="size-3 shrink-0" />
      ) : assignee.avatarUrl ? (
        <img
          alt=""
          src={assignee.avatarUrl}
          className="size-3.5 shrink-0 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span
          aria-hidden
          className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-muted text-4xs font-medium text-foreground"
        >
          {assigneeInitials(assignee.name)}
        </span>
      )}
      <span className="truncate">{assignee === null ? "Unassigned" : assignee.name}</span>
    </span>
  );
}
