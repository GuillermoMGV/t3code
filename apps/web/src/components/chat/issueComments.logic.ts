import type {
  TrackerIssue,
  TrackerIssueComment,
  TrackerIssueStatusChange,
} from "@t3tools/contracts";

// Fork-only ticket comments and status changes modal; see CUSTOM_DEVELOPMENT.md.

/** The composer text asking the agent to look at one ticket comment. */
export function issueCommentPrompt(
  issue: Pick<TrackerIssue, "key" | "title" | "url">,
  comment: Pick<TrackerIssueComment, "author" | "createdAt" | "body">,
): string {
  const author = comment.author?.name ?? "someone";
  // The composer turns each quoted line into its own quote block, so blank ones are dropped.
  const quoted = comment.body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => `> ${line}`)
    .join("\n");
  return `Check this comment on ticket ${issue.key} (${issue.title}), posted by ${author} on ${comment.createdAt}:\n\n${quoted}\n\n${issue.url}`;
}

/** "Nov 19, 14:05" this year, "Nov 19, 2025, 14:05" before; the raw value when unreadable. */
export function formatCommentDate(value: string, now: Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type IssueActivityEntry =
  | { readonly kind: "comment"; readonly createdAt: string; readonly comment: TrackerIssueComment }
  | {
      readonly kind: "statusChange";
      readonly createdAt: string;
      readonly change: TrackerIssueStatusChange;
    };

/** Comments and status changes in one list, newest first. */
export function issueActivityTimeline(
  comments: ReadonlyArray<TrackerIssueComment>,
  statusChanges: ReadonlyArray<TrackerIssueStatusChange>,
): IssueActivityEntry[] {
  const entries: IssueActivityEntry[] = [
    ...comments.map((comment) => ({
      kind: "comment" as const,
      createdAt: comment.createdAt,
      comment,
    })),
    ...statusChanges.map((change) => ({
      kind: "statusChange" as const,
      createdAt: change.createdAt,
      change,
    })),
  ];
  return entries.toSorted(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

/** "3 comments · 1 status change"; either part is left out when there is none. */
export function issueActivityCountLabel(comments: number, statusChanges: number): string {
  const parts = [
    comments > 0 ? `${comments} ${comments === 1 ? "comment" : "comments"}` : null,
    statusChanges > 0
      ? `${statusChanges} ${statusChanges === 1 ? "status change" : "status changes"}`
      : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "No activity" : parts.join(" · ");
}
