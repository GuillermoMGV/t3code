import { describe, expect, it } from "@effect/vitest";
import type { IssueKey } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import {
  applyThreadLinkMutation,
  rememberDetectedLink,
  resolveThreadLink,
  summaryKey,
} from "./IssueTrackerService.ts";
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

describe("remembered detections", () => {
  it("falls back to the remembered detection before the messages load", () => {
    expect(resolveThreadLink({ detected: key("PRO-4") }, [])).toEqual({
      key: "PRO-4",
      source: "detected",
    });
  });

  it("remembers a new detection and ignores manual links or repeats", () => {
    expect(rememberDetectedLink(undefined, { key: key("PRO-4"), source: "detected" })).toEqual({
      detected: "PRO-4",
    });
    expect(
      rememberDetectedLink({ detected: key("PRO-4") }, { key: key("PRO-4"), source: "detected" }),
    ).toBeUndefined();
    expect(
      rememberDetectedLink(undefined, { key: key("PRO-4"), source: "manual" }),
    ).toBeUndefined();
  });

  it.each([
    ["the manual link", { key: key("PRO-1"), detected: key("PRO-2") }, "PRO-1"],
    ["the remembered detection", { detected: key("PRO-2") }, "PRO-2"],
    [
      "nothing for a dismissed detection",
      { detected: key("PRO-2"), dismissed: [key("PRO-2")] },
      null,
    ],
    ["nothing without links", undefined, null],
  ] as const)("shows %s in the thread list", (_name, entry, expected) => {
    expect(summaryKey(entry)).toBe(expected);
  });

  it("forgets the detection when the thread is unlinked", () => {
    expect(
      applyThreadLinkMutation(
        { detected: key("PRO-2") },
        { type: "unlink", threadId, tracker: "linear", dismissKeys: [key("PRO-2")] },
      ),
    ).toEqual({ dismissed: ["PRO-2"] });
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
  const requests: Array<{
    method: string;
    url: URL;
    authorization: string | undefined;
    body: string;
  }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      const body =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      requests.push({
        method: request.method,
        url,
        authorization: request.headers.authorization,
        body,
      });
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
  dueDate: "2026-11-20",
  updatedAt: "2026-11-17T10:00:00.000Z",
  state: { name: "In Progress", color: "#f2c94c", type: "started" },
  assignee: { name: "Ada Lovelace", avatarUrl: null },
  project: { name: "Login revamp", url: "https://linear.app/acme/project/login-revamp" },
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
        dueDate: "2026-11-20",
        updatedAt: LINEAR_NODE.updatedAt,
        project: LINEAR_NODE.project,
      });
      expect(requests[0]?.authorization).toBe("lin_api_key");
    }),
  );

  it.effect("asks Linear to filter recent issues and lists its filter options", () =>
    Effect.gen(function* () {
      const { requests, http } = httpAnswering(() => ({
        status: 200,
        body: {
          data: {
            issues: { nodes: [LINEAR_NODE] },
            workflowStates: {
              nodes: [
                { name: "Done", type: "completed", position: 0 },
                { name: "Todo", type: "unstarted", position: 1 },
                { name: "Backlog", type: "backlog", position: 0 },
                { name: "Todo", type: "unstarted", position: 0 },
              ],
            },
            projects: { nodes: [{ name: "Payments" }, { name: "Login revamp" }] },
          },
        },
      }));
      const api = yield* makeLinearApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      yield* api.recentIssues("lin_api_key");
      expect(JSON.parse(requests[0]!.body).variables).toEqual({ filter: null });
      yield* api.recentIssues("lin_api_key", {
        states: ["Todo"],
        assignees: ["me", "others", "unassigned"],
        projects: [],
      });
      expect(JSON.parse(requests[1]!.body).variables.filter).toEqual({
        and: [
          { state: { name: { in: ["Todo"] } } },
          {
            or: [
              { assignee: { isMe: { eq: true } } },
              { assignee: { isMe: { eq: false } } },
              { assignee: { null: true } },
            ],
          },
        ],
      });
      expect(yield* api.filterOptions("lin_api_key")).toEqual({
        states: ["Backlog", "Todo", "Done"],
        projects: ["Login revamp", "Payments"],
      });
    }),
  );

  it.effect("offers the team's states and active members, and updates by identifier", () =>
    Effect.gen(function* () {
      const { requests, http } = httpAnswering(() => ({
        status: 200,
        body: {
          data: {
            issue: {
              team: {
                states: {
                  nodes: [
                    {
                      id: "s-done",
                      name: "Done",
                      color: "#5e6ad2",
                      type: "completed",
                      position: 0,
                    },
                    {
                      id: "s-todo",
                      name: "Todo",
                      color: "#e2e2e2",
                      type: "unstarted",
                      position: 0,
                    },
                  ],
                },
                members: {
                  nodes: [
                    { id: "u-2", name: "Grace Hopper", avatarUrl: null, active: true },
                    { id: "u-3", name: "Gone Person", active: false },
                    { id: "u-1", name: "Ada Lovelace", avatarUrl: "https://avatar/ada" },
                  ],
                },
              },
            },
            issueUpdate: { success: true },
          },
        },
      }));
      const api = yield* makeLinearApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      expect(yield* api.editOptions("lin_api_key", key("PRO-1"))).toEqual({
        states: [
          { id: "s-todo", name: "Todo", color: "#e2e2e2", category: "unstarted" },
          { id: "s-done", name: "Done", color: "#5e6ad2", category: "completed" },
        ],
        assignees: [
          { id: "u-1", name: "Ada Lovelace", avatarUrl: "https://avatar/ada" },
          { id: "u-2", name: "Grace Hopper", avatarUrl: null },
        ],
      });
      yield* api.updateIssue("lin_api_key", key("PRO-1"), { assigneeId: null });
      expect(JSON.parse(requests[1]!.body).variables).toEqual({
        id: "PRO-1",
        input: { assigneeId: null },
      });
    }),
  );

  it.effect("reports Linear's reason when an update is rejected", () =>
    Effect.gen(function* () {
      const { http } = httpAnswering(() => ({
        status: 200,
        body: { data: null, errors: [{ message: "Invalid state for this team" }] },
      }));
      const api = yield* makeLinearApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      const error = yield* api
        .updateIssue("lin_api_key", key("PRO-1"), { stateId: "s-x" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        reason: "invalidInput",
        detail: "Invalid state for this team",
      });
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
            duedate: "2026-11-21",
            project: { key: "OPS", name: "Operations" },
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
        dueDate: "2026-11-21",
        updatedAt: "2026-11-17T10:00:00.000+0000",
        project: { name: "Operations", url: "https://acme.atlassian.net/browse/OPS" },
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

  it.effect("offers each transition's status once and the assignable people", () =>
    Effect.gen(function* () {
      const { requests, http } = httpAnswering((url) =>
        url.pathname.endsWith("/transitions")
          ? {
              status: 200,
              body: {
                transitions: [
                  {
                    id: "31",
                    to: { name: "Done", statusCategory: { key: "done", colorName: "green" } },
                  },
                  {
                    id: "11",
                    to: { name: "To Do", statusCategory: { key: "new", colorName: "blue-gray" } },
                  },
                  {
                    id: "41",
                    to: { name: "Done", statusCategory: { key: "done", colorName: "green" } },
                  },
                ],
              },
            }
          : {
              status: 200,
              body: [
                { accountId: "a-2", displayName: "Grace Hopper", accountType: "atlassian" },
                { accountId: "bot", displayName: "Automation", accountType: "app" },
                {
                  accountId: "a-1",
                  displayName: "Ada Lovelace",
                  avatarUrls: { "24x24": "https://avatar/24" },
                },
                { accountId: "a-3", displayName: "Gone Person", active: false },
              ],
            },
      );
      const api = yield* makeJiraApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      expect(yield* api.editOptions(JIRA_CREDENTIALS, key("OPS-7"))).toEqual({
        states: [
          { id: "11", name: "To Do", color: "#8590a2", category: "new" },
          { id: "31", name: "Done", color: "#22a06b", category: "done" },
        ],
        assignees: [
          { id: "a-1", name: "Ada Lovelace", avatarUrl: "https://avatar/24" },
          { id: "a-2", name: "Grace Hopper", avatarUrl: null },
        ],
      });
      expect(requests.map((request) => request.url.searchParams.get("issueKey"))).toContain(
        "OPS-7",
      );
    }),
  );

  it.effect("transitions and assigns, and reports why Jira refused", () =>
    Effect.gen(function* () {
      const { requests, http } = httpAnswering((url) =>
        url.pathname.endsWith("/assignee")
          ? { status: 200, body: {} }
          : {
              status: 400,
              body: { errorMessages: [], errors: { resolution: "Resolution is required." } },
            },
      );
      const api = yield* makeJiraApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      yield* api.assignIssue(JIRA_CREDENTIALS, key("OPS-7"), null);
      expect(requests[0]).toMatchObject({ method: "PUT", body: '{"accountId":null}' });
      const error = yield* api
        .transitionIssue(JIRA_CREDENTIALS, key("OPS-7"), "31")
        .pipe(Effect.flip);
      expect(requests[1]).toMatchObject({ method: "POST", body: '{"transition":{"id":"31"}}' });
      expect(error).toMatchObject({ reason: "invalidInput", detail: "Resolution is required." });
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
      // Recent issues need a bounded JQL: the search endpoint rejects unbounded ones.
      yield* api.recentIssues(JIRA_CREDENTIALS);
      expect(JSON.parse(requests[1]!.body)).toMatchObject({
        jql: "updated >= -90d ORDER BY updated DESC",
        maxResults: 50,
      });
      // A filter bounds the JQL itself, so it replaces the 90 day window.
      yield* api.recentIssues(JIRA_CREDENTIALS, {
        states: ["To Do", 'Say "hi"'],
        assignees: ["me", "unassigned"],
        projects: ["Operations"],
      });
      expect(JSON.parse(requests[2]!.body).jql).toBe(
        'status in ("To Do", "Say \\"hi\\"") AND (assignee = currentUser() OR assignee is EMPTY) AND project in ("Operations") ORDER BY updated DESC',
      );
      const error = yield* api.myself(JIRA_CREDENTIALS).pipe(Effect.flip);
      expect(error.reason).toBe("unauthorized");
    }),
  );
});
