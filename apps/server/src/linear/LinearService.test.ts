import { describe, expect, it } from "@effect/vitest";
import type { LinearIssueIdentifier } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { makeLinearApi } from "./linearApi.ts";
import { applyThreadLinkMutation, resolveThreadLink } from "./LinearService.ts";

const id = (value: string) => value as LinearIssueIdentifier;
const threadId = "thread-1" as never;

describe("resolveThreadLink", () => {
  it.each([
    ["nothing linked or detected", undefined, [], null],
    [
      "a manual link over detected ones",
      { identifier: id("PRO-1") },
      [id("PRO-2")],
      { identifier: "PRO-1", source: "manual" },
    ],
    [
      "the oldest detected issue",
      undefined,
      [id("PRO-2"), id("PRO-3")],
      { identifier: "PRO-2", source: "detected" },
    ],
    [
      "the next detected issue when one was dismissed",
      { dismissed: [id("PRO-2")] },
      [id("PRO-2"), id("PRO-3")],
      { identifier: "PRO-3", source: "detected" },
    ],
    [
      "nothing when every detected issue was dismissed",
      { dismissed: [id("PRO-2")] },
      [id("PRO-2")],
      null,
    ],
  ] as const)("resolves %s", (_name, entry, detected, expected) => {
    expect(resolveThreadLink(entry, detected)).toEqual(expected);
  });
});

describe("applyThreadLinkMutation", () => {
  it("links an issue and forgets that it was dismissed", () => {
    expect(
      applyThreadLinkMutation(
        { dismissed: [id("PRO-1"), id("PRO-2")] },
        { type: "link", threadId, identifier: id("PRO-1") },
      ),
    ).toEqual({ identifier: "PRO-1", dismissed: ["PRO-2"] });
  });

  it("unlinks a manual issue and dismisses the detected ones", () => {
    expect(
      applyThreadLinkMutation(
        { identifier: id("PRO-1"), dismissed: [id("PRO-2")] },
        { type: "unlink", threadId, dismissIdentifiers: [id("PRO-2"), id("PRO-3")] },
      ),
    ).toEqual({ dismissed: ["PRO-2", "PRO-3"] });
  });

  it("forgets the thread when unlinking leaves nothing to remember", () => {
    expect(
      applyThreadLinkMutation(
        { identifier: id("PRO-1") },
        { type: "unlink", threadId, dismissIdentifiers: [] },
      ),
    ).toBeUndefined();
  });
});

const ISSUE = {
  identifier: "PRO-1",
  title: "Login fails with SSO",
  url: "https://linear.app/acme/issue/PRO-1/login-fails-with-sso",
  priorityLabel: "High",
  updatedAt: "2026-11-17T10:00:00.000Z",
  state: { name: "In Progress", color: "#f2c94c", type: "started" },
  assignee: { name: "Ada Lovelace", avatarUrl: null },
};

function apiAnswering(status: number, body: unknown) {
  const requests: Array<{ authorization: string | undefined; query: string }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const payload =
        request.body._tag === "Uint8Array"
          ? (JSON.parse(new TextDecoder().decode(request.body.body)) as { query: string })
          : { query: "" };
      requests.push({ authorization: request.headers.authorization, query: payload.query });
      return HttpClientResponse.fromWeb(request, Response.json(body, { status }));
    }),
  );
  return { requests, api: makeLinearApi.pipe(Effect.provideService(HttpClient.HttpClient, http)) };
}

describe("makeLinearApi", () => {
  it.effect("sends the personal key as is and decodes the issue", () =>
    Effect.gen(function* () {
      const { requests, api } = apiAnswering(200, { data: { issue: ISSUE } });
      const issue = yield* (yield* api).issue("lin_api_key", id("PRO-1"));
      expect(issue).toEqual(ISSUE);
      expect(requests[0]?.authorization).toBe("lin_api_key");
    }),
  );

  it.effect("reads an unknown identifier as no issue", () =>
    Effect.gen(function* () {
      const { api } = apiAnswering(200, {
        data: null,
        errors: [{ message: "Entity not found", extensions: { type: "invalid input" } }],
      });
      expect(yield* (yield* api).issue("lin_api_key", id("PRO-404"))).toBeNull();
    }),
  );

  it.effect.each([
    ["an HTTP 401", 401, { errors: [{ message: "Unauthorized" }] }],
    [
      "an authentication error",
      400,
      {
        errors: [
          { message: "Authentication required", extensions: { type: "authentication error" } },
        ],
      },
    ],
  ] as const)("reports %s as an unauthorized key", ([, status, body]) =>
    Effect.gen(function* () {
      const { api } = apiAnswering(status, body);
      const error = yield* (yield* api).viewerName("bad").pipe(Effect.flip);
      expect(error.reason).toBe("unauthorized");
    }),
  );
});
