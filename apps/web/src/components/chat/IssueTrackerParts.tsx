import type { IssueTrackerKind, TrackerIssue } from "@t3tools/contracts";
import { CalendarIcon, SquareKanbanIcon, TicketIcon, UserRoundIcon } from "lucide-react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { issueDueDateView } from "./issueDueDate.logic";
import { assigneeInitials } from "./issueTrackerRows.logic";

const TRACKER_ICONS = { linear: TicketIcon, jira: SquareKanbanIcon } as const;

export function IssueTrackerIcon({
  tracker,
  className,
}: {
  tracker: IssueTrackerKind;
  className?: string;
}) {
  const Icon = TRACKER_ICONS[tracker];
  return <Icon aria-hidden className={className} />;
}

export function IssueStateBadge({
  state,
  className,
}: {
  state: TrackerIssue["state"];
  className?: string;
}) {
  if (state === null) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        // Each tracker defines its states' colors; showing them keeps states recognizable.
        style={{ backgroundColor: state.color }}
      />
      <span className="truncate">{state.name}</span>
    </span>
  );
}

export function IssueAssigneeBadge({
  assignee,
  className,
}: {
  assignee: TrackerIssue["assignee"];
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

/** The tracker's due date, in red when it is close or past; nothing when the issue has none. */
export function IssueDueDate({
  issue,
  className,
}: {
  issue: Pick<TrackerIssue, "dueDate" | "state">;
  className?: string;
}) {
  const view = issueDueDateView(issue, new Date(`${useNowMinute()}:00Z`));
  if (view === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1",
              className,
              view.urgent && "font-medium text-destructive",
            )}
          />
        }
      >
        <CalendarIcon aria-hidden className="size-3 shrink-0" />
        {view.label}
      </TooltipTrigger>
      <TooltipPopup side="top">{`Due ${view.date}`}</TooltipPopup>
    </Tooltip>
  );
}
