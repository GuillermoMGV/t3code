import { describe, expect, it } from "@effect/vitest";
import type { IssueKey } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { applyThreadLinkMutation, resolveThreadLink } from "./IssueTrackerService.ts";
import { jqlString, makeJiraApi, normalizeJiraSiteUrl } from "./jiraApi.ts";
import { makeLinearApi } from "./linearApi.ts";

const key = (value: string) => value as IssueKey;
const threadId = "thread-1" as never;

describe("resolveThreadLink", () => {
  it.each([
    ["nothing linked or detected", undefined, [], null],
    [
      "a manual link over detected ones",
      { key: key("PRO-1") },
      [key("PRO-2")],
      { key: "PRO-1", source: "manual" },
    ],
    [
      "the oldest detected issue",
      undefined,
      [key("PRO-2"), key("PRO-3")],
      { key: "PRO-2", source: "detected" },
    ],
    [
      "the next detected issue when one was dismissed",
      { dismissed: [key("PRO-2")] },
      [key("PRO-2"), key("PRO-3")],
      { key: "PRO-3", source: "detected" },
    ],
    [
      "nothing when every detected issue was dismissed",
      { dismissed: [key("PRO-2")] },
      [key("PRO-2")],
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
        { dismissed: [key("PRO-1"), key("PRO-2")] },
        { type: "link", threadId, tracker: "linear", key: key("PRO-1") },
      ),
    ).toEqual({ key: "PRO-1", dismissed: ["PRO-2"] });
  });

  it("unlinks a manual issue and dismisses the detected ones", () => {
    expect(
      applyThreadLinkMutation(
        { key: key("PRO-1"), dismissed: [key("PRO-2")] },
        { type: "unlink", threadId, tracker: "linear", dismissKeys: [key("PRO-2"), key("PRO-3")] },
      ),
    ).toEqual({ dismissed: ["PRO-2", "PRO-3"] });
  });

  it("forgets the tracker when unlinking leaves nothing to remember", () => {
    expect(
      applyThreadLinkMutation(
        { key: key("PRO-1") },
        { type: "unlink", threadId, tracker: "jira", dismissKeys: [] },
      ),
    ).toBeUndefined();
  });
});

function httpAnswering(answer: (url: URL) => { status: number; body: unknown }) {
  const requests: Array<{ url: URL; authorization: string | undefined; body: string }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      const body =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      requests.push({ url, authorization: request.headers.authorization, body });
      const { status, body: responseBody } = answer(url);
      return HttpClientResponse.fromWeb(request, Response.json(responseBody, { status }));
    }),
  );
  return { requests, http };
}

const LINEAR_NODE = {
  identifier: "PRO-1",
  title: "Login fails with SSO",
  url: "https://linear.app/acme/issue/PRO-1/login-fails-with-sso",
  priorityLabel: "High",
  updatedAt: "2026-11-17T10:00:00.000Z",
  state: { name: "In Progress", color: "#f2c94c", type: "started" },
  assignee: { name: "Ada Lovelace", avatarUrl: null },
};

describe("makeLinearApi", () => {
  it.effect("sends the personal key as is and maps the issue", () =>
    Effect.gen(function* () {
      const { requests, http } = httpAnswering(() => ({
        status: 200,
        body: { data: { issue: LINEAR_NODE } },
      }));
      const api = yield* makeLinearApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      expect(yield* api.issue("lin_api_key", key("PRO-1"))).toEqual({
        tracker: "linear",
        key: "PRO-1",
        title: "Login fails with SSO",
        url: LINEAR_NODE.url,
        state: { name: "In Progress", color: "#f2c94c", category: "started" },
        assignee: { name: "Ada Lovelace", avatarUrl: null },
        priorityLabel: "High",
        updatedAt: LINEAR_NODE.updatedAt,
      });
      expect(requests[0]?.authorization).toBe("lin_api_key");
    }),
  );

  it.effect("reads an unknown identifier as no issue", () =>
    Effect.gen(function* () {
      const { http } = httpAnswering(() => ({
        status: 200,
        body: { data: null, errors: [{ message: "Entity not found" }] },
      }));
      const api = yield* makeLinearApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      expect(yield* api.issue("lin_api_key", key("PRO-404"))).toBeNull();
    }),
  );

  it.effect("reports an authentication error as an unauthorized key", () =>
    Effect.gen(function* () {
      const { http } = httpAnswering(() => ({
        status: 400,
        body: {
          errors: [
            { message: "Authentication required", extensions: { type: "authentication error" } },
          ],
        },
      }));
      const api = yield* makeLinearApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      const error = yield* api.viewerName("bad").pipe(Effect.flip);
      expect(error.reason).toBe("unauthorized");
    }),
  );
});

