import { RegistryContext, useAtom, useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { RefreshCwIcon, TicketIcon } from "lucide-react";
import { useContext, useState } from "react";

import { issueTrackerEnvironment, threadIssuesAtom } from "~/state/issueTrackers";
import { threadIssueKey } from "../issues/issuesPage.logic";
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

/** The servers the listed threads live on, which are the ones that hold their issue links. */
function environmentIdsOf(threads: ReadonlyArray<EnvironmentThreadShell>): EnvironmentId[] {
  return [...new Set(threads.map((thread) => thread.environmentId))].toSorted();
}

/** The threads that pass the issue filter; the same array while no filter is set. */
export function useIssueFilteredThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  const filter = useAtomValue(issueFilterAtom);
  const issues = useAtomValue(threadIssuesAtom(environmentIdsOf(threads)));
  if (issueFilterCount(filter) === 0) return threads;
  return threads.filter((thread) =>
    matchesIssueFilter(
      issues.get(threadIssueKey(thread.environmentId, thread.id))?.[0] ?? null,
      filter,
    ),
  );
}

/** Filter and refresh buttons for the thread list; hidden while no thread has a linked issue. */
export function SidebarIssueControls({
  threads,
}: {
  threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const environmentIds = environmentIdsOf(threads);
  const [filter, setFilter] = useAtom(issueFilterAtom);
  const issues = useAtomValue(threadIssuesAtom(environmentIds));
  const registry = useContext(RegistryContext);
  const mutate = useAtomCommand(issueTrackerEnvironment.mutate, { reportFailure: false });
  const [refreshing, setRefreshing] = useState(false);
  const count = issueFilterCount(filter);
  if (issues.size === 0 && count === 0) return null;

  const options = issueFilterOptions(
    [...issues.values()].flatMap((threadIssues) => threadIssues.slice(0, 1)),
    filter,
  );
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
