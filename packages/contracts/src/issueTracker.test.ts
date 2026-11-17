import { describe, expect, it } from "@effect/vitest";

import { findIssueReferences, parseIssueReference } from "./issueTracker.ts";

describe("parseIssueReference", () => {
  it.each([
    ["https://linear.app/acme/issue/PRO-1234/login-fails-with-sso", "linear", "PRO-1234"],
    ["https://linear.app/acme/issue/pro-7?comment=1", "linear", "PRO-7"],
    ["https://acme.atlassian.net/browse/OPS-42", "jira", "OPS-42"],
    [
      "https://acme.atlassian.net/jira/software/projects/OPS/boards/1?selectedIssue=OPS-9",
      "jira",
      "OPS-9",
    ],
    ["  ENG2-42  ", "linear", "ENG2-42"],
    ["my_proj-12", "jira", "MY_PROJ-12"],
  ] as const)("reads %s for %s as %s", (value, tracker, expected) => {
    expect(parseIssueReference(value, tracker)).toBe(expected);
  });

  it.each([
    ["login fails", "linear"],
    ["PRO-0", "linear"],
    ["1PRO-3", "jira"],
    ["https://linear.app/acme/project/roadmap-123", "linear"],
    // A URL of the other tracker is not a key for this one.
    ["https://acme.atlassian.net/browse/OPS-42", "linear"],
  ] as const)("rejects %s for %s", (value, tracker) => {
    expect(parseIssueReference(value, tracker)).toBeNull();
  });
});

describe("findIssueReferences", () => {
  it("finds Linear and Jira URLs in order, without repeats or bare keys", () => {
    expect(
      findIssueReferences(
        "Fix https://linear.app/acme/issue/PRO-2/title and https://acme.atlassian.net/browse/OPS-5, " +
          "see PRO-9, then https://linear.app/acme/issue/PRO-2 again",
      ),
    ).toEqual([
      { tracker: "linear", key: "PRO-2" },
      { tracker: "jira", key: "OPS-5" },
    ]);
  });
});
