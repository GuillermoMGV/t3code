import { describe, expect, it } from "@effect/vitest";
import type { SalesforceOrg } from "@t3tools/contracts";

import { keepKnownStatuses, markDefaultOrg, nextFavorites } from "./SalesforceService.ts";
import { describeSfFailure, parseOrgList, parseSfJson, parseSfVersion } from "./sfCli.ts";

const sandbox = {
  accessToken: "00D-secret-token",
  clientId: "PlatformCLI",
  alias: "Properti QA2",
  username: "guillermo@properti.ch.qa2",
  orgId: "00D000000000002",
  instanceUrl: "https://propertiag--qa2.sandbox.my.salesforce.com",
  isSandbox: true,
  isScratch: false,
  isDevHub: false,
  isDefaultUsername: true,
  lastUsed: "2026-11-17T09:00:00.000Z",
};

describe("parseOrgList", () => {
  it("dedupes orgs listed twice and keeps only safe fields", () => {
    const orgs = parseOrgList({
      nonScratchOrgs: [sandbox, { username: "prod@properti.ch", alias: "PROPERTI PROD" }],
      sandboxes: [{ ...sandbox, connectedStatus: "Connected" }],
      devHubs: [{ username: "hub@properti.ch", isDevHub: true }],
      scratchOrgs: [{ username: "test-x@example.com", isScratch: true }],
      other: "not a list",
    });
    expect(orgs.map((org) => [org.username, org.type])).toEqual([
      ["hub@properti.ch", "devhub"],
      ["prod@properti.ch", "production"],
      ["guillermo@properti.ch.qa2", "sandbox"],
      ["test-x@example.com", "scratch"],
    ]);
    const qa2 = orgs.find((org) => org.alias === "Properti QA2");
    expect(qa2).toEqual({
      alias: "Properti QA2",
      username: "guillermo@properti.ch.qa2",
      orgId: "00D000000000002",
      instanceUrl: "https://propertiag--qa2.sandbox.my.salesforce.com",
      type: "sandbox",
      isDefault: true,
      connectedStatus: "Connected",
      lastUsed: "2026-11-17T09:00:00.000Z",
    });
    expect(JSON.stringify(orgs)).not.toContain("secret-token");
    expect(JSON.stringify(orgs)).not.toContain("clientId");
  });

  it("skips entries without a username", () => {
    expect(parseOrgList({ nonScratchOrgs: [{ alias: "broken" }] })).toEqual([]);
    expect(parseOrgList(null)).toEqual([]);
  });
});

describe("parseSfJson", () => {
  it("reads the envelope after a warning line", () => {
    expect(
      parseSfJson(
        ' »   Warning: update available\n{"status":1,"name":"NoOrgFound","message":"No org"}',
      ),
    ).toEqual({ status: 1, name: "NoOrgFound", message: "No org" });
  });

  it("returns null without JSON", () => {
    expect(parseSfJson("'sf' is not recognized as an internal command")).toBeNull();
  });
});

it("reads the CLI version", () => {
  expect(parseSfVersion("@salesforce/cli/2.151.7 win32-x64 node-v24.20.0")).toBe("2.151.7");
  expect(parseSfVersion("")).toBeNull();
});

it("explains a busy login callback port", () => {
  expect(
    describeSfFailure(
      { status: 1, message: "listen EADDRINUSE: address already in use :::1717" },
      "x",
    ),
  ).toMatch(/Port 1717 is busy/);
  expect(describeSfFailure(null, "fallback")).toBe("fallback");
});

const org = (overrides: Partial<SalesforceOrg>): SalesforceOrg => ({
  alias: null,
  username: "user@example.com",
  orgId: null,
  instanceUrl: null,
  type: "sandbox",
  isDefault: false,
  connectedStatus: null,
  lastUsed: null,
  ...overrides,
});

describe("markDefaultOrg", () => {
  it("matches the target by alias or username, without case", () => {
    const orgs = [
      org({ alias: "Properti DEV", username: "dev@properti.ch" }),
      org({ alias: "Properti QA2", username: "qa2@properti.ch", isDefault: true }),
    ];
    expect(markDefaultOrg(orgs, "properti dev").map((item) => item.isDefault)).toEqual([
      true,
      false,
    ]);
    expect(markDefaultOrg(orgs, "qa2@properti.ch").map((item) => item.isDefault)).toEqual([
      false,
      true,
    ]);
    expect(markDefaultOrg(orgs, null).map((item) => item.isDefault)).toEqual([false, false]);
  });
});

it("keeps statuses from the last full check for orgs a quick list returns", () => {
  expect(
    keepKnownStatuses(
      [
        org({ username: "a" }),
        org({ username: "b" }),
        org({ username: "c", connectedStatus: "x" }),
      ],
      [
        org({ username: "a", connectedStatus: "Connected" }),
        org({ username: "c", connectedStatus: "y" }),
      ],
    ).map((item) => item.connectedStatus),
  ).toEqual(["Connected", null, "x"]);
});

it("stars and unstars orgs without duplicates", () => {
  expect(nextFavorites(["a", "b"], "b", true)).toEqual(["a", "b"]);
  expect(nextFavorites(["a"], "c", true)).toEqual(["a", "c"]);
  expect(nextFavorites(["a", "b"], "a", false)).toEqual(["b"]);
});
