import { RegistryContext, useAtom, useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, TrackerIssue } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { RefreshCwIcon, TicketIcon } from "lucide-react";
import { useContext, useState } from "react";

import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarMenuButton } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import {
  EMPTY_ISSUE_FILTER,
  issueFilterCount,
  issueFilterOptions,
  matchesIssueFilter,
  type SidebarIssueFilter,
  toggleFilterValue,
} from "./sidebarIssueFilter.logic";

// Fork-only Linear and Jira thread list filter and refresh; see CUSTOM_DEVELOPMENT.md.

const issueFilterAtom = Atom.make<SidebarIssueFilter>(EMPTY_ISSUE_FILTER).pipe(
  // The filter outlives the sidebar remounting when the window resizes.
  Atom.keepAlive,
  Atom.withLabel("sidebar:issue-filter"),
);

const threadIssueKey = (environmentId: EnvironmentId, threadId: string) =>
  `${environmentId}\u0000${threadId}`;

// One derived atom per set of environments; a new atom per render would refetch.
const issuesByThreadAtoms = new Map<string, Atom.Atom<ReadonlyMap<string, TrackerIssue>>>();
function issuesByThreadAtom(environmentIds: ReadonlyArray<EnvironmentId>) {
  const key = environmentIds.join("\u0000");
  let atom = issuesByThreadAtoms.get(key);
  if (atom === undefined) {
    atom = Atom.make((get) => {
      const issues = new Map<string, TrackerIssue>();
      for (const environmentId of environmentIds) {
        const result = get(issueTrackerEnvironment.threadSummaries({ environmentId, input: {} }));
        for (const summary of AsyncResult.getOrElse(result, () => null)?.threads ?? []) {
          const issue = summary.issues[0];
          if (issue !== undefined)
            issues.set(threadIssueKey(environmentId, summary.threadId), issue);
        }
      }
      return issues;
    });
    issuesByThreadAtoms.set(key, atom);
  }
  return atom;
}

/** The threads that pass the issue filter; the same array while no filter is set. */
export function useIssueFilteredThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<EnvironmentThreadShell> {
  const filter = useAtomValue(issueFilterAtom);
  const issues = useAtomValue(issuesByThreadAtom(environmentIds));
  if (issueFilterCount(filter) === 0) return threads;
  return threads.filter((thread) =>
    matchesIssueFilter(issues.get(threadIssueKey(thread.environmentId, thread.id)) ?? null, filter),
  );
}

/** Filter and refresh buttons for the thread list; hidden while no thread has a linked issue. */
export function SidebarIssueControls({
  environmentIds,
}: {
  environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  const [filter, setFilter] = useAtom(issueFilterAtom);
  const issues = useAtomValue(issuesByThreadAtom(environmentIds));
  const registry = useContext(RegistryContext);
  const mutate = useAtomCommand(issueTrackerEnvironment.mutate, { reportFailure: false });
  const [refreshing, setRefreshing] = useState(false);
  const count = issueFilterCount(filter);
  if (issues.size === 0 && count === 0) return null;

  const options = issueFilterOptions([...issues.values()], filter);
  const filterLabel =
    count === 0
      ? "Filter threads by issue"
      : `Filter threads by issue: ${[...filter.states, ...filter.assignees].join(", ")}`;
  const refresh = async () => {
    setRefreshing(true);
    const results = await Promise.all(
      environmentIds.map((environmentId) =>
        mutate({ environmentId, input: { type: "refreshIssues" } }),
      ),
    );
    for (const environmentId of environmentIds) {
      registry.refresh(issueTrackerEnvironment.threadSummaries({ environmentId, input: {} }));
    }
    setRefreshing(false);
    if (results.some((result) => result._tag !== "Success")) {
      toastManager.add({ type: "error", title: "Could not refresh the issues" });
    }
  };

  return (
    <>
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <SidebarMenuButton
                    size="icon"
                    type="button"
                    aria-label={filterLabel}
                    className="relative size-7 shrink-0"
                  />
                }
              />
            }
          >
            <TicketIcon className="size-4" />
            {count > 0 ? (
              <span
                aria-hidden
                className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
              />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="top">{filterLabel}</TooltipPopup>
        </Tooltip>
        <MenuPopup align="start" className="max-h-96 w-60 overflow-y-auto">
          {options.states.length > 0 ? (
            <MenuGroup>
              <MenuGroupLabel>State</MenuGroupLabel>
              {options.states.map((state) => (
                <MenuCheckboxItem
                  key={state}
                  checked={filter.states.includes(state)}
                  onCheckedChange={() =>
                    setFilter({ ...filter, states: toggleFilterValue(filter.states, state) })
                  }
                >
                  {state}
                </MenuCheckboxItem>
              ))}
            </MenuGroup>
          ) : null}
          <MenuGroup>
            <MenuGroupLabel>Assignee</MenuGroupLabel>
            {options.assignees.map((assignee) => (
              <MenuCheckboxItem
                key={assignee}
                checked={filter.assignees.includes(assignee)}
                onCheckedChange={() =>
                  setFilter({ ...filter, assignees: toggleFilterValue(filter.assignees, assignee) })
                }
              >
                {assignee}
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
          {count > 0 ? (
            <>
              <MenuSeparator />
              <MenuItem onClick={() => setFilter(EMPTY_ISSUE_FILTER)}>Clear issue filter</MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      <SidebarHeaderIconButton
        label="Refresh issue states and assignees"
        disabled={refreshing}
        onClick={() => void refresh()}
      >
        {refreshing ? (
          <Spinner size="xs" aria-label="Refreshing issues" />
        ) : (
          <RefreshCwIcon className="size-4" />
        )}
      </SidebarHeaderIconButton>
    </>
  );
}
