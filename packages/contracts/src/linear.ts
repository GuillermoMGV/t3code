import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

// Fork-only Linear integration. Thread links live outside the orchestration model so
// upstream merges stay clean; see CUSTOM_DEVELOPMENT.md.

const LINEAR_ISSUE_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]*-[1-9]\d*$/;

export const LinearIssueIdentifier = TrimmedNonEmptyString.check(
  Schema.isPattern(LINEAR_ISSUE_IDENTIFIER_PATTERN),
);
export type LinearIssueIdentifier = typeof LinearIssueIdentifier.Type;

export const LinearIssueState = Schema.Struct({
  name: Schema.String,
  /** Hex color Linear shows for the state. */
  color: Schema.String,
  /** triage, backlog, unstarted, started, completed or canceled. */
  type: Schema.String,
});
export type LinearIssueState = typeof LinearIssueState.Type;

export const LinearIssueAssignee = Schema.Struct({
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});
export type LinearIssueAssignee = typeof LinearIssueAssignee.Type;

export const LinearIssue = Schema.Struct({
  identifier: LinearIssueIdentifier,
  title: Schema.String,
  url: Schema.String,
  state: Schema.NullOr(LinearIssueState),
  assignee: Schema.NullOr(LinearIssueAssignee),
  priorityLabel: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type LinearIssue = typeof LinearIssue.Type;

export const LinearThreadIssueInput = Schema.Struct({
  threadId: ThreadId,
  /** Issue identifiers found in the thread's messages, oldest first. */
  detectedIdentifiers: Schema.Array(LinearIssueIdentifier).check(Schema.isMaxLength(20)),
});
export type LinearThreadIssueInput = typeof LinearThreadIssueInput.Type;

export const LinearThreadLinkSource = Schema.Literals(["manual", "detected"]);
export type LinearThreadLinkSource = typeof LinearThreadLinkSource.Type;

export const LinearThreadIssueResult = Schema.Struct({
  connected: Schema.Boolean,
  link: Schema.NullOr(
    Schema.Struct({ identifier: LinearIssueIdentifier, source: LinearThreadLinkSource }),
  ),
  /** Null when nothing is linked, or the key cannot read the linked issue. */
  issue: Schema.NullOr(LinearIssue),
});
export type LinearThreadIssueResult = typeof LinearThreadIssueResult.Type;

export const LinearSearchIssuesInput = Schema.Struct({
  /** An issue URL, an identifier, or words from the title. Empty lists your open issues. */
  query: Schema.String.check(Schema.isMaxLength(500)),
});
export type LinearSearchIssuesInput = typeof LinearSearchIssuesInput.Type;

export const LinearSearchIssuesResult = Schema.Struct({
  issues: Schema.Array(LinearIssue),
});
export type LinearSearchIssuesResult = typeof LinearSearchIssuesResult.Type;

export const LinearMutation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("connect"), apiKey: TrimmedNonEmptyString }),
  Schema.Struct({ type: Schema.Literal("disconnect") }),
  Schema.Struct({
    type: Schema.Literal("link"),
    threadId: ThreadId,
    identifier: LinearIssueIdentifier,
  }),
  Schema.Struct({
    type: Schema.Literal("unlink"),
    threadId: ThreadId,
    /** Detected identifiers to stop showing for this thread. */
    dismissIdentifiers: Schema.Array(LinearIssueIdentifier).check(Schema.isMaxLength(20)),
  }),
]);
export type LinearMutation = typeof LinearMutation.Type;

export const LinearMutationResult = Schema.Struct({
  /** The Linear user the saved key belongs to, after connect. */
  viewerName: Schema.optional(Schema.String),
});
export type LinearMutationResult = typeof LinearMutationResult.Type;

export const LinearRequestErrorReason = Schema.Literals([
  "notConnected",
  "unauthorized",
  "network",
  "invalidResponse",
  "storage",
]);
export type LinearRequestErrorReason = typeof LinearRequestErrorReason.Type;

export class LinearRequestError extends Schema.TaggedError<LinearRequestError>()(
  "LinearRequestError",
  {
    reason: LinearRequestErrorReason,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/** Extracts `ABC-123` from a Linear issue URL or a bare identifier; null otherwise. */
export function parseLinearIssueReference(value: string): LinearIssueIdentifier | null {
  const trimmed = value.trim();
  const fromUrl =
    /^https?:\/\/linear\.app\/[^/\s]+\/issue\/([a-z][a-z0-9]*-[1-9]\d*)(?:[/?#]|$)/i.exec(trimmed);
  const candidate = (fromUrl?.[1] ?? trimmed).toUpperCase();
  return LINEAR_ISSUE_IDENTIFIER_PATTERN.test(candidate)
    ? (candidate as LinearIssueIdentifier)
    : null;
}

/** Identifiers of every Linear issue URL in the text, in order, without repeats. */
export function findLinearIssueIdentifiers(text: string): LinearIssueIdentifier[] {
  const found: LinearIssueIdentifier[] = [];
  for (const match of text.matchAll(
    /https?:\/\/linear\.app\/[^/\s]+\/issue\/([a-z][a-z0-9]*-[1-9]\d*)/gi,
  )) {
    const identifier = match[1]!.toUpperCase() as LinearIssueIdentifier;
    if (!found.includes(identifier)) found.push(identifier);
  }
  return found;
}
