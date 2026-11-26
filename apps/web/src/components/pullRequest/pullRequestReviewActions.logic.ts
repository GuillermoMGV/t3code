import type { PullRequestListEntry } from "@t3tools/contracts";

// Fork-only "Address review" and "Remind reviewer" row actions; see CUSTOM_DEVELOPMENT.md.

type ReviewEntry = Pick<
  PullRequestListEntry,
  "state" | "reviewDecision" | "reviewRequestLogins" | "author"
>;

/**
 * "Address review" applies to open pull requests a reviewer sent back, until the author asks for
 * review again: then the ball is in the reviewer's court even though GitHub keeps the decision.
 */
export function canAddressReview(entry: ReviewEntry): boolean {
  return (
    entry.state === "open" &&
    entry.reviewDecision === "changes-requested" &&
    pendingReviewers(entry).length === 0
  );
}

/**
 * Requested reviewers who have not reviewed yet, whatever the review decision: GitHub drops a
 * request once its reviewer submits a review, so the remaining requests are the reviews still
 * owed. The thread panel's pending-review badge uses the same rule. Teams (`org/team`) and the
 * author never count.
 */
export function pendingReviewers(
  entry: Pick<ReviewEntry, "state" | "reviewRequestLogins" | "author">,
): ReadonlyArray<string> {
  if (entry.state !== "open") return [];
  const author = entry.author?.login.toLowerCase();
  return (entry.reviewRequestLogins ?? []).filter(
    (login) => login.toLowerCase() !== author && !login.includes("/"),
  );
}

/** The turn sent to the agent; the URL lets the thread detect and link the pull request. */
export function addressReviewPrompt(entry: { readonly number: number; readonly url: string }) {
  return [
    `Pull request #${entry.number} got review comments requesting changes: ${entry.url}`,
    "",
    "Read every unresolved review comment on it (for example with `gh pr view --comments` and the review threads), apply the requested changes on this branch, run the relevant checks, then commit and push. Summarize what you changed for each comment, and say which ones you disagree with instead of applying them.",
  ].join("\n");
}

const REMINDER_TEMPLATES: ReadonlyArray<(name: string, url: string) => string> = [
  (name, url) => `Hey ${name}, can you have a quick look to approve this PR? Thaaanks 🙏\n${url}`,
  (name, url) => `Hi ${name}! Whenever you have a minute, could you review this one? ${url} 🙌`,
  (name, url) => `${name}, friendly nudge 😇 this PR is waiting for your review: ${url}`,
  (name, url) => `Hey ${name}, mind giving this PR a look when you get a chance? ${url} Thanks!!`,
  (name, url) => `Psst ${name} 👀 got 5 min for a quick review? ${url}`,
  (name, url) => `Hola ${name}! Could you take a look at this PR so I can merge it? ${url} 🙏`,
  (name, url) => `Hey ${name}, small one for you to review when you can: ${url} Thaanks!`,
];

/** What to call the reviewer: their first name, else their login. */
function reviewerGreetingName(login: string, name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : login;
}

/** A short reminder picked at random, never the same as `previous` so "shuffle" always changes it. */
export function reviewReminderMessage(
  input: { readonly login: string; readonly name: string | null | undefined; readonly url: string },
  random: () => number = Math.random,
  previous?: string,
): string {
  const name = reviewerGreetingName(input.login, input.name);
  const messages = REMINDER_TEMPLATES.map((template) => template(name, input.url));
  const choices = messages.filter((message) => message !== previous);
  return choices[Math.floor(random() * choices.length) % choices.length]!;
}

export interface ReviewThreadCandidate {
  readonly environmentId: string;
  readonly id: string;
  readonly projectId: string;
  readonly branch: string | null;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly updatedAt: string;
  readonly latestUserMessageAt: string | null;
  readonly pullRequests: ReadonlyArray<{
    readonly repository: string;
    readonly number: number;
    readonly source: string;
  }>;
  readonly linkedPullRequest?: { readonly repository: string; readonly number: number } | null;
  readonly branchPullRequest?: { readonly repository: string; readonly number: number } | null;
}

interface ReviewTarget {
  readonly environmentId: string;
  readonly projectId: string;
  readonly repository: string;
  readonly number: number;
  readonly headBranch: string;
  readonly baseBranch: string;
}

const samePullRequest = (
  target: ReviewTarget,
  link: { readonly repository: string; readonly number: number } | null | undefined,
) =>
  link != null &&
  link.number === target.number &&
  link.repository.toLowerCase() === target.repository.toLowerCase();

/**
 * The thread to send the review to: one linked to the pull request first, then one on its head
 * branch (same project first; one repository is often added as several projects), then one
 * linked to its issue. The most recently active wins a tie. A head branch equal to the base, as
 * in a fork's `main`, says nothing about the thread, so it never matches.
 */
export function pickReviewThread<Thread extends ReviewThreadCandidate>(
  target: ReviewTarget,
  threads: ReadonlyArray<Thread>,
  issueThreadIds: ReadonlySet<string>,
): Thread | null {
  const rank = (thread: Thread): number | null => {
    if (thread.environmentId !== target.environmentId) return null;
    if (thread.archivedAt !== null || thread.deletedAt !== null) return null;
    if (
      thread.pullRequests.some(
        (link) => link.source !== "stack-dismissed" && samePullRequest(target, link),
      ) ||
      samePullRequest(target, thread.linkedPullRequest) ||
      samePullRequest(target, thread.branchPullRequest)
    ) {
      return 0;
    }
    if (thread.branch === target.headBranch && target.headBranch !== target.baseBranch) {
      return thread.projectId === target.projectId ? 1 : 2;
    }
    if (issueThreadIds.has(thread.id)) return 3;
    return null;
  };
  const activity = (thread: Thread) => Date.parse(thread.latestUserMessageAt ?? thread.updatedAt);
  let best: { thread: Thread; rank: number } | null = null;
  for (const thread of threads) {
    const threadRank = rank(thread);
    if (threadRank === null) continue;
    if (
      best === null ||
      threadRank < best.rank ||
      (threadRank === best.rank && activity(thread) > activity(best.thread))
    ) {
      best = { thread, rank: threadRank };
    }
  }
  return best?.thread ?? null;
}
