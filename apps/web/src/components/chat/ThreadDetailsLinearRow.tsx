import type { EnvironmentId, LinearMutation, ThreadId } from "@t3tools/contracts";
import {
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  LogOutIcon,
  PlusIcon,
  RefreshCwIcon,
  ReplaceIcon,
  TicketIcon,
  TriangleAlertIcon,
  UnlinkIcon,
} from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { useQuietThreadVisibleTurnItems } from "~/state/entities";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { LinearIssueDialog, type LinearIssueDialogMode } from "./LinearIssueDialog";
import { LinearIssueAssigneeBadge, LinearIssueStateBadge } from "./LinearIssueParts";
import { collectThreadLinearIdentifiers, resolveLinearIssueRowView } from "./linearIssueRow.logic";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadDetailsLinearRow({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const threadRef = { environmentId, threadId };
  const items = useQuietThreadVisibleTurnItems(threadRef);
  const detectedIdentifiers = collectThreadLinearIdentifiers(items);
  const query = useEnvironmentQuery(
    linearEnvironment.threadIssue({
      environmentId,
      input: { threadId, detectedIdentifiers },
    }),
  );
  const view = resolveLinearIssueRowView({ data: query.data, error: query.error });
  const [dialog, setDialog] = useState<LinearIssueDialogMode | null>(null);
  const mutate = useAtomCommand(linearEnvironment.mutate);
  const openLink = useOpenLink(threadRef);

  const runMutation = async (input: LinearMutation) => {
    const result = await mutate({ environmentId, input });
    if (result._tag === "Success") query.refresh();
  };
  const unlink = () =>
    void runMutation({ type: "unlink", threadId, dismissIdentifiers: detectedIdentifiers });

  const dialogElement = (
    <LinearIssueDialog
      open={dialog !== null}
      mode={dialog ?? "link"}
      environmentId={environmentId}
      threadId={threadId}
      onOpenChange={(open) => {
        if (!open) setDialog(null);
      }}
      onChanged={query.refresh}
    />
  );

  const simpleRow = (input: {
    icon: ReactNode;
    label: ReactNode;
    tooltip: string;
    onClick: () => void;
    trailing?: ReactNode;
  }) => (
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

  const ticketIcon = <TicketIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />;

  if (view.kind === "loading") {
    return simpleRow({
      icon: ticketIcon,
      label: "Linear…",
      tooltip: "Loading the Linear issue",
      onClick: () => query.refresh(),
    });
  }

  if (view.kind === "error") {
    return (
      <>
        {simpleRow({
          icon: (
            <TriangleAlertIcon
              aria-hidden
              className={cn(THREAD_DETAILS_PANEL_ICON_CLASS, "text-destructive")}
            />
          ),
          label: "Linear unavailable",
          tooltip: `${view.message} Click to retry.`,
          onClick: () => query.refresh(),
        })}
        {dialogElement}
      </>
    );
  }

  if (view.kind === "connect" || view.kind === "connectToSee") {
    return (
      <>
        {simpleRow({
          icon: ticketIcon,
          label:
            view.kind === "connect"
              ? "Connect Linear"
              : `${view.identifier} · Connect Linear to see it`,
          tooltip: "Connect Linear with a personal API key to show issues here",
          onClick: () => setDialog("connect"),
        })}
        {dialogElement}
      </>
    );
  }

  if (view.kind === "empty") {
    return (
      <>
        {simpleRow({
          icon: <PlusIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />,
          label: "Link Linear issue",
          tooltip: "Search for an issue, or paste its URL in the chat to link it automatically",
          onClick: () => setDialog("link"),
        })}
        {dialogElement}
      </>
    );
  }

  const menu = (identifier: string, url: string | null) => (
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
                  aria-label={`Linear issue ${identifier} actions`}
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
              Open in Linear
            </MenuItem>
            <MenuItem
              onClick={() =>
                void writeTextToClipboard(url).then(() =>
                  toastManager.add({ type: "success", title: `Copied ${identifier} link` }),
                )
              }
            >
              <CopyIcon aria-hidden />
              Copy link
            </MenuItem>
          </>
        ) : null}
        <MenuItem onClick={() => setDialog("link")}>
          <ReplaceIcon aria-hidden />
          Change issue…
        </MenuItem>
        <MenuItem onClick={() => query.refresh()}>
          <RefreshCwIcon aria-hidden />
          Refresh
        </MenuItem>
        <MenuItem onClick={unlink}>
          <UnlinkIcon aria-hidden />
          Unlink from thread
        </MenuItem>
        <MenuItem onClick={() => void runMutation({ type: "disconnect" })}>
          <LogOutIcon aria-hidden />
          Disconnect Linear
        </MenuItem>
      </MenuPopup>
    </Menu>
  );

  if (view.kind === "missing") {
    return (
      <>
        {simpleRow({
          icon: <TriangleAlertIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />,
          label: `${view.identifier} not found`,
          tooltip: "This Linear key cannot see the issue. Click to link another one.",
          onClick: () => setDialog("link"),
          trailing: <div className="pe-1.5">{menu(view.identifier, null)}</div>,
        })}
        {dialogElement}
      </>
    );
  }

  const { issue, source } = view;
  const openIssue = (event: ReactMouseEvent<HTMLElement>) => void openLink(issue.url, { event });
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
              aria-label={`Open ${issue.identifier} in Linear`}
              onClick={openIssue}
              onAuxClick={openIssue}
            />
          }
        >
          {ticketIcon}
          <span className="line-clamp-2 min-w-0 flex-1 whitespace-normal text-left leading-4.5">
            {issue.title}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          {source === "detected"
            ? `Linked from a Linear URL in this thread. Open ${issue.identifier} in Linear.`
            : `Open ${issue.identifier} in Linear`}
        </TooltipPopup>
      </Tooltip>
      {/* The panel is narrow; separate lines keep the state and assignee readable. */}
      <div className="flex flex-col ps-9 pe-1.5 text-xs text-muted-foreground">
        <div className="flex h-6 min-w-0 items-center gap-2.5">
          <span className="shrink-0 tabular-nums">{issue.identifier}</span>
          <LinearIssueStateBadge state={issue.state} className="text-foreground/80" />
          <span className="flex-1" />
          {menu(issue.identifier, issue.url)}
        </div>
        <LinearIssueAssigneeBadge assignee={issue.assignee} className="h-5 text-foreground/80" />
      </div>
      {dialogElement}
    </div>
  );
}
