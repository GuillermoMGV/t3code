import {
  ISSUE_TRACKER_LABELS,
  type EnvironmentId,
  type IssueKey,
  type IssueTrackerMutation,
  type ThreadId,
  type TrackerIssue,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshCwIcon,
  ReplaceIcon,
  SettingsIcon,
  TriangleAlertIcon,
  UnlinkIcon,
} from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { useQuietThreadVisibleTurnItems } from "~/state/entities";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { IssueFieldPicker, useShownIssue } from "./IssueFieldPicker";
import { IssueTrackerLinkDialog } from "./IssueTrackerLinkDialog";
import {
  IssueAssigneeBadge,
  IssueDueDate,
  IssueStateBadge,
  IssueTrackerIcon,
} from "./IssueTrackerParts";
import {
  collectThreadIssueReferences,
  resolveIssueTrackerPanelView,
  type IssueTrackerRowView,
} from "./issueTrackerRows.logic";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

const SETTINGS_PATH = "/settings/issue-trackers";

/** The thread's Linear and Jira issues for the details panel. */
export function ThreadDetailsIssueTrackerRows({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const threadRef = { environmentId, threadId };
  const items = useQuietThreadVisibleTurnItems(threadRef);
  const detected = collectThreadIssueReferences(items);
  const query = useEnvironmentQuery(
    issueTrackerEnvironment.threadIssues({ environmentId, input: { threadId, detected } }),
  );
  // The thread list's badges read the same links; refresh them with the panel.
  const summaries = useEnvironmentQuery(
    issueTrackerEnvironment.threadSummaries({ environmentId, input: {} }),
  );
  const view = resolveIssueTrackerPanelView({ data: query.data, error: query.error });
  const navigate = useNavigate();
  const openSettings = () => void navigate({ to: SETTINGS_PATH });

  if (view.kind === "loading") {
    return (
      <SimpleRow
        icon={<IssueTrackerIcon tracker="linear" className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
        label="Issues…"
        tooltip="Loading linked Linear and Jira issues"
        onClick={() => query.refresh()}
      />
    );
  }
  if (view.kind === "error") {
    return (
      <SimpleRow
        icon={<WarningIcon />}
        label="Issue trackers unavailable"
        tooltip={`${view.message} Click to retry.`}
        onClick={() => query.refresh()}
      />
    );
  }
  if (view.kind === "setup") {
    return (
      <SimpleRow
        icon={<SettingsIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
        label="Connect Linear or Jira"
        tooltip="Connect an issue tracker in Settings to link issues to threads"
        onClick={openSettings}
      />
    );
  }
  return (
    <>
      {view.rows.map((row) => (
        <IssueTrackerRow
          key={row.tracker}
          row={row}
          environmentId={environmentId}
          threadId={threadId}
          dismissKeys={detected.filter((ref) => ref.tracker === row.tracker).map((ref) => ref.key)}
          onChanged={() => {
            query.refresh();
            summaries.refresh();
          }}
          onOpenSettings={openSettings}
        />
      ))}
    </>
  );
}

function IssueTrackerRow({
  row,
  environmentId,
  threadId,
  dismissKeys,
  onChanged,
  onOpenSettings,
}: {
  row: IssueTrackerRowView;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  dismissKeys: ReadonlyArray<IssueKey>;
  onChanged: () => void;
  onOpenSettings: () => void;
}) {
  const { tracker } = row;
  const label = ISSUE_TRACKER_LABELS[tracker];
  const [linking, setLinking] = useState(false);
  const mutate = useAtomCommand(issueTrackerEnvironment.mutate);
  const openLink = useOpenLink({ environmentId, threadId });
  const trackerIcon = (
    <IssueTrackerIcon tracker={tracker} className={THREAD_DETAILS_PANEL_ICON_CLASS} />
  );

  const runMutation = async (input: IssueTrackerMutation) => {
    const result = await mutate({ environmentId, input });
    if (result._tag === "Success") onChanged();
  };
  const unlink = () =>
    void runMutation({ type: "unlink", threadId, tracker, dismissKeys: [...dismissKeys] });

  const dialog = (
    <IssueTrackerLinkDialog
      open={linking}
      tracker={tracker}
      environmentId={environmentId}
      threadId={threadId}
      onOpenChange={setLinking}
      onLinked={onChanged}
    />
  );

  const menu = (key: IssueKey, url: string | null) => (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ThreadDetailsControl
                  type="button"
                  variant="ghost"
                  size="sm"
                  part="icon"
                  aria-label={`${label} issue ${key} actions`}
                />
              }
            />
          }
        >
          <EllipsisIcon aria-hidden className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">Issue actions</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        {url !== null ? (
          <>
            <MenuItem onClick={() => void openLink(url)}>
              <ExternalLinkIcon aria-hidden />
              Open in {label}
            </MenuItem>
            <MenuItem
              onClick={() =>
                void writeTextToClipboard(url).then(() =>
                  toastManager.add({ type: "success", title: `Copied ${key} link` }),
                )
              }
            >
              <CopyIcon aria-hidden />
              Copy link
            </MenuItem>
          </>
        ) : null}
        <MenuItem onClick={() => setLinking(true)}>
          <ReplaceIcon aria-hidden />
          Change issue…
        </MenuItem>
        <MenuItem onClick={onChanged}>
          <RefreshCwIcon aria-hidden />
          Refresh
        </MenuItem>
        <MenuItem onClick={unlink}>
          <UnlinkIcon aria-hidden />
          Unlink from thread
        </MenuItem>
        <MenuItem onClick={onOpenSettings}>
          <SettingsIcon aria-hidden />
          {label} settings
        </MenuItem>
      </MenuPopup>
    </Menu>
  );

  switch (row.kind) {
    case "error":
      return (
        <SimpleRow
          icon={<WarningIcon />}
          label={`${label} unavailable`}
          tooltip={`${row.message} Click to retry.`}
          onClick={onChanged}
        />
      );
    case "connectToSee":
      return (
        <SimpleRow
          icon={trackerIcon}
          label={`${row.key} · Connect ${label} to see it`}
          tooltip={`Connect ${label} in Settings to show this issue`}
          onClick={onOpenSettings}
        />
      );
    case "empty":
      return (
        <>
          <SimpleRow
            icon={<PlusIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
            label={`Link ${label} issue`}
            tooltip={`Search for a ${label} issue, or paste its URL in the chat to link it automatically`}
            onClick={() => setLinking(true)}
          />
          {dialog}
        </>
      );
    case "missing":
      return (
        <>
          <SimpleRow
            icon={<WarningIcon />}
            label={`${row.key} not found`}
            tooltip={`${label} cannot show this issue with the saved credentials. Click to link another one.`}
            onClick={() => setLinking(true)}
            trailing={<div className="pe-1.5">{menu(row.key, null)}</div>}
          />
          {dialog}
        </>
      );
    case "issue": {
      const { issue, source } = row;
      const openIssue = (event: ReactMouseEvent<HTMLElement>) =>
        void openLink(issue.url, { event });
      return (
        <div className="pb-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  type="button"
                  variant="ghost"
                  size="sm"
                  part="title"
                  aria-label={`Open ${issue.key} in ${label}`}
                  onClick={openIssue}
                  onAuxClick={openIssue}
                />
              }
            >
              {trackerIcon}
              <span className="line-clamp-2 min-w-0 flex-1 whitespace-normal text-left leading-4.5">
                {issue.title}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top">
              {source === "detected"
                ? `Linked from a ${label} URL in this thread. Open ${issue.key} in ${label}.`
                : `Open ${issue.key} in ${label}`}
            </TooltipPopup>
          </Tooltip>
          <IssueFields
            environmentId={environmentId}
            issue={issue}
            menu={menu(issue.key, issue.url)}
          />

          {dialog}
        </div>
      );
    }
  }
}

