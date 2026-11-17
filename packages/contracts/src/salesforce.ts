import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

// Fork-only Salesforce org manager. The `sf` CLI owns all state; T3 Code only runs it.
// See CUSTOM_DEVELOPMENT.md.

export const SalesforceOrgType = Schema.Literals(["production", "sandbox", "scratch", "devhub"]);
export type SalesforceOrgType = typeof SalesforceOrgType.Type;

/** An authenticated org, with only the fields the UI needs. Never carries tokens. */
export const SalesforceOrg = Schema.Struct({
  alias: Schema.NullOr(Schema.String),
  username: Schema.String,
  orgId: Schema.NullOr(Schema.String),
  instanceUrl: Schema.NullOr(Schema.String),
  type: SalesforceOrgType,
  isDefault: Schema.Boolean,
  /** `Connected`, an error name such as `RefreshTokenAuthError`, or null before the check. */
  connectedStatus: Schema.NullOr(Schema.String),
  lastUsed: Schema.NullOr(Schema.String),
});
export type SalesforceOrg = typeof SalesforceOrg.Type;

export const SalesforceStateInput = Schema.Struct({
  /** The thread's working directory, where `sf` resolves the workspace's default org. */
  cwd: TrimmedNonEmptyString,
});
export type SalesforceStateInput = typeof SalesforceStateInput.Type;

export const SalesforceLoginState = Schema.Struct({
  alias: Schema.String,
  instanceUrl: Schema.String,
  startedAt: Schema.String,
});

export const SalesforceLoginResult = Schema.Struct({
  alias: Schema.String,
  ok: Schema.Boolean,
  message: Schema.String,
  finishedAt: Schema.String,
});

export const SalesforceState = Schema.Struct({
  /** Null until the CLI check finishes. */
  cli: Schema.NullOr(
    Schema.Struct({ installed: Schema.Boolean, version: Schema.NullOr(Schema.String) }),
  ),
  /** True when the folder has `sfdx-project.json`. */
  isDxProject: Schema.Boolean,
  /** The workspace's `target-org`, as configured: an alias or a username. */
  defaultOrg: Schema.NullOr(Schema.String),
  orgs: Schema.Array(SalesforceOrg),
  /** The org list has not loaded yet. */
  loading: Schema.Boolean,
  /** Connection statuses are being checked. */
  checkingStatus: Schema.Boolean,
  updatedAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  login: Schema.NullOr(SalesforceLoginState),
  lastLogin: Schema.NullOr(SalesforceLoginResult),
});
export type SalesforceState = typeof SalesforceState.Type;

export const SalesforceMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("refresh"),
    cwd: TrimmedNonEmptyString,
    checkStatus: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("setDefault"),
    cwd: TrimmedNonEmptyString,
    /** An alias or username of an authenticated org. */
    target: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("login"),
    cwd: TrimmedNonEmptyString,
    alias: TrimmedNonEmptyString,
    instanceUrl: TrimmedNonEmptyString,
    setDefault: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("cancelLogin"), cwd: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("open"),
    cwd: TrimmedNonEmptyString,
    target: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("logout"),
    cwd: TrimmedNonEmptyString,
    target: TrimmedNonEmptyString,
  }),
]);
export type SalesforceMutation = typeof SalesforceMutation.Type;

export const SalesforceMutationResult = Schema.Struct({});

export class SalesforceError extends Schema.TaggedError<SalesforceError>()("SalesforceError", {
  reason: Schema.Literals(["cliMissing", "invalidInput", "command", "busy"]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}

export const SALESFORCE_LOGIN_URLS = {
  production: "https://login.salesforce.com",
  sandbox: "https://test.salesforce.com",
} as const;

/** `https://` origins only, such as a My Domain URL; null otherwise. */
export function normalizeSalesforceLoginUrl(value: string): string | null {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  return url.protocol === "https:" && url.hostname.includes(".") ? url.origin : null;
}

/** The org a `target-org` value names: an alias or a username, compared without case. */
export function matchesSalesforceTarget(org: SalesforceOrg, target: string): boolean {
  const wanted = target.trim().toLowerCase();
  return org.username.toLowerCase() === wanted || org.alias?.toLowerCase() === wanted;
}
