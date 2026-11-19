import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  ISSUE_TRACKER_LABELS,
  type EnvironmentId,
  type IssueTrackerKind,
  type ScopedThreadRef,
  type ThreadId,
  type TrackerIssueComment,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { EyeIcon, MessageSquareIcon, MessageSquareTextIcon } from "lucide-react";

import type { ComposerHandleRef } from "~/composerHandleContext";
import { useNowMinute } from "~/hooks/useNowMinute";
import { ensureLocalApi } from "~/localApi";
import ChatMarkdown from "../ChatMarkdown";
import { useQuietThreadVisibleTurnItems } from "~/state/entities";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatCommentDate, issueCommentPrompt } from "./issueComments.logic";
import { IssueAssigneeBadge, IssueTrackerIcon } from "./IssueTrackerParts";
import { collectThreadIssueReferences } from "./issueTrackerRows.logic";
import { useCheckCommentInThread } from "../sidebar/useCheckCommentInThread";
import { ThreadDetailsControl } from "./ThreadDetailsControl";

// Fork-only ticket comments popover; see CUSTOM_DEVELOPMENT.md.

type OpenComments = { readonly threadKey: string; readonly tracker: IssueTrackerKind };

const threadKeyOf = (environmentId: EnvironmentId, threadId: ThreadId) =>
  `${environmentId}:${threadId}`;

// Shared by the panel's toggle and the modal ChatView renders: the panel popover closes on
// outside clicks, which would unmount a modal rendered inside it.
const openCommentsAtom = Atom.make<OpenComments | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("issue-trackers:open-comments"),
);

/** The speech bubble in the panel's issue row; shown only when the issue has comments. */
export function IssueCommentsToggle({
  environmentId,
  threadId,
  tracker,
  count,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  tracker: IssueTrackerKind;
  count: number;
}) {
  const [open, setOpen] = useAtom(openCommentsAtom);
  const threadKey = threadKeyOf(environmentId, threadId);
  const shown = open?.threadKey === threadKey && open.tracker === tracker;
  const label = `${shown ? "Hide" : "Show"} ${count} ${count === 1 ? "comment" : "comments"}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ThreadDetailsControl
            type="button"
            variant="ghost"
            size="sm"
            part="icon"
            tone={shown ? "primary" : "default"}
            aria-label={label}
            aria-pressed={shown}
            onClick={() => setOpen(shown ? null : { threadKey, tracker })}
          />
        }
      >
        <MessageSquareIcon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

/** The open issue's comments, newest first, in a modal over the chat. */
export function ThreadIssueComments({
  environmentId,
  threadId,
  composerRef,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  composerRef: ComposerHandleRef;
}) {
  const open = useAtomValue(openCommentsAtom);
  if (open === null || open.threadKey !== threadKeyOf(environmentId, threadId)) return null;
  return (
    <CommentsCard
      environmentId={environmentId}
      threadId={threadId}
      tracker={open.tracker}
      composerRef={composerRef}
    />
  );
}

function CommentsCard({
  environmentId,
  threadId,
  tracker,
  composerRef,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  tracker: IssueTrackerKind;
  composerRef: ComposerHandleRef;
}) {
  const [, setOpen] = useAtom(openCommentsAtom);
  // Same input as the panel, so both read one query.
  const items = useQuietThreadVisibleTurnItems({ environmentId, threadId });
  const detected = collectThreadIssueReferences(items);
  const query = useEnvironmentQuery(
    issueTrackerEnvironment.threadIssues({ environmentId, input: { threadId, detected } }),
  );
  const row = query.data?.rows.find((candidate) => candidate.tracker === tracker);
  const issue = row?.issue ?? null;
  const comments = row?.comments ?? [];
  const { checkInThread: check } = useCheckCommentInThread();
  if (issue === null) return null;

  const threadRef = scopeThreadRef(environmentId, threadId);
  const checkInThread = (comment: TrackerIssueComment) => {
    setOpen(null);
    void check({
      issue,
      tracker,
      prompt: issueCommentPrompt(issue, comment),
      thread: threadRef,
    }).then(() => composerRef.current?.focusAtEnd());
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : setOpen(null))}>
      <DialogPopup className="max-h-[85vh] max-w-2xl" finalFocus={false}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <IssueTrackerIcon tracker={tracker} className="size-4 shrink-0 text-muted-foreground" />
            <DialogTitle>
              {issue.key} · {comments.length} {comments.length === 1 ? "comment" : "comments"}
            </DialogTitle>
          </div>
          <DialogDescription>{issue.title}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {comments.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {row?.comments === undefined
                ? `${ISSUE_TRACKER_LABELS[tracker]} comments could not be loaded.`
                : "No comments yet."}
            </p>
          ) : (
            <ol className="divide-y">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  trackerLabel={ISSUE_TRACKER_LABELS[tracker]}
                  threadRef={threadRef}
                  onCheck={() => checkInThread(comment)}
                />
              ))}
            </ol>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function CommentItem({
  comment,
  trackerLabel,
  threadRef,
  onCheck,
}: {
  comment: TrackerIssueComment;
  trackerLabel: string;
  threadRef: ScopedThreadRef;
  onCheck: () => void;
}) {
  const now = new Date(`${useNowMinute()}:00Z`);
  const url = comment.url;
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {comment.author === null ? (
          <span className="truncate">Unknown author</span>
        ) : (
          <IssueAssigneeBadge assignee={comment.author} className="font-medium text-foreground" />
        )}
        <span className="shrink-0">·</span>
        <time dateTime={comment.createdAt} className="shrink-0 tabular-nums">
          {formatCommentDate(comment.createdAt, now)}
        </time>
        {url === null ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Open comment in ${trackerLabel}`}
                  onClick={() => void ensureLocalApi().shell.openExternal(url)}
                />
              }
            >
              <EyeIcon aria-hidden />
            </TooltipTrigger>
            <TooltipPopup side="top">Open in {trackerLabel}</TooltipPopup>
          </Tooltip>
        )}
      </div>
      <ChatMarkdown text={comment.body} cwd={undefined} threadRef={threadRef} lineBreaks />
      <div className="flex justify-end">
        <Button size="xs" variant="outline" onClick={onCheck}>
          <MessageSquareTextIcon aria-hidden />
          Check in thread
        </Button>
      </div>
    </li>
  );
}
