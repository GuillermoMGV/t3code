import { useAtomValue } from "@effect/atom-react";
import {
  NOTIFICATION_SOURCE_LABELS,
  type EnvironmentId,
  type IssueTrackerNotificationsMutation,
  type NotificationSource,
  type TrackerNotification,
  type TrackerNotificationKind,
} from "@t3tools/contracts";
import { AtSignIcon, BellIcon, CheckCheckIcon, CircleIcon, CircleCheckIcon } from "lucide-react";
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { useConnectedEnvironmentIds } from "~/state/environments";
import { issueTrackerNotificationsEnvironment } from "~/state/issueTrackerNotifications";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { showNotificationBadge } from "~/threadNotifications";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { IssueTrackerIcon } from "../chat/IssueTrackerParts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  filterNotifications,
  notificationFilterSources,
  type NotificationTrackerFilter,
  unreadBadgeLabel,
} from "./SidebarIssueNotifications.logic";

// Fork-only notifications bell for Linear, Jira and Slack mentions; see CUSTOM_DEVELOPMENT.md.

const KIND_LABELS: Readonly<Record<TrackerNotificationKind, string>> = {
  assigned: "assigned you",
  unassigned: "unassigned you",
  comment: "commented",
  mention: "mentioned you",
  statusChanged: "changed the status",
  created: "created the issue",
  reaction: "reacted",
  other: "updated",
};

function NotificationSourceIcon({
  source,
  className,
}: {
  source: NotificationSource;
  className: string;
}) {
  if (source === "slack") return <AtSignIcon aria-hidden className={className} />;
  return <IssueTrackerIcon tracker={source} className={className} />;
}

function useNotificationsEnvironmentId(): EnvironmentId | null {
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  // The trackers' credentials live on one server; without a local one, the first connected answers.
  return primaryEnvironmentId ?? connectedEnvironmentIds[0] ?? null;
}

/** The bell in the sidebar footer; hidden until Linear, Jira or Slack is connected. */
export function SidebarIssueNotificationsItem() {
  const environmentId = useNotificationsEnvironmentId();
  if (environmentId === null) return null;
  return <NotificationsBell key={environmentId} environmentId={environmentId} />;
}

/** Shows the bell's unread count on the taskbar icon (desktop) or favicon (web) on every page. */
export function IssueNotificationsBadgeCoordinator() {
  const environmentId = useNotificationsEnvironmentId();
  if (environmentId === null) return null;
  return <NotificationsBadge key={environmentId} environmentId={environmentId} />;
}

function NotificationsBadge({ environmentId }: { environmentId: EnvironmentId }) {
  const { data } = useEnvironmentQuery(
    issueTrackerNotificationsEnvironment.list({ environmentId, input: {} }),
  );
  const count = data !== null && data.connected.length > 0 ? data.unreadCount : 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the count onto the OS taskbar icon and the favicon
  useEffect(() => {
    showNotificationBadge(count);
    return () => showNotificationBadge(0);
  }, [count]);
  return null;
}

