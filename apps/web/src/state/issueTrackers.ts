import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

// Fork-only Linear and Jira integration; see CUSTOM_DEVELOPMENT.md.
export const issueTrackerEnvironment = {
  threadIssues: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:thread-issues",
    tag: WS_METHODS.issueTrackersGetThreadIssues,
    staleTimeMs: 30_000,
    // Keeps state and assignee current while the panel is open.
    refreshIntervalMs: 60_000,
  }),
  search: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:search",
    tag: WS_METHODS.issueTrackersSearch,
    staleTimeMs: 15_000,
  }),
  connections: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:connections",
    tag: WS_METHODS.issueTrackersGetConnections,
    staleTimeMs: 30_000,
  }),
  /** Every linked thread's issues, for the thread list's badges. */
  threadSummaries: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:thread-summaries",
    tag: WS_METHODS.issueTrackersGetThreadSummaries,
    staleTimeMs: 30_000,
    // The server caches each issue for a minute, so this costs one read per issue at most.
    refreshIntervalMs: 60_000,
  }),
  /** Issues for keys found in pull request titles and branches. */
  issues: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:issues",
    tag: WS_METHODS.issueTrackersGetIssues,
    staleTimeMs: 30_000,
    refreshIntervalMs: 60_000,
  }),
  mutate: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "issue-trackers:mutate",
    tag: WS_METHODS.issueTrackersMutate,
  }),
};
