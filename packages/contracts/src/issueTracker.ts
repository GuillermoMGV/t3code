import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

// Fork-only Linear and Jira integration. Thread links live outside the orchestration model so
// upstream merges stay clean; see CUSTOM_DEVELOPMENT.md.

export const IssueTrackerKind = Schema.Literals(["linear", "jira"]);
export type IssueTrackerKind = typeof IssueTrackerKind.Type;

export const ISSUE_TRACKER_LABELS: Readonly<Record<IssueTrackerKind, string>> = {
  linear: "Linear",
  jira: "Jira",
};

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;

/** `ABC-123`: a Linear identifier or a Jira issue key. */
export const IssueKey = TrimmedNonEmptyString.check(Schema.isPattern(ISSUE_KEY_PATTERN));
export type IssueKey = typeof IssueKey.Type;

export const IssueRef = Schema.Struct({ tracker: IssueTrackerKind, key: IssueKey });
export type IssueRef = typeof IssueRef.Type;

export const TrackerIssueState = Schema.Struct({
  name: Schema.String,
  /** CSS color the tracker uses for the state. */
  color: Schema.String,
  /** The tracker's own grouping, such as Linear's `started` or Jira's `indeterminate`. */
  category: Schema.String,
});
export type TrackerIssueState = typeof TrackerIssueState.Type;

export const TrackerIssueAssignee = Schema.Struct({
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});
export type TrackerIssueAssignee = typeof TrackerIssueAssignee.Type;

export const TrackerIssueProject = Schema.Struct({
  name: Schema.String,
  url: Schema.NullOr(Schema.String),
});
export type TrackerIssueProject = typeof TrackerIssueProject.Type;

export const TrackerIssue = Schema.Struct({
  tracker: IssueTrackerKind,
  key: IssueKey,
  title: Schema.String,
  url: Schema.String,
  state: Schema.NullOr(TrackerIssueState),
  assignee: Schema.NullOr(TrackerIssueAssignee),
  /** Calendar day (`YYYY-MM-DD`). Optional: issues cached before it existed lack it. */
  dueDate: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.String,
  /** The Linear or Jira project. Optional: issues cached or stored before it existed lack it. */
  project: Schema.optional(Schema.NullOr(TrackerIssueProject)),
});
export type TrackerIssue = typeof TrackerIssue.Type;

export const IssueTrackerThreadInput = Schema.Struct({
  threadId: ThreadId,
  /** Issues referenced in the thread's messages, oldest first. */
  detected: Schema.Array(IssueRef).check(Schema.isMaxLength(20)),
});
export type IssueTrackerThreadInput = typeof IssueTrackerThreadInput.Type;

export const IssueTrackerLinkSource = Schema.Literals(["manual", "detected"]);
export type IssueTrackerLinkSource = typeof IssueTrackerLinkSource.Type;

export const IssueTrackerThreadRow = Schema.Struct({
  tracker: IssueTrackerKind,
  connected: Schema.Boolean,
  link: Schema.NullOr(Schema.Struct({ key: IssueKey, source: IssueTrackerLinkSource })),
  /** Null when nothing is linked, or the credentials cannot read the linked issue. */
  issue: Schema.NullOr(TrackerIssue),
  /** Why the tracker could not be read; the other tracker's row still loads. */
  error: Schema.NullOr(Schema.String),
});
export type IssueTrackerThreadRow = typeof IssueTrackerThreadRow.Type;

export const IssueTrackerThreadResult = Schema.Struct({
  rows: Schema.Array(IssueTrackerThreadRow),
});
export type IssueTrackerThreadResult = typeof IssueTrackerThreadResult.Type;

export const IssueTrackerSummariesInput = Schema.Struct({});
export const IssueTrackerThreadSummary = Schema.Struct({
  threadId: ThreadId,
  /** Linked issues the saved credentials can read, Linear first. */
  issues: Schema.Array(TrackerIssue),
});
export type IssueTrackerThreadSummary = typeof IssueTrackerThreadSummary.Type;
export const IssueTrackerSummariesResult = Schema.Struct({
  threads: Schema.Array(IssueTrackerThreadSummary),
});
export type IssueTrackerSummariesResult = typeof IssueTrackerSummariesResult.Type;

