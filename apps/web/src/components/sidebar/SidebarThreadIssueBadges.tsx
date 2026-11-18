import { ISSUE_TRACKER_LABELS, type ScopedThreadRef, type TrackerIssue } from "@t3tools/contracts";
import { CalendarIcon, UserRoundIcon } from "lucide-react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useEnvironmentQuery } from "~/state/query";
import { issueDueDateView } from "../chat/issueDueDate.logic";
import { assigneeInitials } from "../chat/issueTrackerRows.logic";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Fork-only Linear and Jira integration; see CUSTOM_DEVELOPMENT.md.

/** The issue the thread list shows for a thread: its first linked issue, Linear before Jira. */
export function useThreadIssueSummary(threadRef: ScopedThreadRef): TrackerIssue | null {
  const { data } = useEnvironmentQuery(
    issueTrackerEnvironment.threadSummaries({ environmentId: threadRef.environmentId, input: {} }),
  );
  return (
    data?.threads.find((summary) => summary.threadId === threadRef.threadId)?.issues[0] ?? null
  );
}

/** First name only: the row is narrow, and the tooltip has the full name. */
function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The state as a small outline badge in its tracker's color. */
export function IssueStateChip({ state }: { state: NonNullable<TrackerIssue["state"]> }) {
  return (
    <Badge variant="outline" size="sm" className="min-w-0 shrink">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        // Each tracker defines its states' colors; showing them keeps states recognizable.
        style={{ backgroundColor: state.color }}
      />
      <span className="truncate">{state.name}</span>
    </Badge>
  );
}

/** The assignee's avatar and first name as a small outline badge. */
export function IssueAssigneeChip({ assignee }: { assignee: TrackerIssue["assignee"] }) {
  return (
    <Badge variant="outline" size="sm" className="min-w-0 shrink">
      {assignee === null ? (
        <UserRoundIcon aria-hidden />
      ) : assignee.avatarUrl ? (
        <img
          alt=""
          src={assignee.avatarUrl}
          className="size-3 shrink-0 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span
          aria-hidden
          className="inline-flex size-3 shrink-0 items-center justify-center rounded-full bg-muted text-4xs"
        >
          {assigneeInitials(assignee.name)}
        </span>
      )}
      <span className="truncate">
        {assignee === null ? "Unassigned" : shortName(assignee.name)}
      </span>
    </Badge>
  );
}

/** The due date as a small badge, red when it is close or past; nothing when there is none. */
export function IssueDueDateChip({ issue }: { issue: Pick<TrackerIssue, "dueDate" | "state"> }) {
  const view = issueDueDateView(issue, new Date(`${useNowMinute()}:00Z`));
  if (view === null) return null;
  return (
    <Badge variant={view.urgent ? "error" : "outline"} size="sm" className="shrink-0">
      <CalendarIcon aria-hidden />
      {view.label}
    </Badge>
  );
}

export function SidebarThreadIssueBadges({ issue }: { issue: TrackerIssue }) {
  const label = ISSUE_TRACKER_LABELS[issue.tracker];
  const due = issueDueDateView(issue, new Date(`${useNowMinute()}:00Z`));
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex min-w-0 shrink items-center gap-1" />}>
        {issue.state ? <IssueStateChip state={issue.state} /> : null}
        <IssueAssigneeChip assignee={issue.assignee} />
        <IssueDueDateChip issue={issue} />
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-72">
        {`${label} ${issue.key}: ${issue.title}`}
        <br />
        {`${issue.state?.name ?? "No state"} · ${issue.assignee?.name ?? "Unassigned"}`}
        {due === null ? null : ` · Due ${due.date}`}
      </TooltipPopup>
    </Tooltip>
  );
}
