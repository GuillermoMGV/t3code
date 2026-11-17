import { describe, expect, it } from "vite-plus/test";

import { pullRequestIssueKey } from "./pullRequestIssue.logic";

describe("pullRequestIssueKey", () => {
  it.each([
    ["fix(PRO-2238): show Active on the layout", "main", "PRO-2238"],
    ["PRO-3853 pipeline test 2/2", "main", "PRO-3853"],
    ["Daily nurturing job", "feat/pro-2239-daily-email", "PRO-2239"],
    ["Daily nurturing job", "fix/PRO-3853-destructive-only-master", "PRO-3853"],
    ["fix(PRO-1): title wins", "feat/OPS-7-branch", "PRO-1"],
    ["fix(web): send button arrow", "fix/send-button-arrow-hover", null],
    ["lowercase pro-12 in a title is prose", "main", null],
    ["Bump abcPRO-12", "main", null],
  ])("reads %j / %j", (title, headBranch, key) => {
    expect(pullRequestIssueKey({ title, headBranch })).toBe(key);
  });
});
