import type { TrackerIssue } from "@t3tools/contracts";

// Fork-only Linear and Jira integration; see CUSTOM_DEVELOPMENT.md.

/** Days left at or below which an open issue's due date shows in red. */
const URGENT_DAYS = 3;
const DAY_MS = 86_400_000;
const DONE_CATEGORIES = new Set(["completed", "canceled", "done"]);

export interface IssueDueDateView {
  readonly label: string;
  /** Full date for the tooltip. */
  readonly date: string;
  readonly urgent: boolean;
}

function parseCalendarDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** How a tracker's due date reads in the UI, counted in local calendar days from `now`. */
export function issueDueDateView(
  issue: Pick<TrackerIssue, "dueDate" | "state">,
  now: Date,
): IssueDueDateView | null {
  if (!issue.dueDate) return null;
  const due = parseCalendarDay(issue.dueDate);
  if (due === null) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Rounding absorbs the hour a daylight saving change adds or removes.
  const days = Math.round((due.getTime() - today.getTime()) / DAY_MS);
  const date = due.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(due.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
  const label =
    days < -1
      ? `Overdue ${-days} days`
      : days === -1
        ? "Overdue 1 day"
        : days === 0
          ? "Due today"
          : days === 1
            ? "Due tomorrow"
            : days <= 7
              ? `Due in ${days} days`
              : `Due ${date}`;
  const done = DONE_CATEGORIES.has(issue.state?.category ?? "");
  return { label, date, urgent: !done && days <= URGENT_DAYS };
}
