import type { PullRequestActor, PullRequestState } from "@t3tools/contracts";

// Fork-only PR ordering and pending-review badge for the thread panel; see CUSTOM_DEVELOPMENT.md.

const BASE_BRANCH_RANK: Readonly<Record<string, number>> = { develop: 0, master: 1 };

function baseBranchRank(baseBranch: string | null | undefined): number {
  return BASE_BRANCH_RANK[baseBranch?.trim().toLowerCase() ?? ""] ?? 2;
}

/** Pull requests into `develop` first, then into `master`, then the rest; ties keep their order. */
export function orderPullRequestsByBaseBranch<T>(
  items: ReadonlyArray<T>,
  baseBranchOf: (item: T) => string | null | undefined,
): ReadonlyArray<T> {
  return items
    .map((item, index) => ({ item, index, rank: baseBranchRank(baseBranchOf(item)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Requested reviewers who have not reviewed yet. GitHub drops a request once its reviewer
 * submits a review, so the requests left on an open pull request are the reviews still owed.
 */
export function pendingReviewActors(
  detail: {
    readonly state: PullRequestState;
    readonly author: PullRequestActor | null;
    /** Optional: partial details (as in tests or older servers) may leave it out. */
    readonly reviewers?: ReadonlyArray<PullRequestActor>;
  } | null,
): ReadonlyArray<PullRequestActor> {
  if (detail === null || detail.state !== "open") return [];
  const author = detail.author?.login.toLowerCase();
  return (detail.reviewers ?? []).filter((reviewer) => reviewer.login.toLowerCase() !== author);
}
