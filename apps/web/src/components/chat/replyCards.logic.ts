import {
  findIssueReferences,
  IssueKey,
  type IssueTrackerKind,
  type TrackerIssue,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

// Fork-only cards under finished agent replies; see CUSTOM_DEVELOPMENT.md.

/** Card kinds a reply can show. A new kind adds a member here, a detector and a card. */
export type ReplyCardRef =
  | {
      readonly kind: "issue";
      readonly key: IssueKey;
      /** Known when the reply links the issue; null for a bare key, which any tracker may own. */
      readonly tracker: IssueTrackerKind | null;
    }
  | {
      readonly kind: "pullRequest";
      /** Lower-cased `owner/repo`; null for `PR #12`, which means the thread's repository. */
      readonly repository: string | null;
      readonly number: number;
      readonly url: string | null;
    };

export type ReplyCardKind = ReplyCardRef["kind"];

export interface ReplyCardSettings {
  readonly issues: boolean;
  readonly pullRequests: boolean;
}

const MAX_REPLY_CARDS = 4;
const MAX_THREAD_ISSUE_KEYS = 200;
const DETECTION_CACHE_SIZE = 300;

const isIssueKey = Schema.is(IssueKey);
// Code blocks hold commands and output, not things the reply is about.
const FENCED_CODE = /^ {0,3}(`{3,}|~{3,}).*$[\s\S]*?(?:^ {0,3}\1.*$|(?![\s\S]))/gm;
// Upper case and standing alone, as replies write keys: not `feat/pro-12`, `abcPRO-12` or `CVE-2024-1`.
const BARE_KEY = /(?<![A-Za-z0-9_/#.-])([A-Z][A-Z0-9_]{1,19}-[1-9]\d{0,6})(?![A-Za-z0-9_]|-\d)/g;
// Shaped like keys but never issues; they would only cost a lookup.
const NOT_ISSUE_PREFIXES = new Set([
  "AES",
  "ASCII",
  "CP",
  "CVE",
  "ECMA",
  "ES",
  "GPT",
  "HTTP",
  "IEEE",
  "IPV",
  "ISO",
  "MD",
  "PEP",
  "RFC",
  "RSA",
  "SHA",
  "SSL",
  "TLS",
  "UTF",
  "WCAG",
]);
const GITHUB_PULL_URL =
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9]\d{0,9})(?!\d)/gi;
// A bare `#12` may be an issue, a list item or a heading; only "PR #12" surely means a pull request.
const PULL_REQUEST_MENTION = /\b(?:PR|pull request)\s?#([1-9]\d{0,9})\b/gi;

interface Found {
  readonly ref: ReplyCardRef;
  readonly index: number;
}

function scanReplyCardRefs(text: string): ReplyCardRef[] {
  const prose = text.replace(FENCED_CODE, "");
  const found: Found[] = [];
  const issueAt = new Map<IssueKey, number>();
  const addIssue = (key: IssueKey, tracker: IssueTrackerKind | null, index: number) => {
    const known = issueAt.get(key);
    if (known === undefined) {
      issueAt.set(key, found.length);
      found.push({ ref: { kind: "issue", key, tracker }, index });
      return;
    }
    const previous = found[known]!;
    if (previous.ref.kind === "issue" && previous.ref.tracker === null && tracker !== null) {
      found[known] = { ref: { kind: "issue", key, tracker }, index: previous.index };
    }
  };

  const upper = prose.toUpperCase();
  for (const { tracker, key } of findIssueReferences(prose)) {
    addIssue(key, tracker, upper.indexOf(key));
  }
  for (const match of prose.matchAll(BARE_KEY)) {
    const key = match[1]!;
    if (NOT_ISSUE_PREFIXES.has(key.slice(0, key.indexOf("-"))) || !isIssueKey(key)) continue;
    addIssue(key, null, match.index);
  }

  const pullRequests = new Set<string>();
  const addPullRequest = (
    repository: string | null,
    number: number,
    url: string | null,
    index: number,
  ) => {
    const id = `${repository ?? ""}#${number}`;
    if (pullRequests.has(id)) return;
    pullRequests.add(id);
    found.push({ ref: { kind: "pullRequest", repository, number, url }, index });
  };
  for (const match of prose.matchAll(GITHUB_PULL_URL)) {
    addPullRequest(match[1]!.toLowerCase(), Number(match[2]), match[0], match.index);
  }
  for (const match of prose.matchAll(PULL_REQUEST_MENTION)) {
    addPullRequest(null, Number(match[1]), null, match.index);
  }

  return found.toSorted((left, right) => left.index - right.index).map(({ ref }) => ref);
}

const detectionCache = new Map<string, ReadonlyArray<ReplyCardRef>>();

/**
 * Issues and pull requests a finished reply mentions, in order and without repeats. Replies
 * do not change once finished, so each text is scanned once.
 */
export function detectReplyCardRefs(text: string): ReadonlyArray<ReplyCardRef> {
  const cached = detectionCache.get(text);
  if (cached !== undefined) return cached;
  const refs = scanReplyCardRefs(text);
  if (detectionCache.size >= DETECTION_CACHE_SIZE) {
    detectionCache.delete(detectionCache.keys().next().value!);
  }
  detectionCache.set(text, refs);
  return refs;
}

/** Applies the settings and points `PR #12` at the thread's repository, or drops it. */
export function resolveReplyCardRefs(
  refs: ReadonlyArray<ReplyCardRef>,
  input: { readonly settings: ReplyCardSettings; readonly threadRepository: string | null },
): ReplyCardRef[] {
  const resolved: ReplyCardRef[] = [];
  const pullRequests = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === "issue") {
      if (input.settings.issues) resolved.push(ref);
      continue;
    }
    if (!input.settings.pullRequests) continue;
    const repository = ref.repository ?? input.threadRepository?.toLowerCase() ?? null;
    if (repository === null) continue;
    const id = `${repository}#${ref.number}`;
    if (pullRequests.has(id)) continue;
    pullRequests.add(id);
    resolved.push({ ...ref, repository });
  }
  return resolved;
}

