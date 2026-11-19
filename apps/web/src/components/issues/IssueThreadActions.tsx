import { RegistryContext } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { ScopedProjectRef, TrackerIssue } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { useContext, useState } from "react";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { buildSidebarProjectPickerEntries } from "~/sidebarProjectGrouping";
import { useEnvironments } from "~/state/environments";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useSortedProjectGroups } from "../CommandPaletteLookups";
import { ProjectFavicon } from "../ProjectFavicon";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { issueThreadPrompt } from "./issuesPage.logic";

// Fork-only: start or open an issue's thread, shared by the Issues page and the home dashboard;
// see CUSTOM_DEVELOPMENT.md.

/**
 * Opens a new-worktree draft whose prompt names the issue; the user reviews and sends it. The
 * issue is linked right away: detection from the prompt only runs while the thread's details
 * panel is open, and the link is what turns this row into "Go to thread".
 */
export function useStartIssueThread() {
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

export interface ProjectChoice {
  readonly value: string;
  readonly label: string;
  readonly projectRef: ScopedProjectRef;
  readonly group: Parameters<typeof ProjectFavicon>[0]["project"];
}

/** The projects the draft hero's picker offers, in sidebar order, without the no-project home. */
export function useProjectChoices(): ReadonlyArray<ProjectChoice> {
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

export function OpenThreadButton({ threads }: { threads: ReadonlyArray<EnvironmentThreadShell> }) {
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

export function StartThreadPicker({
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
