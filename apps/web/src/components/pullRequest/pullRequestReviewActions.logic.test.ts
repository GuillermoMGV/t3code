import { describe, expect, it } from "vite-plus/test";

import {
  canAddressReview,
  pendingReviewers,
  pickReviewThread,
  reviewReminderMessage,
  type ReviewThreadCandidate,
} from "./pullRequestReviewActions.logic";

const author = { login: "me", name: null, avatarUrl: null };

describe("row action visibility", () => {
  it.each([
    ["open, changes requested", "open", "changes-requested", true],
    ["open, approved", "open", "approved", false],
    ["merged, changes requested", "merged", "changes-requested", false],
  ] as const)("Address review on %s: %s", (_label, state, reviewDecision, expected) => {
    expect(canAddressReview({ state, reviewDecision })).toBe(expected);
  });

  it("lists requested reviewers who have not reviewed, never the author", () => {
    const entry = {
      state: "open",
      author,
      reviewDecision: "review-required",
      reviewRequestLogins: ["ada", "ME"],
    } as const;
    expect(pendingReviewers(entry)).toEqual(["ada"]);
    expect(pendingReviewers({ ...entry, reviewDecision: "approved" })).toEqual([]);
    expect(pendingReviewers({ ...entry, state: "closed" })).toEqual([]);
    expect(pendingReviewers({ ...entry, reviewRequestLogins: undefined })).toEqual([]);
  });
});

describe("reviewReminderMessage", () => {
  const input = { login: "ada", name: "Ada Lovelace", url: "https://github.com/o/r/pull/1" };

  it("greets the reviewer by first name with the link", () => {
    const message = reviewReminderMessage(input, () => 0);
    expect(message).toContain("Ada");
    expect(message).not.toContain("Lovelace");
    expect(message).toContain(input.url);
  });

  it("falls back to the login and never repeats the previous message", () => {
    expect(reviewReminderMessage({ ...input, name: null }, () => 0)).toContain("ada");
    const first = reviewReminderMessage(input, () => 0);
    expect(reviewReminderMessage(input, () => 0, first)).not.toBe(first);
  });
});

describe("pickReviewThread", () => {
  const target = {
    environmentId: "env",
    projectId: "project",
    repository: "Acme/App",
    number: 7,
    headBranch: "feature/pro-12",
    baseBranch: "main",
  };
  const thread = (
    id: string,
    fields: Partial<ReviewThreadCandidate> = {},
  ): ReviewThreadCandidate => ({
    environmentId: "env",
    id,
    projectId: "project",
    branch: null,
    archivedAt: null,
    deletedAt: null,
    updatedAt: "2026-11-01T00:00:00.000Z",
    latestUserMessageAt: null,
    pullRequests: [],
    ...fields,
  });

  it("prefers a pull request link, then the head branch, then the issue", () => {
    const linked = thread("linked", {
      pullRequests: [{ repository: "acme/app", number: 7, source: "created" }],
    });
    const onBranch = thread("branch", {
      branch: "feature/pro-12",
      latestUserMessageAt: "2026-11-10T00:00:00.000Z",
    });
    const byIssue = thread("issue", { updatedAt: "2026-11-12T00:00:00.000Z" });
    const issueIds = new Set(["issue"]);
    expect(pickReviewThread(target, [byIssue, onBranch, linked], issueIds)?.id).toBe("linked");
    expect(pickReviewThread(target, [byIssue, onBranch], issueIds)?.id).toBe("branch");
    expect(pickReviewThread(target, [byIssue], issueIds)?.id).toBe("issue");
  });

  it("matches the head branch in another project of the repository, but never the base", () => {
    const elsewhere = thread("elsewhere", { branch: "feature/pro-12", projectId: "clone" });
    const sameProject = thread("same", { branch: "feature/pro-12" });
    expect(pickReviewThread(target, [elsewhere], new Set())?.id).toBe("elsewhere");
    expect(pickReviewThread(target, [elsewhere, sameProject], new Set())?.id).toBe("same");
    const fromMain = { ...target, headBranch: "main" };
    expect(pickReviewThread(fromMain, [thread("main", { branch: "main" })], new Set())).toBeNull();
  });

  it("picks the most recently active of equal matches and skips archived or foreign ones", () => {
    const older = thread("older", { branch: "feature/pro-12" });
    const newer = thread("newer", {
      branch: "feature/pro-12",
      latestUserMessageAt: "2026-11-05T00:00:00.000Z",
    });
    const archived = thread("archived", {
      branch: "feature/pro-12",
      archivedAt: "2026-11-06T00:00:00.000Z",
      latestUserMessageAt: "2026-11-09T00:00:00.000Z",
    });
    const otherEnvironment = thread("other", {
      branch: "feature/pro-12",
      environmentId: "remote",
      latestUserMessageAt: "2026-11-09T00:00:00.000Z",
    });
    expect(
      pickReviewThread(target, [older, newer, archived, otherEnvironment], new Set())?.id,
    ).toBe("newer");
    expect(pickReviewThread(target, [archived, otherEnvironment], new Set())).toBeNull();
  });
});