/**
 * The cards to draw, at most `max`, and how many more there are. An issue shows only once a
 * tracker knows it: a key-shaped word that is no issue, or a tracker that is offline or not
 * connected, leaves no card.
 */
export function selectReplyCards(
  refs: ReadonlyArray<ReplyCardRef>,
  findIssue: (key: IssueKey) => TrackerIssue | undefined,
  max = MAX_REPLY_CARDS,
): { readonly visible: ReadonlyArray<ReplyCardRef>; readonly hiddenCount: number } {
  const shown = refs.filter((ref) => ref.kind !== "issue" || findIssue(ref.key) !== undefined);
  return { visible: shown.slice(0, max), hiddenCount: Math.max(shown.length - max, 0) };
}

/** Every issue key the thread's finished replies mention, for a single lookup. */
export function threadReplyIssueKeys(
  items: ReadonlyArray<{
    readonly item: { readonly type: string; readonly text?: unknown; readonly streaming?: unknown };
  }>,
): IssueKey[] {
  const keys = new Set<IssueKey>();
  for (const { item } of items) {
    if (item.type !== "assistant_message" || item.streaming === true) continue;
    if (typeof item.text !== "string") continue;
    for (const ref of detectReplyCardRefs(item.text)) {
      if (ref.kind === "issue") keys.add(ref.key);
    }
  }
  return [...keys].toSorted().slice(0, MAX_THREAD_ISSUE_KEYS);
}

export function replyCardId(ref: ReplyCardRef): string {
  return ref.kind === "issue" ? `issue:${ref.key}` : `pr:${ref.repository ?? ""}#${ref.number}`;
}
