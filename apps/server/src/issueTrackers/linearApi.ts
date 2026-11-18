import {
  IssueTrackerError,
  type IssueKey,
  type IssueSearchFilter,
  type TrackerIssue,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const RECENT_ISSUES_LIMIT = 50;
const SEARCH_LIMIT = 25;

// IssueSearchResult is not an Issue, so the selection is spelled out instead of a fragment.
const ISSUE_FIELDS = `identifier title url priorityLabel updatedAt
  state { name color type }
  assignee { name avatarUrl }
  project { name url }`;

const LinearIssueNode = Schema.Struct({
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  priorityLabel: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.String,
  state: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ name: Schema.String, color: Schema.String, type: Schema.String }),
    ),
  ),
  assignee: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        name: Schema.String,
        avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  project: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ name: Schema.String, url: Schema.optional(Schema.NullOr(Schema.String)) }),
    ),
  ),
});
type LinearIssueNode = typeof LinearIssueNode.Type;

const GraphqlResponse = Schema.Struct({
  data: Schema.optional(Schema.NullOr(Schema.Unknown)),
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        message: Schema.String,
        extensions: Schema.optional(
          Schema.Struct({
            type: Schema.optional(Schema.String),
            code: Schema.optional(Schema.String),
          }),
        ),
      }),
    ),
  ),
});
const decodeGraphqlResponse = Schema.decodeUnknownEffect(GraphqlResponse);

const ViewerData = Schema.Struct({ viewer: Schema.Struct({ name: Schema.String }) });
const IssueData = Schema.Struct({ issue: Schema.NullOr(LinearIssueNode) });
const SearchData = Schema.Struct({
  searchIssues: Schema.Struct({ nodes: Schema.Array(LinearIssueNode) }),
});
const RecentData = Schema.Struct({
  issues: Schema.Struct({ nodes: Schema.Array(LinearIssueNode) }),
});
const FilterOptionsData = Schema.Struct({
  workflowStates: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({ name: Schema.String, type: Schema.String, position: Schema.Number }),
    ),
  }),
  projects: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ name: Schema.String })) }),
});
const AssignedData = Schema.Struct({
  viewer: Schema.Struct({
    assignedIssues: Schema.Struct({ nodes: Schema.Array(LinearIssueNode) }),
  }),
});

/** Linear's `IssueFilter` for the chosen values, or null when nothing narrows the list. */
function linearIssueFilter(filter: IssueSearchFilter | undefined): object | null {
  if (filter === undefined) return null;
  const and: Array<object> = [];
  if (filter.states.length > 0) and.push({ state: { name: { in: filter.states } } });
  if (filter.assignees.length > 0) {
    and.push({
      or: filter.assignees.map((group) =>
        group === "unassigned"
          ? { assignee: { null: true } }
          : { assignee: { isMe: { eq: group === "me" } } },
      ),
    });
  }
  if (filter.projects.length > 0) and.push({ project: { name: { in: filter.projects } } });
  return and.length === 0 ? null : { and };
}

// Workflow types in the order Linear's own board shows them.
const STATE_TYPE_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];
const stateTypeRank = (type: string) => {
  const rank = STATE_TYPE_ORDER.indexOf(type);
  return rank === -1 ? STATE_TYPE_ORDER.length : rank;
};

const linearError = (reason: IssueTrackerError["reason"], detail: string, cause?: unknown) =>
  new IssueTrackerError({ tracker: "linear", reason, detail, cause });

const invalidResponse = (cause: unknown) =>
  linearError("invalidResponse", "Linear returned a response T3 Code could not read.", cause);

const unauthorized = () =>
  linearError(
    "unauthorized",
    "Linear rejected the API key. Connect Linear again in Settings → Issue trackers.",
  );

/** Null when Linear sends an identifier T3 Code cannot use as a key. */
function toTrackerIssue(node: LinearIssueNode): TrackerIssue | null {
  const key = node.identifier.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(key)) return null;
  return {
    tracker: "linear",
    key: key as IssueKey,
    title: node.title,
    url: node.url,
    state: node.state
      ? { name: node.state.name, color: node.state.color, category: node.state.type }
      : null,
    assignee: node.assignee
      ? { name: node.assignee.name, avatarUrl: node.assignee.avatarUrl ?? null }
      : null,
    priorityLabel: node.priorityLabel ?? null,
    updatedAt: node.updatedAt,
    project: node.project ? { name: node.project.name, url: node.project.url ?? null } : null,
  };
}

const toTrackerIssues = (nodes: ReadonlyArray<LinearIssueNode>) =>
  nodes.flatMap((node) => toTrackerIssue(node) ?? []);

type GraphqlResult =
  | { readonly _tag: "data"; readonly data: unknown }
  | { readonly _tag: "errors"; readonly message: string };

