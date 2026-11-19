import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type IssueTrackerKind,
  type ScheduledTask,
  type TrackerIssue,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { CalendarClockIcon, InboxIcon, TicketIcon, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { useProjects, useVisibleThreadShells } from "~/state/entities";
import { environmentAtomList, environmentIdsKey } from "~/state/environmentAtomList";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { usePullRequestHostList } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";
import { IssueDueDate, IssueStateBadge, IssueTrackerIcon } from "../chat/IssueTrackerParts";
import { useIssueSearch } from "../chat/useIssueSearch";
import { threadsForIssue } from "../issues/issuesPage.logic";
import {
  OpenThreadButton,
  StartThreadPicker,
  useProjectChoices,
  useStartIssueThread,
} from "../issues/IssueThreadActions";
import { useThreadsByIssue } from "../issues/useIssueThreads";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { PullRequestStateGlyph } from "../pullRequest/pullRequestPresentation";
import { usePullRequestScope } from "../pullRequest/usePullRequestListView";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { resolveThreadLastVisitedAt, resolveThreadStatusPill } from "../Sidebar.logic";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  isBusyPill,
  pullRequestsNeedingYou,
  sortByAttention,
  sortMyIssues,
  sortScheduledTasks,
  threadAttention,
  type Attention,
  type AttentionTone,
} from "./homeDashboard.logic";

// Fork-only home dashboard under the new-thread composer; see CUSTOM_DEVELOPMENT.md.

const VISIBLE_ROWS = 4;
const TONE_CLASS: Record<AttentionTone, string> = {
  urgent: "text-error-foreground",
  action: "text-info-foreground",
  info: "text-muted-foreground",
};
const NO_HOST_READS = new Map<EnvironmentId, never>();
const PR_SCOPE = { involvement: "all", state: "open" } as const;
const PR_LIMIT = 50;

/** What is waiting on the user: threads, issues, pull requests, and their scheduled tasks. */
export function HomeDashboard() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <NeedsYouCard />
      <MyIssuesCard />
      <PullRequestsCard />
      <ScheduledTasksCard />
    </div>
  );
}

function DashboardCard({
  icon: Icon,
  title,
  count,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: number | undefined;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border/70 bg-card/80 p-2.5">
      <header className="mb-1 flex h-6 items-center gap-1.5 px-1.5 font-medium text-muted-foreground text-xs">
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <h2>{title}</h2>
        {count ? <span className="tabular-nums">{count}</span> : null}
        {action ? <span className="ml-auto flex items-center">{action}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** The first rows, with the rest one click away so the card keeps its height. */
function CardRows<T>({
  items,
  render,
  empty,
}: {
  items: ReadonlyArray<T>;
  render: (item: T) => ReactNode;
  empty: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) {
    return <p className="px-1.5 py-1.5 text-muted-foreground/80 text-xs">{empty}</p>;
  }
  const shown = expanded ? items : items.slice(0, VISIBLE_ROWS);
  const hidden = items.length - shown.length;
  return (
    <ul className="flex min-w-0 flex-col">
      {shown.map(render)}
      {hidden > 0 || expanded ? (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="px-1.5 py-1 text-muted-foreground text-xs hover:text-foreground"
          >
            {expanded ? "Show fewer" : `+${hidden} more`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

const ROW_CLASS =
  "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset";

function AttentionLabel({ attention }: { attention: Attention }) {
  return (
    <span className={cn("shrink-0 text-xs", TONE_CLASS[attention.tone])}>{attention.label}</span>
  );
}

function ViewAllLink({ to, label }: { to: "/issues" | "/pull-requests"; label: string }) {
  return (
    <Link to={to} className="font-normal text-muted-foreground/80 hover:text-foreground">
      {label}
    </Link>
  );
}

function NeedsYouCard() {
  const threads = useVisibleThreadShells();
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const nowMs = Date.parse(useNowMinute());
  const navigate = useNavigate();
  const projectTitles = useProjectTitles();
  let working = 0;
  const rows: Array<{ thread: EnvironmentThreadShell; attention: Attention }> = [];
  for (const thread of threads) {
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      localVisits[scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id })],
    );
    const pill = resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } });
    const attention = threadAttention(thread, pill, nowMs);
    if (attention !== null) rows.push({ thread, attention });
    else if (isBusyPill(pill) && thread.archivedAt === null) working += 1;
  }
  const sorted = sortByAttention(rows, ({ thread }) => Date.parse(thread.updatedAt));
  return (
    <DashboardCard
      icon={InboxIcon}
      title="Needs you"
      count={sorted.length}
      action={working > 0 ? <span className="font-normal">{working} working</span> : undefined}
    >
      <CardRows
        items={sorted}
        empty="Nothing is waiting on you."
        render={({ thread, attention }) => (
          <li key={`${thread.environmentId}:${thread.id}`}>
            <button
              type="button"
              className={ROW_CLASS}
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams({
                    environmentId: thread.environmentId,
                    threadId: thread.id,
                  }),
                })
              }
            >
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              <span className="hidden max-w-24 shrink-0 truncate text-muted-foreground/70 text-xs md:inline">
                {projectTitles.get(`${thread.environmentId}:${thread.projectId}`)}
              </span>
              <AttentionLabel attention={attention} />
            </button>
          </li>
        )}
      />
    </DashboardCard>
  );
}

