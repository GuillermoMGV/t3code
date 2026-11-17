import type { IssueTrackerKind } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { IssuesPage } from "../components/issues/IssuesPage";

// Fork-only Issues page; see CUSTOM_DEVELOPMENT.md.
export const Route = createFileRoute("/_chat/issues")({
  validateSearch: (raw: Record<string, unknown>): { tracker?: IssueTrackerKind } =>
    raw.tracker === "linear" || raw.tracker === "jira" ? { tracker: raw.tracker } : {},
  component: IssuesPage,
});
