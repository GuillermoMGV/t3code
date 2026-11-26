import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import type { ModelSelection, ScopedProjectRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { BellIcon, CheckIcon, CopyIcon, ShuffleIcon, WrenchIcon } from "lucide-react";
import { useContext, useRef, useState } from "react";
import { RegistryContext } from "@effect/atom-react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { usePullRequestLinking } from "~/hooks/usePullRequestLinking";
import { newMessageId, newThreadId } from "~/lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { readProject, readThreadShells } from "~/state/entities";
import { readEnvironment, readEnvironmentProviders } from "~/state/environments";
import { gitEnvironment } from "~/state/git";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { slackEnvironment } from "~/state/slack";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
} from "../ui/anchoredCopyToast";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usePullRequestIssue } from "./PullRequestIssueBadges";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import {
  addressReviewPrompt,
  canAddressReview,
  pendingReviewers,
  pickReviewThread,
  reviewReminderMessage,
} from "./pullRequestReviewActions.logic";

// Fork-only "Address review" and "Remind reviewer" row actions; see CUSTOM_DEVELOPMENT.md.

const SLACK_SETTINGS_PATH = "/settings/issue-trackers";

/** The row's review shortcuts; renders nothing unless one applies. */
export function PullRequestReviewActions({ entry }: { entry: EnvironmentPullRequestEntry }) {
  const reviewers = pendingReviewers(entry);
  const addressable = canAddressReview(entry);
  if (!addressable && reviewers.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 pr-2">
      {addressable ? <AddressReviewButton entry={entry} /> : null}
      {reviewers.length > 0 ? <RemindReviewerButton entry={entry} logins={reviewers} /> : null}
    </div>
  );
}

