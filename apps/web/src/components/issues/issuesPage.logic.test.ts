import { findIssueReferences, type TrackerIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_ISSUE_LIST_FILTER,
  filterIssues,
  issueAssigneeGroup,
  issueProjectOptions,
  issueStateOptions,
  pullRequestsByIssueKey,
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

const listed = (
  key: string,
  state: string | null,
  assignee: string | null,
  project: string | null = null,
) => ({
  key,
  state: state === null ? null : { name: state, color: "#000", category: "started" },
  assignee: assignee === null ? null : { name: assignee, avatarUrl: null },
  project: project === null ? null : { name: project, url: null },
});
const filter = (patch: Partial<Parameters<typeof filterIssues>[1]>) => ({
  ...EMPTY_ISSUE_LIST_FILTER,
  ...patch,
});

describe("filterIssues", () => {
  const issues = [
    listed("A-1", "In Progress", "Guillermo Miranda", "Login"),
    listed("A-2", "Todo", "Ada Lovelace", "Billing"),
    listed("A-3", "Todo", null, "Login"),
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
    expect(keys(filter({ assignees: ["me", "unassigned"] }), me)).toEqual(["A-1", "A-3", "A-4"]);
    expect(keys(filter({ states: ["Todo"] }), me)).toEqual(["A-2", "A-3"]);
    expect(keys(filter({ states: ["Todo"], assignees: ["others"] }), me)).toEqual(["A-2"]);
    // An issue without a project never matches a project filter.
    expect(keys(filter({ projects: ["Login"] }), me)).toEqual(["A-1", "A-3"]);
    expect(keys(filter({ projects: ["Login"], assignees: ["unassigned"] }), me)).toEqual(["A-3"]);
  });

  it("offers the listed states and projects, keeping chosen ones a new search dropped", () => {
    expect(issueStateOptions(issues, filter({ states: ["Done"] }))).toEqual([
      "In Progress",
      "Todo",
      "Done",
    ]);
    expect(issueProjectOptions(issues, filter({ projects: ["Ops"] }))).toEqual([
      "Login",
      "Billing",
      "Ops",
    ]);
  });
});

describe("pullRequestsByIssueKey", () => {
  const pr = (number: number, title: string, state: string, updatedAt: string) => ({
    number,
    title,
    state,
    updatedAt,
  });
  const keyOf = (entry: { title: string }) => /[A-Z]+-\d+/.exec(entry.title)?.[0] ?? null;

  it("groups by key, open first then most recent, a few per issue", () => {
    const byKey = pullRequestsByIssueKey(
      [
        pr(1, "PRO-1 old merged", "merged", "2026-11-01T00:00:00Z"),
        pr(2, "PRO-1 open", "open", "2026-10-01T00:00:00Z"),
        pr(3, "PRO-1 new merged", "merged", "2026-11-10T00:00:00Z"),
        pr(4, "PRO-1 closed", "closed", "2026-11-05T00:00:00Z"),
        pr(5, "no key", "open", "2026-11-10T00:00:00Z"),
        pr(6, "OPS-2 fix", "open", "2026-11-10T00:00:00Z"),
      ],
      keyOf,
    );
    expect(byKey.get("PRO-1")?.map((entry) => entry.number)).toEqual([2, 3, 4]);
    expect(byKey.get("OPS-2")?.map((entry) => entry.number)).toEqual([6]);
    expect([...byKey.keys()]).toEqual(["PRO-1", "OPS-2"]);
  });
});
