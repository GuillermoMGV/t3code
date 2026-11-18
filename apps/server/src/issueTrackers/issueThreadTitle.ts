// Fork-only ticket-based thread titles. See CUSTOM_DEVELOPMENT.md.
import { CommandId, type ThreadId, type TrackerIssue } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import type { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";

export function issueThreadTitle(issue: Pick<TrackerIssue, "key" | "title">): string {
  // oxlint-disable-next-line t3code/no-em-dash-copy -- Delimiter in the ticket title format.
  return `${issue.key} — ${issue.title.trim()}`;
}

export const renameLinkedThread = Effect.fn("IssueTrackerService.renameLinkedThread")(function* (
  threads: Pick<ThreadManagementService["Service"], "getThreadShell" | "dispatch">,
  threadId: ThreadId,
  title: string,
) {
  if ((yield* threads.getThreadShell(threadId)) === null) return;
  const random = yield* SecureRandom.SecureRandom;
  yield* threads.dispatch({
    type: "thread.metadata.update",
    commandId: CommandId.make(`issue-title:${yield* random.uuidV4()}`),
    threadId,
    title,
  });
});
