import type { SalesforceOrg, SalesforceState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  currentSalesforceOrg,
  favoritesFirst,
  filterSalesforceOrgs,
  isProductionOrg,
  salesforceAliasProblem,
  salesforceOrgHealth,
  salesforceStatusLabel,
} from "./salesforceOrgs.logic";

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

const qa2 = org({
  alias: "Properti QA2",
  username: "guillermo@properti.ch.qa2",
  instanceUrl: "https://propertiag--qa2.sandbox.my.salesforce.com",
});
const prod = org({ alias: "PROPERTI PROD", username: "guillermo@properti.ch", type: "production" });

describe("org status", () => {
  it.each([
    [null, "unknown", "Not checked"],
    ["Connected", "connected", "Connected"],
    ["RefreshTokenAuthError", "error", "Session expired"],
    ["DomainNotFoundError", "error", "Domain not found"],
    [
      "Unable to refresh session due to: Error authenticating with the refresh token",
      "error",
      "Session expired",
    ],
  ] as const)("reads %s", (connectedStatus, health, label) => {
    expect(salesforceOrgHealth({ connectedStatus })).toBe(health);
    expect(salesforceStatusLabel({ connectedStatus })).toBe(label);
  });

  it("shortens long CLI messages", () => {
    expect(salesforceStatusLabel({ connectedStatus: "x".repeat(100) })).toHaveLength(58);
  });
});

it("treats production and Dev Hub orgs as production", () => {
  expect(
    [prod, qa2, org({ type: "devhub" }), org({ type: "scratch" })].map(isProductionOrg),
  ).toEqual([true, false, true, false]);
});

it("finds the workspace's current org by alias or username", () => {
  const state = { defaultOrg: "properti qa2", orgs: [prod, qa2] } as unknown as SalesforceState;
  expect(currentSalesforceOrg(state)).toBe(qa2);
  expect(currentSalesforceOrg({ ...state, defaultOrg: "missing" })).toBeNull();
  expect(currentSalesforceOrg({ ...state, defaultOrg: null })).toBeNull();
});

it("filters orgs by every word of the query", () => {
  expect(filterSalesforceOrgs([prod, qa2], "properti qa2")).toEqual([qa2]);
  expect(filterSalesforceOrgs([prod, qa2], "sandbox.my")).toEqual([qa2]);
  expect(filterSalesforceOrgs([prod, qa2], "  ")).toEqual([prod, qa2]);
});

it("lists favorite orgs first and keeps the CLI order within each group", () => {
  const dev = org({ alias: "Properti DEV", username: "dev@properti.ch" });
  expect(favoritesFirst([prod, qa2, dev], [dev.username, qa2.username])).toEqual([qa2, dev, prod]);
  expect(favoritesFirst([prod, qa2], ["gone@example.com"])).toEqual([prod, qa2]);
});

describe("salesforceAliasProblem", () => {
  it.each([
    ["", "Enter an alias."],
    ['bad"alias', "An alias cannot contain quotes or =."],
    ["properti qa2", "An org already uses this alias. Pick another, or re-authenticate that org."],
    ["Properti DEV2", null],
  ])("checks %j", (alias, problem) => {
    expect(salesforceAliasProblem(alias, [qa2])).toBe(problem);
  });
});
