import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Fork-only cards under finished agent replies; see CUSTOM_DEVELOPMENT.md.

/** One compact row: icon, a title line, a muted line of facts, and icon actions. */
export function ReplyCardFrame({
  icon,
  title,
  meta,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-1.5 text-xs">
      <span className="flex shrink-0 items-center self-start pt-0.5 text-muted-foreground">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-foreground">{title}</div>
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">{meta}</div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
    </div>
  );
}

export function ReplyCardAction({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