export const makeLinearApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  // Lets local tests point the server at a mock; unset in normal use.
  const endpoint = yield* Config.String("T3CODE_LINEAR_API_URL").pipe(
    Config.withDefault(LINEAR_API_URL),
    Effect.orElseSucceed(() => LINEAR_API_URL),
  );

  const graphql = Effect.fn("LinearApi.graphql")(function* (
    apiKey: string,
    query: string,
    variables: Record<string, unknown>,
  ) {
    const response = yield* client
      .execute(
        HttpClientRequest.post(endpoint).pipe(
          // Personal API keys go in the header as is; only OAuth tokens take "Bearer".
          HttpClientRequest.setHeader("Authorization", apiKey),
          HttpClientRequest.bodyJsonUnsafe({ query, variables }),
        ),
      )
      .pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) =>
          linearError(
            "network",
            "Could not reach Linear. Check the connection and try again.",
            cause,
          ),
        ),
      );
    if (response.status === 401 || response.status === 403) return yield* unauthorized();
    const body = yield* response.json.pipe(
      Effect.flatMap(decodeGraphqlResponse),
      Effect.mapError(invalidResponse),
    );
    const errors = body.errors ?? [];
    if (
      errors.some((error) =>
        /auth/i.test(
          `${error.message} ${error.extensions?.type ?? ""} ${error.extensions?.code ?? ""}`,
        ),
      )
    ) {
      return yield* unauthorized();
    }
    if (errors.length > 0) {
      return { _tag: "errors", message: errors[0]!.message } satisfies GraphqlResult;
    }
    if (response.status < 200 || response.status >= 300 || body.data == null) {
      return yield* invalidResponse(`HTTP ${response.status}`);
    }
    return { _tag: "data", data: body.data } satisfies GraphqlResult;
  });

  const expectData = <A, I>(schema: Schema.Codec<A, I>, result: GraphqlResult) =>
    result._tag === "errors"
      ? Effect.fail(invalidResponse(result.message))
      : Schema.decodeUnknownEffect(schema)(result.data).pipe(Effect.mapError(invalidResponse));

  const viewerName = Effect.fn("LinearApi.viewerName")(function* (apiKey: string) {
    const result = yield* graphql(apiKey, "query { viewer { name } }", {});
    return (yield* expectData(ViewerData, result)).viewer.name;
  });

  /** Null when the issue does not exist or the key cannot see it. */
  const issue = Effect.fn("LinearApi.issue")(function* (apiKey: string, key: IssueKey) {
    const result = yield* graphql(
      apiKey,
      `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
      { id: key },
    );
    // Linear answers an unknown identifier with an "Entity not found" error.
    if (result._tag === "errors") return null;
    const node = (yield* expectData(IssueData, result)).issue;
    return node === null ? null : toTrackerIssue(node);
  });

  const search = Effect.fn("LinearApi.search")(function* (
    apiKey: string,
    term: string,
    filter?: IssueSearchFilter,
  ) {
    const result = yield* graphql(
      apiKey,
      `query Search($term: String!, $filter: IssueFilter) {
        searchIssues(term: $term, first: ${SEARCH_LIMIT}, filter: $filter) { nodes { ${ISSUE_FIELDS} } }
      }`,
      { term, filter: linearIssueFilter(filter) },
    );
    return toTrackerIssues((yield* expectData(SearchData, result)).searchIssues.nodes);
  });

  const assignedOpenIssues = Effect.fn("LinearApi.assignedOpenIssues")(function* (apiKey: string) {
    const result = yield* graphql(
      apiKey,
      `query Assigned {
        viewer {
          assignedIssues(
            first: 15
            orderBy: updatedAt
            filter: { state: { type: { nin: ["completed", "canceled"] } } }
          ) { nodes { ${ISSUE_FIELDS} } }
        }
      }`,
      {},
    );
    return toTrackerIssues((yield* expectData(AssignedData, result)).viewer.assignedIssues.nodes);
  });

  const recentIssues = Effect.fn("LinearApi.recentIssues")(function* (
    apiKey: string,
    filter?: IssueSearchFilter,
  ) {
    const result = yield* graphql(
      apiKey,
      `query Recent($filter: IssueFilter) {
        issues(first: ${RECENT_ISSUES_LIMIT}, orderBy: updatedAt, filter: $filter) { nodes { ${ISSUE_FIELDS} } }
      }`,
      { filter: linearIssueFilter(filter) },
    );
    return toTrackerIssues((yield* expectData(RecentData, result)).issues.nodes);
  });

  /** State names once each (every team repeats "Todo"), in board order; project names A to Z. */
  const filterOptions = Effect.fn("LinearApi.filterOptions")(function* (apiKey: string) {
    const result = yield* graphql(
      apiKey,
      `
        query FilterOptions {
          workflowStates(first: 250) {
            nodes {
              name
              type
              position
            }
          }
          projects(first: 250) {
            nodes {
              name
            }
          }
        }
      `,
      {},
    );
    const data = yield* expectData(FilterOptionsData, result);
    const states = data.workflowStates.nodes.toSorted(
      (left, right) =>
        stateTypeRank(left.type) - stateTypeRank(right.type) || left.position - right.position,
    );
    return {
      states: [...new Set(states.map((state) => state.name))],
      projects: [...new Set(data.projects.nodes.map((project) => project.name))].toSorted(
        (left, right) => left.localeCompare(right),
      ),
    };
  });

  // graphql: used by the notifications bell (IssueTrackerNotifications.ts).
  return {
    viewerName,
    issue,
    search,
    assignedOpenIssues,
    recentIssues,
    filterOptions,
    graphql,
  };
});

export type LinearApi = Effect.Success<typeof makeLinearApi>;
