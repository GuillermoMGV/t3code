import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ProcessRunner from "../processRunner.ts";
import * as SalesforceDataService from "./SalesforceDataService.ts";

const INSTANCE = "https://acme--qa.sandbox.my.salesforce.com";

/** Runs the service against fake `sf` and HTTP; `respond` answers each request in order. */
function harness(
  respond: (request: { method: string; url: URL; token: string }) => Response,
  { hiddenSecrets = false } = {},
) {
  const tokens = ["token-1", "token-2"];
  let displays = 0;
  const requests: Array<{ method: string; url: URL; token: string }> = [];
  const runner = Layer.mock(ProcessRunner.ProcessRunner)({
    run: (input) => {
      const showToken = input.args[1] === "auth";
      assert.deepStrictEqual(
        input.args.slice(0, -3),
        showToken ? ["org", "auth", "show-access-token"] : ["org", "display"],
      );
      assert.deepStrictEqual(input.args.slice(-3), ["--target-org", "qa", "--json"]);
      // Newer CLIs hide the token in `org display` and only show it through `org auth`.
      const accessToken =
        hiddenSecrets && !showToken
          ? "[REDACTED] Use 'sf org auth show-access-token' to view"
          : tokens[Math.min(displays++, tokens.length - 1)];
      return Effect.succeed({
        stdout: JSON.stringify({
          status: 0,
          result: showToken
            ? { accessToken }
            : { accessToken, instanceUrl: INSTANCE, apiVersion: "61.0", clientId: "x" },
        }),
        stderr: "",
        code: 0,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      } as unknown as ProcessRunner.ProcessRunOutput);
    },
  });
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const entry = {
        method: request.method,
        url: new URL(request.url),
        token: request.headers.authorization ?? "",
      };
      requests.push(entry);
      return Effect.succeed(HttpClientResponse.fromWeb(request, respond(entry)));
    }),
  );
  const layer = SalesforceDataService.layer.pipe(Layer.provide(Layer.merge(runner, http)));
  return { layer, requests, displays: () => displays };
}

const target = { cwd: "/repo", target: "qa" };

describe("SalesforceDataService", () => {
  it.effect("queries with the CLI's session and never returns the token", () => {
    const { layer, requests } = harness(() =>
      Response.json({
        totalSize: 3,
        done: false,
        nextRecordsUrl: "/services/data/v61.0/query/01gXX-2000",
        records: [{ attributes: { type: "Account" }, Id: "001000000000001AAA" }],
      }),
    );
    return Effect.gen(function* () {
      const service = yield* SalesforceDataService.SalesforceDataService;
      const result = yield* service.run({
        type: "query",
        ...target,
        soql: "SELECT Id FROM Account",
        queryAll: true,
        tooling: false,
      });
      assert.strictEqual(result.type, "page");
      assert.strictEqual(requests[0]?.url.pathname, "/services/data/v61.0/queryAll/");
      assert.strictEqual(requests[0]?.url.searchParams.get("q"), "SELECT Id FROM Account");
      assert.strictEqual(requests[0]?.token, "Bearer token-1");
      assert.include(JSON.stringify(result), "/services/data/v61.0/query/01gXX-2000");
      assert.notInclude(JSON.stringify(result), "token-1");
    }).pipe(Effect.provide(layer));
  });

  it.effect("reads the token through org auth when org display hides it", () => {
    const { layer, requests } = harness(
      () => Response.json({ totalSize: 0, done: true, records: [] }),
      { hiddenSecrets: true },
    );
    return Effect.gen(function* () {
      const service = yield* SalesforceDataService.SalesforceDataService;
      yield* service.run({
        type: "queryMore",
        ...target,
        nextRecordsUrl: "/services/data/v61.0/query/01gXX-2000",
      });
      assert.strictEqual(requests[0]?.token, "Bearer token-1");
    }).pipe(Effect.provide(layer));
  });

  it.effect("refreshes an expired session once and retries", () => {
    const { layer, requests, displays } = harness(({ token }) =>
      token === "Bearer token-1"
        ? Response.json([{ message: "Session expired", errorCode: "INVALID_SESSION_ID" }], {
            status: 401,
          })
        : Response.json({ totalSize: 0, done: true, records: [] }),
    );
    return Effect.gen(function* () {
      const service = yield* SalesforceDataService.SalesforceDataService;
      const result = yield* service.run({
        type: "queryMore",
        ...target,
        nextRecordsUrl: "/services/data/v61.0/query/01gXX-2000",
      });
      assert.deepStrictEqual(result, {
        type: "page",
        totalSize: 0,
        done: true,
        nextRecordsUrl: null,
        records: [],
      });
      assert.strictEqual(displays(), 2);
      assert.deepStrictEqual(
        requests.map((request) => request.token),
        ["Bearer token-1", "Bearer token-2"],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("surfaces the API's own error message", () => {
    const { layer } = harness(() =>
      Response.json([{ message: "unexpected token: FORM", errorCode: "MALFORMED_QUERY" }], {
        status: 400,
      }),
    );
    return Effect.gen(function* () {
      const service = yield* SalesforceDataService.SalesforceDataService;
      const error = yield* service
        .run({ type: "explain", ...target, soql: "SELECT Id FORM Account", tooling: false })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "api");
      assert.strictEqual(error.detail, "MALFORMED_QUERY: unexpected token: FORM");
    }).pipe(Effect.provide(layer));
  });

  it.effect("deletes through sObject Collections and reports each failure", () => {
    const { layer, requests } = harness(() =>
      Response.json([
        { id: "001000000000001AAA", success: true, errors: [] },
        {
          id: "001000000000002AAA",
          success: false,
          errors: [{ message: "entity is deleted", statusCode: "ENTITY_IS_DELETED" }],
        },
      ]),
    );
    return Effect.gen(function* () {
      const service = yield* SalesforceDataService.SalesforceDataService;
      const result = yield* service.run({
        type: "delete",
        ...target,
        ids: ["001000000000001AAA", "001000000000002AAA"],
      });
      assert.strictEqual(requests[0]?.method, "DELETE");
      assert.strictEqual(requests[0]?.url.pathname, "/services/data/v61.0/composite/sobjects");
      assert.strictEqual(requests[0]?.url.searchParams.get("allOrNone"), "false");
      assert.deepStrictEqual(result, {
        type: "delete",
        results: [
          { id: "001000000000001AAA", success: true, error: null },
          { id: "001000000000002AAA", success: false, error: "entity is deleted" },
        ],
      });
    }).pipe(Effect.provide(layer));
  });
});
