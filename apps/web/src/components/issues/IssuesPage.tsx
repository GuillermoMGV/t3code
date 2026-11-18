import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  ISSUE_TRACKER_LABELS,
  type EnvironmentId,
  type IssueTrackerKind,
  type ScopedProjectRef,
  type TrackerIssue,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  FolderIcon,
  ListFilterIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import { useContext, useState, type MouseEvent as ReactMouseEvent } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useScratchProject } from "~/hooks/useScratchProject";
import { buildSidebarProjectPickerEntries } from "~/sidebarProjectGrouping";
import { useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { issueTrackerEnvironment, threadIssuesAtom } from "~/state/issueTrackers";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { IssueAssigneeBadge, IssueStateBadge, IssueTrackerIcon } from "../chat/IssueTrackerParts";
import { useIssueSearch } from "../chat/useIssueSearch";
import { useSortedProjectGroups } from "../CommandPaletteLookups";
import { ProjectFavicon } from "../ProjectFavicon";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toggleFilterValue } from "../sidebar/sidebarIssueFilter.logic";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  defaultIssueListFilter,
  filterIssues,
  ISSUE_ASSIGNEE_GROUPS,
  IssueListFilter,
  issueListFilterStorageKey,
  issueProjectOptions,
  issueStateOptions,
  issueThreadPrompt,
  resolveIssuesTracker,
  threadsByIssue,
  threadsForIssue,
} from "./issuesPage.logic";
import { IssuePullRequestsLine, useIssuePullRequests } from "./IssuePullRequests";

// Fork-only Issues page (start a thread from a Linear or Jira issue); see CUSTOM_DEVELOPMENT.md.

const SETTINGS_PATH = "/settings/issue-trackers";

const PASTE_EXAMPLES: Readonly<Record<IssueTrackerKind, string>> = {
  linear: "https://linear.app/…/issue/PRO-123",
  jira: "https://…atlassian.net/browse/PRO-123",
};

export function IssuesPage() {
  // Credentials live on the server; the primary one is the one Settings configures.
  const environmentId = usePrimaryEnvironmentId();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron} className="bg-background">
        <WorkspaceBreadcrumb ariaLabel="Issues breadcrumb">
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate">Issues</h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="wide" className="gap-3">
          {environmentId === null ? (
            <IssuesUnavailable description="Connect to a T3 Code server to see its issues." />
          ) : (
            <IssueTrackerTabs environmentId={environmentId} />
          )}
        </WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}

function IssueTrackerTabs({ environmentId }: { environmentId: EnvironmentId }) {
  const search = useSearch({ from: "/_chat/issues" });
  const navigate = useNavigate({ from: "/issues" });
  const connections = useEnvironmentQuery(
    issueTrackerEnvironment.connections({ environmentId, input: {} }),
  );
  if (connections.data === null) {
    return connections.error === null ? (
      <Spinner aria-label="Loading issue trackers" />
    ) : (
      <IssuesUnavailable description={connections.error} />
    );
  }
  const trackers = connections.data.trackers;
  const tracker = resolveIssuesTracker(trackers, search.tracker);
  if (tracker === null) {
    return (
      <IssuesUnavailable description="Connect Linear or Jira in Settings to list your issues and start threads from them." />
    );
  }
  const connected = trackers.filter((connection) => connection.connected);
  return (
    <>
      {connected.length > 1 ? (
        <ToggleGroup
          aria-label="Issue tracker"
          value={[tracker]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "linear" || value === "jira")
              void navigate({ search: { tracker: value } });
          }}
        >
          {connected.map((connection) => (
            <Toggle key={connection.tracker} value={connection.tracker}>
              <IssueTrackerIcon tracker={connection.tracker} />
              {ISSUE_TRACKER_LABELS[connection.tracker]}
            </Toggle>
          ))}
        </ToggleGroup>
      ) : null}
      {/* A new tracker starts a new search. */}
      <IssueList
        key={tracker}
        environmentId={environmentId}
        tracker={tracker}
        me={connected.find((connection) => connection.tracker === tracker)?.account ?? null}
      />
    </>
  );
}

