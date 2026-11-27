import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  ISSUE_TRACKER_LABELS,
  type EnvironmentId,
  type IssueTrackerKind,
  type ScopedThreadRef,
  type ThreadId,
  type TrackerIssue,
  type TrackerIssueComment,
  type TrackerIssueStatusChange,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { ArrowRightIcon, EyeIcon, MessageSquareIcon, MessageSquareTextIcon } from "lucide-react";

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
import {
  formatCommentDate,
  issueActivityCountLabel,
  issueActivityTimeline,
  issueCommentPrompt,
} from "./issueComments.logic";
import { IssueAssigneeBadge, IssueTrackerIcon } from "./IssueTrackerParts";
import { collectThreadIssueReferences } from "./issueTrackerRows.logic";
import { useCheckCommentInThread } from "../sidebar/useCheckCommentInThread";
import { ThreadDetailsControl } from "./ThreadDetailsControl";

// Fork-only ticket comments and status changes modal; see CUSTOM_DEVELOPMENT.md.

type OpenComments = { readonly threadKey: string; readonly tracker: IssueTrackerKind };

const threadKeyOf = (environmentId: EnvironmentId, threadId: ThreadId) =>
  `${environmentId}:${threadId}`;

// Shared by the panel's toggle and the modal ChatView renders: the panel popover closes on
// outside clicks, which would unmount a modal rendered inside it.
const openCommentsAtom = Atom.make<OpenComments | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("issue-trackers:open-comments"),
);

/** The speech bubble in the panel's issue row; shown only when the issue has some activity. */
export function IssueCommentsToggle({
  environmentId,
  threadId,
  tracker,
  commentCount,
  statusChangeCount,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  tracker: IssueTrackerKind;
  commentCount: number;
  statusChangeCount: number;
}) {
  const [open, setOpen] = useAtom(openCommentsAtom);
  const threadKey = threadKeyOf(environmentId, threadId);
  const shown = open?.threadKey === threadKey && open.tracker === tracker;
  const label = `${shown ? "Hide" : "Show"} ${issueActivityCountLabel(commentCount, statusChangeCount)}`;
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

/** The open issue's comments and status changes, newest first, in a modal over the chat. */
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
  const statusChanges = row?.statusChanges ?? [];
  const timeline = issueActivityTimeline(comments, statusChanges);
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
              {issue.key} · {issueActivityCountLabel(comments.length, statusChanges.length)}
            </DialogTitle>
          </div>
          <DialogDescription>{issue.title}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {timeline.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {row?.comments === undefined
                ? `${ISSUE_TRACKER_LABELS[tracker]} activity could not be loaded.`
                : "No comments or status changes yet."}
            </p>
          ) : (
            <ol className="divide-y">
              {timeline.map((entry) =>
                entry.kind === "comment" ? (
                  <CommentItem
                    key={`comment:${entry.comment.id}`}
                    comment={entry.comment}
                    trackerLabel={ISSUE_TRACKER_LABELS[tracker]}
                    threadRef={threadRef}
                    onCheck={() => checkInThread(entry.comment)}
                  />
                ) : (
                  <StatusChangeItem
                    key={`status:${entry.change.id}`}
                    change={entry.change}
                    currentState={issue.state}
                  />
                ),
              )}
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

/** One line: who moved the issue from which status to which, and when. */
function StatusChangeItem({
  change,
  currentState,
}: {
  change: TrackerIssueStatusChange;
  currentState: TrackerIssue["state"];
}) {
  const now = new Date(`${useNowMinute()}:00Z`);
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2.5 text-xs text-muted-foreground">
      {change.actor === null ? (
        <span>Someone</span>
      ) : (
        <IssueAssigneeBadge assignee={change.actor} className="font-medium text-foreground" />
      )}
      <span>{change.from === null ? "set status to" : "changed status"}</span>
      {change.from === null ? null : (
        <>
          <StatusName status={change.from} currentState={currentState} />
          <ArrowRightIcon aria-label="to" className="size-3 shrink-0" />
        </>
      )}
      <StatusName status={change.to} currentState={currentState} />
      <span className="shrink-0">·</span>
      <time dateTime={change.createdAt} className="shrink-0 tabular-nums">
        {formatCommentDate(change.createdAt, now)}
      </time>
    </li>
  );
}

function StatusName({
  status,
  currentState,
}: {
  status: TrackerIssueStatusChange["to"];
  currentState: TrackerIssue["state"];
}) {
  // Jira changelogs carry no colors; the issue's current state lends its own when names match.
  const color = status.color ?? (currentState?.name === status.name ? currentState.color : null);
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground">
      <span
        aria-hidden
        className={
          color === null
            ? "size-2 shrink-0 rounded-full bg-muted-foreground/40"
            : "size-2 shrink-0 rounded-full"
        }
        // Each tracker defines its states' colors; showing them keeps states recognizable.
        style={color === null ? undefined : { backgroundColor: color }}
      />
      <span className="truncate">{status.name}</span>
    </span>
  );
}
