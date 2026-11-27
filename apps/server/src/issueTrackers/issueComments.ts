import {
  IssueTrackerError,
  type IssueKey,
  type TrackerIssueComment,
  type TrackerIssueStatusChange,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { JiraApi, JiraCredentials } from "./jiraApi.ts";
import { type LinearApi, linearUserName } from "./linearApi.ts";

// Fork-only ticket comments and status changes for the thread panel; see CUSTOM_DEVELOPMENT.md.

const COMMENT_LIMIT = 100;
const HISTORY_LIMIT = 100;

export type IssueActivity = {
  readonly comments: ReadonlyArray<TrackerIssueComment>;
  readonly statusChanges: ReadonlyArray<TrackerIssueStatusChange>;
};
export const NO_ACTIVITY: IssueActivity = { comments: [], statusChanges: [] };

const LinearUser = Schema.Struct({
  name: Schema.String,
  displayName: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
});
const LinearState = Schema.Struct({ name: Schema.String, color: Schema.optional(Schema.String) });

const LinearActivityData = Schema.Struct({
  issue: Schema.NullOr(
    Schema.Struct({
      comments: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            body: Schema.String,
            createdAt: Schema.String,
            url: Schema.optional(Schema.String),
            user: Schema.optional(Schema.NullOr(LinearUser)),
          }),
        ),
      }),
      history: Schema.optional(
        Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              createdAt: Schema.String,
              actor: Schema.optional(Schema.NullOr(LinearUser)),
              fromState: Schema.optional(Schema.NullOr(LinearState)),
              toState: Schema.optional(Schema.NullOr(LinearState)),
            }),
          ),
        }),
      ),
    }),
  ),
});
const decodeLinearActivity = Schema.decodeUnknownEffect(LinearActivityData);

const JiraAuthor = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  avatarUrls: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const JiraComments = Schema.Struct({
  comments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        created: Schema.String,
        body: Schema.optional(Schema.Unknown),
        author: Schema.optional(Schema.NullOr(JiraAuthor)),
      }),
    ),
  ),
});
const decodeJiraComments = Schema.decodeUnknownEffect(JiraComments);

const JiraChangelogPage = Schema.Struct({
  total: Schema.optional(Schema.Number),
  values: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        created: Schema.String,
        author: Schema.optional(Schema.NullOr(JiraAuthor)),
        items: Schema.optional(
          Schema.Array(
            Schema.Struct({
              field: Schema.optional(Schema.String),
              fieldId: Schema.optional(Schema.String),
              fromString: Schema.optional(Schema.NullOr(Schema.String)),
              toString: Schema.optional(Schema.NullOr(Schema.String)),
            }),
          ),
        ),
      }),
    ),
  ),
});
const decodeJiraChangelog = Schema.decodeUnknownEffect(JiraChangelogPage);

type AdfNode = { readonly type?: unknown; readonly text?: unknown; readonly attrs?: unknown };
const ADF_BLOCKS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "blockquote",
  "codeBlock",
  "panel",
  "tableRow",
]);