function IssuesUnavailable({ description }: { description: string }) {
  const navigate = useNavigate();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No issues to show</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline" onClick={() => void navigate({ to: SETTINGS_PATH })}>
          <SettingsIcon aria-hidden />
          Issue tracker settings
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** The threads already linked to each issue, from the links the thread list loads anyway. */
function useThreadsByIssue() {
  const threads = useThreadShells();
  const environmentIds = [...new Set(threads.map((thread) => thread.environmentId))].toSorted();
  const threadIssues = useAtomValue(threadIssuesAtom(environmentIds));
  return threadsByIssue(threadIssues, threads);
}

function IssueList({
  environmentId,
  tracker,
  me,
}: {
  environmentId: EnvironmentId;
  tracker: IssueTrackerKind;
  /** The connected account's name, which is how the tracker names the user as an assignee. */
  me: string | null;
}) {
  const label = ISSUE_TRACKER_LABELS[tracker];
  const [draft, setDraft] = useState("");
  // Remembered per tracker in this browser, like the Pull requests page's filters.
  const [filter, setFilter] = useLocalStorage(
    issueListFilterStorageKey(tracker),
    defaultIssueListFilter(tracker),
    IssueListFilter,
  );
  const {
    query,
    issues: found,
    searching,
    error,
  } = useIssueSearch(environmentId, tracker, draft, "recent", filter);
  const options = useEnvironmentQuery(
    issueTrackerEnvironment.filterOptions({ environmentId, input: { tracker } }),
  ).data;
  const pullRequestsByKey = useIssuePullRequests();
  const issues = filterIssues(found, filter, me);
  const threadsByIssueKey = useThreadsByIssue();
  const projectChoices = useProjectChoices();
  const startThread = useStartIssueThread();
  return (
    <>
      <div className="flex items-center gap-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            {searching ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder={`Search ${label} issues, or paste ${PASTE_EXAMPLES[tracker]}`}
            aria-label={`Search ${label} issues`}
          />
        </InputGroup>
        <IssueProjectMenu
          filter={filter}
          onFilter={setFilter}
          projectOptions={issueProjectOptions(options?.projects ?? [], found, filter)}
        />
        <IssueFiltersMenu
          filter={filter}
          onFilter={setFilter}
          stateOptions={issueStateOptions(options?.states ?? [], found, filter)}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {query === "" ? "Recently updated issues" : `Results for “${query}”`}
        {issues.length < found.length
          ? ` · ${found.length - issues.length} hidden by filters`
          : null}
      </p>
      {error !== null ? <p className="text-destructive text-sm">{error}</p> : null}
      <ul aria-label={`${label} issues`} className="flex flex-col">
        {issues.map((issue) => (
          <IssueRow
            key={issue.key}
            issue={issue}
            threads={threadsForIssue(threadsByIssueKey, issue)}
            pullRequests={pullRequestsByKey.get(issue.key) ?? []}
            projectChoices={projectChoices}
            onStart={(projectRef) => void startThread(issue, projectRef)}
          />
        ))}
      </ul>
      {!searching && error === null && issues.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {found.length === 0 ? "No issues found." : "No issues match the filters."}
        </p>
      ) : null}
    </>
  );
}

/**
 * Opens a new-worktree draft whose prompt names the issue; the user reviews and sends it. The
 * issue is linked right away: detection from the prompt only runs while the thread's details
 * panel is open, and the link is what turns this row into "Go to thread".
 */
function useStartIssueThread() {
  const handleNewThread = useNewThreadHandler();
  const mutate = useAtomCommand(issueTrackerEnvironment.mutate, { reportFailure: false });
  const registry = useContext(RegistryContext);
  return async (issue: TrackerIssue, projectRef: ScopedProjectRef) => {
    const opened = await handleNewThread(projectRef, {
      prompt: issueThreadPrompt(issue),
      envMode: "worktree",
    });
    if (opened === null) return;
    const { environmentId } = projectRef;
    const result = await mutate({
      environmentId,
      input: { type: "link", threadId: opened.threadId, tracker: issue.tracker, key: issue.key },
    });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "warning",
        title: `Could not link ${issue.key} to the new thread`,
        description: "The prompt's issue URL still links it once the thread is open.",
      });
      return;
    }
    registry.refresh(issueTrackerEnvironment.threadSummaries({ environmentId, input: {} }));
  };
}

interface ProjectChoice {
  readonly value: string;
  readonly label: string;
  readonly projectRef: ScopedProjectRef;
  readonly group: Parameters<typeof ProjectFavicon>[0]["project"];
}

