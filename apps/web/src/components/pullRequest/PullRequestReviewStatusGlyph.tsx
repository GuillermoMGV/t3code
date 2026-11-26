import type { PullRequestListEntry } from "@t3tools/contracts";

import { PrPendingReviewBadge } from "../chat/PrPendingReviewBadge";
import { PullRequestReviewDecisionGlyph } from "./pullRequestPresentation";
import { pendingReviewers } from "./pullRequestReviewActions.logic";

// Fork-only: a review still owed outranks the review decision; see CUSTOM_DEVELOPMENT.md.

/**
 * GitHub keeps "changes requested" until that reviewer approves, even after the author pushed
 * and asked again, so a pending request is the newer fact and shows instead.
 */
export function PullRequestReviewStatusGlyph({
  entry,
}: {
  entry: Pick<PullRequestListEntry, "state" | "author" | "reviewRequestLogins" | "reviewDecision">;
}) {
  const pending = pendingReviewers(entry);
  if (pending.length > 0) {
    return (
      <PrPendingReviewBadge
        reviewers={pending.map((login) => ({ login, name: null, avatarUrl: null }))}
      />
    );
  }
  return entry.reviewDecision === undefined ? null : (
    <PullRequestReviewDecisionGlyph decision={entry.reviewDecision} />
  );
}
