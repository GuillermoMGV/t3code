import type { ScopedThreadRef } from "@t3tools/contracts";
import { CalendarClockIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Fork-only scheduler marker for thread rows; see CUSTOM_DEVELOPMENT.md.

/** Clock before the title of a thread that a scheduled task runs in. */
export function SidebarThreadSchedulerIcon({ threadRef }: { threadRef: ScopedThreadRef }) {
  const { data } = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: threadRef.environmentId, input: {} }),
  );
  const tasks = (data?.tasks ?? []).filter((task) => task.threadId === threadRef.threadId);
  if (tasks.length === 0) return null;
  const active = tasks.some((task) => task.enabled);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={active ? "Scheduled task" : "Scheduled task (paused)"}
            className="inline-flex shrink-0 items-center"
          />
        }
      >
        <CalendarClockIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            active ? "text-success-foreground" : "text-error-foreground",
          )}
        />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {tasks.map((task) => (
          <div key={task.id}>
            {task.title} · {scheduleLabel(task.schedule, data?.timeZone, task.nextRunAt)}
            {task.enabled ? "" : " · paused"}
          </div>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
}