describe("normalizeJiraSiteUrl", () => {
  it.each([
    ["acme", "https://acme.atlassian.net"],
    ["acme.atlassian.net", "https://acme.atlassian.net"],
    ["https://acme.atlassian.net/jira/your-work/", "https://acme.atlassian.net"],
    ["http://127.0.0.1:4568", "http://127.0.0.1:4568"],
    ["http://acme.atlassian.net", null],
    ["", null],
  ])("reads %j as %j", (value, expected) => {
    expect(normalizeJiraSiteUrl(value)).toBe(expected);
  });
});

it("quotes JQL strings", () => {
  expect(jqlString('say "hi" \\ bye')).toBe('"say \\"hi\\" \\\\ bye"');
});

const JIRA_CREDENTIALS = {
  siteUrl: "https://acme.atlassian.net",
  email: "ada@example.com",
  apiToken: "token",
};

describe("makeJiraApi", () => {
  it.effect("uses basic auth and maps the issue", () =>
    Effect.gen(function* () {
      const { requests, http } = httpAnswering(() => ({
        status: 200,
        body: {
          key: "OPS-7",
          fields: {
            summary: "Rotate the certificates",
            updated: "2026-11-17T10:00:00.000+0000",
            status: {
              name: "In Progress",
              statusCategory: { key: "indeterminate", colorName: "yellow" },
            },
            assignee: { displayName: "Ada Lovelace", avatarUrls: { "24x24": "https://avatar/24" } },
            priority: { name: "High" },
          },
        },
      }));
      const api = yield* makeJiraApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      expect(yield* api.issue(JIRA_CREDENTIALS, key("OPS-7"))).toEqual({
        tracker: "jira",
        key: "OPS-7",
        title: "Rotate the certificates",
        url: "https://acme.atlassian.net/browse/OPS-7",
        state: { name: "In Progress", color: "#e2b203", category: "indeterminate" },
        assignee: { name: "Ada Lovelace", avatarUrl: "https://avatar/24" },
        priorityLabel: "High",
        updatedAt: "2026-11-17T10:00:00.000+0000",
      });
      expect(requests[0]?.authorization).toBe(`Basic ${btoa("ada@example.com:token")}`);
      expect(requests[0]?.url.pathname).toBe("/rest/api/3/issue/OPS-7");
    }),
  );

  it.effect("reads a missing issue as no issue", () =>
    Effect.gen(function* () {
      const { http } = httpAnswering(() => ({
        status: 404,
        body: { errorMessages: ["No issue"] },
      }));
      const api = yield* makeJiraApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      expect(yield* api.issue(JIRA_CREDENTIALS, key("OPS-404"))).toBeNull();
    }),
  );

  it.effect("searches with JQL and reports rejected credentials", () =>
    Effect.gen(function* () {
      const { requests, http } = httpAnswering((url) =>
        url.pathname.endsWith("/myself")
          ? { status: 401, body: {} }
          : { status: 200, body: { issues: [{ key: "OPS-1", fields: { summary: "One" } }] } },
      );
      const api = yield* makeJiraApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      const issues = yield* api.search(JIRA_CREDENTIALS, 'cert "rotation"');
      expect(issues.map((issue) => issue.key)).toEqual(["OPS-1"]);
      expect(JSON.parse(requests[0]!.body).jql).toBe(
        'text ~ "cert \\"rotation\\"" ORDER BY updated DESC',
      );
      const error = yield* api.myself(JIRA_CREDENTIALS).pipe(Effect.flip);
      expect(error.reason).toBe("unauthorized");
    }),
  );
});
