import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

// Fork-only notifications bell for Linear and Jira; see CUSTOM_DEVELOPMENT.md.
export const issueTrackerNotificationsEnvironment = {
  /** The server's cached list; reading it never reaches the trackers. */
  list: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:notifications",
    tag: WS_METHODS.issueTrackersGetNotifications,
    staleTimeMs: 30_000,
    // The server checks the trackers every 5 minutes; this only picks its result up sooner.
    refreshIntervalMs: 60_000,
  }),
  mutate: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "issue-trackers:notifications-mutate",
    tag: WS_METHODS.issueTrackersMutateNotifications,
  }),
};
