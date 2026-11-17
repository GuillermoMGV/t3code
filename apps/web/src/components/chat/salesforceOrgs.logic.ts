import {
  matchesSalesforceTarget,
  type SalesforceOrg,
  type SalesforceOrgType,
  type SalesforceState,
} from "@t3tools/contracts";

export type SalesforceOrgHealth = "connected" | "error" | "unknown";

export function salesforceOrgHealth(
  org: Pick<SalesforceOrg, "connectedStatus">,
): SalesforceOrgHealth {
  if (org.connectedStatus === null) return "unknown";
  return org.connectedStatus === "Connected" ? "connected" : "error";
}

/** A short reason for a failed status; the CLI sometimes sends a whole paragraph. */
export function salesforceStatusLabel(org: Pick<SalesforceOrg, "connectedStatus">): string {
  const status = org.connectedStatus;
  if (status === null) return "Not checked";
  if (status === "Connected") return "Connected";
  const known: Record<string, string> = {
    RefreshTokenAuthError: "Session expired",
    JwtAuthError: "JWT auth failed",
    DomainNotFoundError: "Domain not found",
  };
  if (/^Unable to refresh session/i.test(status)) return "Session expired";
  return known[status] ?? (status.length > 60 ? `${status.slice(0, 57)}…` : status);
}

export const SALESFORCE_TYPE_LABELS: Readonly<Record<SalesforceOrgType, string>> = {
  production: "PROD",
  devhub: "Dev Hub",
  sandbox: "Sandbox",
  scratch: "Scratch",
};

/** Production and Dev Hub orgs hold real data, so targeting them needs a confirmation. */
export function isProductionOrg(org: Pick<SalesforceOrg, "type">): boolean {
  return org.type === "production" || org.type === "devhub";
}

export function salesforceOrgName(org: Pick<SalesforceOrg, "alias" | "username">): string {
  return org.alias ?? org.username;
}

/** The org the workspace targets, when it is one of the authenticated orgs. */
export function currentSalesforceOrg(state: SalesforceState): SalesforceOrg | null {
  const target = state.defaultOrg;
  if (target === null) return null;
  return state.orgs.find((org) => matchesSalesforceTarget(org, target)) ?? null;
}

/** Orgs whose alias, username or URL contain every word of the query. */
export function filterSalesforceOrgs(
  orgs: ReadonlyArray<SalesforceOrg>,
  query: string,
): SalesforceOrg[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...orgs];
  return orgs.filter((org) => {
    const text = `${org.alias ?? ""} ${org.username} ${org.instanceUrl ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Favorite orgs first, each group in the CLI's order. */
export function favoritesFirst(
  orgs: ReadonlyArray<SalesforceOrg>,
  favorites: ReadonlyArray<string>,
): SalesforceOrg[] {
  const starred = new Set(favorites);
  return [
    ...orgs.filter((org) => starred.has(org.username)),
    ...orgs.filter((org) => !starred.has(org.username)),
  ];
}

/** Why an alias cannot be used for a new org, or null when it can. */
export function salesforceAliasProblem(
  alias: string,
  orgs: ReadonlyArray<SalesforceOrg>,
): string | null {
  const trimmed = alias.trim();
  if (trimmed.length === 0) return "Enter an alias.";
  if (/["=]/.test(trimmed)) return "An alias cannot contain quotes or =.";
  return orgs.some((org) => org.alias?.toLowerCase() === trimmed.toLowerCase())
    ? "An org already uses this alias. Pick another, or re-authenticate that org."
    : null;
}
