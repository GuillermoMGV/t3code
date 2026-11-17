import {
  SalesforceError,
  type SalesforceDataRequest,
  type SalesforceDataResult,
  type SalesforceFieldInfo,
  type SalesforceQueryPlan,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

import { describeSfFailure, makeSfCli } from "./sfCli.ts";

// Fork-only Salesforce Export panel; see CUSTOM_DEVELOPMENT.md. The access token comes from
// `sf org display` (which refreshes it) and never leaves this module.

const DEFAULT_API_VERSION = "62.0";

export interface SalesforceSession {
  readonly instanceUrl: string;
  readonly accessToken: string;
  readonly apiVersion: string;
}

const OrgDisplay = Schema.Struct({
  accessToken: Schema.String,
  instanceUrl: Schema.String,
  apiVersion: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeOrgDisplay = Schema.decodeUnknownOption(OrgDisplay);

/** The session fields of `sf org display --json`'s result, or null when any is missing. */
function parseOrgDisplay(result: unknown): SalesforceSession | null {
  const display = Option.getOrNull(decodeOrgDisplay(result));
  if (display === null || !/^https:\/\//.test(display.instanceUrl)) return null;
  const apiVersion = display.apiVersion ?? "";
  return {
    instanceUrl: display.instanceUrl.replace(/\/+$/, ""),
    accessToken: display.accessToken,
    apiVersion: /^\d+\.\d+$/.test(apiVersion) ? apiVersion : DEFAULT_API_VERSION,
  };
}

/** The REST path for a request, relative to the instance URL. */
function salesforceDataPath(
  apiVersion: string,
  request: Exclude<SalesforceDataRequest, { type: "delete" }>,
): string {
  const base = `/services/data/v${apiVersion}`;
  switch (request.type) {
    case "query":
      return `${base}/${request.tooling ? "tooling/" : ""}${request.queryAll ? "queryAll" : "query"}/?q=${encodeURIComponent(request.soql)}`;
    case "queryMore":
      return request.nextRecordsUrl;
    case "explain":
      return `${base}/${request.tooling ? "tooling/" : ""}query/?explain=${encodeURIComponent(request.soql)}`;
    case "describe":
      return `${base}/${request.tooling ? "tooling/" : ""}sobjects/${request.sobject}/describe`;
  }
}

const ApiErrors = Schema.Array(
  Schema.Struct({ message: Schema.String, errorCode: Schema.optional(Schema.String) }),
);
const decodeApiErrors = Schema.decodeUnknownOption(ApiErrors);

/** The API's own message, such as a SOQL syntax error, or a generic one for the status. */
function salesforceApiErrorMessage(status: number, body: unknown): string {
  const errors = Option.getOrNull(decodeApiErrors(body));
  const first = errors?.[0];
  if (first !== undefined) {
    return first.errorCode ? `${first.errorCode}: ${first.message}` : first.message;
  }
  return `Salesforce answered HTTP ${status}.`;
}

const QueryPage = Schema.Struct({
  totalSize: Schema.Number,
  done: Schema.Boolean,
  nextRecordsUrl: Schema.optional(Schema.NullOr(Schema.String)),
  records: Schema.Array(Schema.Unknown),
});
const decodeQueryPage = Schema.decodeUnknownEffect(QueryPage);

const NullableNumber = Schema.optional(Schema.NullOr(Schema.Number));
const Explain = Schema.Struct({
  plans: Schema.Array(
    Schema.Struct({
      leadingOperationType: Schema.String,
      sobjectType: Schema.optional(Schema.NullOr(Schema.String)),
      relativeCost: NullableNumber,
      cardinality: NullableNumber,
      sobjectCardinality: NullableNumber,
      fields: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
      notes: Schema.optional(
        Schema.NullOr(Schema.Array(Schema.Struct({ description: Schema.String }))),
      ),
    }),
  ),
});
const decodeExplain = Schema.decodeUnknownEffect(Explain);

const Describe = Schema.Struct({
  name: Schema.String,
  label: Schema.String,
  fields: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      label: Schema.String,
      type: Schema.String,
      referenceTo: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
      relationshipName: Schema.optional(Schema.NullOr(Schema.String)),
      length: NullableNumber,
      nillable: Schema.optional(Schema.Boolean),
      custom: Schema.optional(Schema.Boolean),
    }),
  ),
});
const decodeDescribe = Schema.decodeUnknownEffect(Describe);

const DeleteResults = Schema.Array(
  Schema.Struct({
    id: Schema.optional(Schema.NullOr(Schema.String)),
    success: Schema.Boolean,
    errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
  }),
);
const decodeDeleteResults = Schema.decodeUnknownEffect(DeleteResults);

const apiError = (detail: string, cause?: unknown) =>
  new SalesforceError({ reason: "api", detail, cause });

const invalidResponse = (cause: unknown) =>
  apiError("Salesforce returned a response T3 Code could not read.", cause);

export class SalesforceDataService extends Context.Service<
  SalesforceDataService,
  {
    readonly run: (
      request: SalesforceDataRequest,
    ) => Effect.Effect<SalesforceDataResult, SalesforceError>;
  }
>()("t3/salesforce/SalesforceDataService") {}

const make = Effect.gen(function* () {
  const sf = yield* makeSfCli;
  const client = yield* HttpClient.HttpClient;
  // Points every request at a local mock API instead of the org; never set outside local checks.
  const mockApiUrl = yield* Config.String("T3CODE_SALESFORCE_API_URL").pipe(
    Config.option,
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  const sessions = new Map<string, SalesforceSession>();

  const loadSession = Effect.fn("SalesforceDataService.loadSession")(function* (
    cwd: string,
    target: string,
  ) {
    if (Option.isSome(mockApiUrl)) {
      return {
        instanceUrl: mockApiUrl.value.replace(/\/+$/, ""),
        accessToken: "mock-token",
        apiVersion: DEFAULT_API_VERSION,
      };
    }
    const cached = sessions.get(target);
    if (cached !== undefined) return cached;
    const json = yield* sf.run(cwd, ["org", "display", "--target-org", target]);
    if (json === null || json.status !== 0) {
      return yield* new SalesforceError({
        reason: "command",
        detail: describeSfFailure(json, `Could not get a session for ${target}.`),
      });
    }
    const session = parseOrgDisplay(json.result);
    if (session === null) {
      return yield* new SalesforceError({
        reason: "command",
        detail: `${target} has no active session. Re-authenticate the org.`,
      });
    }
    sessions.set(target, session);
    return session;
  });

  const send = (
    session: SalesforceSession,
    method: "GET" | "DELETE",
    path: string,
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, SalesforceError> =>
    client
      .execute(
        (method === "GET"
          ? HttpClientRequest.get(`${session.instanceUrl}${path}`)
          : HttpClientRequest.delete(`${session.instanceUrl}${path}`)
        ).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${session.accessToken}`),
          HttpClientRequest.setHeader("Accept", "application/json"),
        ),
      )
      .pipe(
        Effect.timeout("2 minutes"),
        Effect.mapError((cause) =>
          apiError("Could not reach Salesforce. Check the connection.", cause),
        ),
      );

  /** Sends a request and reads its JSON; an expired session is refreshed once. */
  const request = Effect.fn("SalesforceDataService.request")(function* (
    cwd: string,
    target: string,
    method: "GET" | "DELETE",
    path: string,
  ) {
    let response = yield* send(yield* loadSession(cwd, target), method, path);
    if (response.status === 401) {
      sessions.delete(target);
      response = yield* send(yield* loadSession(cwd, target), method, path);
    }
    const body = yield* response.json.pipe(Effect.orElseSucceed((): unknown => null));
    if (response.status < 200 || response.status >= 300) {
      return yield* apiError(salesforceApiErrorMessage(response.status, body));
    }
    return body;
  });

  const run = Effect.fn("SalesforceDataService.run")(function* (
    input: SalesforceDataRequest,
  ): Effect.fn.Return<SalesforceDataResult, SalesforceError> {
    const { cwd, target } = input;
    if (input.type === "delete") {
      const session = yield* loadSession(cwd, target);
      const body = yield* request(
        cwd,
        target,
        "DELETE",
        `/services/data/v${session.apiVersion}/composite/sobjects?allOrNone=false&ids=${input.ids.join(",")}`,
      );
      const results = yield* decodeDeleteResults(body).pipe(Effect.mapError(invalidResponse));
      return {
        type: "delete",
        results: input.ids.map((id, index) => {
          const result = results[index];
          return {
            id,
            success: result?.success ?? false,
            error:
              result === undefined
                ? "No result returned."
                : result.success
                  ? null
                  : (result.errors?.map((error) => error.message).join("; ") ?? "Not deleted."),
          };
        }),
      };
    }
    if (input.type === "query" && input.queryAll && input.tooling) {
      return yield* new SalesforceError({
        reason: "invalidInput",
        detail: "Deleted and archived records cannot be queried through the Tooling API.",
      });
    }
    const session = yield* loadSession(cwd, target);
    const body = yield* request(cwd, target, "GET", salesforceDataPath(session.apiVersion, input));
    switch (input.type) {
      case "query":
      case "queryMore": {
        const page = yield* decodeQueryPage(body).pipe(Effect.mapError(invalidResponse));
        return {
          type: "page",
          totalSize: page.totalSize,
          done: page.done,
          nextRecordsUrl: page.done ? null : (page.nextRecordsUrl ?? null),
          records: page.records,
        };
      }
      case "explain": {
        const explain = yield* decodeExplain(body).pipe(Effect.mapError(invalidResponse));
        return {
          type: "explain",
          plans: explain.plans.map((plan): SalesforceQueryPlan => ({
            leadingOperationType: plan.leadingOperationType,
            sobjectType: plan.sobjectType ?? null,
            relativeCost: plan.relativeCost ?? null,
            cardinality: plan.cardinality ?? null,
            sobjectCardinality: plan.sobjectCardinality ?? null,
            fields: plan.fields ?? [],
            notes: plan.notes?.map((note) => note.description) ?? [],
          })),
        };
      }
      case "describe": {
        const describe = yield* decodeDescribe(body).pipe(Effect.mapError(invalidResponse));
        return {
          type: "describe",
          name: describe.name,
          label: describe.label,
          fields: describe.fields.map((field): SalesforceFieldInfo => ({
            name: field.name,
            label: field.label,
            type: field.type,
            referenceTo: field.referenceTo ?? [],
            relationshipName: field.relationshipName ?? null,
            length: field.length ?? null,
            nillable: field.nillable ?? false,
            custom: field.custom ?? false,
          })),
        };
      }
    }
  });

  return SalesforceDataService.of({ run });
});

export const layer = Layer.effect(SalesforceDataService, make);