const failureMessage = (result: AtomCommandResult<unknown, unknown>, fallback: string) => {
  if (result._tag !== "Failure") return null;
  if (isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : fallback;
};

/** The model a new thread in the project starts with, as the composer would pick it. */
function newThreadModelSelection(projectRef: ScopedProjectRef): ModelSelection | null {
  const project = readProject(projectRef);
  const settings = readEnvironment(projectRef.environmentId)?.serverConfig?.settings;
  const providers = readEnvironmentProviders(projectRef.environmentId) ?? [];
  const store = useComposerDraftStore.getState();
  const sticky =
    store.stickyActiveProvider === null
      ? null
      : (store.stickyModelSelectionByProvider[store.stickyActiveProvider] ?? null);
  const defaultSelection =
    (settings
      ? resolveProjectSettings(settings, projectRef.projectId, project ?? undefined).settings
          .defaultModelSelection
      : (project?.defaultModelSelection ?? null)) ??
    sticky ??
    (settings
      ? resolveProjectDefaultProviderModelSelection(providers, settings, projectRef.projectId)
      : null);
  const resolution = resolveNewThreadModelSelection({
    defaultSelection,
    fallbackSelection: settings?.fallbackModelSelection ?? null,
    providers,
    ...(settings ? { settings } : {}),
    projectId: projectRef.projectId,
    now: Date.now(),
  });
  return resolution.fallback ? resolution.selection : defaultSelection;
}

function useAddressReview(entry: EnvironmentPullRequestEntry) {
  const navigate = useNavigate();
  const registry = useContext(RegistryContext);
  const issue = usePullRequestIssue(entry);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const prepare = useAtomCommand(gitEnvironment.preparePullRequestThread, {
    reportFailure: false,
  });
  const linkIssue = useAtomCommand(issueTrackerEnvironment.mutate, { reportFailure: false });
  const linking = usePullRequestLinking(entry.environmentId);
  const handleNewThread = useNewThreadHandler();
  const { environmentId } = entry;
  const projectRef = scopeProjectRef(environmentId, entry.projectId);
  const text = addressReviewPrompt(entry);
  const message = () => ({
    messageId: newMessageId(),
    role: "user" as const,
    text,
    attachments: [],
  });

  const openThread = (threadId: Parameters<typeof scopeThreadRef>[1]) =>
    navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });

  const sendToExisting = async () => {
    const summaries = AsyncResult.getOrElse(
      registry.get(issueTrackerEnvironment.threadSummaries({ environmentId, input: {} })),
      () => null,
    );
    const issueThreadIds = new Set(
      issue === undefined
        ? []
        : (summaries?.threads ?? []).flatMap((summary) =>
            summary.issues.some(
              (linked) => linked.tracker === issue.tracker && linked.key === issue.key,
            )
              ? [summary.threadId]
              : [],
          ),
    );
    const thread = pickReviewThread(entry, readThreadShells(), issueThreadIds);
    if (thread === null) return false;
    const result = await startTurn({
      environmentId,
      input: {
        threadId: thread.id,
        message: message(),
        runtimeMode: thread.runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        createdAt: new Date().toISOString(),
      },
    });
    const failure = failureMessage(result, "Could not send the review to the thread.");
    if (failure !== null) toastManager.add({ type: "error", title: failure });
    if (result._tag === "Success") await openThread(thread.id);
    return true;
  };

  const startNew = async () => {
    const project = readProject(projectRef);
    if (project === null) {
      toastManager.add({ type: "error", title: "The pull request's project is not available." });
      return;
    }
    const threadId = newThreadId();
    const prepared = await prepare({
      environmentId,
      input: { cwd: project.workspaceRoot, reference: entry.url, mode: "worktree", threadId },
    });
    if (prepared._tag !== "Success") {
      const failure = failureMessage(prepared, "Could not check out the pull request.");
      if (failure !== null) toastManager.add({ type: "error", title: failure });
      return;
    }
    const { branch, worktreePath } = prepared.value;
    const modelSelection = newThreadModelSelection(projectRef);
    if (modelSelection === null) {
      // No model to start with: leave the prompt in a draft on the checkout for the user to send.
      await handleNewThread(projectRef, {
        branch,
        worktreePath,
        envMode: "worktree",
        prompt: text,
      });
      return;
    }
    const settings = readEnvironment(environmentId)?.serverConfig?.settings;
    const runtimeMode = settings
      ? resolveProjectSettings(settings, entry.projectId, project).settings.defaultRuntimeMode
      : DEFAULT_RUNTIME_MODE;
    const title = `Address review on #${entry.number}`;
    const createdAt = new Date().toISOString();
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: message(),
        modelSelection,
        titleSeed: deriveThreadTitleSeed({ text: title, attachments: [] }),
        runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId: entry.projectId,
            title,
            modelSelection,
            runtimeMode,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch,
            worktreePath,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (result._tag !== "Success") {
      const failure = failureMessage(result, "Could not start the thread.");
      if (failure !== null) toastManager.add({ type: "error", title: failure });
      return;
    }
    const threadRef = scopeThreadRef(environmentId, threadId);
    // Best effort: the thread exists either way, and its prompt names the pull request.
    if (linking.canLink(entry.url)) {
      linking.changeLink(threadRef, entry.url, true).catch((error: unknown) => {
        console.warn("Could not link the pull request to its review thread.", error);
      });
    }
    if (issue !== undefined) {
      void linkIssue({
        environmentId,
        input: { type: "link", threadId, tracker: issue.tracker, key: issue.key },
      }).then((linked) => {
        if (linked._tag === "Success") {
          registry.refresh(issueTrackerEnvironment.threadSummaries({ environmentId, input: {} }));
        }
      });
    }
    await openThread(threadId);
  };

  return async () => {
    if (!(await sendToExisting())) await startNew();
  };
}

function AddressReviewButton({ entry }: { entry: EnvironmentPullRequestEntry }) {
  const run = useAddressReview(entry);
  const [pending, setPending] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            aria-label={`Address review on #${entry.number}`}
            onClick={() => {
              setPending(true);
              void run().finally(() => setPending(false));
            }}
          />
        }
      >
        {pending ? <Spinner size="xs" /> : <WrenchIcon aria-hidden className="size-3" />}
        Address review
      </TooltipTrigger>
      <TooltipPopup>
        Ask the agent to apply the requested changes, in this pull request's thread or a new one
      </TooltipPopup>
    </Tooltip>
  );
}

function RemindReviewerButton({
  entry,
  logins,
}: {
  entry: EnvironmentPullRequestEntry;
  logins: ReadonlyArray<string>;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const slack = useEnvironmentQuery(
    slackEnvironment.state({ environmentId: entry.environmentId, input: {} }),
  );
  const notConnected = slack.data !== null && !slack.data.connected;
  const label = logins.length === 1 ? `Remind @${logins[0]}` : "Remind reviewer";
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && notConnected) {
          void navigate({ to: SLACK_SETTINGS_PATH });
          return;
        }
        setOpen(next);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button variant="outline" size="xs" aria-label={`${label} on Slack`} />}
            />
          }
        >
          <BellIcon aria-hidden className="size-3" />
          Remind
        </TooltipTrigger>
        <TooltipPopup>
          {notConnected ? "Connect Slack to remind reviewers" : `${label} on Slack`}
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" width="md" side="bottom">
        <ReminderForm entry={entry} logins={logins} onSent={() => setOpen(false)} />
      </PopoverPopup>
    </Popover>
  );
}

