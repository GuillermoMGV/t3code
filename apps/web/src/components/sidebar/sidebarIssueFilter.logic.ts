import type { TrackerIssue } from "@t3tools/contracts";

// Fork-only Linear and Jira thread list filter; see CUSTOM_DEVELOPMENT.md.

export const UNASSIGNED = "Unassigned";

/** Selected issue states and assignees; an empty list does not filter. */
export interface SidebarIssueFilter {
  readonly states: ReadonlyArray<string>;
  readonly assignees: ReadonlyArray<string>;
}

export const EMPTY_ISSUE_FILTER: SidebarIssueFilter = { states: [], assignees: [] };

export function issueFilterCount(filter: SidebarIssueFilter): number {
  return filter.states.length + filter.assignees.length;
}

function issueStateName(issue: TrackerIssue): string | null {
  return issue.state?.name ?? null;
}

function issueAssigneeName(issue: TrackerIssue): string {
  return issue.assignee?.name ?? UNASSIGNED;
}

/** States and assignees the shown issues have, plus any still selected, sorted by name. */
export function issueFilterOptions(
  issues: ReadonlyArray<TrackerIssue>,
  filter: SidebarIssueFilter,
): { states: string[]; assignees: string[] } {
  const states = new Set(filter.states);
  const assignees = new Set(filter.assignees);
  for (const issue of issues) {
    const state = issueStateName(issue);
    if (state !== null) states.add(state);
    assignees.add(issueAssigneeName(issue));
  }
  const byName = (left: string, right: string) => left.localeCompare(right);
  return { states: [...states].toSorted(byName), assignees: [...assignees].toSorted(byName) };
}

/** Whether a thread's issue passes the filter; threads without an issue pass only when unfiltered. */
export function matchesIssueFilter(
  issue: TrackerIssue | null,
  filter: SidebarIssueFilter,
): boolean {
  if (issueFilterCount(filter) === 0) return true;
  if (issue === null) return false;
  const state = issueStateName(issue);
  const stateMatches =
    filter.states.length === 0 || (state !== null && filter.states.includes(state));
  const assigneeMatches =
    filter.assignees.length === 0 || filter.assignees.includes(issueAssigneeName(issue));
  return stateMatches && assigneeMatches;
}

export function toggleFilterValue<Value extends string>(
  values: ReadonlyArray<Value>,
  value: Value,
): Value[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