/** Plain text of an Atlassian Document Format body, one line per block. */
function adfToMultilineText(body: unknown): string {
  if (typeof body === "string") return body.trim();
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const value = node as AdfNode & { readonly content?: unknown };
    if (value.type === "text" && typeof value.text === "string") out.push(value.text);
    else if (value.type === "hardBreak") out.push("\n");
    else if (value.type === "mention" || value.type === "emoji") {
      const text = (value.attrs as { text?: unknown } | undefined)?.text;
      if (typeof text === "string") out.push(text);
    } else if (value.type === "inlineCard") {
      const url = (value.attrs as { url?: unknown } | undefined)?.url;
      if (typeof url === "string") out.push(url);
    }
    if (Array.isArray(value.content)) for (const child of value.content) walk(child);
    if (typeof value.type === "string" && ADF_BLOCKS.has(value.type)) out.push("\n");
  };
  walk(body);
  return out
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Jira writes offsets as `+0000`; some engines only parse `+00:00`. */
function jiraIsoDate(value: string): string {
  const parsed = DateTime.make(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : value;
}

const jiraPerson = (author: typeof JiraAuthor.Type | null | undefined) =>
  author?.displayName
    ? {
        name: author.displayName,
        avatarUrl: author.avatarUrls?.["24x24"] ?? author.avatarUrls?.["48x48"] ?? null,
      }
    : null;

const newestFirst = <T extends { readonly createdAt: string }>(items: ReadonlyArray<T>) =>
  items.toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

const invalidResponse = (tracker: "linear" | "jira") => (cause: unknown) =>
  new IssueTrackerError({
    tracker,
    reason: "invalidResponse",
    detail: `${tracker === "linear" ? "Linear" : "Jira"} returned activity T3 Code could not read.`,
    cause,
  });

const linearPerson = (user: typeof LinearUser.Type | null | undefined) =>
  user ? { name: linearUserName(user), avatarUrl: user.avatarUrl ?? null } : null;

export const linearIssueActivity = Effect.fn("IssueComments.linear")(function* (
  linear: LinearApi,
  apiKey: string,
  key: IssueKey,
) {
  // `first` returns the newest entries of a Linear connection.
  const result = yield* linear.graphql(
    apiKey,
    `query IssueComments($id: String!) {
      issue(id: $id) {
        comments(first: ${COMMENT_LIMIT}) {
          nodes { id body createdAt url user { name displayName avatarUrl } }
        }
        history(first: ${HISTORY_LIMIT}) {
          nodes {
            id createdAt
            actor { name displayName avatarUrl }
            fromState { name color }
            toState { name color }
          }
        }
      }
    }`,
    { id: key },
  );
  if (result._tag === "errors") return NO_ACTIVITY;
  const data = yield* decodeLinearActivity(result.data).pipe(
    Effect.mapError(invalidResponse("linear")),
  );
  const comments = newestFirst(
    (data.issue?.comments.nodes ?? []).map((node) => ({
      id: node.id,
      author: linearPerson(node.user),
      createdAt: node.createdAt,
      body: node.body.trim(),
      url: node.url ?? null,
    })),
  );
  const statusChanges = newestFirst(
    (data.issue?.history?.nodes ?? []).flatMap((node): TrackerIssueStatusChange[] =>
      node.toState
        ? [
            {
              id: node.id,
              actor: linearPerson(node.actor),
              createdAt: node.createdAt,
              from: node.fromState
                ? { name: node.fromState.name, color: node.fromState.color ?? null }
                : null,
              to: { name: node.toState.name, color: node.toState.color ?? null },
            },
          ]
        : [],
    ),
  );
  return { comments, statusChanges } satisfies IssueActivity;
});

const jiraIssueComments = Effect.fn("IssueComments.jiraComments")(function* (
  jira: JiraApi,
  credentials: JiraCredentials,
  key: IssueKey,
) {
  const response = yield* jira.request(
    credentials,
    `/rest/api/3/issue/${encodeURIComponent(key)}/comment?orderBy=-created&maxResults=${COMMENT_LIMIT}`,
  );
  if (response.status === 404) return [];
  const json = yield* jira.readJson(response);
  const data = yield* decodeJiraComments(json).pipe(Effect.mapError(invalidResponse("jira")));
  return newestFirst(
    (data.comments ?? []).map((comment) => ({
      id: comment.id,
      author: jiraPerson(comment.author),
      createdAt: comment.created,
      body: adfToMultilineText(comment.body),
      url: `${credentials.siteUrl}/browse/${encodeURIComponent(key)}?focusedCommentId=${encodeURIComponent(comment.id)}`,
    })),
  );
});

/** Jira pages changelogs oldest first, so a long history reads its last page instead. */
const jiraStatusChanges = Effect.fn("IssueComments.jiraStatusChanges")(function* (
  jira: JiraApi,
  credentials: JiraCredentials,
  key: IssueKey,
) {
  const readPage = Effect.fnUntraced(function* (startAt: number) {
    const response = yield* jira.request(
      credentials,
      `/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=${HISTORY_LIMIT}`,
    );
    if (response.status === 404) return {};
    const json = yield* jira.readJson(response);
    return yield* decodeJiraChangelog(json).pipe(Effect.mapError(invalidResponse("jira")));
  });
  const first = yield* readPage(0);
  const total = first.total ?? 0;
  const page = total > HISTORY_LIMIT ? yield* readPage(total - HISTORY_LIMIT) : first;
  return newestFirst(
    (page.values ?? []).flatMap((history) =>
      (history.items ?? []).flatMap((item): TrackerIssueStatusChange[] => {
        // An absent key would read Object.prototype.toString, so check the type.
        const to = typeof item.toString === "string" ? item.toString : null;
        if ((item.fieldId ?? item.field) !== "status" || to === null) return [];
        return [
          {
            id: `${history.id}:status`,
            actor: jiraPerson(history.author),
            createdAt: jiraIsoDate(history.created),
            from: item.fromString ? { name: item.fromString, color: null } : null,
            to: { name: to, color: null },
          },
        ];
      }),
    ),
  );
});

export const jiraIssueActivity = Effect.fn("IssueComments.jira")(function* (
  jira: JiraApi,
  credentials: JiraCredentials,
  key: IssueKey,
) {
  const [comments, statusChanges] = yield* Effect.all(
    [jiraIssueComments(jira, credentials, key), jiraStatusChanges(jira, credentials, key)],
    { concurrency: 2 },
  );
  return { comments, statusChanges } satisfies IssueActivity;
});
