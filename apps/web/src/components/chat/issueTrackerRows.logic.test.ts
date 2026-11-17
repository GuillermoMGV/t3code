import type { IssueKey, IssueTrackerThreadRow, TrackerIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assigneeInitials,
  collectThreadIssueReferences,
  issueSearchQuery,
  moveSelectedIssue,
  resolveIssueTrackerPanelView,
  resolveSelectedIssue,
} from "./issueTrackerRows.logic";

const key = (value: string) => value as IssueKey;
const issue = { tracker: "linear", key: key("PRO-1"), title: "Login" } as TrackerIssue;

const row = (overrides: Partial<IssueTrackerThreadRow>): IssueTrackerThreadRow => ({
  tracker: "linear",
  connected: true,
  link: null,
  issue: null,
  error: null,
  ...overrides,
});

describe("collectThreadIssueReferences", () => {
  it("reads Linear and Jira URLs from user messages only, oldest first", () => {
    expect(
      collectThreadIssueReferences([
        { item: { type: "assistant_message", text: "https://linear.app/a/issue/PRO-9" } },
        { item: { type: "user_message", text: "Work on https://linear.app/a/issue/PRO-2" } },
        { item: { type: "user_message", text: "and https://acme.atlassian.net/browse/OPS-3" } },
        { item: { type: "user_message", text: "https://linear.app/a/issue/PRO-2 again" } },
      ]),
    ).toEqual([
      { tracker: "linear", key: "PRO-2" },
      { tracker: "jira", key: "OPS-3" },
    ]);
  });
});

describe("resolveIssueTrackerPanelView", () => {
  it.each([
    ["loading", { data: null, error: null }, { kind: "loading" }],
    ["an error", { data: null, error: "Offline" }, { kind: "error", message: "Offline" }],
    [
      "setup when nothing is connected or referenced",
      {
        data: { rows: [row({ connected: false }), row({ tracker: "jira", connected: false })] },
        error: null,
      },
      { kind: "setup" },
    ],
  ] as const)("shows %s", (_name, input, expected) => {
    expect(resolveIssueTrackerPanelView(input)).toEqual(expected);
  });

  it("shows a row per connected or referenced tracker", () => {
    expect(
      resolveIssueTrackerPanelView({
        data: {
          rows: [
            row({ link: { key: key("PRO-1"), source: "manual" }, issue }),
            row({
              tracker: "jira",
              connected: false,
              link: { key: key("OPS-2"), source: "detected" },
            }),
          ],
        },
        error: null,
      }),
    ).toEqual({
      kind: "rows",
      rows: [
        { kind: "issue", tracker: "linear", issue, source: "manual" },
        { kind: "connectToSee", tracker: "jira", key: "OPS-2" },
      ],
    });
  });

  it.each([
    ["empty", row({}), { kind: "empty", tracker: "linear" }],
    [
      "missing",
      row({ link: { key: key("PRO-1"), source: "manual" } }),
      { kind: "missing", tracker: "linear", key: "PRO-1", source: "manual" },
    ],
    [
      "error",
      row({ error: "Linear rejected the API key." }),
      { kind: "error", tracker: "linear", message: "Linear rejected the API key." },
    ],
  ] as const)("shows a connected tracker as %s", (_name, input, expected) => {
    expect(resolveIssueTrackerPanelView({ data: { rows: [input] }, error: null })).toEqual({
      kind: "rows",
      rows: [expected],
    });
  });
});

describe("issueSearchQuery", () => {
  it.each([
    ["", ""],
    ["  a ", ""],
    ["  login sso ", "login sso"],
  ])("searches %j as %j", (draft, expected) => {
    expect(issueSearchQuery(draft)).toBe(expected);
  });
});

describe("issue selection", () => {
  const issues = [{ key: key("PRO-1") }, { key: key("PRO-2") }, { key: key("PRO-3") }];

  it.each([
    ["the first result when nothing is chosen", null, "PRO-1"],
    ["the chosen issue while it is listed", key("PRO-2"), "PRO-2"],
    ["the first result once the chosen issue is gone", key("PRO-9"), "PRO-1"],
  ] as const)("selects %s", (_name, selected, expected) => {
    expect(resolveSelectedIssue(issues, selected)).toBe(expected);
  });

  it("selects nothing without results", () => {
    expect(resolveSelectedIssue([], key("PRO-1"))).toBeNull();
    expect(moveSelectedIssue([], key("PRO-1"), 1)).toBeNull();
  });

  it.each([
    ["down", key("PRO-1"), 1, "PRO-2"],
    ["up", key("PRO-2"), -1, "PRO-1"],
    ["down at the last result", key("PRO-3"), 1, "PRO-3"],
    ["up at the first result", key("PRO-1"), -1, "PRO-1"],
  ] as const)("moves %s", (_name, selected, delta, expected) => {
    expect(moveSelectedIssue(issues, selected, delta)).toBe(expected);
  });
});

describe("assigneeInitials", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["Grace Brewster Hopper", "GH"],
    ["guillermo", "GU"],
  ])("abbreviates %s as %s", (name, expected) => {
    expect(assigneeInitials(name)).toBe(expected);
  });
});
