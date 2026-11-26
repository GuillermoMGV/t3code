import type { PullRequestActor } from "@t3tools/contracts";
import { UserRoundSearchIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Fork-only pending-review badge for the thread panel's PR rows; see CUSTOM_DEVELOPMENT.md.

export function PrPendingReviewBadge({
  reviewers,
}: {
  reviewers: ReadonlyArray<PullRequestActor>;
}) {
  if (reviewers.length === 0) return null;
  const names = reviewers.map((reviewer) => reviewer.name?.trim() || reviewer.login).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`Waiting for review from ${names}`}
            className="flex shrink-0 items-center gap-0.5 px-1 text-warning"
          />
        }
      >
        <UserRoundSearchIcon aria-hidden className="size-3.5" />
        {reviewers.length > 1 ? <span className="tabular-nums">{reviewers.length}</span> : null}
      </TooltipTrigger>
      <TooltipPopup side="top">Waiting for review from {names}</TooltipPopup>
    </Tooltip>
  );
}
