import { useAtomValue } from "@effect/atom-react";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import {
  ISSUE_TRACKER_LABELS,
  type EnvironmentId,
  type IssueKey,
  type ProjectId,
  type ScopedThreadRef,
  type ThreadId,
  type TrackerIssue,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { ExternalLinkIcon, LinkIcon } from "lucide-react";
import { use, useState, type MouseEvent as ReactMouseEvent } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { useClientSettings } from "~/hooks/useSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readThreadTurnItems, useProject, useQuietThreadShell } from "~/state/entities";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useEnvironmentQuery } from "~/state/query";
import { environmentThreadDetails } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { ReplyCardAction, ReplyCardFrame } from "./ReplyCardParts";
import { collectThreadIssueReferences } from "./issueTrackerRows.logic";
import {
  IssueAssigneeBadge,
  IssueDueDate,
  IssueStateBadge,
  IssueTrackerIcon,
} from "./IssueTrackerParts";
import {
  detectReplyCardRefs,
  replyCardId,
  resolveReplyCardRefs,
  selectReplyCards,
  threadReplyIssueKeys,
  type ReplyCardRef,
} from "./replyCards.logic";
import { ReplyPullRequestCard } from "./ReplyPullRequestCard";
import { TimelineRowActivityCtx, TimelineRowCtx, type TimelineRow } from "./timelineRowContext";

// Fork-only cards under finished agent replies; see CUSTOM_DEVELOPMENT.md.

type ThreadIssueIndex = ReadonlyMap<IssueKey, TrackerIssue>;

const EMPTY_INDEX: ThreadIssueIndex = new Map();

// One lookup for every key the thread's finished replies name, so cards never ask one by one.
// The timeline atom holds while a reply streams, and keys change only when a reply finishes.
const threadIssueIndexAtom = Atom.family((threadKey: string) => {
  const separator = threadKey.indexOf("\u0000");
  const environmentId = threadKey.slice(0, separator) as EnvironmentId;
  const threadRef = { environmentId, threadId: threadKey.slice(separator + 1) as ThreadId };
  let previous = EMPTY_INDEX;
  let previousIssues: ReadonlyArray<TrackerIssue> | undefined;
  return Atom.make((get): ThreadIssueIndex => {
    const items = get(environmentThreadDetails.timelineVisibleTurnItemsAtom(threadRef));
    const keys = threadReplyIssueKeys(items);
    if (keys.length === 0) return EMPTY_INDEX;
    const result = get(issueTrackerEnvironment.issues({ environmentId, input: { keys } }));
    const issues = AsyncResult.getOrElse(result, () => null)?.issues;
    if (issues === previousIssues) return previous;
    previousIssues = issues;
    previous = new Map(issues?.map((issue) => [issue.key, issue]));
    return previous;
  });
});

const threadIndexKey = (threadRef: ScopedThreadRef) =>
  `${threadRef.environmentId}\u0000${threadRef.threadId}`;

/** The thread's project repository when it lives on GitHub, for `PR #12`. */
function useThreadGitHubRepository(threadRef: ScopedThreadRef) {
  const thread = useQuietThreadShell(threadRef);
  const project = useProject(
    thread?.projectId ? { environmentId: thread.environmentId, projectId: thread.projectId } : null,
  );
  const identity = project?.repositoryIdentity;
  return {
    project,
    repository:
      identity?.provider === "github" ? sourceControlClients.repositorySelector(identity) : null,
  };
}

/** Cards for the issues and pull requests a finished reply names, below its text. */
export function ReplyCards({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const { threadRef } = use(TimelineRowCtx);
  const issues = useClientSettings((settings) => settings.replyCardsIssues);
  const pullRequests = useClientSettings((settings) => settings.replyCardsPullRequests);
  if (threadRef === null || row.message.streaming || (!issues && !pullRequests)) return null;
  const refs = detectReplyCardRefs(row.message.text);
  if (refs.length === 0) return null;
  return (
    <ReplyCardList
      threadRef={threadRef}
      refs={refs}
      runId={row.projectedItem?.item.runId ?? null}
      settings={{ issues, pullRequests }}
    />
  );
}

function ReplyCardList({
  threadRef,
  refs,
  runId,
  settings,
}: {
  threadRef: ScopedThreadRef;
  refs: ReadonlyArray<ReplyCardRef>;
  runId: string | null;
  settings: { readonly issues: boolean; readonly pullRequests: boolean };
}) {
  const activity = use(TimelineRowActivityCtx);
  const [expanded, setExpanded] = useState(false);
  const { project, repository } = useThreadGitHubRepository(threadRef);
  const index = useAtomValue(threadIssueIndexAtom(threadIndexKey(threadRef)));
  // Wait for the whole turn: a reply mid-turn is often superseded by the next one.
  if (activity.isWorking && runId !== null && runId === activity.latestRunId) return null;
  const resolved = resolveReplyCardRefs(refs, { settings, threadRepository: repository });
  const { visible, hiddenCount } = selectReplyCards(
    resolved,
    (key) => index.get(key),
    expanded ? Number.POSITIVE_INFINITY : undefined,
  );
  if (visible.length === 0) return null;
  return (
    <div className="mt-2 flex max-w-xl flex-col gap-1.5" data-reply-cards="true">
      {visible.map((ref) => (
        <ReplyCard
          key={replyCardId(ref)}
          cardRef={ref}
          threadRef={threadRef}
          index={index}
          projectId={project?.id ?? null}
        />
      ))}
      {hiddenCount > 0 || expanded ? (
        <div>
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show fewer" : `+${hiddenCount} more`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReplyCard({
  cardRef,
  threadRef,
  index,
  projectId,
}: {
  cardRef: ReplyCardRef;
  threadRef: ScopedThreadRef;
  index: ThreadIssueIndex;
  projectId: ProjectId | null;
}) {
  switch (cardRef.kind) {
    case "issue": {
      const issue = index.get(cardRef.key);
      return issue === undefined ? null : <ReplyIssueCard issue={issue} threadRef={threadRef} />;
    }
    case "pullRequest":
      return (
        <ReplyPullRequestCard cardRef={cardRef} threadRef={threadRef} threadProjectId={projectId} />
      );
  }
}

function ReplyIssueCard({ issue, threadRef }: { issue: TrackerIssue; threadRef: ScopedThreadRef }) {
  const trackerLabel = ISSUE_TRACKER_LABELS[issue.tracker];
  const openLink = useOpenLink(threadRef);
  const summaries = useEnvironmentQuery(
    issueTrackerEnvironment.threadSummaries({ environmentId: threadRef.environmentId, input: {} }),
  );
  const linked =
    summaries.data?.threads
      .find((summary) => summary.threadId === threadRef.threadId)
      ?.issues.some((linkedIssue) => linkedIssue.key === issue.key) ?? false;
  const mutate = useAtomCommand(issueTrackerEnvironment.mutate);
  const [linking, setLinking] = useState(false);

  const open = (event: ReactMouseEvent) => {
    openLink(issue.url, { event: { metaKey: event.metaKey, ctrlKey: event.ctrlKey } }).catch(() =>
      toastManager.add({ type: "error", title: `Could not open ${issue.key}` }),
    );
  };
  const link = async () => {
    setLinking(true);
    const result = await mutate({
      environmentId: threadRef.environmentId,
      input: { type: "link", threadId: threadRef.threadId, tracker: issue.tracker, key: issue.key },
    });
    setLinking(false);
    if (result._tag === "Success") {
      summaries.refresh();
      // The thread panel keys its query by the issues the thread's own messages name.
      const detected = collectThreadIssueReferences(readThreadTurnItems(threadRef));
      appAtomRegistry.refresh(
        issueTrackerEnvironment.threadIssues({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, detected },
        }),
      );
      toastManager.add({ type: "success", title: `Linked ${issue.key} to this thread` });
    }
  };

  return (
    <ReplyCardFrame
      icon={<IssueTrackerIcon tracker={issue.tracker} className="size-3.5" />}
      title={
        <>
          <span className="shrink-0 font-medium">{issue.key}</span>
          <span className="min-w-0 truncate">{issue.title}</span>
        </>
      }
      meta={
        <>
          <IssueStateBadge state={issue.state} className="min-w-0" />
          <IssueAssigneeBadge assignee={issue.assignee} className="min-w-0" />
          <IssueDueDate issue={issue} />
        </>
      }
      actions={
        <>
          {linked ? null : (
            <ReplyCardAction
              label={`Link ${issue.key} to this thread`}
              icon={<LinkIcon aria-hidden className="size-3.5" />}
              disabled={linking}
              onClick={() => void link()}
            />
          )}
          <ReplyCardAction
            label={`Open in ${trackerLabel}`}
            icon={<ExternalLinkIcon aria-hidden className="size-3.5" />}
            onClick={open}
          />
        </>
      }
    />
  );
}
