import { useAtomValue } from "@effect/atom-react";

import { useThreadShells } from "~/state/entities";
import { threadIssuesAtom } from "~/state/issueTrackers";
import { threadsByIssue } from "./issuesPage.logic";

// Fork-only Issues page and notifications bell; see CUSTOM_DEVELOPMENT.md.

/** The threads already linked to each issue, from the links the thread list loads anyway. */
export function useThreadsByIssue() {
  const threads = useThreadShells();
  const environmentIds = [...new Set(threads.map((thread) => thread.environmentId))].toSorted();
  const threadIssues = useAtomValue(threadIssuesAtom(environmentIds));
  return threadsByIssue(threadIssues, threads);
}
