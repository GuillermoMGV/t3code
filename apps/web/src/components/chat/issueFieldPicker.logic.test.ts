import type { IssueKey, TrackerIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { issueTimestamp, shownIssue } from "./issueFieldPicker.logic";

const issue = (updatedAt: string, state: string): TrackerIssue => ({
  tracker: "jira",
  key: "OPS-1" as IssueKey,
  title: "Rotate the certificates",
  url: "https://acme.atlassian.net/browse/OPS-1",
  state: { name: state, color: "#8590a2", category: "new" },
  assignee: null,
  dueDate: null,
  updatedAt,
});

describe("shownIssue", () => {
  const edited = issue("2026-11-18T10:05:00.000+0100", "Done");

  it.each([
    ["no edit", issue("2026-11-18T09:00:00.000Z", "To Do"), null, "To Do"],
    ["a stale list answer", issue("2026-11-18T08:00:00.000Z", "To Do"), edited, "Done"],
    ["a list that caught up", issue("2026-11-18T09:05:00.000Z", "Done"), edited, "Done"],
    ["a later change elsewhere", issue("2026-11-18T09:30:00.000Z", "Blocked"), edited, "Blocked"],
  ] as const)("shows the right state for %s", (_name, listed, edit, expected) => {
    expect(shownIssue(listed, edit).state?.name).toBe(expected);
  });

  it("reads Jira's offsets without a colon", () => {
    expect(issueTimestamp("2026-11-18T10:05:00.000+0100")).toBe(
      Date.parse("2026-11-18T09:05:00.000Z"),
    );
  });
});
