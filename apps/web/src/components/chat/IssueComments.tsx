import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  ISSUE_TRACKER_LABELS,
  type EnvironmentId,
  type IssueTrackerKind,
  type ThreadId,
  type TrackerIssueComment,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { MessageSquareIcon, MessageSquareQuoteIcon, XIcon } from "lucide-react";

import type { ComposerHandleRef } from "~/composerHandleContext";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useQuietThreadVisibleTurnItems } from "~/state/entities";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatCommentDate, issueCommentPrompt } from "./issueComments.logic";
import { IssueAssigneeBadge, IssueTrackerIcon } from "./IssueTrackerParts";
import { collectThreadIssueReferences } from "./issueTrackerRows.logic";
import { ThreadDetailsControl } from "./ThreadDetailsControl";

// Fork-only ticket comments popover; see CUSTOM_DEVELOPMENT.md.

type OpenComments = { readonly threadKey: string; readonly tracker: IssueTrackerKind };

const threadKeyOf = (environmentId: EnvironmentId, threadId: ThreadId) =>
  `${environmentId}:${threadId}`;

// Shared by the panel's toggle and the card ChatView renders: the panel popover closes on
// outside clicks, and the card must stay while the user works in the composer.
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

/** The open issue's comments, newest first, floating at the bottom right of the chat. */
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
  if (issue === null) return null;

  const checkInChat = (comment: TrackerIssueComment) => {
    const composer = composerRef.current;
    if (
      !composer?.insertTextAtEnd(issueCommentPrompt(issue, comment), {
        ensureLeadingBoundary: true,
      })
    ) {
      toastManager.add({ type: "error", title: "The chat isn't ready to accept input right now" });
      return;
    }
    composer.focusAtEnd();
  };

  return (
    <section
      aria-label={`${issue.key} comments`}
      className="absolute right-4 bottom-36 left-4 z-30 flex max-h-2/5 flex-col sm:left-auto sm:w-80 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <IssueTrackerIcon tracker={tracker} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {issue.key} · {comments.length} {comments.length === 1 ? "comment" : "comments"}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Close comments"
          onClick={() => setOpen(null)}
        >
          <XIcon aria-hidden />
        </Button>
      </header>
      {comments.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          {row?.comments === undefined
            ? `${ISSUE_TRACKER_LABELS[tracker]} comments could not be loaded.`
            : "No comments yet."}
        </p>
      ) : (
        <ol className="min-h-0 flex-1 divide-y overflow-y-auto">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} onCheck={() => checkInChat(comment)} />
          ))}
        </ol>
      )}
    </section>
  );
}

function CommentItem({ comment, onCheck }: { comment: TrackerIssueComment; onCheck: () => void }) {
  const now = new Date(`${useNowMinute()}:00Z`);
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
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
      </div>
      <p className="text-sm break-words whitespace-pre-wrap">{comment.body}</p>
      <div className="flex justify-end">
        <Button size="xs" variant="outline" onClick={onCheck}>
          <MessageSquareQuoteIcon aria-hidden />
          Check in chat
        </Button>
      </div>
    </li>
  );
}
