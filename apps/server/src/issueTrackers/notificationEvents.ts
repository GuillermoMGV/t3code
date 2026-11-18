import type { IssueKey, TrackerNotification, TrackerNotificationKind } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// Fork-only notifications bell; see CUSTOM_DEVELOPMENT.md. Pure parts, tested on their own.

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;
const TEXT_LIMIT = 400;
const MAX_NOTIFICATIONS = 100;
/** How far back Jira events are derived; older ones drop out of the list. */
export const JIRA_WINDOW_MS = 3 * 24 * 60 * 60_000;
/** On a first Jira or Slack check, items older than this start out read so the badge stays calm. */
const JIRA_INITIAL_UNREAD_MS = 24 * 60 * 60_000;

const asKey = (value: string): IssueKey | null => {
  const key = value.trim().toUpperCase();
  return KEY_PATTERN.test(key) ? (key as IssueKey) : null;
};

const shorten = (text: string): string | null => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > TEXT_LIMIT ? `${trimmed.slice(0, TEXT_LIMIT - 1)}…` : trimmed;
};

/** Jira writes offsets as `+0000`; some engines only parse `+00:00`. */
function toIsoDate(value: string): string | null {
  const parsed = DateTime.make(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : null;
}

const LinearUser = Schema.Struct({ name: Schema.String });

export const LinearNotificationNode = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  readAt: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  snoozedUntilAt: Schema.optional(Schema.NullOr(Schema.String)),
  actor: Schema.optional(Schema.NullOr(LinearUser)),
  botActor: Schema.optional(
    Schema.NullOr(Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
  // Only IssueNotification has these; other notification kinds are left out of the bell.
  issue: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        identifier: Schema.String,
        title: Schema.String,
        url: Schema.String,
        state: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
      }),
    ),
  ),
  comment: Schema.optional(Schema.NullOr(Schema.Struct({ body: Schema.String }))),
});
export type LinearNotificationNode = typeof LinearNotificationNode.Type;

// Linear documents `type` as a free string; these are the values its webhooks name.
const LINEAR_KINDS: Readonly<Record<string, TrackerNotificationKind>> = {
  issueAssignedToYou: "assigned",
  issueUnassignedFromYou: "unassigned",
  issueNewComment: "comment",
  issueComment: "comment",
  issueThreadResolved: "comment",
  issueMention: "mention",
  issueCommentMention: "mention",
  issueStatusChanged: "statusChanged",
  issueStatusChangedAll: "statusChanged",
  issueCreated: "created",
  issueCommentReaction: "reaction",
  issueEmojiReaction: "reaction",
};

function linearNotificationKind(type: string): TrackerNotificationKind {
  return LINEAR_KINDS[type] ?? "other";
}

/** `issuePriorityUrgent` → `Priority urgent`, for types the bell has no label for. */
function humanizeType(type: string): string {
  const words = type
    .replace(/^issue/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.length === 0 ? type : `${words[0]!.toUpperCase()}${words.slice(1)}`;
}

/** Null for snoozed items and for notifications that are not about an issue. */
export function toLinearNotification(
  node: LinearNotificationNode,
  nowMs: number,
): TrackerNotification | null {
  const issue = node.issue ?? null;
  if (issue === null) return null;
  const key = asKey(issue.identifier);
  if (key === null) return null;
  const snoozedUntil = node.snoozedUntilAt ? Date.parse(node.snoozedUntilAt) : Number.NaN;
  if (!Number.isNaN(snoozedUntil) && snoozedUntil > nowMs) return null;
  const kind = linearNotificationKind(node.type);
  return {
    id: `linear:${node.id}`,
    tracker: "linear",
    kind,
    issue: { key, title: issue.title, url: issue.url },
    actor: node.actor?.name ?? node.botActor?.name ?? null,
    text: node.comment ? shorten(node.comment.body) : null,
    detail:
      kind === "statusChanged"
        ? (issue.state?.name ?? null)
        : kind === "other"
          ? humanizeType(node.type)
          : null,
    createdAt: node.createdAt,
    read: node.readAt != null,
  };
}

// Atlassian has no public API for the Jira bell, so Jira events come from changelogs and comments.

const JiraUser = Schema.Struct({
  accountId: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
});

const JiraChangeItem = Schema.Struct({
  field: Schema.optional(Schema.String),
  fieldId: Schema.optional(Schema.String),
  from: Schema.optional(Schema.NullOr(Schema.String)),
  to: Schema.optional(Schema.NullOr(Schema.String)),
  fromString: Schema.optional(Schema.NullOr(Schema.String)),
  toString: Schema.optional(Schema.NullOr(Schema.String)),
});

const JiraComment = Schema.Struct({
  id: Schema.String,
  created: Schema.String,
  author: Schema.optional(Schema.NullOr(JiraUser)),
  body: Schema.optional(Schema.Unknown),
});

export const JiraNotificationIssue = Schema.Struct({
  key: Schema.String,
  fields: Schema.optional(
    Schema.Struct({
      summary: Schema.optional(Schema.NullOr(Schema.String)),
      comment: Schema.optional(
        Schema.NullOr(Schema.Struct({ comments: Schema.optional(Schema.Array(JiraComment)) })),
      ),
    }),
  ),
  changelog: Schema.optional(
    Schema.Struct({
      histories: Schema.optional(
        Schema.Array(
          Schema.Struct({
            id: Schema.String,
            created: Schema.String,
            author: Schema.optional(Schema.NullOr(JiraUser)),
            items: Schema.optional(Schema.Array(JiraChangeItem)),
          }),
        ),
      ),
    }),
  ),
});
export type JiraNotificationIssue = typeof JiraNotificationIssue.Type;

type AdfNode = {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly attrs?: unknown;
  readonly content?: unknown;
};
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
]);

