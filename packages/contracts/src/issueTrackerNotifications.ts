import * as Schema from "effect/Schema";

import { IssueKey, IssueTrackerKind } from "./issueTracker.ts";

// Fork-only notifications bell for Linear and Jira; see CUSTOM_DEVELOPMENT.md.

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
  /** `linear:<id>` or `jira:<key>:<event>`; stable across polls. */
  id: Schema.String,
  tracker: IssueTrackerKind,
  kind: TrackerNotificationKind,
  issue: Schema.Struct({ key: IssueKey, title: Schema.String, url: Schema.String }),
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
  /** Trackers with saved credentials; the bell hides when empty. */
  connected: Schema.Array(IssueTrackerKind),
  /** When the server last asked the trackers; null before the first check. */
  checkedAt: Schema.NullOr(Schema.String),
  /** The last check's failure per tracker; the other tracker's items still show. */
  errors: Schema.Array(Schema.Struct({ tracker: IssueTrackerKind, message: Schema.String })),
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
