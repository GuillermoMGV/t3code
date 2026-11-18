import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { pullRequestEnvironment, usePullRequestHostList } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { pullRequestIssueKey } from "../pullRequest/pullRequestIssue.logic";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import {
  PullRequestReviewDecisionGlyph,
  PullRequestStateGlyph,
  pullRequestChecksStatePresentation,
} from "../pullRequest/pullRequestPresentation";
import { usePullRequestScope } from "../pullRequest/usePullRequestListView";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { pullRequestsByIssueKey } from "./issuesPage.logic";

// Fork-only Issues page: the pull requests that name each issue; see CUSTOM_DEVELOPMENT.md.

const NO_HOST_READS = new Map<EnvironmentId, never>();
// Open and closed alike, so a merged pull request still shows on its issue.
const LIST_SCOPE = { involvement: "all", state: "all" } as const;
const LIST_LIMIT = 99;

/**
 * One list read per server, the same read the Pull requests page makes for every state, so the
 * Issues page asks the hosts once rather than once per issue.
 */
export function useIssuePullRequests() {
  const { environmentQueries } = usePullRequestScope(LIST_SCOPE, NO_HOST_READS);
  const invalidate = useAtomCommand(pullRequestEnvironment.invalidate, { reportFailure: false });
  const [invalidating, setInvalidating] = useState(false);
  const list = usePullRequestHostList(
    environmentQueries.map(({ environmentId, projectIds }) => ({
      environmentId,
      input: { ...LIST_SCOPE, limit: LIST_LIMIT, ...(projectIds ? { projectIds } : {}) },
    })),
  );
  return {
    byKey: pullRequestsByIssueKey(list.data?.entries ?? [], pullRequestIssueKey),
    refreshing: invalidating || list.isPending,
    /** Drops the servers' cached host reads first, as the Pull requests page's refresh does. */
    refresh: async () => {
      setInvalidating(true);
      await Promise.all(
        environmentQueries.map(({ environmentId }) => invalidate({ environmentId, input: {} })),
      );
      setInvalidating(false);
      list.refresh();
    },
  };
}

/** One quiet line: state, number, checks and review of each pull request naming the issue. */
export function IssuePullRequestsLine({
  entries,
}: {
  entries: ReadonlyArray<EnvironmentPullRequestEntry>;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 text-muted-foreground text-xs">
      {entries.map((entry) => (
        <IssuePullRequest key={`${entry.environmentId}:${entry.url}`} entry={entry} />
      ))}
    </div>
  );
}

function IssuePullRequest({ entry }: { entry: EnvironmentPullRequestEntry }) {
  const navigate = useNavigate();
  const checks =
    entry.checksState === undefined ? null : pullRequestChecksStatePresentation(entry.checksState);
  const open = () =>
    void navigate({
      to: "/pull-requests",
      search: {
        ...readPullRequestListPreferences(),
        repository: entry.repository,
        number: entry.number,
        selectedProjectId: entry.projectId,
        selectedEnvironmentId: entry.environmentId,
        selectedHost: entry.host,
      },
    });
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <PullRequestStateGlyph state={entry.state} isDraft={entry.isDraft} className="size-3.5" />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={open}
              className="min-w-0 max-w-56 truncate tabular-nums underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
            />
          }
        >
          #{entry.number} {entry.title}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {entry.repository}#{entry.number}: {entry.title}
        </TooltipPopup>
      </Tooltip>
      {checks === null ? null : (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
            <checks.Icon
              aria-label={checks.label}
              className={cn("size-3.5", checks.toneClassName)}
            />
          </TooltipTrigger>
          <TooltipPopup>{checks.label}</TooltipPopup>
        </Tooltip>
      )}
      {entry.reviewDecision === undefined ? null : (
        <PullRequestReviewDecisionGlyph decision={entry.reviewDecision} />
      )}
    </span>
  );
}
