import type { LinearIssue, LinearIssueIdentifier } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assigneeInitials,
  collectThreadLinearIdentifiers,
  linearSearchQuery,
  moveSelectedIssue,
  resolveLinearIssueRowView,
  resolveSelectedIssue,
} from "./linearIssueRow.logic";

const id = (value: string) => value as LinearIssueIdentifier;
const issue = { identifier: id("PRO-1"), title: "Login" } as LinearIssue;

describe("collectThreadLinearIdentifiers", () => {
  it("reads issue URLs from user messages only, oldest first", () => {
    expect(
      collectThreadLinearIdentifiers([
        { item: { type: "assistant_message", text: "https://linear.app/a/issue/PRO-9" } },
        { item: { type: "user_message", text: "Work on https://linear.app/a/issue/PRO-2" } },
        { item: { type: "user_message", text: "and https://linear.app/a/issue/PRO-3, PRO-2 too" } },
        { item: { type: "user_message", text: "https://linear.app/a/issue/PRO-2" } },
      ]),
    ).toEqual(["PRO-2", "PRO-3"]);
  });
});

describe("resolveLinearIssueRowView", () => {
  it.each([
    ["loading", { data: null, error: null }, { kind: "loading" }],
    ["error", { data: null, error: "Offline" }, { kind: "error", message: "Offline" }],
    [
      "connect",
      { data: { connected: false, link: null, issue: null }, error: null },
      { kind: "connect" },
    ],
    [
      "connectToSee",
      {
        data: {
          connected: false,
          link: { identifier: id("PRO-1"), source: "detected" },
          issue: null,
        },
        error: null,
      },
      { kind: "connectToSee", identifier: "PRO-1" },
    ],
    [
      "empty",
      { data: { connected: true, link: null, issue: null }, error: null },
      { kind: "empty" },
    ],
    [
      "missing",
      {
        data: { connected: true, link: { identifier: id("PRO-1"), source: "manual" }, issue: null },
        error: null,
      },
      { kind: "missing", identifier: "PRO-1", source: "manual" },
    ],
    [
      "issue",
      {
        data: { connected: true, link: { identifier: id("PRO-1"), source: "manual" }, issue },
        error: null,
      },
      { kind: "issue", issue, source: "manual" },
    ],
  ] as const)("shows %s", (_name, input, expected) => {
    expect(resolveLinearIssueRowView(input)).toEqual(expected);
  });
});

describe("linearSearchQuery", () => {
  it.each([
    ["", ""],
    ["  a ", ""],
    ["  login sso ", "login sso"],
  ])("searches %j as %j", (draft, expected) => {
    expect(linearSearchQuery(draft)).toBe(expected);
  });
});

describe("issue selection", () => {
  const issues = [
    { identifier: id("PRO-1") },
    { identifier: id("PRO-2") },
    { identifier: id("PRO-3") },
  ];

  it.each([
    ["the first result when nothing is chosen", null, "PRO-1"],
    ["the chosen issue while it is listed", id("PRO-2"), "PRO-2"],
    ["the first result once the chosen issue is gone", id("PRO-9"), "PRO-1"],
  ] as const)("selects %s", (_name, selected, expected) => {
    expect(resolveSelectedIssue(issues, selected)).toBe(expected);
  });

  it("selects nothing without results", () => {
    expect(resolveSelectedIssue([], id("PRO-1"))).toBeNull();
    expect(moveSelectedIssue([], id("PRO-1"), 1)).toBeNull();
  });

  it.each([
    ["down", id("PRO-1"), 1, "PRO-2"],
    ["up", id("PRO-2"), -1, "PRO-1"],
    ["down at the last result", id("PRO-3"), 1, "PRO-3"],
    ["up at the first result", id("PRO-1"), -1, "PRO-1"],
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
