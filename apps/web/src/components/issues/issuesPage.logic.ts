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

export type IssueAssigneeGroup = "me" | "others" | "unassigned";

export const ISSUE_ASSIGNEE_GROUPS: ReadonlyArray<{
  readonly value: IssueAssigneeGroup;
  readonly label: string;
}> = [
  { value: "me", label: "Assigned to me" },
  { value: "others", label: "Assigned to others" },
  { value: "unassigned", label: "Unassigned" },
];

export interface IssueListFilter {
  readonly states: ReadonlyArray<string>;
  readonly assignees: ReadonlyArray<IssueAssigneeGroup>;
}

export const EMPTY_ISSUE_LIST_FILTER: IssueListFilter = { states: [], assignees: [] };

const sameName = (left: string, right: string) =>
  left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

/**
 * Trackers send the assignee's display name only, so "me" is the connected account's name, which
 * Linear (`viewer.name`) and Jira (`myself.displayName`) report in the same form.
 */
export function issueAssigneeGroup(
  issue: Pick<TrackerIssue, "assignee">,
  me: string | null,
): IssueAssigneeGroup {
  if (issue.assignee === null) return "unassigned";
  return me !== null && sameName(issue.assignee.name, me) ? "me" : "others";
}

/** Several values of one kind add up; the two kinds narrow each other. */
export function filterIssues<Issue extends Pick<TrackerIssue, "state" | "assignee">>(
  issues: ReadonlyArray<Issue>,
  filter: IssueListFilter,
  me: string | null,
): ReadonlyArray<Issue> {
  if (filter.states.length === 0 && filter.assignees.length === 0) return issues;
  return issues.filter(
    (issue) =>
      (filter.states.length === 0 ||
        (issue.state !== null && filter.states.includes(issue.state.name))) &&
      (filter.assignees.length === 0 || filter.assignees.includes(issueAssigneeGroup(issue, me))),
  );
}

/** The states in the results, in order of appearance, plus chosen ones a new search left out. */
export function issueStateOptions(
  issues: ReadonlyArray<Pick<TrackerIssue, "state">>,
  filter: IssueListFilter,
): ReadonlyArray<string> {
  const states = issues.flatMap((issue) => (issue.state === null ? [] : [issue.state.name]));
  return [...new Set([...states, ...filter.states])];
}
