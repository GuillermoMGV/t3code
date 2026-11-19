import { IssueTrackerError, type IssueKey, type TrackerIssueComment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { JiraApi, JiraCredentials } from "./jiraApi.ts";
import { type LinearApi, linearUserName } from "./linearApi.ts";

// Fork-only ticket comments for the thread panel; see CUSTOM_DEVELOPMENT.md.

const COMMENT_LIMIT = 100;

const LinearCommentsData = Schema.Struct({
  issue: Schema.NullOr(
    Schema.Struct({
      comments: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            body: Schema.String,
            createdAt: Schema.String,
            user: Schema.optional(
              Schema.NullOr(
                Schema.Struct({
                  name: Schema.String,
                  displayName: Schema.optional(Schema.String),
                  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
                }),
              ),
            ),
          }),
        ),
      }),
    }),
  ),
});
const decodeLinearComments = Schema.decodeUnknownEffect(LinearCommentsData);

const JiraComments = Schema.Struct({
  comments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        created: Schema.String,
        body: Schema.optional(Schema.Unknown),
        author: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              displayName: Schema.String,
              avatarUrls: Schema.optional(Schema.Record(Schema.String, Schema.String)),
            }),
          ),
        ),
      }),
    ),
  ),
});
const decodeJiraComments = Schema.decodeUnknownEffect(JiraComments);

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

const newestFirst = (comments: ReadonlyArray<TrackerIssueComment>) =>
  comments.toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

const invalidResponse = (tracker: "linear" | "jira") => (cause: unknown) =>
  new IssueTrackerError({
    tracker,
    reason: "invalidResponse",
    detail: `${tracker === "linear" ? "Linear" : "Jira"} returned comments T3 Code could not read.`,
    cause,
  });

export const linearIssueComments = Effect.fn("IssueComments.linear")(function* (
  linear: LinearApi,
  apiKey: string,
  key: IssueKey,
) {
  const result = yield* linear.graphql(
    apiKey,
    `query IssueComments($id: String!) {
      issue(id: $id) {
        comments(first: ${COMMENT_LIMIT}) {
          nodes { id body createdAt user { name displayName avatarUrl } }
        }
      }
    }`,
    { id: key },
  );
  if (result._tag === "errors") return [];
  const data = yield* decodeLinearComments(result.data).pipe(
    Effect.mapError(invalidResponse("linear")),
  );
  return newestFirst(
    (data.issue?.comments.nodes ?? []).map((node) => ({
      id: node.id,
      author: node.user
        ? { name: linearUserName(node.user), avatarUrl: node.user.avatarUrl ?? null }
        : null,
      createdAt: node.createdAt,
      body: node.body.trim(),
    })),
  );
});

export const jiraIssueComments = Effect.fn("IssueComments.jira")(function* (
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
      author: comment.author
        ? {
            name: comment.author.displayName,
            avatarUrl:
              comment.author.avatarUrls?.["24x24"] ?? comment.author.avatarUrls?.["48x48"] ?? null,
          }
        : null,
      createdAt: comment.created,
      body: adfToMultilineText(comment.body),
    })),
  );
});
