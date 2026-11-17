import type { IssueTrackerConnection, IssueTrackerKind, TrackerIssue } from "@t3tools/contracts";

// Fork-only Issues page (start a thread from a Linear or Jira issue); see CUSTOM_DEVELOPMENT.md.

export const threadIssueKey = (environmentId: string, threadId: string) =>
  `${environmentId}\u0000${threadId}`;

const issueId = (issue: Pick<TrackerIssue, "tracker" | "key">) => `${issue.tracker}:${issue.key}`;

interface IssueThreadCandidate {
  readonly environmentId: string;
  readonly id: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

/**
 * The threads linked to each issue, most recently updated first. Links can outlive their thread
 * (a deleted thread, or a draft that was never sent), so only threads the client knows count;
 * archived ones are left out.
 */
export function threadsByIssue<Thread extends IssueThreadCandidate>(
  threadIssues: ReadonlyMap<string, ReadonlyArray<Pick<TrackerIssue, "tracker" | "key">>>,
  threads: ReadonlyArray<Thread>,
): ReadonlyMap<string, ReadonlyArray<Thread>> {
  const byIssue = new Map<string, Thread[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    for (const issue of threadIssues.get(threadIssueKey(thread.environmentId, thread.id)) ?? []) {
      const id = issueId(issue);
      byIssue.set(id, [...(byIssue.get(id) ?? []), thread]);
    }
  }
  for (const list of byIssue.values()) {
    list.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }
  return byIssue;
}

export function threadsForIssue<Thread>(
  byIssue: ReadonlyMap<string, ReadonlyArray<Thread>>,
  issue: Pick<TrackerIssue, "tracker" | "key">,
): ReadonlyArray<Thread> {
  return byIssue.get(issueId(issue)) ?? [];
}

/** The draft's first message. The URL lets the thread detect and link the issue. */
export function issueThreadPrompt(issue: Pick<TrackerIssue, "key" | "title" | "url">): string {
  return `Work on ${issue.key}: ${issue.title}\n\n${issue.url}`;
}

/** The tab to show: the requested tracker while connected, otherwise the first connected one. */
export function resolveIssuesTracker(
  connections: ReadonlyArray<Pick<IssueTrackerConnection, "tracker" | "connected">>,
  requested: IssueTrackerKind | undefined,
): IssueTrackerKind | null {
  const connected = connections.filter((connection) => connection.connected);
  if (connected.some((connection) => connection.tracker === requested)) return requested ?? null;
  return connected[0]?.tracker ?? null;
}
