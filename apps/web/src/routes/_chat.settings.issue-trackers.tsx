import { createFileRoute } from "@tanstack/react-router";

import { IssueTrackersSettingsPanel } from "../components/settings/IssueTrackersSettings";

// Fork-only Linear and Jira integration; see CUSTOM_DEVELOPMENT.md.
export const Route = createFileRoute("/_chat/settings/issue-trackers")({
  component: IssueTrackersSettingsPanel,
});