function useProjectTitles(): ReadonlyMap<string, string> {
  const projects = useProjects();
  return new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title] as const),
  );
}

function MyIssuesCard() {
  const environmentId = usePrimaryEnvironmentId();
  const connections = useEnvironmentQuery(
    environmentId === null
      ? null
      : issueTrackerEnvironment.connections({ environmentId, input: {} }),
  );
  const connected = (tracker: IssueTrackerKind) =>
    connections.data?.trackers.some((entry) => entry.tracker === tracker && entry.connected) ??
    false;
  // An empty query lists the issues assigned to the user that are still open.
  const linear = useIssueSearch(connected("linear") ? environmentId : null, "linear", "", "mine");
  const jira = useIssueSearch(connected("jira") ? environmentId : null, "jira", "", "mine");
  const now = new Date(useNowMinute());
  const issues = sortMyIssues([...linear.issues, ...jira.issues], now);
  const threadsByIssue = useThreadsByIssue();
  const projectChoices = useProjectChoices();
  const startThread = useStartIssueThread();
  const openLink = useOpenLink(null);
  if (environmentId === null || !(connected("linear") || connected("jira"))) return null;
  const error = linear.error ?? jira.error;
  return (
    <DashboardCard
      icon={TicketIcon}
      title="My issues"
      count={issues.length}
      action={<ViewAllLink to="/issues" label="All issues" />}
    >
      <CardRows
        items={issues}
        empty={
          error
            ? "Could not load your issues."
            : linear.searching || jira.searching
              ? "Loading…"
              : "No issues waiting on you."
        }
        render={(issue: TrackerIssue) => {
          const threads = threadsForIssue(threadsByIssue, issue);
          return (
            <li
              key={`${issue.tracker}:${issue.key}`}
              className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-sm"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={(event) =>
                          void openLink(issue.url, {
                            event: { metaKey: event.metaKey, ctrlKey: event.ctrlKey },
                          }).catch(() =>
                            toastManager.add({
                              type: "error",
                              title: `Could not open ${issue.key}`,
                            }),
                          )
                        }
                        className="flex w-full min-w-0 items-center gap-1.5 text-left hover:underline"
                      />
                    }
                  >
                    <IssueTrackerIcon
                      tracker={issue.tracker}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                      {issue.key}
                    </span>
                    <span className="min-w-0 truncate">{issue.title}</span>
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    {issue.key}: {issue.title}
                  </TooltipPopup>
                </Tooltip>
                <div className="flex min-w-0 items-center gap-3 pl-5 text-muted-foreground text-xs">
                  <IssueStateBadge state={issue.state} className="max-w-32" />
                  <IssueDueDate issue={issue} className="shrink-0" />
                </div>
              </div>
              {threads.length === 0 ? (
                <StartThreadPicker
                  issueKey={issue.key}
                  choices={projectChoices}
                  onPick={(projectRef) => void startThread(issue, projectRef)}
                />
              ) : (
                <OpenThreadButton threads={threads} />
              )}
            </li>
          );
        }}
      />
    </DashboardCard>
  );
}

function PullRequestsCard() {
  const { environmentQueries } = usePullRequestScope(PR_SCOPE, NO_HOST_READS);
  const targets = (involvement: "authored" | "reviewing") =>
    environmentQueries.map(({ environmentId, projectIds }) => ({
      environmentId,
      input: {
        state: "open" as const,
        involvement,
        limit: PR_LIMIT,
        ...(projectIds ? { projectIds } : {}),
      },
    }));
  const authored = usePullRequestHostList(targets("authored"));
  const reviewing = usePullRequestHostList(targets("reviewing"));
  const navigate = useNavigate();
  if (environmentQueries.length === 0) return null;
  const rows = sortByAttention(
    pullRequestsNeedingYou(authored.data?.entries ?? [], reviewing.data?.entries ?? []),
    ({ entry }) => Date.parse(entry.updatedAt),
  );
  const loading = authored.isPending || reviewing.isPending;
  const open = (entry: EnvironmentPullRequestEntry) =>
    void navigate({
      to: "/pull-requests",
      search: {
        ...readPullRequestListPreferences(),
        repository: entry.repository,
        number: entry.number,
        selectedProjectId: entry.projectId,
        selectedEnvironmentId: entry.environmentId,
        selectedHost: entry.host,
      },
    });
  return (
    <DashboardCard
      icon={PullRequestGlyph.pullRequest}
      title="Pull requests"
      count={rows.length}
      action={<ViewAllLink to="/pull-requests" label="All PRs" />}
    >
      <CardRows
        items={rows}
        empty={
          rows.length === 0 && loading
            ? "Loading…"
            : authored.error || reviewing.error
              ? "Could not load pull requests."
              : "No pull requests waiting on you."
        }
        render={({ entry, attention }) => (
          <li key={`${entry.environmentId}:${entry.url}`}>
            <Tooltip>
              <TooltipTrigger
                render={<button type="button" className={ROW_CLASS} onClick={() => open(entry)} />}
              >
                <PullRequestStateGlyph
                  state={entry.state}
                  isDraft={entry.isDraft}
                  className="size-3.5 shrink-0"
                />
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  #{entry.number}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <AttentionLabel attention={attention} />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {entry.repository}#{entry.number}: {entry.title}
                {entry.author ? ` Â· ${entry.author.name ?? entry.author.login}` : ""}
              </TooltipPopup>
            </Tooltip>
          </li>
        )}
      />
    </DashboardCard>
  );
}

