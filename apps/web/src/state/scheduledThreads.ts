import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { threadIssueKey } from "../components/issues/issuesPage.logic";
import { connectionAtomRuntime } from "../connection/runtime";

// Fork-only list of threads a scheduled task started; see CUSTOM_DEVELOPMENT.md.

const scheduledThreads = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "scheduled-threads:list",
  tag: WS_METHODS.scheduledThreadsList,
  staleTimeMs: 30_000,
  // Tasks launch threads on their own; this picks the new ones up.
  refreshIntervalMs: 60_000,
});

// One derived atom per set of environments; a new atom per render would refetch.
const scheduledThreadKeysAtoms = new Map<string, Atom.Atom<ReadonlySet<string>>>();

/** Threads a scheduled task started on those servers, keyed by `threadIssueKey`. */
export function scheduledThreadKeysAtom(environmentIds: ReadonlyArray<EnvironmentId>) {
  const key = environmentIds.join("\u0000");
  let atom = scheduledThreadKeysAtoms.get(key);
  if (atom === undefined) {
    atom = Atom.make((get) => {
      const keys = new Set<string>();
      for (const environmentId of environmentIds) {
        const result = get(scheduledThreads({ environmentId, input: {} }));
        for (const threadId of AsyncResult.getOrElse(result, () => null)?.threadIds ?? []) {
          keys.add(threadIssueKey(environmentId, threadId));
        }
      }
      return keys;
    });
    scheduledThreadKeysAtoms.set(key, atom);
  }
  return atom;
}
