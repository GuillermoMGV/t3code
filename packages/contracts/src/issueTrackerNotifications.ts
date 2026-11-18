import * as Schema from "effect/Schema";

// Fork-only notifications bell for Linear, Jira and Slack mentions; see CUSTOM_DEVELOPMENT.md.

export const NotificationSource = Schema.Literals(["linear", "jira", "slack"]);
export type NotificationSource = typeof NotificationSource.Type;

export const NOTIFICATION_SOURCE_LABELS: Readonly<Record<NotificationSource, string>> = {
  linear: "Linear",
  jira: "Jira",
  slack: "Slack",
};

export const TrackerNotificationKind = Schema.Literals([
  "assigned",
  "unassigned",
  "comment",
  "mention",
  "statusChanged",
  "created",
  "reaction",
  "other",
]);
export type TrackerNotificationKind = typeof TrackerNotificationKind.Type;

export const TrackerNotification = Schema.Struct({
  /** `linear:<id>`, `jira:<key>:<event>` or `slack:<channel>:<ts>`; stable across polls. */
  id: Schema.String,
  tracker: NotificationSource,
  kind: TrackerNotificationKind,
  /** For Slack, `key` is the channel (`#general`, `Direct message`) and `url` the permalink. */
  issue: Schema.Struct({ key: Schema.String, title: Schema.String, url: Schema.String }),
  /** Who did it; null for automations. */
  actor: Schema.NullOr(Schema.String),
  /** Comment text, shortened, for comments and mentions. */
  text: Schema.NullOr(Schema.String),
  /** Extra context, such as `To Do → Done` or Linear's raw type for `other`. */
  detail: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  read: Schema.Boolean,
});
export type TrackerNotification = typeof TrackerNotification.Type;

export const IssueTrackerNotificationsInput = Schema.Struct({});

export const IssueTrackerNotificationsResult = Schema.Struct({
  /** Newest first. */
  notifications: Schema.Array(TrackerNotification),
  unreadCount: Schema.Number,
  /** Sources with saved credentials; the bell hides when empty. */
  connected: Schema.Array(NotificationSource),
  /** When the server last asked the trackers; null before the first check. */
  checkedAt: Schema.NullOr(Schema.String),
  /** The last check's failure per source; the other sources' items still show. */
  errors: Schema.Array(Schema.Struct({ tracker: NotificationSource, message: Schema.String })),
});
export type IssueTrackerNotificationsResult = typeof IssueTrackerNotificationsResult.Type;

const NotificationIds = Schema.Array(Schema.String).check(Schema.isMaxLength(200));

export const IssueTrackerNotificationsMutation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("markRead"), ids: NotificationIds }),
  Schema.Struct({ type: Schema.Literal("markUnread"), ids: NotificationIds }),
  Schema.Struct({ type: Schema.Literal("markAllRead") }),
  /** Asks the trackers now instead of waiting for the next check. */
  Schema.Struct({ type: Schema.Literal("refresh") }),
]);
export type IssueTrackerNotificationsMutation = typeof IssueTrackerNotificationsMutation.Type;
