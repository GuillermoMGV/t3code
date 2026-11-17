import { findIssueReferences, type TrackerIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
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
