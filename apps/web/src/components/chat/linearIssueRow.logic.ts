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

export function assigneeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1 ? `${words[0]![0]}${words.at(-1)![0]}` : (words[0] ?? "?").slice(0, 2);
  return initials.toUpperCase();
}
