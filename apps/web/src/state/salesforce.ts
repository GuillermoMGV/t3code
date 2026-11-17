import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

// Fork-only Salesforce org manager; see CUSTOM_DEVELOPMENT.md.
export const salesforceEnvironment = {
  /** The server's cached state, cheap to read; `sf` runs only when the CLI's files change. */
  state: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "salesforce:state",
    tag: WS_METHODS.salesforceGetState,
    staleTimeMs: 1_000,
    refreshIntervalMs: 3_000,
  }),
  mutate: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "salesforce:mutate",
    tag: WS_METHODS.salesforceMutate,
  }),
};
