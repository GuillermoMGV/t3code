import {
  IssueSearchFilter,
  type IssueTrackerConnection,
  type IssueTrackerKind,
  type TrackerIssue,
} from "@t3tools/contracts";

// Fork-only Issues page (start a thread from a Linear or Jira issue); see CUSTOM_DEVELOPMENT.md.

export const threadIssueKey = (environmentId: string, threadId: string) =>
  `${environmentId}\u0000${threadId}`;

const issueId = (issue: Pick<TrackerIssue, "tracker" | "key">) => `${issue.tracker}:${issue.key}`;

interface IssueThreadCandidate {
  readonly environmentId: string;
  readonly id: string;
  readonly title: string;
  readonly branch: string | null;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

// A key standing alone, any case: `feat/pro-12-login`, `PRO-12: …`, but not `PRO-123` for PRO-12.
const KEY_IN_TEXT = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9_]{0,19}-[1-9]\d{0,6})(?![A-Za-z0-9])/g;

/** Every issue-key-shaped token in the text, upper-cased. */
export function issueKeysIn(text: string): ReadonlyArray<string> {
  return [...text.matchAll(KEY_IN_TEXT)].map((match) => match[1]!.toUpperCase());
}

// Stored links know their tracker; a key in a branch or title could belong to either.
const mentionId = (key: string) => `key:${key.toUpperCase()}`;

/**
 * The threads that belong to each issue: those linked to it (a manual link, or a detection the
 * server remembered) and those whose branch or title names its key. Links can outlive their
 * thread (a deleted thread, or a draft never sent), so only threads the client knows count, and
 * archived ones are left out. Reads only thread shells, never messages.
 */
export function threadsByIssue<Thread extends IssueThreadCandidate>(
  threadIssues: ReadonlyMap<string, ReadonlyArray<Pick<TrackerIssue, "tracker" | "key">>>,
  threads: ReadonlyArray<Thread>,
): ReadonlyMap<string, ReadonlyArray<Thread>> {
  const byIssue = new Map<string, Thread[]>();
  const add = (id: string, thread: Thread) => {
    const list = byIssue.get(id) ?? [];
    if (!list.includes(thread)) byIssue.set(id, [...list, thread]);
  };
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    for (const issue of threadIssues.get(threadIssueKey(thread.environmentId, thread.id)) ?? []) {
      add(issueId(issue), thread);
    }
    for (const key of issueKeysIn(`${thread.branch ?? ""} ${thread.title}`)) {
      add(mentionId(key), thread);
    }
  }
  return byIssue;
}

/** The issue's threads, most recently updated first. */
export function threadsForIssue<Thread extends Pick<IssueThreadCandidate, "updatedAt">>(
  byIssue: ReadonlyMap<string, ReadonlyArray<Thread>>,
  issue: Pick<TrackerIssue, "tracker" | "key">,
): ReadonlyArray<Thread> {
  const linked = byIssue.get(issueId(issue)) ?? [];
  const named = byIssue.get(mentionId(issue.key)) ?? [];
  if (named.length === 0) return sortByRecency(linked);
  return sortByRecency([...new Set([...linked, ...named])]);
}

const sortByRecency = <Thread extends Pick<IssueThreadCandidate, "updatedAt">>(
  threads: ReadonlyArray<Thread>,
) =>
  threads.length < 2
    ? threads
    : [...threads].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

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

export type IssueAssigneeGroup = IssueListFilter["assignees"][number];

export const ISSUE_ASSIGNEE_GROUPS: ReadonlyArray<{
  readonly value: IssueAssigneeGroup;
  readonly label: string;
}> = [
  { value: "me", label: "Assigned to me" },
  { value: "others", label: "Assigned to others" },
  { value: "unassigned", label: "Unassigned" },
];

export const IssueListFilter = IssueSearchFilter;
export type IssueListFilter = IssueSearchFilter;

