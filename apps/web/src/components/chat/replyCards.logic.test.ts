import type { IssueKey, TrackerIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  detectReplyCardRefs,
  resolveReplyCardRefs,
  selectReplyCards,
  threadReplyIssueKeys,
  type ReplyCardRef,
} from "./replyCards.logic";

const key = (value: string) => value as IssueKey;
const issueRef = (value: string, tracker: "linear" | "jira" | null = null): ReplyCardRef => ({
  kind: "issue",
  key: key(value),
  tracker,
});
const trackerIssue = (value: string): TrackerIssue => ({
  tracker: "linear",
  key: key(value),
  title: value,
  url: `https://linear.app/acme/issue/${value}`,
  state: null,
  assignee: null,
  priorityLabel: null,
  updatedAt: "2026-11-17T00:00:00.000Z",
});
const ALL = { issues: true, pullRequests: true };

describe("detectReplyCardRefs", () => {
  it("finds issue URLs, bare keys and pull requests in the order the reply names them", () => {
    const text = [
      "Fixed in https://github.com/Acme/Web/pull/42 for PRO-7.",
      "See https://linear.app/acme/issue/PRO-12/title and https://acme.atlassian.net/browse/OPS-3.",
      "Follow-up: PR #43.",
    ].join("\n");
    expect(detectReplyCardRefs(text)).toEqual([
      {
        kind: "pullRequest",
        repository: "acme/web",
        number: 42,
        url: "https://github.com/Acme/Web/pull/42",
      },
      issueRef("PRO-7"),
      issueRef("PRO-12", "linear"),
      issueRef("OPS-3", "jira"),
      { kind: "pullRequest", repository: null, number: 43, url: null },
    ]);
  });

  it("names each issue and pull request once, keeping the tracker a link gives", () => {
    const text =
      "PRO-12 is done (https://linear.app/acme/issue/PRO-12/x). PRO-12 again. " +
      "https://github.com/acme/web/pull/42 and https://github.com/acme/web/pull/42/files";
    expect(detectReplyCardRefs(text)).toEqual([
      issueRef("PRO-12", "linear"),
      {
        kind: "pullRequest",
        repository: "acme/web",
        number: 42,
        url: "https://github.com/acme/web/pull/42",
      },
    ]);
  });

  it("ignores code blocks, lower-case keys, branch paths and key-shaped standards", () => {
    const text = [
      "```sh",
      "git switch feat/PRO-99 # PRO-98",
      "```",
      "Encoding UTF-8, hash SHA-256, CVE-2024-1234, feat/PRO-5, pro-6, abcPRO-7, #12.",
    ].join("\n");
    expect(detectReplyCardRefs(text)).toEqual([]);
  });

  it("keeps keys written as inline code", () => {
    expect(detectReplyCardRefs("Closes `PRO-21`.")).toEqual([issueRef("PRO-21")]);
  });
});

describe("resolveReplyCardRefs", () => {
  const refs: ReplyCardRef[] = [
    issueRef("PRO-1"),
    { kind: "pullRequest", repository: null, number: 42, url: null },
    { kind: "pullRequest", repository: "acme/web", number: 42, url: "https://x" },
  ];

  it("points PR #n at the thread's repository and drops the repeat", () => {
    expect(resolveReplyCardRefs(refs, { settings: ALL, threadRepository: "Acme/Web" })).toEqual([
      issueRef("PRO-1"),
      { kind: "pullRequest", repository: "acme/web", number: 42, url: null },
    ]);
  });

  it("drops PR #n when the thread has no repository", () => {
    expect(resolveReplyCardRefs(refs, { settings: ALL, threadRepository: null })).toEqual([
      issueRef("PRO-1"),
      refs[2],
    ]);
  });

  it("leaves out the kinds turned off in Settings", () => {
    expect(
      resolveReplyCardRefs(refs, {
        settings: { issues: false, pullRequests: true },
        threadRepository: null,
      }),
    ).toEqual([refs[2]]);
    expect(
      resolveReplyCardRefs(refs, {
        settings: { issues: true, pullRequests: false },
        threadRepository: "acme/web",
      }),
    ).toEqual([issueRef("PRO-1")]);
  });
});

describe("selectReplyCards", () => {
  it("shows an issue only once a tracker knows it", () => {
    const refs = [issueRef("UTC-1"), issueRef("PRO-1"), issueRef("PRO-2", "jira")];
    const findIssue = (value: IssueKey) => (value === "PRO-1" ? trackerIssue(value) : undefined);
    expect(selectReplyCards(refs, findIssue)).toEqual({
      visible: [issueRef("PRO-1")],
      hiddenCount: 0,
    });
  });

  it("caps the cards, counting only those that will show", () => {
    const pullRequest = (number: number): ReplyCardRef => ({
      kind: "pullRequest",
      repository: "acme/web",
      number,
      url: null,
    });
    const refs = [issueRef("NOPE-1"), ...[1, 2, 3, 4, 5, 6].map(pullRequest)];
    expect(selectReplyCards(refs, () => undefined)).toEqual({
      visible: [1, 2, 3, 4].map(pullRequest),
      hiddenCount: 2,
    });
    expect(selectReplyCards(refs, () => undefined, Number.POSITIVE_INFINITY).hiddenCount).toBe(0);
  });
});

describe("threadReplyIssueKeys", () => {
  it("collects keys from finished replies only, sorted, for one lookup", () => {
    const items = [
      { item: { type: "user_message", text: "USER-1" } },
      { item: { type: "assistant_message", text: "PRO-2 and PRO-1", streaming: false } },
      { item: { type: "assistant_message", text: "LIVE-1", streaming: true } },
      { item: { type: "assistant_message", text: "PRO-1 again", streaming: false } },
    ];
    expect(threadReplyIssueKeys(items)).toEqual(["PRO-1", "PRO-2"]);
  });
});