/** The projects the draft hero's picker offers, in sidebar order, without the no-project home. */
function useProjectChoices(): ReadonlyArray<ProjectChoice> {
  const { environments } = useEnvironments();
  const { scratchWorkspaceRootFor } = useScratchProject();
  const groups = useSortedProjectGroups(
    new Map(environments.map((environment) => [environment.environmentId, environment.label])),
  );
  return buildSidebarProjectPickerEntries({
    groups: pickableProjectGroups(groups),
    preferredProjectRef: null,
  }).flatMap(({ group, targetProject }) =>
    isScratchProject(targetProject, scratchWorkspaceRootFor(targetProject.environmentId))
      ? []
      : [
          {
            value: group.projectKey,
            label: group.displayName,
            projectRef: scopeProjectRef(targetProject.environmentId, targetProject.id),
            group,
          },
        ],
  );
}

function IssueRow({
  issue,
  threads,
  pullRequests,
  projectChoices,
  onStart,
}: {
  issue: TrackerIssue;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  pullRequests: ReadonlyArray<EnvironmentPullRequestEntry>;
  projectChoices: ReadonlyArray<ProjectChoice>;
  onStart: (projectRef: ScopedProjectRef) => void;
}) {
  const openLink = useOpenLink(null);
  const openIssue = (event: ReactMouseEvent) => {
    event.preventDefault();
    openLink(issue.url, { event: { metaKey: event.metaKey, ctrlKey: event.ctrlKey } }).catch(() =>
      toastManager.add({ type: "error", title: `Could not open ${issue.key}` }),
    );
  };
  return (
    <li className="flex min-w-0 items-center gap-3 border-border/60 border-b py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2 text-sm">
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            onClick={openIssue}
            aria-label={`Open ${issue.key} in ${ISSUE_TRACKER_LABELS[issue.tracker]}`}
            className="shrink-0 text-muted-foreground text-xs tabular-nums underline-offset-2 hover:text-foreground hover:underline"
          >
            {issue.key}
          </a>
          <span className="min-w-0 truncate">{issue.title}</span>
        </div>
        <div className="flex min-w-0 items-center gap-3 text-muted-foreground text-xs">
          <IssueStateBadge state={issue.state} className="shrink-0" />
          <IssueAssigneeBadge assignee={issue.assignee} />
          {issue.project ? <IssueProject project={issue.project} /> : null}
          {issue.priorityLabel ? <span className="shrink-0">{issue.priorityLabel}</span> : null}
          <span className="shrink-0">Updated {formatRelativeTimeLabel(issue.updatedAt)}</span>
        </div>
        {pullRequests.length > 0 ? <IssuePullRequestsLine entries={pullRequests} /> : null}
      </div>
      {threads.length === 0 ? (
        <StartThreadPicker issueKey={issue.key} choices={projectChoices} onPick={onStart} />
      ) : (
        <OpenThreadButton threads={threads} />
      )}
    </li>
  );
}

