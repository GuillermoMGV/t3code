import type { TrackerIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_ISSUE_FILTER,
  issueFilterOptions,
  matchesIssueFilter,
  UNASSIGNED,
} from "./sidebarIssueFilter.logic";

const issue = (state: string | null, assignee: string | null): TrackerIssue => ({
  tracker: "linear",
  key: "PRO-1" as TrackerIssue["key"],
  title: "Issue",
  url: "https://linear.app/x/issue/PRO-1",
  state: state === null ? null : { name: state, color: "#000", category: "started" },
  assignee: assignee === null ? null : { name: assignee, avatarUrl: null },
  priorityLabel: null,
  updatedAt: "2026-11-17T00:00:00.000Z",
});

describe("sidebar issue filter", () => {
  const review = issue("Code Review", "Guillermo Miranda");
  const open = issue("Todo", null);

  it("matches every selected state or assignee, and both kinds together", () => {
    const byState = { states: ["Code Review", "Done"], assignees: [] };
    expect([review, open].map((item) => matchesIssueFilter(item, byState))).toEqual([true, false]);
    const unassigned = { states: [], assignees: [UNASSIGNED] };
    expect([review, open].map((item) => matchesIssueFilter(item, unassigned))).toEqual([
      false,
      true,
    ]);
    const both = { states: ["Code Review"], assignees: [UNASSIGNED] };
    expect([review, open].map((item) => matchesIssueFilter(item, both))).toEqual([false, false]);
  });

  it("hides threads without an issue only while a filter is set", () => {
    expect(matchesIssueFilter(null, EMPTY_ISSUE_FILTER)).toBe(true);
    expect(matchesIssueFilter(null, { states: ["Todo"], assignees: [] })).toBe(false);
  });

  it("offers the shown states and assignees, keeping selected ones that left the list", () => {
    expect(
      issueFilterOptions([review, open, issue(null, "Ana")], {
        states: ["Done"],
        assignees: [],
      }),
    ).toEqual({
      states: ["Code Review", "Done", "Todo"],
      assignees: ["Ana", "Guillermo Miranda", UNASSIGNED],
    });
  });
});
