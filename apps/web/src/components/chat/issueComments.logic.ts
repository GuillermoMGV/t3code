import type { TrackerIssue, TrackerIssueComment } from "@t3tools/contracts";

// Fork-only ticket comments popover; see CUSTOM_DEVELOPMENT.md.

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