const homeScheduledTasksAtom = environmentAtomList("fork-home-scheduled-tasks", (environmentId) =>
  serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
);

function ScheduledTasksCard() {
  const { environments } = useEnvironments();
  const connectedIds = environments.flatMap((environment) =>
    environment.connection.phase === "connected" && environment.serverConfig !== null
      ? [environment.environmentId]
      : [],
  );
  const queries = useAtomValue(homeScheduledTasksAtom(environmentIdsKey(connectedIds)));
  const projectTitles = useProjectTitles();
  const rows = connectedIds.flatMap((environmentId, index) => {
    const data = AsyncResult.getOrElse(queries[index]!, () => null);
    return sortScheduledTasks(data?.tasks ?? []).map((task) => ({
      environmentId,
      task,
      timeZone: data?.timeZone,
    }));
  });
  if (rows.length === 0) return null;
  const active = rows.filter(({ task }) => task.enabled).length;
  return (
    <DashboardCard
      icon={CalendarClockIcon}
      title="Scheduled tasks"
      count={active}
      action={
        <Link
          to="/settings/scheduled-tasks"
          className="font-normal text-muted-foreground/80 hover:text-foreground"
        >
          Manage
        </Link>
      }
    >
      <CardRows
        items={rows}
        empty=""
        render={({ environmentId, task, timeZone }) => (
          <ScheduledTaskRow
            key={`${environmentId}:${task.id}`}
            environmentId={environmentId}
            task={task}
            timeZone={timeZone}
            projectTitle={projectTitles.get(`${environmentId}:${task.projectId}`) ?? null}
          />
        )}
      />
    </DashboardCard>
  );
}

function ScheduledTaskRow({
  environmentId,
  task,
  timeZone,
  projectTitle,
}: {
  environmentId: EnvironmentId;
  task: ScheduledTask;
  timeZone: string | undefined;
  projectTitle: string | null;
}) {
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "scheduled task enabled",
  });
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const setEnabled = async (enabled: boolean) => {
    if (busy || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    setBusy(true);
    const result = await toggle({ environmentId, input: { id: task.id, enabled } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not update scheduled task",
        description: String(squashAtomCommandFailure(result)),
      });
    }
  };
  const status = !task.enabled
    ? "Paused"
    : task.blockedByPolicy !== undefined
      ? task.blockedByPolicy
      : task.nextRunAt
        ? `Next ${formatNextRun(task.nextRunAt)}`
        : scheduleLabel(task.schedule, timeZone, task.nextRunAt);
  const threadId = task.threadId;
  return (
    <li className="flex h-8 min-w-0 items-center gap-2 px-1.5 text-sm">
      <Switch
        size="sm"
        checked={task.enabled}
        disabled={busy || !canOperate}
        aria-label={`${task.enabled ? "Pause" : "Resume"} ${task.title}`}
        onCheckedChange={(checked) => void setEnabled(checked)}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={threadId === null}
              onClick={() => {
                if (threadId === null) return;
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams({ environmentId, threadId }),
                });
              }}
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                threadId !== null && "hover:underline",
                !task.enabled && "text-muted-foreground",
              )}
            />
          }
        >
          {task.title}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {scheduleLabel(task.schedule, timeZone, task.nextRunAt)}
          {projectTitle ? ` Â· ${projectTitle}` : ""}
          {task.lastRunAt ? ` Â· Last run ${formatRelativeTimeLabel(task.lastRunAt)}` : ""}
        </TooltipPopup>
      </Tooltip>
      {task.lastRunStatus === "failed" ? (
        <span className="shrink-0 text-error-foreground text-xs">Last run failed</span>
      ) : null}
      <span className="max-w-32 shrink-0 truncate text-muted-foreground text-xs">{status}</span>
    </li>
  );
}

function formatNextRun(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}
