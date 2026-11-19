import type { PullRequestListEntry, ScheduledTask, TrackerIssue } from "@t3tools/contracts";

import { issueDueDateView } from "../chat/issueDueDate.logic";
import type { ThreadStatusPill } from "../Sidebar.logic";

// Fork-only home dashboard: what is waiting on the user; see CUSTOM_DEVELOPMENT.md.

export type AttentionTone = "urgent" | "action" | "info";

export interface Attention {
  readonly label: string;
  readonly tone: AttentionTone;
  /** Lower comes first. */
  readonly rank: number;
}

export interface ThreadAttentionInput {
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly settledAt: string | null;
  readonly settledOverride: "settled" | "active" | null;
  readonly snoozedUntil: string | null;
  readonly lineage: { readonly parentThreadId: string | null };
  readonly latestRun: { readonly status: string } | null;
  readonly pendingBackgroundTasks: ReadonlyArray<unknown>;
}

const PILL_ATTENTION: Partial<Record<ThreadStatusPill["label"], Attention>> = {
  "Pending Approval": { label: "Needs approval", tone: "urgent", rank: 0 },
  "Awaiting Input": { label: "Asks you", tone: "urgent", rank: 1 },
  "Guest Request": { label: "Guest message", tone: "action", rank: 2 },
  "Plan Ready": { label: "Plan ready", tone: "action", rank: 3 },
  Failed: { label: "Failed", tone: "urgent", rank: 4 },
  Completed: { label: "New reply", tone: "action", rank: 5 },
};
const YOUR_TURN: Attention = { label: "Your turn", tone: "info", rank: 6 };
// The agent is busy or waiting on something else; nothing to do until it stops.
const BUSY_PILLS = new Set<ThreadStatusPill["label"]>(["Working", "Connecting", "Waiting"]);
const FINISHED_RUNS = new Set(["completed", "failed"]);

/**
 * Whether a thread is on the user's plate. Settled and snoozed threads are put away on purpose,
 * subagents report to their parent, and a busy agent needs nothing yet. A finished run the user
 * already read still waits on them until they settle or snooze the thread.
 */
export function threadAttention(
  thread: ThreadAttentionInput,
  pill: ThreadStatusPill | null,
  nowMs: number,
): Attention | null {
  if (thread.archivedAt !== null || thread.deletedAt !== null) return null;
  if (thread.settledOverride === "settled" || thread.settledAt !== null) return null;
  if (thread.snoozedUntil !== null && Date.parse(thread.snoozedUntil) > nowMs) return null;
  if (thread.lineage.parentThreadId !== null) return null;
  if (pill !== null) {
    if (BUSY_PILLS.has(pill.label)) return null;
    const attention = PILL_ATTENTION[pill.label];
    if (attention) return attention;
  }
  if (thread.pendingBackgroundTasks.length > 0) return null;
  return thread.latestRun !== null && FINISHED_RUNS.has(thread.latestRun.status) ? YOUR_TURN : null;
}

export function isBusyPill(pill: ThreadStatusPill | null): boolean {
  return pill !== null && BUSY_PILLS.has(pill.label);
}

/** Highest attention first, then the most recent activity. */
export function sortByAttention<T extends { readonly attention: Attention }>(
  items: ReadonlyArray<T>,
  activityMs: (item: T) => number,
): T[] {
  return [...items].sort(
    (left, right) =>
      left.attention.rank - right.attention.rank || activityMs(right) - activityMs(left),
  );
}

// Statuses where the next move is someone else's: a reviewer, a business check or a blocker.
const WAITING_STATE = /block|hold|waiting|review/i;
const BACKLOG_STATE = /backlog|icebox/i;
const CLOSED_CATEGORIES = new Set(["completed", "canceled", "cancelled", "done", "duplicate"]);

/**
 * The server lists the issues assigned to the user. Trackers reassign an issue to whoever must
 * act next, so an assigned issue is on the user's plate unless it is parked or waiting.
 */
