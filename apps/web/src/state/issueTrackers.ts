import {
  type EnvironmentId,
  type ScopedThreadRef,
  type TrackerIssue,
  WS_METHODS,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { issueEditKey } from "../components/chat/issueFieldPicker.logic";
import { threadIssueKey } from "../components/issues/issuesPage.logic";
import { connectionAtomRuntime } from "../connection/runtime";

/** Every linked thread's issues, for the thread list's badges. */
const threadSummaries = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "issue-trackers:thread-summaries",
  tag: WS_METHODS.issueTrackersGetThreadSummaries,
  staleTimeMs: 30_000,
  // The server caches each issue for a minute, so this costs one read per issue at most.
  refreshIntervalMs: 60_000,
});

// Fork-only Linear and Jira integration; see CUSTOM_DEVELOPMENT.md.
export const issueTrackerEnvironment = {
  threadIssues: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:thread-issues",
    tag: WS_METHODS.issueTrackersGetThreadIssues,
    staleTimeMs: 30_000,
    // Keeps state and assignee current while the panel is open.
    refreshIntervalMs: 60_000,
    // The server remembers issues detected in messages while answering; the thread list
    // learns about them only from a summaries refetch.
    onAnswer: ({ environmentId, input }, value, registry) =>
      Effect.sync(() => {
        const shown = value.rows.flatMap((row) =>
          row.link?.source === "detected" && row.issue !== null ? [row.issue.key] : [],
        );
        if (shown.length === 0) return;
        const summaries = threadSummaries({ environmentId, input: {} });
        const known =
          AsyncResult.getOrElse(registry.get(summaries), () => null)
            ?.threads.find((summary) => summary.threadId === input.threadId)
            ?.issues.map((issue) => issue.key) ?? [];
        if (shown.every((key) => known.includes(key))) return;
        registry.refresh(summaries);
      }),
  }),
  search: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:search",
    tag: WS_METHODS.issueTrackersSearch,
    staleTimeMs: 15_000,
  }),
  /** What the Issues page's filter menu offers; states and projects rarely change. */
  filterOptions: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:filter-options",
    tag: WS_METHODS.issueTrackersGetFilterOptions,
    staleTimeMs: 5 * 60_000,
  }),
  connections: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:connections",
    tag: WS_METHODS.issueTrackersGetConnections,
    staleTimeMs: 30_000,
  }),
  threadSummaries,
  /** Issues for keys found in pull request titles and branches. */
  issues: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:issues",
    tag: WS_METHODS.issueTrackersGetIssues,
    staleTimeMs: 30_000,
    refreshIntervalMs: 60_000,
  }),
  /** What one issue's state and assignee pickers offer; loaded when a picker opens. */
  editOptions: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "issue-trackers:edit-options",
    tag: WS_METHODS.issueTrackersGetEditOptions,
    staleTimeMs: 60_000,
  }),
  mutate: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "issue-trackers:mutate",
    tag: WS_METHODS.issueTrackersMutate,
    onSuccess: ({ environmentId, input }, registry, result) =>
      Effect.sync(() => {
        if (input.type !== "setIssueState" && input.type !== "setIssueAssignee") return;
        if (result.issue !== undefined) {
          registry.set(editedIssueAtom(issueEditKey(environmentId, input)), result.issue);
        }
        // The thread list's badges come from the server cache the change just refreshed.
        registry.refresh(threadSummaries({ environmentId, input: {} }));
      }),
  }),
};

/** The issue as read back after a state or assignee change here, keyed by `issueEditKey`. */
export const editedIssueAtom = Atom.family((key: string) =>
  Atom.make<TrackerIssue | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`issue-trackers:edited:${key}`),
  ),
);

// One derived atom per set of environments; a new atom per render would refetch.
const threadIssuesAtoms = new Map<
  string,
  Atom.Atom<ReadonlyMap<string, ReadonlyArray<TrackerIssue>>>
>();

/** Each linked thread's issues (Linear first) on those servers, keyed by `threadIssueKey`. */
export function threadIssuesAtom(environmentIds: ReadonlyArray<EnvironmentId>) {
  const key = environmentIds.join("\u0000");
  let atom = threadIssuesAtoms.get(key);
  if (atom === undefined) {
    atom = Atom.make((get) => {
      const issues = new Map<string, ReadonlyArray<TrackerIssue>>();
      for (const environmentId of environmentIds) {
        const result = get(issueTrackerEnvironment.threadSummaries({ environmentId, input: {} }));
        for (const summary of AsyncResult.getOrElse(result, () => null)?.threads ?? []) {
          if (summary.issues.length > 0)
            issues.set(threadIssueKey(environmentId, summary.threadId), summary.issues);
        }
      }
      return issues;
    });
    threadIssuesAtoms.set(key, atom);
  }
  return atom;
}

/** The thread's first linked issue from the cached summaries, for menus that read it once. */
export function readThreadIssueSummary(
  registry: AtomRegistry.AtomRegistry,
  threadRef: ScopedThreadRef,
): TrackerIssue | null {
  const summaries = AsyncResult.getOrElse(
    registry.get(threadSummaries({ environmentId: threadRef.environmentId, input: {} })),
    () => null,
  );
  return (
    summaries?.threads.find((summary) => summary.threadId === threadRef.threadId)?.issues[0] ?? null
  );
}
