import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, IssueKey, TrackerIssue } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, useContext, type ReactNode } from "react";

import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { SidebarThreadIssueBadges } from "../sidebar/SidebarThreadIssueBadges";
import { Badge } from "../ui/badge";
import { pullRequestIssueKey } from "./pullRequestIssue.logic";

// Fork-only Linear and Jira badges on pull requests; see CUSTOM_DEVELOPMENT.md.

interface IssueEntry {
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly headBranch: string;
}

const issueIndexKey = (environmentId: EnvironmentId, key: IssueKey) =>
  `${environmentId}\u0000${key}`;

const PullRequestIssuesContext = createContext<ReadonlyMap<string, TrackerIssue>>(new Map());

type IssueRequest = ReadonlyArray<readonly [EnvironmentId, ReadonlyArray<IssueKey>]>;

// One derived atom per set of keys; a new atom per render would refetch every time.
const issueIndexAtoms = new Map<string, Atom.Atom<ReadonlyMap<string, TrackerIssue>>>();
function issueIndexAtom(request: IssueRequest) {
  const cacheKey = request
    .map(([environmentId, keys]) => `${environmentId}:${keys.join(",")}`)
    .join("|");
  let atom = issueIndexAtoms.get(cacheKey);
  if (atom === undefined) {
    // Loading more pull requests asks for a new key set; old sets are not needed again.
    if (issueIndexAtoms.size > 20) issueIndexAtoms.clear();
    atom = Atom.make((get) => {
      const index = new Map<string, TrackerIssue>();
      for (const [environmentId, keys] of request) {
        const result = get(issueTrackerEnvironment.issues({ environmentId, input: { keys } }));
        for (const issue of AsyncResult.getOrElse(result, () => null)?.issues ?? []) {
          index.set(issueIndexKey(environmentId, issue.key), issue);
        }
      }
      return index;
    });
    issueIndexAtoms.set(cacheKey, atom);
  }
  return atom;
}

/** Looks up, in one request per server, the issues the listed pull requests name. */
export function PullRequestIssuesProvider({
  groups,
  children,
}: {
  groups: ReadonlyArray<{ readonly entries: ReadonlyArray<IssueEntry> }>;
  children: ReactNode;
}) {
  const keysByEnvironment = new Map<EnvironmentId, Set<IssueKey>>();
  for (const group of groups) {
    for (const entry of group.entries) {
      const key = pullRequestIssueKey(entry);
      if (key === null) continue;
      const keys = keysByEnvironment.get(entry.environmentId) ?? new Set<IssueKey>();
      keys.add(key);
      keysByEnvironment.set(entry.environmentId, keys);
    }
  }
  const request: IssueRequest = [...keysByEnvironment]
    .map(([environmentId, keys]) => [environmentId, [...keys].toSorted().slice(0, 200)] as const)
    .toSorted(([left], [right]) => left.localeCompare(right));
  const index = useAtomValue(issueIndexAtom(request));
  return <PullRequestIssuesContext value={index}>{children}</PullRequestIssuesContext>;
}

/** The linked issue's key, state and assignee, when a connected tracker knows the key. */
export function PullRequestIssueBadges({ entry }: { entry: IssueEntry }) {
  const index = useContext(PullRequestIssuesContext);
  const key = pullRequestIssueKey(entry);
  const issue = key === null ? undefined : index.get(issueIndexKey(entry.environmentId, key));
  if (issue === undefined) return null;
  return (
    <span className="inline-flex min-w-0 shrink items-center gap-1">
      <Badge variant="outline" size="sm" className="shrink-0">
        {issue.key}
      </Badge>
      <SidebarThreadIssueBadges issue={issue} />
    </span>
  );
}