/** Key, then state, then assignee, each on its own line: the panel is narrow. */
function IssueFields({
  environmentId,
  issue: listed,
  menu,
}: {
  environmentId: EnvironmentId;
  issue: TrackerIssue;
  menu: ReactNode;
}) {
  const issue = useShownIssue(environmentId, listed);
  return (
    <div className="flex flex-col ps-9 pe-1.5 text-xs text-muted-foreground">
      <div className="flex h-6 min-w-0 items-center gap-2.5">
        <span className="shrink-0 tabular-nums">{issue.key}</span>
        <span className="flex-1" />
        {menu}
      </div>
      <IssueFieldPicker
        environmentId={environmentId}
        issue={issue}
        field="state"
        className="-ms-1 h-5 self-start px-1 text-foreground/80"
      >
        {issue.state === null ? <span>No status</span> : <IssueStateBadge state={issue.state} />}
      </IssueFieldPicker>
      <IssueFieldPicker
        environmentId={environmentId}
        issue={issue}
        field="assignee"
        className="-ms-1 h-5 self-start px-1 text-foreground/80"
      >
        <IssueAssigneeBadge assignee={issue.assignee} />
      </IssueFieldPicker>
      <IssueDueDate issue={issue} className="h-5 text-foreground/80" />
    </div>
  );
}

function WarningIcon() {
  return (
    <TriangleAlertIcon
      aria-hidden
      className={cn(THREAD_DETAILS_PANEL_ICON_CLASS, "text-destructive")}
    />
  );
}

function SimpleRow(input: {
  icon: ReactNode;
  label: ReactNode;
  tooltip: string;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsControl
              type="button"
              variant="ghost"
              size="sm"
              part="row"
              tone="muted"
              className="min-w-0 flex-1"
              onClick={input.onClick}
            />
          }
        >
          {input.icon}
          <span
            className={cn("min-w-0 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}
          >
            {input.label}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">{input.tooltip}</TooltipPopup>
      </Tooltip>
      {input.trailing}
    </div>
  );
}