export const EMPTY_ISSUE_LIST_FILTER: IssueListFilter = { states: [], assignees: [], projects: [] };

/** The project each tracker opens on until the user picks another (names as the tracker has them). */
const DEFAULT_ISSUE_PROJECTS: Readonly<Record<IssueTrackerKind, ReadonlyArray<string>>> = {
  linear: ["Salesforce"],
  jira: ["Proyecto Salesforce"],
};

export const defaultIssueListFilter = (tracker: IssueTrackerKind): IssueListFilter => ({
  ...EMPTY_ISSUE_LIST_FILTER,
  projects: DEFAULT_ISSUE_PROJECTS[tracker],
});

/** One remembered filter per tracker, so Linear and Jira states never mix. */
export const issueListFilterStorageKey = (tracker: IssueTrackerKind) =>
  `t3code:issues-filter:${tracker}:v2`;

const issueListFilterCount = (filter: IssueListFilter) =>
  filter.states.length + filter.assignees.length + filter.projects.length;

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

/**
 * The tracker filters the list; this repeats it for a pasted key, which bypasses the filter.
 * Several values of one kind add up; different kinds narrow each other.
 */
export function filterIssues<Issue extends Pick<TrackerIssue, "state" | "assignee" | "project">>(
  issues: ReadonlyArray<Issue>,
  filter: IssueListFilter,
  me: string | null,
): ReadonlyArray<Issue> {
  if (issueListFilterCount(filter) === 0) return issues;
  return issues.filter(
    (issue) =>
      (filter.states.length === 0 ||
        (issue.state !== null && filter.states.includes(issue.state.name))) &&
      (filter.assignees.length === 0 || filter.assignees.includes(issueAssigneeGroup(issue, me))) &&
      (filter.projects.length === 0 ||
        (issue.project != null && filter.projects.includes(issue.project.name))),
  );
}

/**
 * The tracker's states, then any in the results it did not list (all of them while its list
 * loads), then chosen ones neither has.
 */
export function issueStateOptions(
  known: ReadonlyArray<string>,
  issues: ReadonlyArray<Pick<TrackerIssue, "state">>,
  filter: IssueListFilter,
): ReadonlyArray<string> {
  const states = issues.flatMap((issue) => (issue.state === null ? [] : [issue.state.name]));
  return [...new Set([...known, ...states, ...filter.states])];
}

/** The tracker's projects, then any in the results it did not list, then chosen ones. */
export function issueProjectOptions(
  known: ReadonlyArray<string>,
  issues: ReadonlyArray<Pick<TrackerIssue, "project">>,
  filter: IssueListFilter,
): ReadonlyArray<string> {
  const projects = issues.flatMap((issue) => (issue.project == null ? [] : [issue.project.name]));
  return [...new Set([...known, ...projects, ...filter.projects])];
}

/** The project menu's search: case-insensitive, anywhere in the name. */
export function matchingIssueProjects(
  projects: ReadonlyArray<string>,
  query: string,
): ReadonlyArray<string> {
  const needle = query.trim().toLowerCase();
  return needle === "" ? projects : projects.filter((name) => name.toLowerCase().includes(needle));
}

const MAX_PULL_REQUESTS_PER_ISSUE = 3;

/**
 * Pull requests by the issue key their title or source branch names, open ones first, then the
 * most recently updated; a few per issue keep the row to one line.
 */
export function pullRequestsByIssueKey<
  Entry extends { readonly state: string; readonly updatedAt: string },
>(
  entries: ReadonlyArray<Entry>,
  keyOf: (entry: Entry) => string | null,
): ReadonlyMap<string, ReadonlyArray<Entry>> {
  const byKey = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (key !== null) byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }
  for (const [key, list] of byKey) {
    list.sort(
      (left, right) =>
        Number(right.state === "open") - Number(left.state === "open") ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
    byKey.set(key, list.slice(0, MAX_PULL_REQUESTS_PER_ISSUE));
  }
  return byKey;
}
