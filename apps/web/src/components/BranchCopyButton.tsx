import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef, type SyntheticEvent } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { ANCHORED_COPY_TOAST_TIMEOUT_MS, showAnchoredCopyErrorToast } from "./ui/anchoredCopyToast";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

// Fork-only copy button on branch picker rows; see CUSTOM_DEVELOPMENT.md.

// The row selects the branch on press, so the button keeps its events to itself.
const stopRowEvent = (event: SyntheticEvent) => {
  event.stopPropagation();
  event.preventDefault();
};

export function BranchCopyButton({ name }: { name: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onError: (error: Error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={`Copy branch name ${name}`}
            className="pointer-events-auto shrink-0"
            onClick={(event) => {
              stopRowEvent(event);
              copyToClipboard(name);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            onMouseDown={stopRowEvent}
            onPointerDown={stopRowEvent}
            ref={ref}
            size="icon-xs"
            tabIndex={-1}
            type="button"
            variant="ghost-muted"
          />
        }
      >
        {isCopied ? <CheckIcon className="size-3 text-primary" /> : <CopyIcon className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{isCopied ? "Copied" : "Copy branch name"}</p>
      </TooltipPopup>
    </Tooltip>
  );
}
