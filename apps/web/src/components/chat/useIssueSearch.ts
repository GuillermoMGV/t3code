import type { EnvironmentId, IssueTrackerKind } from "@t3tools/contracts";

import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useEnvironmentQuery } from "~/state/query";
import { useDebouncedValue } from "~/state/queries";
import { ISSUE_SEARCH_DEBOUNCE_MS, issueSearchQuery } from "./issueTrackerRows.logic";

// Fork-only Linear and Jira integration; see CUSTOM_DEVELOPMENT.md.

/**
 * Searches one tracker as the user types. An empty draft lists the user's open issues; a pasted
 * issue URL or key finds that issue, because the server parses it before searching by title.
 */
export function useIssueSearch(
  environmentId: EnvironmentId | null,
  tracker: IssueTrackerKind,
  draft: string,
) {
  const query = issueSearchQuery(useDebouncedValue(draft, ISSUE_SEARCH_DEBOUNCE_MS));
  const typing = issueSearchQuery(draft) !== query;
  const search = useEnvironmentQuery(
    environmentId === null
      ? null
      : issueTrackerEnvironment.search({ environmentId, input: { tracker, query } }),
  );
  return {
    query,
    issues: search.data?.issues ?? [],
    searching: typing || search.isPending,
    error: search.error,
    refresh: search.refresh,
  };
}