function ReminderForm({
  entry,
  logins,
  onSent,
}: {
  entry: EnvironmentPullRequestEntry;
  logins: ReadonlyArray<string>;
  onSent: () => void;
}) {
  const detail = useEnvironmentQuery(
    pullRequestEnvironment.detail({
      environmentId: entry.environmentId,
      input: {
        projectId: entry.projectId,
        host: entry.host,
        repository: entry.repository,
        number: entry.number,
      },
    }),
  );
  const nameOf = (login: string) =>
    detail.data?.reviewers.find((actor) => actor.login.toLowerCase() === login.toLowerCase())
      ?.name ?? null;
  const [login, setLogin] = useState(logins[0]!);
  const [edited, setEdited] = useState<string | null>(null);
  const [seed] = useState(() => Math.random());
  const generated = reviewReminderMessage(
    { login, name: nameOf(login), url: entry.url },
    () => seed,
  );
  const text = edited ?? generated;
  const [slackUser, setSlackUser] = useState("");
  const [needsSlackUser, setNeedsSlackUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onError: (copyError: Error) => showAnchoredCopyErrorToast(copyRef, copyError),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });
  const mutate = useAtomCommand(slackEnvironment.mutate, { reportFailure: false });

  const send = async () => {
    if (pending || text.trim().length === 0) return;
    setPending(true);
    setError(null);
    const result = await mutate({
      environmentId: entry.environmentId,
      input: {
        type: "remindReviewer",
        login,
        name: nameOf(login),
        text: text.trim(),
        ...(slackUser.trim().length > 0 ? { slackUser: slackUser.trim() } : {}),
      },
    });
    setPending(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: `Reminder sent to ${result.value.recipient ?? `@${login}`} on Slack`,
      });
      onSent();
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    if (
      typeof failure === "object" &&
      failure !== null &&
      "reason" in failure &&
      (failure.reason === "userNotFound" || failure.reason === "invalidInput")
    ) {
      setNeedsSlackUser(true);
    }
    setError(failure instanceof Error ? failure.message : "Slack did not answer. Try again.");
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="font-medium text-sm">Remind on Slack</p>
      {logins.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Reviewer">
          {logins.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              size="xs"
              variant={candidate === login ? "secondary" : "ghost"}
              role="radio"
              aria-checked={candidate === login}
              onClick={() => {
                setLogin(candidate);
                setEdited(null);
                setNeedsSlackUser(false);
                setError(null);
              }}
            >
              @{candidate}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">To @{login}</p>
      )}
      <Textarea
        aria-label="Message"
        value={text}
        rows={3}
        onChange={(event) => setEdited(event.target.value)}
      />
      {needsSlackUser ? (
        <label className="flex flex-col gap-1 text-muted-foreground text-xs">
          Slack email or member ID of @{login} (remembered for next time)
          <Input
            autoComplete="off"
            placeholder="name@company.com"
            value={slackUser}
            onChange={(event) => setSlackUser(event.target.value)}
          />
        </label>
      ) : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() =>
            setEdited(
              reviewReminderMessage(
                { login, name: nameOf(login), url: entry.url },
                Math.random,
                text,
              ),
            )
          }
        >
          <ShuffleIcon aria-hidden className="size-3" />
          Another message
        </Button>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  ref={copyRef}
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Copy message"
                  disabled={text.trim().length === 0}
                  onClick={() => copyToClipboard(text)}
                />
              }
            >
              {isCopied ? (
                <CheckIcon aria-hidden className="size-3 text-primary" />
              ) : (
                <CopyIcon aria-hidden className="size-3" />
              )}
            </TooltipTrigger>
            <TooltipPopup>
              <p>{isCopied ? "Copied" : "Copy message"}</p>
            </TooltipPopup>
          </Tooltip>
          <Button type="submit" size="xs" disabled={pending || text.trim().length === 0}>
            {pending ? <Spinner size="xs" /> : null}
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}