function OpenThreadButton({ threads }: { threads: ReadonlyArray<EnvironmentThreadShell> }) {
  const navigate = useNavigate();
  const open = (thread: EnvironmentThreadShell) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams({ environmentId: thread.environmentId, threadId: thread.id }),
    });
  const [latest] = threads;
  if (latest === undefined) return null;
  if (threads.length === 1) {
    return (
      <Button size="xs" variant="outline" className="shrink-0" onClick={() => open(latest)}>
        <ArrowRightIcon aria-hidden />
        Go to thread
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="xs" variant="outline" className="shrink-0" />}
        aria-label={`Open one of ${threads.length} threads`}
      >
        <ArrowRightIcon aria-hidden />
        Go to thread
        <ChevronDownIcon aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end" className="max-w-80">
        {threads.map((thread) => (
          <MenuItem key={`${thread.environmentId}:${thread.id}`} onClick={() => open(thread)}>
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {formatRelativeTimeLabel(thread.updatedAt)}
            </span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function StartThreadPicker({
  issueKey,
  choices,
  onPick,
}: {
  issueKey: string;
  choices: ReadonlyArray<ProjectChoice>;
  onPick: (projectRef: ScopedProjectRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const filter = useComboboxFilter();
  const search = pickerQuery.trim();
  const filtered =
    search.length === 0
      ? choices
      : choices.filter((choice) => filter.contains(choice, search, (item) => item.label));
  return (
    <Combobox
      items={choices}
      filteredItems={filtered}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setPickerQuery("");
      }}
      value={null}
      onValueChange={(item) => {
        if (!item) return;
        setOpen(false);
        onPick(item.projectRef);
      }}
    >
      <ComboboxTrigger
        render={<Button size="xs" variant="outline" className="shrink-0" />}
        disabled={choices.length === 0}
        aria-label={`Start a thread for ${issueKey}`}
      >
        <PlusIcon aria-hidden />
        Start thread
      </ComboboxTrigger>
      <ComboboxPopup align="end" className="w-72 overflow-hidden">
        <ComboboxSearchInput
          aria-label="Search projects"
          placeholder="Start in project…"
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
        />
        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
        <ComboboxList>
          {(item: ProjectChoice) => (
            <ComboboxItem key={item.value} hideIndicator value={item}>
              <ProjectFavicon project={item.group} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

function IssueProjectMenu({
  filter,
  onFilter,
  projectOptions,
}: {
  filter: IssueListFilter;
  onFilter: (filter: IssueListFilter) => void;
  projectOptions: ReadonlyArray<string>;
}) {
  const chosen = filter.projects;
  const label =
    chosen.length === 0
      ? "All projects"
      : chosen.length === 1
        ? chosen[0]!
        : `${chosen.length} projects`;
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="sm" variant="outline" className="max-w-56 shrink-0" />}
        aria-label={`Project filter: ${label}`}
      >
        <FolderIcon aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end" className="max-h-96 w-64 overflow-y-auto">
        <MenuCheckboxItem
          checked={chosen.length === 0}
          onCheckedChange={() => onFilter({ ...filter, projects: [] })}
        >
          All projects
        </MenuCheckboxItem>
        {projectOptions.length > 0 ? <MenuSeparator /> : null}
        {projectOptions.map((project) => (
          <MenuCheckboxItem
            key={project}
            checked={chosen.includes(project)}
            onCheckedChange={() =>
              onFilter({ ...filter, projects: toggleFilterValue(chosen, project) })
            }
          >
            {project}
          </MenuCheckboxItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/** Assignee and state; the project has its own menu beside it. */
function IssueFiltersMenu({
  filter,
  onFilter,
  stateOptions,
}: {
  filter: IssueListFilter;
  onFilter: (filter: IssueListFilter) => void;
  stateOptions: ReadonlyArray<string>;
}) {
  const count = filter.states.length + filter.assignees.length;
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="sm" variant="outline" className="shrink-0" />}
        aria-label={count === 0 ? "Filter issues" : `Filter issues (${count} active)`}
      >
        <ListFilterIcon aria-hidden />
        {count === 0 ? "Filters" : `Filters · ${count}`}
      </MenuTrigger>
      <MenuPopup align="end" className="max-h-96 w-60 overflow-y-auto">
        <MenuGroup>
          <MenuGroupLabel>Assignee</MenuGroupLabel>
          {ISSUE_ASSIGNEE_GROUPS.map(({ value, label }) => (
            <MenuCheckboxItem
              key={value}
              checked={filter.assignees.includes(value)}
              onCheckedChange={() =>
                onFilter({ ...filter, assignees: toggleFilterValue(filter.assignees, value) })
              }
            >
              {label}
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        {stateOptions.length > 0 ? (
          <MenuGroup>
            <MenuGroupLabel>State</MenuGroupLabel>
            {stateOptions.map((state) => (
              <MenuCheckboxItem
                key={state}
                checked={filter.states.includes(state)}
                onCheckedChange={() =>
                  onFilter({ ...filter, states: toggleFilterValue(filter.states, state) })
                }
              >
                {state}
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
        ) : null}
        {count > 0 ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onFilter({ ...filter, states: [], assignees: [] })}>
              Clear filters
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function IssueProject({ project }: { project: NonNullable<TrackerIssue["project"]> }) {
  const openLink = useOpenLink(null);
  const content = (
    <>
      <FolderIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{project.name}</span>
    </>
  );
  const url = project.url;
  if (url === null) {
    return <span className="inline-flex min-w-0 items-center gap-1">{content}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open project ${project.name}`}
      onClick={(event) => {
        event.preventDefault();
        openLink(url, { event: { metaKey: event.metaKey, ctrlKey: event.ctrlKey } }).catch(() =>
          toastManager.add({ type: "error", title: `Could not open ${project.name}` }),
        );
      }}
      className="inline-flex min-w-0 items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
    >
      {content}
    </a>
  );
}
