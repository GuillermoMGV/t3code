import {
  parseLinearIssueReference,
  type EnvironmentId,
  type LinearIssue,
  type LinearIssueIdentifier,
  type LinearMutation,
  type ThreadId,
} from "@t3tools/contracts";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { linearEnvironment } from "~/state/linear";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
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
import { toastManager } from "../ui/toast";
import { LinearIssueAssigneeBadge, LinearIssueStateBadge } from "./LinearIssueParts";
import {
  LINEAR_SEARCH_DEBOUNCE_MS,
  linearSearchQuery,
  moveSelectedIssue,
  resolveSelectedIssue,
} from "./linearIssueRow.logic";

export type LinearIssueDialogMode = "connect" | "link";

interface LinearIssueDialogProps {
  open: boolean;
  mode: LinearIssueDialogMode;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onOpenChange: (open: boolean) => void;
  /** Runs after a successful change so the panel row reloads. */
  onChanged: () => void;
}

function failureMessage(
  result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
) {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "Linear did not answer. Try again.";
}

export function LinearIssueDialog(props: LinearIssueDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-xl">
        {props.open ? (
          props.mode === "connect" ? (
            <LinearConnectForm {...props} />
          ) : (
            <LinearLinkForm {...props} />
          )
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function useLinearMutation(environmentId: EnvironmentId) {
  const mutate = useAtomCommand(linearEnvironment.mutate, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (input: LinearMutation) => {
    setPending(true);
    setError(null);
    const result = await mutate({ environmentId, input });
    setPending(false);
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
    return null;
  };
  return { run, pending, error };
}

function LinearConnectForm({ environmentId, onOpenChange, onChanged }: LinearIssueDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [apiKey, setApiKey] = useState("");
  const mutation = useLinearMutation(environmentId);

  const submit = async () => {
    if (apiKey.trim().length === 0 || mutation.pending) return;
    const result = await mutation.run({ type: "connect", apiKey: apiKey.trim() });
    if (result === null) return;
    toastManager.add({
      type: "success",
      title: result.viewerName
        ? `Connected to Linear as ${result.viewerName}`
        : "Connected to Linear",
    });
    onChanged();
    onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect Linear</DialogTitle>
        <DialogDescription>
          In Linear, open Settings → Security &amp; access → Personal API keys, create a key, and
          paste it here. T3 Code keeps it in this environment's secrets folder.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <Input
          ref={inputRef}
          autoFocus
          type="password"
          autoComplete="off"
          placeholder="lin_api_..."
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void submit();
          }}
        />
        {mutation.error ? <p className="text-destructive text-xs">{mutation.error}</p> : null}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={apiKey.trim().length === 0 || mutation.pending}
          onClick={() => void submit()}
        >
          {mutation.pending ? "Checking..." : "Connect"}
        </Button>
      </DialogFooter>
    </>
  );
}

function LinearLinkForm({
  environmentId,
  threadId,
  onOpenChange,
  onChanged,
}: LinearIssueDialogProps) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<LinearIssueIdentifier | null>(null);
  const query = linearSearchQuery(useDebouncedValue(draft, LINEAR_SEARCH_DEBOUNCE_MS));
  const typing = linearSearchQuery(draft) !== query;
  const mutation = useLinearMutation(environmentId);
  const search = useEnvironmentQuery(
    linearEnvironment.searchIssues({ environmentId, input: { query } }),
  );
  const issues = search.data?.issues ?? [];
  const searching = typing || search.isPending;
  const selectedIssue = searching ? null : resolveSelectedIssue(issues, selected);

  const link = async (identifier: LinearIssueIdentifier) => {
    if (mutation.pending) return;
    const result = await mutation.run({ type: "link", threadId, identifier });
    if (result === null) return;
    onChanged();
    onOpenChange(false);
  };

  // A pasted URL or identifier links at once, without waiting for its search.
  const linkSelection = () => {
    const identifier = parseLinearIssueReference(draft) ?? selectedIssue;
    if (identifier !== null) void link(identifier);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Link Linear issue</DialogTitle>
        <DialogDescription>
          Type to search by title, or paste an issue URL or identifier. Pick an issue, then Link.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="linear-issue-results"
            placeholder="Search issues, or paste https://linear.app/…/issue/PRO-123"
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
            <span>{query === "" ? "Your open issues" : `Results for “${query}”`}</span>
            {searching ? <Spinner size="xs" aria-label="Searching Linear" /> : null}
          </div>
          <div
            id="linear-issue-results"
            role="listbox"
            aria-label="Linear issues"
            className="-mx-1 flex max-h-80 flex-col overflow-y-auto"
          >
            {issues.map((issue) => (
              <LinearIssueOption
                key={issue.identifier}
                issue={issue}
                selected={issue.identifier === selectedIssue}
                disabled={mutation.pending}
                onSelect={() => setSelected(issue.identifier)}
                onConfirm={() => void link(issue.identifier)}
              />
            ))}
            {!searching && search.error === null && issues.length === 0 ? (
              <p className="px-1 py-2 text-muted-foreground text-xs">No issues found.</p>
            ) : null}
          </div>
          {(mutation.error ?? search.error) ? (
            <p className="text-destructive text-xs">{mutation.error ?? search.error}</p>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={
            mutation.pending ||
            (parseLinearIssueReference(draft) === null && selectedIssue === null)
          }
          onClick={linkSelection}
        >
          {mutation.pending ? "Linking..." : selectedIssue ? `Link ${selectedIssue}` : "Link"}
        </Button>
      </DialogFooter>
    </>
  );
}

function LinearIssueOption({
  issue,
  selected,
  disabled,
  onSelect,
  onConfirm,
}: {
  issue: LinearIssue;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onConfirm: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={onSelect}
      onDoubleClick={onConfirm}
      // Keeps the row picked with the arrow keys in view.
      ref={selected ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none disabled:opacity-60",
        selected && "bg-accent hover:bg-accent",
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2 text-sm">
        <span className="shrink-0 text-muted-foreground tabular-nums text-xs">
          {issue.identifier}
        </span>
        <span className="min-w-0 truncate">{issue.title}</span>
      </span>
      <span className="flex min-w-0 items-center gap-3 text-muted-foreground text-xs">
        <LinearIssueStateBadge state={issue.state} />
        <LinearIssueAssigneeBadge assignee={issue.assignee} />
      </span>
    </button>
  );
}