export function isIssueOnMyPlate(issue: Pick<TrackerIssue, "state">): boolean {
  const state = issue.state;
  if (state === null) return true;
  if (CLOSED_CATEGORIES.has(state.category)) return false;
  if (state.category === "backlog" || BACKLOG_STATE.test(state.name)) return false;
  return !WAITING_STATE.test(state.name);
}

/** Due soon or overdue first, then started work before work not started, then recent. */
export function sortMyIssues(issues: ReadonlyArray<TrackerIssue>, now: Date): TrackerIssue[] {
  const rank = (issue: TrackerIssue) => {
    const due = issueDueDateView(issue, now);
    if (due?.urgent) return 0;
    const category = issue.state?.category;
    return category === "started" || category === "indeterminate" ? 1 : 2;
  };
  const dueMs = (issue: TrackerIssue) =>
    issue.dueDate ? Date.parse(issue.dueDate) : Number.POSITIVE_INFINITY;
  return issues
    .filter(isIssueOnMyPlate)
    .map((issue) => ({ issue, rank: rank(issue) }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        dueMs(left.issue) - dueMs(right.issue) ||
        Date.parse(right.issue.updatedAt) - Date.parse(left.issue.updatedAt),
    )
    .map(({ issue }) => issue);
}

export type PullRequestRole = "authored" | "reviewing";

type PullRequestAttentionInput = Pick<
  PullRequestListEntry,
  "state" | "isDraft" | "mergeability" | "checksState" | "reviewDecision" | "viewerReviewRequested"
>;

/**
 * An authored pull request is the user's move when it is blocked on their side (conflicts,
 * failing checks, requested changes) or approved and ready to merge; waiting for reviewers is
 * not. A review request is always theirs. Drafts are work in progress, not a prompt.
 */
export function pullRequestAttention(
  entry: PullRequestAttentionInput,
  role: PullRequestRole,
): Attention | null {
  if (entry.state !== "open" || entry.isDraft) return null;
  if (role === "reviewing") {
    return entry.viewerReviewRequested
      ? { label: "Review requested", tone: "action", rank: 3 }
      : null;
  }
  if (entry.mergeability === "conflicting") return { label: "Conflicts", tone: "urgent", rank: 0 };
  if (entry.checksState === "failing") return { label: "Checks failing", tone: "urgent", rank: 1 };
  if (entry.reviewDecision === "changes-requested") {
    return { label: "Changes requested", tone: "urgent", rank: 2 };
  }
  if (entry.reviewDecision === "approved") {
    return { label: "Approved, ready to merge", tone: "action", rank: 4 };
  }
  return null;
}

/** Authored and review-requested lists merged, one row per pull request. */
export function pullRequestsNeedingYou<T extends PullRequestAttentionInput & { url: string }>(
  authored: ReadonlyArray<T>,
  reviewing: ReadonlyArray<T>,
): Array<{ readonly entry: T; readonly attention: Attention }> {
  const byUrl = new Map<string, { entry: T; attention: Attention }>();
  const add = (entry: T, role: PullRequestRole) => {
    const attention = pullRequestAttention(entry, role);
    const current = byUrl.get(entry.url);
    if (attention === null || (current && current.attention.rank <= attention.rank)) return;
    byUrl.set(entry.url, { entry, attention });
  };
  for (const entry of authored) add(entry, "authored");
  for (const entry of reviewing) add(entry, "reviewing");
  return [...byUrl.values()];
}

/** Active tasks first, then by title. */
export function sortScheduledTasks<T extends Pick<ScheduledTask, "enabled" | "title">>(
  tasks: ReadonlyArray<T>,
): T[] {
  return [...tasks].sort(
    (left, right) =>
      Number(right.enabled) - Number(left.enabled) || left.title.localeCompare(right.title),
  );
}
