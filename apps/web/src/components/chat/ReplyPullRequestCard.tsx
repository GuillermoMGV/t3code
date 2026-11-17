import { useAtomValue } from "@effect/atom-react";
import { resolvePullRequestPreviewTarget } from "@t3tools/client-runtime/change-request-links";
import type { ProjectId, PullRequestRef, ScopedThreadRef, ServerConfig } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { useOpenChangeRequestLink } from "~/lib/openPullRequestLink";
import { useProjects } from "~/state/entities";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { PullRequestChecksPopover } from "../pullRequest/PullRequestChecksPopover";
import {
  PullRequestIssueBadges,
  PullRequestIssuesProvider,
  PullRequestTargetBranches,
} from "../pullRequest/PullRequestIssueBadges";
import {
  PullRequestStateGlyph,
  pullRequestChecksState,
} from "../pullRequest/pullRequestPresentation";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { toastManager } from "../ui/toast";
import type { ReplyCardRef } from "./replyCards.logic";
import { ReplyCardAction, ReplyCardFrame } from "./ReplyCardParts";

// Fork-only cards under finished agent replies; see CUSTOM_DEVELOPMENT.md.

const hasServerConfig = (config: ServerConfig | null) => config !== null;

/** The pull request's state, branches, checks and issue, read like the pull requests page. */
export function ReplyPullRequestCard({
  cardRef,
  threadRef,
  threadProjectId,
}: {
  cardRef: Extract<ReplyCardRef, { kind: "pullRequest" }>;
  threadRef: ScopedThreadRef;
  threadProjectId: ProjectId | null;
}) {
  const { environmentId } = threadRef;
  const projects = useProjects();
  const pullRequestsEnabled = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
    hasServerConfig,
  );
  const repository = cardRef.repository ?? "";
  // A link names its project by URL; `PR #12` already means the thread's project.
  const reference: PullRequestRef | null =
    cardRef.url !== null
      ? (resolvePullRequestPreviewTarget({
          environmentId,
          projects,
          pullRequestsEnabled,
          url: cardRef.url,
        })?.input ?? null)
      : threadProjectId !== null && pullRequestsEnabled
        ? { projectId: threadProjectId, repository, number: cardRef.number }
        : null;
  const { data: detail } = useEnvironmentQuery(
    reference === null ? null : pullRequestEnvironment.detail({ environmentId, input: reference }),
  );
  const url =
    detail?.url ?? cardRef.url ?? `https://github.com/${repository}/pull/${cardRef.number}`;
  const openChangeRequestLink = useOpenChangeRequestLink(threadRef);
  const openLink = useOpenLink(threadRef);
  const open = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (openChangeRequestLink(event, url, undefined, environmentId)) return;
    openLink(url, { event: { metaKey: event.metaKey, ctrlKey: event.ctrlKey } }).catch(() =>
      toastManager.add({ type: "error", title: `Could not open #${cardRef.number}` }),
    );
  };
  const action = (
    <ReplyCardAction
      label="Open pull request"
      icon={<ExternalLinkIcon aria-hidden className="size-3.5" />}
      onClick={open}
    />
  );

  // Not one of the server's projects, still loading, or unreadable: the link is all there is.
  if (detail === null || reference === null) {
    return (
      <ReplyCardFrame
        icon={<PullRequestGlyph.pullRequest aria-hidden className="size-3.5" />}
        title={<span className="min-w-0 truncate">{`${repository} #${cardRef.number}`}</span>}
        meta={<span>Pull request</span>}
        actions={action}
      />
    );
  }

  const checksState = pullRequestChecksState(detail.checks);
  const issueEntry = { environmentId, title: detail.title, headBranch: detail.headBranch };
  return (
    <ReplyCardFrame
      icon={
        <PullRequestStateGlyph state={detail.state} isDraft={detail.isDraft} className="size-3.5" />
      }
      title={
        <>
          <span className="min-w-0 truncate">{detail.title}</span>
          <span className="shrink-0 text-muted-foreground">#{detail.number}</span>
        </>
      }
      meta={
        <>
          <PullRequestTargetBranches head={detail.headBranch} base={detail.baseBranch} />
          {checksState === null ? null : (
            <PullRequestChecksPopover
              checksState={checksState}
              checks={detail.checks}
              environmentId={environmentId}
              reference={reference}
              threadRef={threadRef}
            />
          )}
          <PullRequestIssuesProvider groups={[{ entries: [issueEntry] }]}>
            <PullRequestIssueBadges entry={issueEntry} />
          </PullRequestIssuesProvider>
        </>
      }
      actions={action}
    />
  );
}
