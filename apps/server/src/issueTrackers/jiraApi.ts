import {
  IssueTrackerError,
  type IssueKey,
  type IssueSearchFilter,
  type TrackerIssue,
} from "@t3tools/contracts";
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

const ISSUE_FIELDS = ["summary", "status", "assignee", "duedate", "updated", "project"];

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
      duedate: Schema.optional(Schema.NullOr(Schema.String)),
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
const decodeStatuses = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      statusCategory: Schema.optional(
        Schema.NullOr(Schema.Struct({ key: Schema.optional(Schema.String) })),
      ),
    }),
  ),
);
const decodeProjects = Schema.decodeUnknownEffect(
  Schema.Struct({ values: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))) }),
);
const decodeMyself = Schema.decodeUnknownEffect(Schema.Struct({ displayName: Schema.String }));
const JiraStatusCategory = Schema.optional(
  Schema.NullOr(
    Schema.Struct({
      key: Schema.optional(Schema.String),
      colorName: Schema.optional(Schema.String),
    }),
  ),
);
const decodeTransitions = Schema.decodeUnknownEffect(
  Schema.Struct({
    transitions: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          to: Schema.Struct({ name: Schema.String, statusCategory: JiraStatusCategory }),
        }),
      ),
    ),
  }),
);
const decodeAssignableUsers = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      accountId: Schema.String,
      displayName: Schema.String,
      accountType: Schema.optional(Schema.String),
      active: Schema.optional(Schema.Boolean),
      avatarUrls: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
);
const decodeErrorBody = Schema.decodeUnknownEffect(
  Schema.Struct({
    errorMessages: Schema.optional(Schema.Array(Schema.String)),
    errors: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
);

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

/** The JQL clauses for the chosen values, or null when nothing narrows the list. */
function jiraFilterJql(filter: IssueSearchFilter | undefined): string | null {
  if (filter === undefined) return null;
  const clauses: Array<string> = [];
  if (filter.states.length > 0) {
    clauses.push(`status in (${filter.states.map(jqlString).join(", ")})`);
  }
  if (filter.assignees.length > 0) {
    const groups = filter.assignees.map((group) =>
      group === "me"
        ? "assignee = currentUser()"
        : group === "others"
          ? "assignee != currentUser()"
          : "assignee is EMPTY",
    );
    clauses.push(`(${groups.join(" OR ")})`);
  }
  if (filter.projects.length > 0) {
    clauses.push(`project in (${filter.projects.map(jqlString).join(", ")})`);
  }
  return clauses.length === 0 ? null : clauses.join(" AND ");
}

const STATUS_CATEGORY_ORDER = ["new", "indeterminate", "done"];
const statusCategoryRank = (key: string | undefined) => {
  const rank = STATUS_CATEGORY_ORDER.indexOf(key ?? "");
  return rank === -1 ? STATUS_CATEGORY_ORDER.length : rank;
};

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
    dueDate: fields?.duedate ?? null,
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
    method: "POST" | "PUT" = "POST",
  ) {
    const authorization = `Basic ${Base64.encode(
      new TextEncoder().encode(`${credentials.email}:${credentials.apiToken}`),
    )}`;
    const url = `${credentials.siteUrl}${path}`;
    const base = (
      body === undefined
        ? HttpClientRequest.get(url)
        : method === "PUT"
          ? HttpClientRequest.put(url)
          : HttpClientRequest.post(url)
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
    maxResults = 15,
  ) {
    const response = yield* request(credentials, "/rest/api/3/search/jql", {
      jql,
      fields: ISSUE_FIELDS,
      maxResults,
    });
    // Jira answers a JQL it cannot run, such as one naming a missing project, with 400.
    if (response.status === 400) return [];
    const json = yield* readJson(response);
    const { issues } = yield* decodeSearch(json).pipe(Effect.mapError(invalidResponse));
    return (issues ?? []).flatMap((item) => toTrackerIssue(credentials.siteUrl, item) ?? []);
  });

  const search = (credentials: JiraCredentials, term: string, filter?: IssueSearchFilter) => {
    const narrow = jiraFilterJql(filter);
    const text = `text ~ ${jqlString(term)}`;
    return searchJql(
      credentials,
      `${narrow === null ? text : `${text} AND ${narrow}`} ORDER BY updated DESC`,
      25,
    );
  };

  // The search endpoint rejects unbounded JQL, so unfiltered "recent" means the last 90 days.
  const recentIssues = (credentials: JiraCredentials, filter?: IssueSearchFilter) =>
    searchJql(
      credentials,
      `${jiraFilterJql(filter) ?? "updated >= -90d"} ORDER BY updated DESC`,
      50,
    );

  /** Status names once each, to do first; project names A to Z. */
  const filterOptions = Effect.fn("JiraApi.filterOptions")(function* (
    credentials: JiraCredentials,
  ) {
    const statuses = yield* decodeStatuses(
      yield* readJson(yield* request(credentials, "/rest/api/3/status")),
    ).pipe(Effect.mapError(invalidResponse));
    const projects = yield* decodeProjects(
      yield* readJson(
        yield* request(credentials, "/rest/api/3/project/search?maxResults=100&orderBy=name"),
      ),
    ).pipe(Effect.mapError(invalidResponse));
    const sorted = statuses.toSorted(
      (left, right) =>
        statusCategoryRank(left.statusCategory?.key) -
        statusCategoryRank(right.statusCategory?.key),
    );
    return {
      states: [...new Set(sorted.map((status) => status.name))],
      projects: [...new Set((projects.values ?? []).map((project) => project.name))],
    };
  });

  const assignedOpenIssues = (credentials: JiraCredentials) =>
    searchJql(
      credentials,
      "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
    );

  /** Jira's own words for a rejected change, such as a transition that needs a field set. */
  const expectNoContent = Effect.fn("JiraApi.expectNoContent")(function* (
    response: HttpClientResponse.HttpClientResponse,
    fallback: string,
  ) {
    if (response.status >= 200 && response.status < 300) return;
    const body = yield* response.json.pipe(
      Effect.flatMap(decodeErrorBody),
      Effect.orElseSucceed(() => ({ errorMessages: [], errors: {} })),
    );
    const messages = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})];
    return yield* jiraError("invalidInput", messages.length > 0 ? messages.join(" ") : fallback);
  });

  /** The statuses the issue's transitions lead to, once each, to do first; assignable users A to Z. */
  const editOptions = Effect.fn("JiraApi.editOptions")(function* (
    credentials: JiraCredentials,
    key: IssueKey,
  ) {
    const encodedKey = encodeURIComponent(key);
    const [transitions, users] = yield* Effect.all(
      [
        request(credentials, `/rest/api/3/issue/${encodedKey}/transitions`).pipe(
          Effect.flatMap(readJson),
          Effect.flatMap((json) => decodeTransitions(json).pipe(Effect.mapError(invalidResponse))),
        ),
        request(
          credentials,
          `/rest/api/3/user/assignable/search?issueKey=${encodedKey}&maxResults=1000`,
        ).pipe(
          Effect.flatMap(readJson),
          Effect.flatMap((json) =>
            decodeAssignableUsers(json).pipe(Effect.mapError(invalidResponse)),
          ),
        ),
      ],
      { concurrency: 2 },
    );
    const all = transitions.transitions ?? [];
    // Several transitions can lead to one status; the first one stands for it.
    const unique = all.filter(
      (transition, index) =>
        all.findIndex((other) => other.to.name === transition.to.name) === index,
    );
    return {
      states: unique
        .toSorted(
          (left, right) =>
            statusCategoryRank(left.to.statusCategory?.key) -
            statusCategoryRank(right.to.statusCategory?.key),
        )
        .map((transition) => ({
          id: transition.id,
          name: transition.to.name,
          color: CATEGORY_COLORS[transition.to.statusCategory?.colorName ?? ""] ?? "#8590a2",
          category: transition.to.statusCategory?.key ?? "",
        })),
      assignees: users
        // Apps and deactivated accounts cannot own work, though Jira lists some of them.
        .filter((user) => user.active !== false && user.accountType !== "app")
        .toSorted((left, right) => left.displayName.localeCompare(right.displayName))
        .map((user) => ({
          id: user.accountId,
          name: user.displayName,
          avatarUrl: user.avatarUrls?.["24x24"] ?? user.avatarUrls?.["48x48"] ?? null,
        })),
    };
  });

  const transitionIssue = Effect.fn("JiraApi.transitionIssue")(function* (
    credentials: JiraCredentials,
    key: IssueKey,
    transitionId: string,
  ) {
    const response = yield* request(
      credentials,
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
      { transition: { id: transitionId } },
    );
    yield* expectNoContent(response, `Jira did not change the status of ${key}.`);
  });

  const assignIssue = Effect.fn("JiraApi.assignIssue")(function* (
    credentials: JiraCredentials,
    key: IssueKey,
    accountId: string | null,
  ) {
    const response = yield* request(
      credentials,
      `/rest/api/3/issue/${encodeURIComponent(key)}/assignee`,
      { accountId },
      "PUT",
    );
    yield* expectNoContent(response, `Jira did not change the assignee of ${key}.`);
  });

  // request, readJson: used by the notifications bell (IssueTrackerNotifications.ts).
  return {
    myself,
    issue,
    search,
    assignedOpenIssues,
    recentIssues,
    filterOptions,
    editOptions,
    transitionIssue,
    assignIssue,
    request,
    readJson,
  };
});

export type JiraApi = Effect.Success<typeof makeJiraApi>;
