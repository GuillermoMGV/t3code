import { LinearIssue, LinearRequestError, type LinearIssueIdentifier } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

const LINEAR_API_URL = "https://api.linear.app/graphql";

// IssueSearchResult is not an Issue, so the selection is spelled out instead of a fragment.
const ISSUE_FIELDS = `identifier title url priorityLabel updatedAt
  state { name color type }
  assignee { name avatarUrl }`;

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
const IssueData = Schema.Struct({ issue: Schema.NullOr(LinearIssue) });
const SearchData = Schema.Struct({
  searchIssues: Schema.Struct({ nodes: Schema.Array(LinearIssue) }),
});
const AssignedData = Schema.Struct({
  viewer: Schema.Struct({
    assignedIssues: Schema.Struct({ nodes: Schema.Array(LinearIssue) }),
  }),
});

const invalidResponse = (cause: unknown) =>
  new LinearRequestError({
    reason: "invalidResponse",
    detail: "Linear returned a response T3 Code could not read.",
    cause,
  });

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
        Effect.mapError(
          (cause) =>
            new LinearRequestError({
              reason: "network",
              detail: "Could not reach Linear. Check the connection and try again.",
              cause,
            }),
        ),
      );
    if (response.status === 401 || response.status === 403) {
      return yield* new LinearRequestError({
        reason: "unauthorized",
        detail: "Linear rejected the API key. Connect Linear again with a valid key.",
      });
    }
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
      return yield* new LinearRequestError({
        reason: "unauthorized",
        detail: "Linear rejected the API key. Connect Linear again with a valid key.",
      });
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
  const issue = Effect.fn("LinearApi.issue")(function* (
    apiKey: string,
    identifier: LinearIssueIdentifier,
  ) {
    const result = yield* graphql(
      apiKey,
      `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
      { id: identifier },
    );
    // Linear answers an unknown identifier with an "Entity not found" error.
    if (result._tag === "errors") return null;
    return (yield* expectData(IssueData, result)).issue;
  });

  const search = Effect.fn("LinearApi.search")(function* (apiKey: string, term: string) {
    const result = yield* graphql(
      apiKey,
      `query Search($term: String!) { searchIssues(term: $term, first: 10) { nodes { ${ISSUE_FIELDS} } } }`,
      { term },
    );
    return (yield* expectData(SearchData, result)).searchIssues.nodes;
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
    return (yield* expectData(AssignedData, result)).viewer.assignedIssues.nodes;
  });

  return { viewerName, issue, search, assignedOpenIssues };
});

export type LinearApi = Effect.Success<typeof makeLinearApi>;
