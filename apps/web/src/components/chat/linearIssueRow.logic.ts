import {
  findLinearIssueIdentifiers,
  type LinearIssue,
  type LinearIssueIdentifier,
  type LinearThreadIssueResult,
  type LinearThreadLinkSource,
} from "@t3tools/contracts";

const MAX_DETECTED_IDENTIFIERS = 20;

/** Issue identifiers in the thread's own messages, oldest first. */
export function collectThreadLinearIdentifiers(
  items: ReadonlyArray<{ readonly item: { readonly type: string; readonly text?: unknown } }>,
): LinearIssueIdentifier[] {
  const found: LinearIssueIdentifier[] = [];
  for (const { item } of items) {
    if (item.type !== "user_message" || typeof item.text !== "string") continue;
    for (const identifier of findLinearIssueIdentifiers(item.text)) {
      if (found.includes(identifier)) continue;
      found.push(identifier);
      if (found.length === MAX_DETECTED_IDENTIFIERS) return found;
    }
  }
  return found;
}

export type LinearIssueRowView =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "connect" }
  | { readonly kind: "connectToSee"; readonly identifier: LinearIssueIdentifier }
  | { readonly kind: "empty" }
  | {
      readonly kind: "missing";
      readonly identifier: LinearIssueIdentifier;
      readonly source: LinearThreadLinkSource;
    }
  | {
      readonly kind: "issue";
      readonly issue: LinearIssue;
      readonly source: LinearThreadLinkSource;
    };

export function resolveLinearIssueRowView(input: {
  readonly data: LinearThreadIssueResult | null;
  readonly error: string | null;
}): LinearIssueRowView {
  const { data, error } = input;
  if (data === null)
    return error === null ? { kind: "loading" } : { kind: "error", message: error };
  if (!data.connected) {
    return data.link === null
      ? { kind: "connect" }
      : { kind: "connectToSee", identifier: data.link.identifier };
  }
  if (data.link === null) return { kind: "empty" };
  return data.issue === null
    ? { kind: "missing", identifier: data.link.identifier, source: data.link.source }
    : { kind: "issue", issue: data.issue, source: data.link.source };
}

/** Waits for a pause in typing before searching Linear. */
export const LINEAR_SEARCH_DEBOUNCE_MS = 500;

/** The text to search for; one character is too broad, so it lists open issues instead. */
export function linearSearchQuery(draft: string): string {
  const trimmed = draft.trim();
  return trimmed.length < 2 ? "" : trimmed;
}

/** The chosen issue while it is still listed, otherwise the first result. */
export function resolveSelectedIssue(
  issues: ReadonlyArray<Pick<LinearIssue, "identifier">>,
  selected: LinearIssueIdentifier | null,
): LinearIssueIdentifier | null {
  if (selected !== null && issues.some((issue) => issue.identifier === selected)) return selected;
  return issues[0]?.identifier ?? null;
}

/** Moves the selection by `delta` rows, stopping at the first and last result. */
export function moveSelectedIssue(
  issues: ReadonlyArray<Pick<LinearIssue, "identifier">>,
  selected: LinearIssueIdentifier | null,
  delta: number,
): LinearIssueIdentifier | null {
  if (issues.length === 0) return null;
  const current = issues.findIndex((issue) => issue.identifier === selected);
  const next = Math.min(Math.max((current === -1 ? 0 : current) + delta, 0), issues.length - 1);
  return issues[next]!.identifier;
}

export function assigneeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1 ? `${words[0]![0]}${words.at(-1)![0]}` : (words[0] ?? "?").slice(0, 2);
  return initials.toUpperCase();
}
