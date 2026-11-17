import { useAtomValue } from "@effect/atom-react";
import {
  ISSUE_TRACKER_LABELS,
  type EnvironmentId,
  type IssueKey,
  type TrackerIssue,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { ArrowRightIcon, GitBranchIcon } from "lucide-react";
import {
  createContext,
  useContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { SidebarThreadIssueBadges } from "../sidebar/SidebarThreadIssueBadges";
import { Badge } from "../ui/badge";
import { MiddleTruncate } from "../ui/middle-truncate";
import { toastManager } from "../ui/toast";
import { pullRequestIssueKey } from "./pullRequestIssue.logic";
import { targetBranchKind } from "./pullRequestTargetBranch.logic";

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

/** The linked issue's key, state and assignee; a click opens the issue instead of the row. */
export function PullRequestIssueBadges({ entry }: { entry: IssueEntry }) {
  const index = useContext(PullRequestIssuesContext);
  const openLink = useOpenLink(null);
  const key = pullRequestIssueKey(entry);
  const issue = key === null ? undefined : index.get(issueIndexKey(entry.environmentId, key));
  if (issue === undefined) return null;
  const open = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const modifiers = { metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    openLink(issue.url, { event: modifiers }).catch(() =>
      toastManager.add({ type: "error", title: `Could not open ${issue.key}` }),
    );
  };
  return (
    // The row is a button, so this follows the checks popover: a focusable span, not a nested button.
    <span
      role="link"
      tabIndex={0}
      aria-label={`Open ${issue.key} in ${ISSUE_TRACKER_LABELS[issue.tracker]}`}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      }}
    >
      <Badge variant="outline" size="sm" className="shrink-0">
        {issue.key}
      </Badge>
      <SidebarThreadIssueBadges issue={issue} />
    </span>
  );
}

const TARGET_BRANCH_VARIANTS = {
  production: "warning",
  integration: "info",
  other: "secondary",
} as const;

/** `source → target`, with the target as a badge colored by kind: master/main, develop, other. */
export function PullRequestTargetBranches({ head, base }: { head: string; base: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="flex min-w-0 font-mono">
        <MiddleTruncate value={head} />
      </span>
      <ArrowRightIcon aria-hidden className="size-3 shrink-0" />
      <Badge
        variant={TARGET_BRANCH_VARIANTS[targetBranchKind(base)]}
        size="sm"
        className="shrink-0"
      >
        <GitBranchIcon aria-hidden />
        {base}
      </Badge>
    </span>
  );
}