/** Issue keys found outside threads, such as in pull request titles and branches. */
export const IssueTrackerIssuesInput = Schema.Struct({
  keys: Schema.Array(IssueKey).check(Schema.isMaxLength(200)),
});
export type IssueTrackerIssuesInput = typeof IssueTrackerIssuesInput.Type;
/** The keys a connected tracker knows; unknown keys are left out. Linear wins a shared key. */
export const IssueTrackerIssuesResult = Schema.Struct({ issues: Schema.Array(TrackerIssue) });
export type IssueTrackerIssuesResult = typeof IssueTrackerIssuesResult.Type;

/** Several values of one kind add up; different kinds narrow each other. Empty lists match all. */
export const IssueSearchFilter = Schema.Struct({
  /** State names, which Linear repeats per team and Jira shares across projects. */
  states: Schema.Array(Schema.String).check(Schema.isMaxLength(50)),
  assignees: Schema.Array(Schema.Literals(["me", "others", "unassigned"])),
  /** Project names. */
  projects: Schema.Array(Schema.String).check(Schema.isMaxLength(50)),
});
export type IssueSearchFilter = typeof IssueSearchFilter.Type;

export const IssueTrackerSearchInput = Schema.Struct({
  tracker: IssueTrackerKind,
  /** An issue URL, a key, or words from the title. Empty lists issues by `scope`. */
  query: Schema.String.check(Schema.isMaxLength(500)),
  /** What an empty query lists: your open issues (default), or recently updated ones. */
  scope: Schema.optional(Schema.Literals(["mine", "recent"])),
  /** Applied by the tracker to recent issues and title searches, so the limit counts matches. */
  filter: Schema.optional(IssueSearchFilter),
});
export type IssueTrackerSearchInput = typeof IssueTrackerSearchInput.Type;

export const IssueTrackerSearchResult = Schema.Struct({ issues: Schema.Array(TrackerIssue) });
export type IssueTrackerSearchResult = typeof IssueTrackerSearchResult.Type;

export const IssueTrackerFilterOptionsInput = Schema.Struct({ tracker: IssueTrackerKind });
/** What the tracker can filter by, in its own order. */
export const IssueTrackerFilterOptionsResult = Schema.Struct({
  states: Schema.Array(Schema.String),
  projects: Schema.Array(Schema.String),
});
export type IssueTrackerFilterOptionsResult = typeof IssueTrackerFilterOptionsResult.Type;

export const IssueTrackerEditOptionsInput = IssueRef;
/** What one issue can be changed to; ids are what `setIssueState` and `setIssueAssignee` take. */
export const IssueTrackerEditOptionsResult = Schema.Struct({
  /** Linear: the issue team's workflow states. Jira: the statuses its transitions lead to. */
  states: Schema.Array(Schema.Struct({ id: Schema.String, ...TrackerIssueState.fields })),
  /** Linear: the team's members. Jira: the users assignable to the issue. */
  assignees: Schema.Array(Schema.Struct({ id: Schema.String, ...TrackerIssueAssignee.fields })),
});
export type IssueTrackerEditOptionsResult = typeof IssueTrackerEditOptionsResult.Type;

export const IssueTrackerConnection = Schema.Struct({
  tracker: IssueTrackerKind,
  connected: Schema.Boolean,
  /** The account the saved credentials belong to. */
  account: Schema.NullOr(Schema.String),
  /** The Jira site; null for Linear. */
  site: Schema.NullOr(Schema.String),
  /** Why the saved credentials could not be checked just now. */
  error: Schema.NullOr(Schema.String),
});
export type IssueTrackerConnection = typeof IssueTrackerConnection.Type;

export const IssueTrackerConnectionsInput = Schema.Struct({});
export const IssueTrackerConnectionsResult = Schema.Struct({
  trackers: Schema.Array(IssueTrackerConnection),
});
export type IssueTrackerConnectionsResult = typeof IssueTrackerConnectionsResult.Type;