function walkAdf(node: unknown, visit: (node: AdfNode) => void): void {
  if (node === null || typeof node !== "object") return;
  const value = node as AdfNode;
  visit(value);
  if (Array.isArray(value.content)) for (const child of value.content) walkAdf(child, visit);
}

/** Plain text of an Atlassian Document Format body (or a v2 string body). */
export function adfToText(body: unknown): string {
  if (typeof body === "string") return body;
  const parts: string[] = [];
  walkAdf(body, (node) => {
    if (node.type === "text" && typeof node.text === "string") parts.push(node.text);
    else if (node.type === "mention") {
      const attrs = (node.attrs ?? {}) as { text?: unknown };
      parts.push(typeof attrs.text === "string" ? attrs.text : "@someone");
    } else if (typeof node.type === "string" && BLOCK_TYPES.has(node.type)) parts.push(" ");
  });
  return parts.join("");
}

function adfMentions(body: unknown, accountId: string): boolean {
  if (typeof body === "string") return body.includes(`[~accountid:${accountId}]`);
  let found = false;
  walkAdf(body, (node) => {
    if (node.type === "mention" && (node.attrs as { id?: unknown } | undefined)?.id === accountId) {
      found = true;
    }
  });
  return found;
}

/**
 * Events on the issues for the user, newest first: assigned to or unassigned from them, status
 * changes, comments and mentions. The user's own actions are left out.
 */
export function deriveJiraNotifications(
  issues: ReadonlyArray<JiraNotificationIssue>,
  options: { readonly accountId: string; readonly siteUrl: string; readonly sinceMs: number },
): TrackerNotification[] {
  const events: TrackerNotification[] = [];
  for (const raw of issues) {
    const key = asKey(raw.key);
    if (key === null) continue;
    const issue = {
      key,
      title: raw.fields?.summary ?? key,
      url: `${options.siteUrl}/browse/${key}`,
    };
    const base = { tracker: "jira" as const, issue, read: false };
    const recent = (created: string) => {
      const iso = toIsoDate(created);
      return iso !== null && Date.parse(iso) >= options.sinceMs ? iso : null;
    };
    for (const history of raw.changelog?.histories ?? []) {
      if (history.author?.accountId === options.accountId) continue;
      const createdAt = recent(history.created);
      if (createdAt === null) continue;
      const actor = history.author?.displayName ?? null;
      for (const item of history.items ?? []) {
        const field = item.fieldId ?? item.field;
        const id = `jira:${key}:history:${history.id}:${field ?? "?"}`;
        if (field === "assignee") {
          const kind =
            item.to === options.accountId
              ? "assigned"
              : item.from === options.accountId
                ? "unassigned"
                : null;
          if (kind !== null)
            events.push({ ...base, id, kind, actor, text: null, detail: null, createdAt });
        } else if (field === "status") {
          const from = item.fromString ?? "?";
          // An absent key would read Object.prototype.toString, so check the type.
          const to = typeof item.toString === "string" ? item.toString : "?";
          events.push({
            ...base,
            id,
            kind: "statusChanged",
            actor,
            text: null,
            detail: `${from} → ${to}`,
            createdAt,
          });
        }
      }
    }
    for (const comment of raw.fields?.comment?.comments ?? []) {
      if (comment.author?.accountId === options.accountId) continue;
      const createdAt = recent(comment.created);
      if (createdAt === null) continue;
      events.push({
        ...base,
        id: `jira:${key}:comment:${comment.id}`,
        kind: adfMentions(comment.body, options.accountId) ? "mention" : "comment",
        actor: comment.author?.displayName ?? null,
        text: shorten(adfToText(comment.body)),
        detail: null,
        createdAt,
      });
    }
  }
  return sortNewestFirst(events);
}

/** Read flags for Jira and Slack items from the ids the user marked read on this server. */
export function applyReadState(
  events: ReadonlyArray<TrackerNotification>,
  readIds: ReadonlySet<string>,
): TrackerNotification[] {
  return events.map((event) => ({ ...event, read: readIds.has(event.id) }));
}

/** The ids that start out read on a source's first check: everything older than a day. */
export function initialReadIds(
  events: ReadonlyArray<TrackerNotification>,
  nowMs: number,
): string[] {
  return events
    .filter((event) => nowMs - Date.parse(event.createdAt) > JIRA_INITIAL_UNREAD_MS)
    .map((event) => event.id);
}

function sortNewestFirst(items: ReadonlyArray<TrackerNotification>): TrackerNotification[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Every source's items in one list, newest first, without repeats, capped. */
export function mergeNotifications(
  ...lists: ReadonlyArray<ReadonlyArray<TrackerNotification>>
): TrackerNotification[] {
  const byId = new Map<string, TrackerNotification>();
  for (const list of lists) for (const item of list) byId.set(item.id, item);
  return sortNewestFirst([...byId.values()]).slice(0, MAX_NOTIFICATIONS);
}
