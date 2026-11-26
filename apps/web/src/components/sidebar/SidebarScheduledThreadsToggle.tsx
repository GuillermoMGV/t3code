import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import { CalendarClockIcon, CalendarOffIcon } from "lucide-react";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { scheduledThreadKeysAtom } from "~/state/scheduledThreads";
import { threadIssueKey } from "../issues/issuesPage.logic";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

// Fork-only toggle that hides threads a scheduled task started; see CUSTOM_DEVELOPMENT.md.

const HIDE_SCHEDULED_THREADS_KEY = "t3code:sidebar:hide-scheduled-threads";

function useHideScheduledThreads() {
  return useLocalStorage(HIDE_SCHEDULED_THREADS_KEY, false, Schema.Boolean);
}

function environmentIdsOf(threads: ReadonlyArray<EnvironmentThreadShell>): EnvironmentId[] {
  return [...new Set(threads.map((thread) => thread.environmentId))].toSorted();
}

function useScheduledThreadKeys(threads: ReadonlyArray<EnvironmentThreadShell>) {
  return useAtomValue(scheduledThreadKeysAtom(environmentIdsOf(threads)));
}

function isScheduled(keys: ReadonlySet<string>, thread: EnvironmentThreadShell): boolean {
  return keys.has(threadIssueKey(thread.environmentId, thread.id));
}

/** The threads without the scheduled ones while they are hidden; the same array otherwise. */
export function useScheduledFilteredThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  const [hidden] = useHideScheduledThreads();
  const keys = useScheduledThreadKeys(threads);
  if (!hidden || keys.size === 0) return threads;
  return threads.filter((thread) => !isScheduled(keys, thread));
}

/** Hides or shows scheduled threads; absent while no listed thread came from a scheduled task. */
export function SidebarScheduledThreadsToggle({
  threads,
}: {
  threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const [hidden, setHidden] = useHideScheduledThreads();
  const keys = useScheduledThreadKeys(threads);
  const count = threads.filter((thread) => isScheduled(keys, thread)).length;
  if (count === 0) return null;

  const label = hidden
    ? `Show scheduled threads (${count} hidden)`
    : `Hide scheduled threads (${count})`;
  return (
    <SidebarHeaderIconButton label={label} aria-pressed={hidden} onClick={() => setHidden(!hidden)}>
      {hidden ? (
        <>
          <CalendarOffIcon className="size-4" />
          <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
        </>
      ) : (
        <CalendarClockIcon className="size-4" />
      )}
    </SidebarHeaderIconButton>
  );
}
