import {
  findIssueReferences,
  type IssueKey,
  type IssueRef,
  type IssueTrackerKind,
  type IssueTrackerLinkSource,
  type IssueTrackerThreadResult,
  type TrackerIssue,
} from "@t3tools/contracts";

const MAX_DETECTED_REFERENCES = 20;

/** Linear and Jira issues referenced in the thread's own messages, oldest first. */
export function collectThreadIssueReferences(
  items: ReadonlyArray<{ readonly item: { readonly type: string; readonly text?: unknown } }>,
): IssueRef[] {
  const found: IssueRef[] = [];
  for (const { item } of items) {
    if (item.type !== "user_message" || typeof item.text !== "string") continue;
    for (const ref of findIssueReferences(item.text)) {
      if (found.some((known) => known.tracker === ref.tracker && known.key === ref.key)) continue;
      found.push(ref);
      if (found.length === MAX_DETECTED_REFERENCES) return found;
    }
  }
  return found;
}

export type IssueTrackerRowView =
  | { readonly kind: "error"; readonly tracker: IssueTrackerKind; readonly message: string }
  | { readonly kind: "connectToSee"; readonly tracker: IssueTrackerKind; readonly key: IssueKey }
  | { readonly kind: "empty"; readonly tracker: IssueTrackerKind }
  | {
      readonly kind: "missing";
      readonly tracker: IssueTrackerKind;
      readonly key: IssueKey;
      readonly source: IssueTrackerLinkSource;
    }
  | {
      readonly kind: "issue";
      readonly tracker: IssueTrackerKind;
      readonly issue: TrackerIssue;
      readonly source: IssueTrackerLinkSource;
    };

export type IssueTrackerPanelView =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  /** Nothing connected and nothing referenced: point to Settings. */
  | { readonly kind: "setup" }
  | { readonly kind: "rows"; readonly rows: ReadonlyArray<IssueTrackerRowView> };

/**
 * One row per tracker that is connected or referenced in the thread. A tracker that is
 * neither stays out of the panel, so connecting only Linear shows no Jira row.
 */
export function resolveIssueTrackerPanelView(input: {
  readonly data: IssueTrackerThreadResult | null;
  readonly error: string | null;
}): IssueTrackerPanelView {
  const { data, error } = input;
  if (data === null)
    return error === null ? { kind: "loading" } : { kind: "error", message: error };
  const rows = data.rows.flatMap((row): IssueTrackerRowView[] => {
    const { tracker, link } = row;
    if (row.error !== null) return [{ kind: "error", tracker, message: row.error }];
    if (!row.connected)
      return link === null ? [] : [{ kind: "connectToSee", tracker, key: link.key }];
    if (link === null) return [{ kind: "empty", tracker }];
    return row.issue === null
      ? [{ kind: "missing", tracker, key: link.key, source: link.source }]
      : [{ kind: "issue", tracker, issue: row.issue, source: link.source }];
  });
  return rows.length === 0 ? { kind: "setup" } : { kind: "rows", rows };
}

/** Waits for a pause in typing before searching. */
export const ISSUE_SEARCH_DEBOUNCE_MS = 500;

/** The text to search for; one character is too broad, so it lists open issues instead. */
export function issueSearchQuery(draft: string): string {
  const trimmed = draft.trim();
  return trimmed.length < 2 ? "" : trimmed;
}

/** The chosen issue while it is still listed, otherwise the first result. */
export function resolveSelectedIssue(
  issues: ReadonlyArray<Pick<TrackerIssue, "key">>,
  selected: IssueKey | null,
): IssueKey | null {
  if (selected !== null && issues.some((issue) => issue.key === selected)) return selected;
  return issues[0]?.key ?? null;
}

/** Moves the selection by `delta` rows, stopping at the first and last result. */
export function moveSelectedIssue(
  issues: ReadonlyArray<Pick<TrackerIssue, "key">>,
  selected: IssueKey | null,
  delta: number,
): IssueKey | null {
  if (issues.length === 0) return null;
  const current = issues.findIndex((issue) => issue.key === selected);
  const next = Math.min(Math.max((current === -1 ? 0 : current) + delta, 0), issues.length - 1);
  return issues[next]!.key;
}

export function assigneeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1 ? `${words[0]![0]}${words.at(-1)![0]}` : (words[0] ?? "?").slice(0, 2);
  return initials.toUpperCase();
}
