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
import { IssueFieldPicker, useShownIssue } from "../chat/IssueFieldPicker";
import { IssueAssigneeChip, IssueStateChip } from "../sidebar/SidebarThreadIssueBadges";
import { Badge } from "../ui/badge";
import { MiddleTruncate } from "../ui/middle-truncate";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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

/** The issue a listed pull request names, once the provider above has fetched it. */
export function usePullRequestIssue(entry: IssueEntry): TrackerIssue | undefined {
  const index = useContext(PullRequestIssuesContext);
  const key = pullRequestIssueKey(entry);
  return key === null ? undefined : index.get(issueIndexKey(entry.environmentId, key));
}

/**
 * The linked issue's key, state and assignee. A click on the key opens the issue; the state and
 * assignee open pickers that change them in the tracker. None of them opens the row.
 */
export function PullRequestIssueBadges({ entry }: { entry: IssueEntry }) {
  const listed = usePullRequestIssue(entry);
  if (listed === undefined) return null;
  return <IssueBadges environmentId={entry.environmentId} listed={listed} />;
}

function IssueBadges({
  environmentId,
  listed,
}: {
  environmentId: EnvironmentId;
  listed: TrackerIssue;
}) {
  const openLink = useOpenLink(null);
  const issue = useShownIssue(environmentId, listed);
  const label = ISSUE_TRACKER_LABELS[issue.tracker];
  const open = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const modifiers = { metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    openLink(issue.url, { event: modifiers }).catch(() =>
      toastManager.add({ type: "error", title: `Could not open ${issue.key}` }),
    );
  };
  return (
    <span className="inline-flex min-w-0 shrink-0 items-center gap-1">
      <Tooltip>
        {/* The row is a button, so this follows the checks popover: a focusable span, not a nested button. */}
        <TooltipTrigger
          render={
            <span
              role="link"
              tabIndex={0}
              aria-label={`Open ${issue.key} in ${label}`}
              className="inline-flex shrink-0 cursor-pointer rounded-md hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={open}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") open(event);
              }}
            />
          }
        >
          <Badge variant="outline" size="sm" className="shrink-0">
            {issue.key}
          </Badge>
        </TooltipTrigger>
        <TooltipPopup side="top" className="max-w-72">
          {`Open ${label} ${issue.key}: ${issue.title}`}
        </TooltipPopup>
      </Tooltip>
      {issue.state ? (
        <IssueFieldPicker environmentId={environmentId} issue={issue} field="state" nested>
          <IssueStateChip state={issue.state} />
        </IssueFieldPicker>
      ) : null}
      <IssueFieldPicker environmentId={environmentId} issue={issue} field="assignee" nested>
        <IssueAssigneeChip assignee={issue.assignee} />
      </IssueFieldPicker>
    </span>
  );
}

/** The issue badges on their own row line, or nothing when the pull request names no issue. */
export function PullRequestIssueLine({ entry }: { entry: IssueEntry }) {
  if (usePullRequestIssue(entry) === undefined) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden pt-0.5 text-2xs text-muted-foreground">
      <PullRequestIssueBadges entry={entry} />
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
