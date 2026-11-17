import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

// Fork-only Slack reviewer reminders; see CUSTOM_DEVELOPMENT.md.
export const slackEnvironment = {
  state: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "slack:state",
    tag: WS_METHODS.slackGetState,
    staleTimeMs: 60_000,
  }),
  mutate: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "slack:mutate",
    tag: WS_METHODS.slackMutate,
  }),
};
