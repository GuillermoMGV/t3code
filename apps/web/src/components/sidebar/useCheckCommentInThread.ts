import { RegistryContext } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { IssueTrackerKind, TrackerNotification } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useContext } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { resolveThreadActionProjectRef } from "~/lib/chatThreadActions";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { threadsForIssue } from "../issues/issuesPage.logic";
import { useThreadsByIssue } from "../issues/useIssueThreads";
import { toastManager } from "../ui/toast";
import { checkCommentPrompt, withCheckCommentPrompt } from "./SidebarIssueNotifications.logic";

// Fork-only "Check comment in thread" for the notifications bell; see CUSTOM_DEVELOPMENT.md.

/**
 * Puts a "check the last comment" prompt in the composer of the issue's most recent thread and
 * opens it, unsent. Without one, opens a new-thread draft with that prompt and links the issue,
 * as the Issues page's "Start thread" does, so the next comment finds this thread.
 */
export function useCheckCommentInThread() {
  const threadsByIssueKey = useThreadsByIssue();
  const navigate = useNavigate();
  const newThreadContext = useHandleNewThread();
  const mutate = useAtomCommand(issueTrackerEnvironment.mutate, { reportFailure: false });
  const registry = useContext(RegistryContext);

  return async (
    notification: Pick<TrackerNotification, "issue"> & { tracker: IssueTrackerKind },
  ) => {
    const { issue, tracker } = notification;
    const prompt = checkCommentPrompt(issue);
    const [latest] = threadsForIssue(threadsByIssueKey, { tracker, key: issue.key });
    if (latest !== undefined) {
      const target = scopeThreadRef(latest.environmentId, latest.id);
      const store = useComposerDraftStore.getState();
      store.setPrompt(
        target,
        withCheckCommentPrompt(store.getComposerDraft(target)?.prompt ?? "", prompt),
      );
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target),
      });
      return;
    }

    // The thread or draft on screen first, else the project a new thread would use.
    const projectRef = resolveThreadActionProjectRef({
      ...newThreadContext,
      activeThread: newThreadContext.activeThread ?? undefined,
    });
    if (projectRef === null) {
      toastManager.add({ type: "warning", title: "Add a project to start a thread" });
      return;
    }
    const opened = await newThreadContext.handleNewThread(projectRef, { prompt });
    if (opened === null) return;
    const { environmentId } = projectRef;
    const result = await mutate({
      environmentId,
      input: { type: "link", threadId: opened.threadId, tracker, key: issue.key },
    });
    if (result._tag === "Success") {
      registry.refresh(issueTrackerEnvironment.threadSummaries({ environmentId, input: {} }));
    }
  };
}
