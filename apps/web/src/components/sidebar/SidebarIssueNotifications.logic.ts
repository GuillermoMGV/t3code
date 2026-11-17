import type { IssueTrackerKind, TrackerNotification } from "@t3tools/contracts";

// Fork-only notifications bell for Linear and Jira; see CUSTOM_DEVELOPMENT.md.

export type NotificationTrackerFilter = "all" | IssueTrackerKind;

/** The tracker filter only helps when both trackers are connected or have items. */
export function showsTrackerFilter(
  connected: ReadonlyArray<IssueTrackerKind>,
  notifications: ReadonlyArray<TrackerNotification>,
): boolean {
  const trackers = new Set([...connected, ...notifications.map((item) => item.tracker)]);
  return trackers.has("linear") && trackers.has("jira");
}

export function filterNotifications(
  notifications: ReadonlyArray<TrackerNotification>,
  filter: NotificationTrackerFilter,
): ReadonlyArray<TrackerNotification> {
  return filter === "all" ? notifications : notifications.filter((item) => item.tracker === filter);
}

/** The badge stays one or two characters wide so it fits the icon button. */
export function unreadBadgeLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}
