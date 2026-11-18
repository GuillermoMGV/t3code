import type { NotificationSource, TrackerNotification } from "@t3tools/contracts";

// Fork-only notifications bell for Linear, Jira and Slack mentions; see CUSTOM_DEVELOPMENT.md.

export type NotificationTrackerFilter = "all" | NotificationSource;

const SOURCE_ORDER: ReadonlyArray<NotificationSource> = ["linear", "jira", "slack"];

/** The sources the filter offers; it only helps with two or more, connected or with items. */
export function notificationFilterSources(
  connected: ReadonlyArray<NotificationSource>,
  notifications: ReadonlyArray<TrackerNotification>,
): NotificationSource[] {
  const present = new Set([...connected, ...notifications.map((item) => item.tracker)]);
  const sources = SOURCE_ORDER.filter((source) => present.has(source));
  return sources.length > 1 ? sources : [];
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
