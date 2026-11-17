import { describe, expect, it } from "@effect/vitest";

import { findLinearIssueIdentifiers, parseLinearIssueReference } from "./linear.ts";

describe("parseLinearIssueReference", () => {
  it.each([
    ["https://linear.app/acme/issue/PRO-1234/login-fails-with-sso", "PRO-1234"],
    ["https://linear.app/acme/issue/pro-7?comment=1", "PRO-7"],
    ["  ENG2-42  ", "ENG2-42"],
    ["pro-12", "PRO-12"],
  ])("reads %s as %s", (value, expected) => {
    expect(parseLinearIssueReference(value)).toBe(expected);
  });

  it.each([
    "login fails",
    "PRO-0",
    "1PRO-3",
    "https://linear.app/acme/project/roadmap-123",
    "https://example.com/acme/issue/PRO-1",
  ])("rejects %s", (value) => {
    expect(parseLinearIssueReference(value)).toBeNull();
  });
});

describe("findLinearIssueIdentifiers", () => {
  it("finds issue URLs in order, without repeats or bare identifiers", () => {
    expect(
      findLinearIssueIdentifiers(
        "Fix https://linear.app/acme/issue/PRO-2/title, see PRO-9 and " +
          "https://linear.app/acme/issue/eng-5 then https://linear.app/acme/issue/PRO-2 again",
      ),
    ).toEqual(["PRO-2", "ENG-5"]);
  });
});
