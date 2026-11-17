import type { LinearIssue, LinearIssueIdentifier } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assigneeInitials,
  collectThreadLinearIdentifiers,
  resolveLinearIssueRowView,
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

describe("assigneeInitials", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["Grace Brewster Hopper", "GH"],
    ["guillermo", "GU"],
  ])("abbreviates %s as %s", (name, expected) => {
    expect(assigneeInitials(name)).toBe(expected);
  });
});
