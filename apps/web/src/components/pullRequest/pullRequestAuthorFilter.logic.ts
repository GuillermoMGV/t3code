// Fork-only: several authors share the single `author` filter as comma-separated logins, so the
// URL, the saved preferences and the wire contract keep their shape; see CUSTOM_DEVELOPMENT.md.
import { resolvePullRequestAuthorFilter, type PullRequestListFilters } from "@t3tools/contracts";

/** The saved preference and the URL hold at most 200 characters. */
const MAX_AUTHOR_FILTER_LENGTH = 200;

export function pullRequestAuthorLogins(value: string | undefined): ReadonlyArray<string> {
  const seen = new Set<string>();
  const logins: string[] = [];
  for (const part of value?.split(",") ?? []) {
    const login = part.trim();
    const key = login.toLowerCase();
    if (login === "" || seen.has(key)) continue;
    seen.add(key);
    logins.push(login);
  }
  return logins;
}

/** Drops the authors that no longer fit rather than cutting a login in half. */
export function joinPullRequestAuthors(logins: ReadonlyArray<string>): string | undefined {
  let joined = "";
  for (const login of pullRequestAuthorLogins(logins.join(","))) {
    const next = joined === "" ? login : `${joined},${login}`;
    if (next.length > MAX_AUTHOR_FILTER_LENGTH) continue;
    joined = next;
  }
  return joined === "" ? undefined : joined;
}

export function matchesPullRequestAuthors(
  login: string | undefined,
  value: string | undefined,
  viewer?: string | null,
): boolean {
  const logins = pullRequestAuthorLogins(value);
  if (logins.length === 0) return true;
  const author = login?.toLowerCase();
  return logins.some(
    (candidate) => resolvePullRequestAuthorFilter(candidate, viewer).toLowerCase() === author,
  );
}

/** Hosts answer one author; with several, the host lists everyone and the page narrows. */
export function hostPullRequestFilters(filters: PullRequestListFilters): PullRequestListFilters {
  if (pullRequestAuthorLogins(filters.author).length <= 1) return filters;
  const { author: _author, ...rest } = filters;
  return rest;
}

export function pullRequestAuthorSummary(value: string | undefined): string {
  const logins = pullRequestAuthorLogins(value);
  return logins.length <= 1 ? (logins[0] ?? "Anyone") : `${logins.length} selected`;
}
