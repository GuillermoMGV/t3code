import type { EnvironmentId, IssueRef, TrackerIssue } from "@t3tools/contracts";

// Fork-only state and assignee pickers for Linear and Jira issues; see CUSTOM_DEVELOPMENT.md.

export const issueEditKey = (environmentId: EnvironmentId, ref: IssueRef) =>
  `${environmentId}\u0000${ref.tracker}:${ref.key}`;

/** Milliseconds for Linear's ISO dates and Jira's `+0000` offsets; NaN when unreadable. */
export function issueTimestamp(value: string): number {
  return Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

/**
 * The issue to show after an edit here. Trackers index searches a little later, so a list can
 * still answer with the old value; the edit wins until the list sends something as new or newer.
 */
export function shownIssue(issue: TrackerIssue, edited: TrackerIssue | null): TrackerIssue {
  if (edited === null) return issue;
  const listed = issueTimestamp(issue.updatedAt);
  return Number.isNaN(listed) || issueTimestamp(edited.updatedAt) >= listed ? edited : issue;
}
