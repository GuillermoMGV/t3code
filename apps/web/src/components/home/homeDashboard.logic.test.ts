import type { TrackerIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadStatusPill } from "../Sidebar.logic";
import {
  isIssueOnMyPlate,
  pullRequestAttention,
  pullRequestsNeedingYou,
  sortMyIssues,
  threadAttention,
  type ThreadAttentionInput,
} from "./homeDashboard.logic";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const THREAD: ThreadAttentionInput = {
  archivedAt: null,
  deletedAt: null,
  settledAt: null,
  settledOverride: null,
  snoozedUntil: null,
  lineage: { parentThreadId: null },
  latestRun: { status: "completed" },
  pendingBackgroundTasks: [],
};
const pill = (label: ThreadStatusPill["label"]): ThreadStatusPill => ({
  label,
  colorClass: "",
  dotClass: "",
  pulse: false,
});

describe("threadAttention", () => {
  it.each([
    ["approval", pill("Pending Approval"), "Needs approval"],
    ["question", pill("Awaiting Input"), "Asks you"],
    ["unread reply", pill("Completed"), "New reply"],
    ["read reply", null, "Your turn"],
    ["working", pill("Working"), null],
    ["waiting on a wait", pill("Waiting"), null],
  ])("%s", (_name, status, expected) => {
    expect(threadAttention(THREAD, status, NOW)?.label ?? null).toBe(expected);
  });

  it.each([
    ["settled", { settledAt: "2026-11-19T10:00:00.000Z" }],
    ["settled by hand", { settledOverride: "settled" as const }],
    ["snoozed", { snoozedUntil: "2026-11-20T08:00:00.000Z" }],
    ["a subagent", { lineage: { parentThreadId: "parent" } }],
    ["archived", { archivedAt: "2026-11-19T10:00:00.000Z" }],
    ["never run", { latestRun: null }],
    ["stopped by the user", { latestRun: { status: "interrupted" } }],
    ["waiting on background work", { pendingBackgroundTasks: [{}] }],
  ])("ignores a thread that is %s", (_name, patch) => {
    expect(threadAttention({ ...THREAD, ...patch }, null, NOW)).toBeNull();
  });

  it("shows a thread whose snooze ended", () => {
    const woke = { ...THREAD, snoozedUntil: "2026-11-19T08:00:00.000Z" };
    expect(threadAttention(woke, null, NOW)?.label).toBe("Your turn");
  });

  it("still asks for approval on a snoozed thread only once it wakes", () => {
    const snoozed = { ...THREAD, snoozedUntil: "2026-11-20T08:00:00.000Z" };
    expect(threadAttention(snoozed, pill("Pending Approval"), NOW)).toBeNull();
  });
});

const issue = (patch: Partial<TrackerIssue>): TrackerIssue => ({
  tracker: "linear",
  key: "PRO-1",
  title: "Issue",
  url: "https://linear.app/x/issue/PRO-1",
  state: { name: "In Progress", color: "#000", category: "started" },
  assignee: { name: "Me", avatarUrl: null },
  updatedAt: "2026-11-18T10:00:00.000Z",
  ...patch,
});
const state = (name: string, category: string) => ({ name, color: "#000", category });

describe("isIssueOnMyPlate", () => {
  it.each([
    ["Todo", "unstarted", true],
    ["In Progress", "started", true],
    ["Ready", "started", true],
    ["Ready for Prod", "started", true],
    ["Production Testing", "started", true],
    ["To Do", "new", true],
    ["Code Review", "started", false],
    ["Business Review", "started", false],
    ["Blocked", "started", false],
    ["On Hold", "indeterminate", false],
    ["Backlog", "backlog", false],
    ["Done", "completed", false],
    ["Done", "done", false],
  ])("%s (%s) → %s", (name, category, expected) => {
    expect(isIssueOnMyPlate({ state: state(name, category) })).toBe(expected);
  });
});

describe("sortMyIssues", () => {
  it("puts urgent due dates first, then started work, then recent updates", () => {
    const sorted = sortMyIssues(
      [
        issue({ key: "TODO-1", state: state("Todo", "unstarted") }),
        issue({ key: "OLD-1", updatedAt: "2026-11-01T10:00:00.000Z" }),
        issue({ key: "NEW-1", updatedAt: "2026-11-19T10:00:00.000Z" }),
        issue({ key: "DUE-1", state: state("Todo", "unstarted"), dueDate: "2026-11-20" }),
        issue({ key: "REV-1", state: state("Code Review", "started") }),
      ],
      new Date(NOW),
    );
    expect(sorted.map((entry) => entry.key)).toEqual(["DUE-1", "NEW-1", "OLD-1", "TODO-1"]);
  });
});

const pr = (patch: Partial<Parameters<typeof pullRequestAttention>[0]> & { url?: string }) => ({
  url: "https://github.com/o/r/pull/1",
  state: "open" as const,
  isDraft: false,
  mergeability: "mergeable" as const,
  checksState: "passing" as const,
  reviewDecision: "review-required" as const,
  viewerReviewRequested: false,
  ...patch,
});

describe("pullRequestAttention", () => {
  it.each([
    ["conflicts", pr({ mergeability: "conflicting" }), "Conflicts"],
    ["failing checks", pr({ checksState: "failing" }), "Checks failing"],
    ["changes requested", pr({ reviewDecision: "changes-requested" }), "Changes requested"],
    ["approved", pr({ reviewDecision: "approved" }), "Approved, ready to merge"],
    ["waiting for review", pr({}), null],
    ["pending checks", pr({ checksState: "pending" }), null],
    ["a draft", pr({ isDraft: true, checksState: "failing" }), null],
    ["merged", pr({ state: "merged", reviewDecision: "approved" }), null],
  ])("authored and %s", (_name, entry, expected) => {
    expect(pullRequestAttention(entry, "authored")?.label ?? null).toBe(expected);
  });

  it("asks for a review only while it is requested", () => {
    expect(pullRequestAttention(pr({ viewerReviewRequested: true }), "reviewing")?.label).toBe(
      "Review requested",
    );
    expect(pullRequestAttention(pr({}), "reviewing")).toBeNull();
  });
});

describe("pullRequestsNeedingYou", () => {
  it("keeps one row per pull request with its most urgent reason", () => {
    const failing = pr({ checksState: "failing", viewerReviewRequested: true });
    const rows = pullRequestsNeedingYou([failing], [failing]);
    expect(rows.map((row) => row.attention.label)).toEqual(["Checks failing"]);
  });
});