function NotificationsBell({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(
    issueTrackerNotificationsEnvironment.list({ environmentId, input: {} }),
  );
  const mutate = useAtomCommand(issueTrackerNotificationsEnvironment.mutate, {
    reportFailure: false,
  });
  const openLink = useOpenLink(null);
  const [refreshing, setRefreshing] = useState(false);
  const [trackerFilter, setTrackerFilter] = useState<NotificationTrackerFilter>("all");
  const data = query.data;
  if (data === null || data.connected.length === 0) return null;
  const filterSources = notificationFilterSources(data.connected, data.notifications);
  const withFilter = filterSources.length > 0;
  const activeFilter = filterSources.some((source) => source === trackerFilter)
    ? trackerFilter
    : "all";
  const visible = filterNotifications(data.notifications, activeFilter);
  const visibleUnreadIds = visible.filter((item) => !item.read).map((item) => item.id);

  const run = async (input: IssueTrackerNotificationsMutation) => {
    const result = await mutate({ environmentId, input });
    query.refresh();
    if (result._tag !== "Success") {
      toastManager.add({ type: "error", title: "Could not update the notifications" });
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    await run({ type: "refresh" });
    setRefreshing(false);
  };
  const open = (notification: TrackerNotification, event: ReactMouseEvent<HTMLElement>) => {
    if (!notification.read) void run({ type: "markRead", ids: [notification.id] });
    void openLink(notification.issue.url, { event });
  };

  const unread = data.unreadCount;
  const label = unread > 0 ? `Notifications (${unread} unread)` : "Notifications";

  return (
    <SidebarMenuItem className="shrink-0">
      <Popover>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger render={<SidebarMenuButton aria-label={label} size="icon" />} />
            }
          >
            <BellIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">{label}</TooltipPopup>
        </Tooltip>
        {/* Outside the button: SidebarMenuButton clips its overflow, which cut the badge. */}
        {unread > 0 ? (
          <Badge
            variant="destructive"
            size="sm"
            aria-hidden
            className="pointer-events-none absolute -top-1 -right-1"
          >
            {unreadBadgeLabel(unread)}
          </Badge>
        ) : null}
        <PopoverPopup side="top" align="start" className="w-96">
          <div className="flex max-h-120 flex-col">
            <div className="flex items-center gap-1 pb-2">
              <span className="min-w-0 flex-1 text-sm font-semibold">Notifications</span>
              <Button
                variant="ghost"
                size="xs"
                disabled={visibleUnreadIds.length === 0}
                // With a tracker chosen, only what is shown is marked.
                onClick={() =>
                  void run(
                    activeFilter !== "all"
                      ? { type: "markRead", ids: visibleUnreadIds }
                      : { type: "markAllRead" },
                  )
                }
              >
                <CheckCheckIcon />
                Mark all as read
              </Button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Check now"
                      disabled={refreshing}
                      onClick={() => void refresh()}
                    />
                  }
                >
                  <RefreshIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {data.checkedAt === null
                    ? "Check now"
                    : `Checked ${formatRelativeTimeLabel(data.checkedAt)}. Check now`}
                </TooltipPopup>
              </Tooltip>
            </div>
            {data.errors.map((error) => (
              <p key={error.tracker} className="pb-2 text-xs text-destructive-foreground">
                {NOTIFICATION_SOURCE_LABELS[error.tracker]}: {error.message}
              </p>
            ))}
            {withFilter ? (
              <ToggleGroup
                aria-label="Show notifications from"
                className="mb-2 self-start"
                value={[activeFilter]}
                onValueChange={(next) => {
                  const value = next[0];
                  const source = filterSources.find((candidate) => candidate === value);
                  if (value === "all" || source !== undefined) setTrackerFilter(source ?? "all");
                }}
              >
                <Toggle value="all">All</Toggle>
                {filterSources.map((source) => (
                  <Toggle key={source} value={source}>
                    {NOTIFICATION_SOURCE_LABELS[source]}
                  </Toggle>
                ))}
              </ToggleGroup>
            ) : null}
            {visible.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {data.checkedAt === null ? "Checking…" : "No notifications in the last days."}
              </p>
            ) : (
              <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
                {visible.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onOpen={(event) => open(notification, event)}
                    onToggleRead={() =>
                      void run({
                        type: notification.read ? "markUnread" : "markRead",
                        ids: [notification.id],
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}

function NotificationRow({
  notification,
  onOpen,
  onToggleRead,
}: {
  notification: TrackerNotification;
  onOpen: (event: ReactMouseEvent<HTMLElement>) => void;
  onToggleRead: () => void;
}) {
  const { issue, read } = notification;
  const toggleLabel = read ? "Mark as unread" : "Mark as read";
  const sourceLabel = NOTIFICATION_SOURCE_LABELS[notification.tracker];
  // Slack items name the channel instead of an issue.
  const isSlack = notification.tracker === "slack";
  return (
    <li className="group flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/50">
      <NotificationSourceIcon
        source={notification.tracker}
        className={read ? "mt-0.5 size-4 shrink-0 text-muted-foreground" : "mt-0.5 size-4 shrink-0"}
      />
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer text-left"
        aria-label={`Open ${issue.key} in ${sourceLabel}`}
        onClick={onOpen}
      >
        <span className={read ? "block text-xs text-muted-foreground" : "block text-xs"}>
          <span className="font-medium">{notification.actor ?? "Someone"}</span>{" "}
          {KIND_LABELS[notification.kind]}
          {notification.detail ? ` · ${notification.detail}` : ""}
          <span className="text-muted-foreground">
            {" "}
            · {sourceLabel} ·{formatRelativeTimeLabel(notification.createdAt)}
          </span>
        </span>
        <span
          className={
            read
              ? "block truncate text-sm text-muted-foreground"
              : "block truncate text-sm font-medium"
          }
        >
          {isSlack ? (
            issue.key
          ) : (
            <>
              <span className="font-mono text-xs">{issue.key}</span> {issue.title}
            </>
          )}
        </span>
        {notification.text ? (
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {notification.text}
          </span>
        ) : null}
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={toggleLabel}
              onClick={onToggleRead}
            />
          }
        >
          {read ? <CircleIcon /> : <CircleCheckIcon />}
        </TooltipTrigger>
        <TooltipPopup side="left">{toggleLabel}</TooltipPopup>
      </Tooltip>
    </li>
  );
}
