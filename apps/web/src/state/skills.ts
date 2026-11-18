import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

// Fork-only Skills inventory; see CUSTOM_DEVELOPMENT.md.
export const skillsEnvironment = {
  /** Scans the disk on every read, so it refreshes only on demand. */
  inventory: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "skills:inventory",
    tag: WS_METHODS.skillsList,
    staleTimeMs: 30_000,
  }),
  detail: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "skills:detail",
    tag: WS_METHODS.skillsRead,
    staleTimeMs: 30_000,
  }),
  mutate: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "skills:mutate",
    tag: WS_METHODS.skillsMutate,
  }),
};
