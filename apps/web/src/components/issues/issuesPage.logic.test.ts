import { findIssueReferences, type TrackerIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_ISSUE_LIST_FILTER,
  filterIssues,
  issueAssigneeGroup,
  issueStateOptions,
  issueThreadPrompt,
  resolveIssuesTracker,
  threadIssueKey,
  threadsByIssue,
  threadsForIssue,
} from "./issuesPage.logic";

const ref = (tracker: TrackerIssue["tracker"], key: string) => ({
  tracker,
  key: key as TrackerIssue["key"],
});

const thread = (id: string, updatedAt: string, archivedAt: string | null = null) => ({
  environmentId: "env",
  id,
  updatedAt,
  archivedAt,
});

describe("threadsByIssue", () => {
  it("lists an issue's live threads, most recently updated first", () => {
    const links = new Map([
      [threadIssueKey("env", "old"), [ref("linear", "PRO-1")]],
      [threadIssueKey("env", "new"), [ref("linear", "PRO-1"), ref("jira", "OPS-2")]],
      [threadIssueKey("env", "archived"), [ref("linear", "PRO-1")]],
      // A link whose thread the client does not know: deleted, or a draft never sent.
      [threadIssueKey("env", "gone"), [ref("linear", "PRO-1")]],
    ]);
    const byIssue = threadsByIssue(links, [
      thread("old", "2026-11-01T00:00:00.000Z"),
      thread("new", "2026-11-10T00:00:00.000Z"),
      thread("archived", "2026-11-12T00:00:00.000Z", "2026-11-13T00:00:00.000Z"),
    ]);

    expect(threadsForIssue(byIssue, ref("linear", "PRO-1")).map((t) => t.id)).toEqual([
      "new",
      "old",
    ]);
    expect(threadsForIssue(byIssue, ref("jira", "OPS-2")).map((t) => t.id)).toEqual(["new"]);
    // The same key in the other tracker is a different issue.
    expect(threadsForIssue(byIssue, ref("jira", "PRO-1"))).toEqual([]);
  });

  it("keeps threads on different servers apart", () => {
    const links = new Map([[threadIssueKey("remote", "t1"), [ref("linear", "PRO-1")]]]);
    const byIssue = threadsByIssue(links, [thread("t1", "2026-11-01T00:00:00.000Z")]);
    expect(threadsForIssue(byIssue, ref("linear", "PRO-1"))).toEqual([]);
  });
});

describe("issueThreadPrompt", () => {
  it("carries a URL the thread detects as the same issue", () => {
    for (const issue of [
      {
        ...ref("linear", "PRO-12"),
        title: "Fix login",
        url: "https://linear.app/acme/issue/PRO-12/fix-login",
      },
      {
        ...ref("jira", "OPS-3"),
        title: "Rotate keys",
        url: "https://acme.atlassian.net/browse/OPS-3",
      },
    ]) {
      expect(findIssueReferences(issueThreadPrompt(issue))).toEqual([
        { tracker: issue.tracker, key: issue.key },
      ]);
    }
  });
});

describe("resolveIssuesTracker", () => {
  const both = [
    { tracker: "linear", connected: true },
    { tracker: "jira", connected: true },
  ] as const;

  it("shows the requested tracker only while it is connected", () => {
    expect(resolveIssuesTracker(both, "jira")).toBe("jira");
    expect(resolveIssuesTracker(both, undefined)).toBe("linear");
    expect(
      resolveIssuesTracker(
        [
          { tracker: "linear", connected: false },
          { tracker: "jira", connected: true },
        ],
        "linear",
      ),
    ).toBe("jira");
    expect(resolveIssuesTracker([{ tracker: "linear", connected: false }], undefined)).toBe(null);
  });
});

const listed = (key: string, state: string | null, assignee: string | null) => ({
  key,
  state: state === null ? null : { name: state, color: "#000", category: "started" },
  assignee: assignee === null ? null : { name: assignee, avatarUrl: null },
});

describe("filterIssues", () => {
  const issues = [
    listed("A-1", "In Progress", "Guillermo Miranda"),
    listed("A-2", "Todo", "Ada Lovelace"),
    listed("A-3", "Todo", null),
    listed("A-4", null, "guillermo miranda "),
  ];
  const keys = (filter: Parameters<typeof filterIssues>[1], me: string | null) =>
    filterIssues(issues, filter, me).map((issue) => issue.key);

  it("groups assignees as me, others and unassigned", () => {
    expect(issues.map((issue) => issueAssigneeGroup(issue, "Guillermo Miranda"))).toEqual([
      "me",
      "others",
      "unassigned",
      "me",
    ]);
    // Without a known account, nobody is "me".
    expect(issueAssigneeGroup(issues[0]!, null)).toBe("others");
  });

  it("adds up values of one kind and narrows across kinds", () => {
    const me = "Guillermo Miranda";
    expect(keys(EMPTY_ISSUE_LIST_FILTER, me)).toEqual(["A-1", "A-2", "A-3", "A-4"]);
    expect(keys({ states: [], assignees: ["me", "unassigned"] }, me)).toEqual([
      "A-1",
      "A-3",
      "A-4",
    ]);
    expect(keys({ states: ["Todo"], assignees: [] }, me)).toEqual(["A-2", "A-3"]);
    expect(keys({ states: ["Todo"], assignees: ["others"] }, me)).toEqual(["A-2"]);
  });

  it("offers the listed states and keeps chosen ones a new search dropped", () => {
    expect(issueStateOptions(issues, { states: ["Done"], assignees: [] })).toEqual([
      "In Progress",
      "Todo",
      "Done",
    ]);
  });
});
