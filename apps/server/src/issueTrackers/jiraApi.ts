import { IssueTrackerError, type IssueKey, type TrackerIssue } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

export interface JiraCredentials {
  /** Normalized site origin, such as `https://example.atlassian.net`. */
  readonly siteUrl: string;
  readonly email: string;
  readonly apiToken: string;
}

const ISSUE_FIELDS = ["summary", "status", "assignee", "priority", "updated", "project"];

// Every field is optional: Jira omits fields the caller cannot see, and a missing one should
// leave a gap in the row rather than fail the whole read.
const JiraIssue = Schema.Struct({
  key: Schema.String,
  fields: Schema.optional(
    Schema.Struct({
      summary: Schema.optional(Schema.NullOr(Schema.String)),
      updated: Schema.optional(Schema.NullOr(Schema.String)),
      status: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            name: Schema.String,
            statusCategory: Schema.optional(
              Schema.NullOr(
                Schema.Struct({
                  key: Schema.optional(Schema.String),
                  colorName: Schema.optional(Schema.String),
                }),
              ),
            ),
          }),
        ),
      ),
      assignee: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            displayName: Schema.String,
            avatarUrls: Schema.optional(Schema.Record(Schema.String, Schema.String)),
          }),
        ),
      ),
      priority: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
      project: Schema.optional(
        Schema.NullOr(Schema.Struct({ key: Schema.String, name: Schema.String })),
      ),
    }),
  ),
});
type JiraIssue = typeof JiraIssue.Type;

const decodeIssue = Schema.decodeUnknownEffect(JiraIssue);
const decodeSearch = Schema.decodeUnknownEffect(
  Schema.Struct({ issues: Schema.optional(Schema.Array(JiraIssue)) }),
);
const decodeMyself = Schema.decodeUnknownEffect(Schema.Struct({ displayName: Schema.String }));

// Jira names a status category's color; these follow Atlassian's design tokens.
const CATEGORY_COLORS: Readonly<Record<string, string>> = {
  "blue-gray": "#8590a2",
  "medium-gray": "#8590a2",
  yellow: "#e2b203",
  green: "#22a06b",
  blue: "#1d7afc",
};

const jiraError = (reason: IssueTrackerError["reason"], detail: string, cause?: unknown) =>
  new IssueTrackerError({ tracker: "jira", reason, detail, cause });

const invalidResponse = (cause: unknown) =>
  jiraError("invalidResponse", "Jira returned a response T3 Code could not read.", cause);

/** `example`, `example.atlassian.net` or a URL on the site; plain http only for local tests. */
export function normalizeJiraSiteUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return null;
  const candidate = /^[a-z0-9-]+$/i.test(trimmed)
    ? `https://${trimmed}.atlassian.net`
    : /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  return url.origin;
}

/** Text for a JQL string literal: quotes and backslashes escaped. */
export function jqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;

function toTrackerIssue(siteUrl: string, issue: JiraIssue): TrackerIssue | null {
  const key = issue.key.trim().toUpperCase();
  if (!KEY_PATTERN.test(key)) return null;
  const fields = issue.fields;
  const status = fields?.status ?? null;
  const assignee = fields?.assignee ?? null;
  return {
    tracker: "jira",
    key: key as IssueKey,
    title: fields?.summary ?? key,
    url: `${siteUrl}/browse/${key}`,
    state:
      status === null
        ? null
        : {
            name: status.name,
            color: CATEGORY_COLORS[status.statusCategory?.colorName ?? ""] ?? "#8590a2",
            category: status.statusCategory?.key ?? "",
          },
    assignee:
      assignee === null
        ? null
        : {
            name: assignee.displayName,
            avatarUrl: assignee.avatarUrls?.["24x24"] ?? assignee.avatarUrls?.["48x48"] ?? null,
          },
    priorityLabel: fields?.priority?.name ?? null,
    updatedAt: fields?.updated ?? "",
    project: fields?.project
      ? {
          name: fields.project.name,
          url: `${siteUrl}/browse/${encodeURIComponent(fields.project.key)}`,
        }
      : null,
  };
}

export const makeJiraApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const request = Effect.fn("JiraApi.request")(function* (
    credentials: JiraCredentials,
    path: string,
    body?: unknown,
  ) {
    const authorization = `Basic ${Base64.encode(
      new TextEncoder().encode(`${credentials.email}:${credentials.apiToken}`),
    )}`;
    const base = (
      body === undefined
        ? HttpClientRequest.get(`${credentials.siteUrl}${path}`)
        : HttpClientRequest.post(`${credentials.siteUrl}${path}`)
    ).pipe(
      HttpClientRequest.setHeader("Authorization", authorization),
      HttpClientRequest.setHeader("Accept", "application/json"),
    );
    const response: HttpClientResponse.HttpClientResponse = yield* client
      .execute(body === undefined ? base : base.pipe(HttpClientRequest.bodyJsonUnsafe(body)))
      .pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) =>
          jiraError("network", "Could not reach Jira. Check the site URL and connection.", cause),
        ),
      );
    if (response.status === 401 || response.status === 403) {
      return yield* jiraError(
        "unauthorized",
        "Jira rejected the email or API token. Connect Jira again in Settings → Issue trackers.",
      );
    }
    return response;
  });

  const readJson = (response: HttpClientResponse.HttpClientResponse) =>
    response.status < 200 || response.status >= 300
      ? Effect.fail(invalidResponse(`HTTP ${response.status}`))
      : response.json.pipe(Effect.mapError(invalidResponse));

  const myself = Effect.fn("JiraApi.myself")(function* (credentials: JiraCredentials) {
    const response = yield* request(credentials, "/rest/api/3/myself");
    const json = yield* readJson(response);
    return (yield* decodeMyself(json).pipe(Effect.mapError(invalidResponse))).displayName;
  });

  /** Null when the issue does not exist or the account cannot see it. */
  const issue = Effect.fn("JiraApi.issue")(function* (credentials: JiraCredentials, key: IssueKey) {
    const response = yield* request(
      credentials,
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS.join(",")}`,
    );
    if (response.status === 404) return null;
    const json = yield* readJson(response);
    return toTrackerIssue(
      credentials.siteUrl,
      yield* decodeIssue(json).pipe(Effect.mapError(invalidResponse)),
    );
  });

  const searchJql = Effect.fn("JiraApi.searchJql")(function* (
    credentials: JiraCredentials,
    jql: string,
  ) {
    const response = yield* request(credentials, "/rest/api/3/search/jql", {
      jql,
      fields: ISSUE_FIELDS,
      maxResults: 15,
    });
    // Jira answers a JQL it cannot run, such as one naming a missing project, with 400.
    if (response.status === 400) return [];
    const json = yield* readJson(response);
    const { issues } = yield* decodeSearch(json).pipe(Effect.mapError(invalidResponse));
    return (issues ?? []).flatMap((item) => toTrackerIssue(credentials.siteUrl, item) ?? []);
  });

  const search = (credentials: JiraCredentials, term: string) =>
    searchJql(credentials, `text ~ ${jqlString(term)} ORDER BY updated DESC`);

  const assignedOpenIssues = (credentials: JiraCredentials) =>
    searchJql(
      credentials,
      "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
    );

  // request, readJson: used by the notifications bell (IssueTrackerNotifications.ts).
  return { myself, issue, search, assignedOpenIssues, request, readJson };
});

export type JiraApi = Effect.Success<typeof makeJiraApi>;
