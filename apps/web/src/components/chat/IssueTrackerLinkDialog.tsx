import {
  ISSUE_TRACKER_LABELS,
  parseIssueReference,
  type EnvironmentId,
  type IssueKey,
  type IssueTrackerKind,
  type ThreadId,
  type TrackerIssue,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { IssueAssigneeBadge, IssueStateBadge } from "./IssueTrackerParts";
import { moveSelectedIssue, resolveSelectedIssue } from "./issueTrackerRows.logic";
import { useIssueSearch } from "./useIssueSearch";

const PASTE_EXAMPLES: Readonly<Record<IssueTrackerKind, string>> = {
  linear: "https://linear.app/…/issue/PRO-123",
  jira: "https://…atlassian.net/browse/PRO-123",
};

interface IssueTrackerLinkDialogProps {
  open: boolean;
  tracker: IssueTrackerKind;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onOpenChange: (open: boolean) => void;
  /** Runs after a successful link so the panel row reloads. */
  onLinked: () => void;
}

export function IssueTrackerLinkDialog(props: IssueTrackerLinkDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-xl">
        {props.open ? <IssueTrackerLinkForm {...props} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function IssueTrackerLinkForm({
  tracker,
  environmentId,
  threadId,
  onOpenChange,
  onLinked,
}: IssueTrackerLinkDialogProps) {
  const label = ISSUE_TRACKER_LABELS[tracker];
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<IssueKey | null>(null);
  const [pending, setPending] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const mutate = useAtomCommand(issueTrackerEnvironment.mutate, { reportFailure: false });
  const search = useIssueSearch(environmentId, tracker, draft);
  const { query, issues, searching } = search;
  const selectedIssue = searching ? null : resolveSelectedIssue(issues, selected);
  const pastedKey = parseIssueReference(draft, tracker);

  const link = async (key: IssueKey) => {
    if (pending) return;
    setPending(true);
    setLinkError(null);
    const result = await mutate({
      environmentId,
      input: { type: "link", threadId, tracker, key },
    });
    setPending(false);
    if (result._tag === "Success") {
      onLinked();
      onOpenChange(false);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    setLinkError(error instanceof Error ? error.message : `${label} did not answer. Try again.`);
  };

  // Enter links the highlighted issue; a pasted URL or key links without waiting for its search.
  const linkSelection = () => {
    const key = pastedKey ?? selectedIssue;
    if (key !== null) void link(key);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Link {label} issue</DialogTitle>
        <DialogDescription>
          Type to search by title, or paste an issue URL or key. Click an issue to link it.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="issue-tracker-results"
            placeholder={`Search ${label} issues, or paste ${PASTE_EXAMPLES[tracker]}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setSelected(
                  moveSelectedIssue(issues, selectedIssue, event.key === "ArrowDown" ? 1 : -1),
                );
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              linkSelection();
            }}
          />
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>
              {pending ? "Linking…" : query === "" ? "Your open issues" : `Results for “${query}”`}
            </span>
            {searching || pending ? (
              <Spinner size="xs" aria-label={pending ? "Linking" : `Searching ${label}`} />
            ) : null}
          </div>
          <div
            id="issue-tracker-results"
            role="listbox"
            aria-label={`${label} issues`}
            className="-mx-1 flex max-h-80 flex-col overflow-y-auto"
          >
            {issues.map((issue) => (
              <IssueOption
                key={issue.key}
                issue={issue}
                selected={issue.key === selectedIssue}
                disabled={pending}
                onLink={() => void link(issue.key)}
              />
            ))}
            {!searching && search.error === null && issues.length === 0 ? (
              <p className="px-1 py-2 text-muted-foreground text-xs">No issues found.</p>
            ) : null}
          </div>
          {(linkError ?? search.error) ? (
            <p className="text-destructive text-xs">{linkError ?? search.error}</p>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

function IssueOption({
  issue,
  selected,
  disabled,
  onLink,
}: {
  issue: TrackerIssue;
  selected: boolean;
  disabled: boolean;
  onLink: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      // One click links; the arrow keys and Enter do the same from the search field.
      onClick={onLink}
      // Keeps the row picked with the arrow keys in view.
      ref={selected ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none disabled:opacity-60",
        selected && "bg-accent hover:bg-accent",
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2 text-sm">
        <span className="shrink-0 text-muted-foreground tabular-nums text-xs">{issue.key}</span>
        <span className="min-w-0 truncate">{issue.title}</span>
      </span>
      <span className="flex min-w-0 items-center gap-3 text-muted-foreground text-xs">
        <IssueStateBadge state={issue.state} />
        <IssueAssigneeBadge assignee={issue.assignee} />
      </span>
    </button>
  );
}
