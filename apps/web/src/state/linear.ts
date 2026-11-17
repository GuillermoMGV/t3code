import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

// Fork-only Linear integration; see CUSTOM_DEVELOPMENT.md.
export const linearEnvironment = {
  threadIssue: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "linear:thread-issue",
    tag: WS_METHODS.linearGetThreadIssue,
    staleTimeMs: 30_000,
    // Keeps state and assignee current while the panel is open.
    refreshIntervalMs: 60_000,
  }),
  searchIssues: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "linear:search-issues",
    tag: WS_METHODS.linearSearchIssues,
    staleTimeMs: 15_000,
  }),
  mutate: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "linear:mutate",
    tag: WS_METHODS.linearMutate,
  }),
};
