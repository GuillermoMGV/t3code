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

/** A 15- or 18-character record ID; the pattern also keeps it safe as a CLI argument. */
export const SalesforceRecordId = Schema.String.check(
  Schema.isPattern(/^[0-9A-Za-z]{15}(?:[0-9A-Za-z]{3})?$/),
);

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
  /** Usernames of the orgs starred as favorites; shared by every workspace on this machine. */
  favorites: Schema.Array(Schema.String),
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
    /** Opens this record instead of the org's home page. */
    recordId: Schema.optional(SalesforceRecordId),
  }),
  Schema.Struct({
    type: Schema.Literal("logout"),
    cwd: TrimmedNonEmptyString,
    target: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("setFavorite"),
    cwd: TrimmedNonEmptyString,
    username: TrimmedNonEmptyString,
    favorite: Schema.Boolean,
  }),
]);
export type SalesforceMutation = typeof SalesforceMutation.Type;

export const SalesforceMutationResult = Schema.Struct({});

export class SalesforceError extends Schema.TaggedError<SalesforceError>()("SalesforceError", {
  reason: Schema.Literals(["cliMissing", "invalidInput", "command", "busy", "storage", "api"]),
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

// Fork-only Salesforce Export panel: SOQL queries, query plans, describes and deletes, run
// through the org's REST API with the CLI's session. See CUSTOM_DEVELOPMENT.md.

/** An sObject or Tooling API type name, such as `Account` or `Custom__c`. */
export const SalesforceSObjectName = Schema.String.check(Schema.isPattern(/^[A-Za-z]\w{0,79}$/));

/** The most IDs one delete call takes; the REST API's sObject Collections limit. */
export const SALESFORCE_DELETE_BATCH_SIZE = 200;

const SalesforceDataTarget = {
  cwd: TrimmedNonEmptyString,
  /** The org's username, so the request runs against the org the panel shows. */
  target: TrimmedNonEmptyString,
};

export const SalesforceDataRequest = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("query"),
    ...SalesforceDataTarget,
    soql: TrimmedNonEmptyString,
    /** Includes deleted and archived records (the `queryAll` endpoint). */
    queryAll: Schema.Boolean,
    tooling: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("queryMore"),
    ...SalesforceDataTarget,
    /** The `nextRecordsUrl` of the previous page. */
    nextRecordsUrl: Schema.String.check(
      Schema.isPattern(/^\/services\/data\/v\d+\.\d+\/(?:tooling\/)?query(?:All)?\/[\w-]+$/),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("explain"),
    ...SalesforceDataTarget,
    soql: TrimmedNonEmptyString,
    tooling: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("describe"),
    ...SalesforceDataTarget,
    sobject: SalesforceSObjectName,
    tooling: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("delete"),
    ...SalesforceDataTarget,
    ids: Schema.Array(SalesforceRecordId).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(SALESFORCE_DELETE_BATCH_SIZE),
    ),
  }),
]);
export type SalesforceDataRequest = typeof SalesforceDataRequest.Type;

export const SalesforceQueryPage = Schema.Struct({
  type: Schema.Literal("page"),
  totalSize: Schema.Number,
  done: Schema.Boolean,
  nextRecordsUrl: Schema.NullOr(Schema.String),
  /** Records as the API returns them, relationships nested. */
  records: Schema.Array(Schema.Unknown),
});
export type SalesforceQueryPage = typeof SalesforceQueryPage.Type;

export const SalesforceQueryPlan = Schema.Struct({
  leadingOperationType: Schema.String,
  sobjectType: Schema.NullOr(Schema.String),
  relativeCost: Schema.NullOr(Schema.Number),
  cardinality: Schema.NullOr(Schema.Number),
  sobjectCardinality: Schema.NullOr(Schema.Number),
  fields: Schema.Array(Schema.String),
  notes: Schema.Array(Schema.String),
});
export type SalesforceQueryPlan = typeof SalesforceQueryPlan.Type;

export const SalesforceFieldInfo = Schema.Struct({
  name: Schema.String,
  label: Schema.String,
  type: Schema.String,
  referenceTo: Schema.Array(Schema.String),
  relationshipName: Schema.NullOr(Schema.String),
  length: Schema.NullOr(Schema.Number),
  nillable: Schema.Boolean,
  custom: Schema.Boolean,
});
export type SalesforceFieldInfo = typeof SalesforceFieldInfo.Type;

export const SalesforceDataResult = Schema.Union([
  SalesforceQueryPage,
  Schema.Struct({ type: Schema.Literal("explain"), plans: Schema.Array(SalesforceQueryPlan) }),
  Schema.Struct({
    type: Schema.Literal("describe"),
    name: Schema.String,
    label: Schema.String,
    fields: Schema.Array(SalesforceFieldInfo),
  }),
  Schema.Struct({
    type: Schema.Literal("delete"),
    results: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        success: Schema.Boolean,
        error: Schema.NullOr(Schema.String),
      }),
    ),
  }),
]);
export type SalesforceDataResult = typeof SalesforceDataResult.Type;
