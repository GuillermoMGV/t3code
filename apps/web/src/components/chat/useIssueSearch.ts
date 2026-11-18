import type { EnvironmentId, IssueSearchFilter, IssueTrackerKind } from "@t3tools/contracts";

import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useEnvironmentQuery } from "~/state/query";
import { useDebouncedValue } from "~/state/queries";
import { ISSUE_SEARCH_DEBOUNCE_MS, issueSearchQuery } from "./issueTrackerRows.logic";

// Fork-only Linear and Jira integration; see CUSTOM_DEVELOPMENT.md.

/**
 * Searches one tracker as the user types. An empty draft lists issues by `scope`; a pasted
 * issue URL or key finds that issue, because the server parses it before searching by title.
 */
export function useIssueSearch(
  environmentId: EnvironmentId | null,
  tracker: IssueTrackerKind,
  draft: string,
  /** What an empty draft lists; left out, the server lists the user's open issues. */
  scope?: "mine" | "recent",
  /** Applied by the tracker, so its result limit counts only matching issues. */
  filter?: IssueSearchFilter,
) {
  // Left out when empty, so an unfiltered list shares its cache entry.
  const narrows =
    filter !== undefined &&
    filter.states.length + filter.assignees.length + filter.projects.length > 0;
  const query = issueSearchQuery(useDebouncedValue(draft, ISSUE_SEARCH_DEBOUNCE_MS));
  const typing = issueSearchQuery(draft) !== query;
  const search = useEnvironmentQuery(
    environmentId === null
      ? null
      : issueTrackerEnvironment.search({
          environmentId,
          input: {
            tracker,
            query,
            ...(scope === undefined ? {} : { scope }),
            ...(narrows ? { filter } : {}),
          },
        }),
  );
  return {
    query,
    issues: search.data?.issues ?? [],
    searching: typing || search.isPending,
    error: search.error,
    refresh: search.refresh,
  };
}