export const IssueTrackerMutation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("connectLinear"), apiKey: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("connectJira"),
    /** `https://example.atlassian.net`, `example.atlassian.net`, or `example`. */
    siteUrl: TrimmedNonEmptyString,
    email: TrimmedNonEmptyString,
    apiToken: TrimmedNonEmptyString,
  }),
  Schema.Struct({ type: Schema.Literal("disconnect"), tracker: IssueTrackerKind }),
  Schema.Struct({
    type: Schema.Literal("link"),
    threadId: ThreadId,
    tracker: IssueTrackerKind,
    key: IssueKey,
  }),
  Schema.Struct({
    type: Schema.Literal("unlink"),
    threadId: ThreadId,
    tracker: IssueTrackerKind,
    /** Detected keys to stop showing for this thread. */
    dismissKeys: Schema.Array(IssueKey).check(Schema.isMaxLength(20)),
  }),
  /** Drops the cached issues, so the next thread list read asks the trackers again. */
  Schema.Struct({ type: Schema.Literal("refreshIssues") }),
  /** A Linear workflow state id, or a Jira transition id. */
  Schema.Struct({
    type: Schema.Literal("setIssueState"),
    tracker: IssueTrackerKind,
    key: IssueKey,
    stateId: TrimmedNonEmptyString,
  }),
  /** A Linear user id or a Jira account id; null unassigns. */
  Schema.Struct({
    type: Schema.Literal("setIssueAssignee"),
    tracker: IssueTrackerKind,
    key: IssueKey,
    assigneeId: Schema.NullOr(TrimmedNonEmptyString),
  }),
]);
export type IssueTrackerMutation = typeof IssueTrackerMutation.Type;

export const IssueTrackerMutationResult = Schema.Struct({
  /** The account the new credentials belong to, after connecting. */
  account: Schema.optional(Schema.String),
  /** The issue as the tracker reads it after a state or assignee change. */
  issue: Schema.optional(TrackerIssue),
});
export type IssueTrackerMutationResult = typeof IssueTrackerMutationResult.Type;

export class IssueTrackerError extends Schema.TaggedError<IssueTrackerError>()(
  "IssueTrackerError",
  {
    tracker: IssueTrackerKind,
    reason: Schema.Literals([
      "notConnected",
      "unauthorized",
      "invalidInput",
      "network",
      "invalidResponse",
      "storage",
    ]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const LINEAR_URL = /https?:\/\/linear\.app\/[^/\s]+\/issue\/([a-z][a-z0-9_]*-[1-9]\d*)/gi;
// Jira Cloud issue pages and board views that open an issue in a side panel.
const JIRA_URL =
  /https?:\/\/[a-z0-9-]+\.atlassian\.net\/(?:browse\/([a-z][a-z0-9_]*-[1-9]\d*)|[^\s]*?[?&]selectedIssue=([a-z][a-z0-9_]*-[1-9]\d*))/gi;

const asKey = (value: string): IssueKey | null => {
  const key = value.trim().toUpperCase();
  return ISSUE_KEY_PATTERN.test(key) ? (key as IssueKey) : null;
};

/** Every Linear or Jira issue URL in the text, in order, without repeats. Bare keys are ignored. */
export function findIssueReferences(text: string): IssueRef[] {
  const found: Array<IssueRef & { index: number }> = [];
  const add = (tracker: IssueTrackerKind, raw: string | undefined, index: number) => {
    const key = raw === undefined ? null : asKey(raw);
    if (key === null) return;
    if (found.some((ref) => ref.tracker === tracker && ref.key === key)) return;
    found.push({ tracker, key, index });
  };
  for (const match of text.matchAll(LINEAR_URL)) add("linear", match[1], match.index);
  for (const match of text.matchAll(JIRA_URL)) add("jira", match[1] ?? match[2], match.index);
  return [...found].sort((a, b) => a.index - b.index).map(({ tracker, key }) => ({ tracker, key }));
}

/** The key in a URL of that tracker, or a bare key; null otherwise. */
export function parseIssueReference(value: string, tracker: IssueTrackerKind): IssueKey | null {
  const [fromUrl] = findIssueReferences(value.trim()).filter((ref) => ref.tracker === tracker);
  return fromUrl?.key ?? asKey(value);
}
