import { useAtomValue } from "@effect/atom-react";
import {
  ISSUE_TRACKER_LABELS,
  type EnvironmentId,
  type IssueTrackerMutation,
  type TrackerIssue,
} from "@t3tools/contracts";
import { CheckIcon, UserRoundIcon } from "lucide-react";
import { useState, type ReactNode, type SyntheticEvent } from "react";

import { cn } from "~/lib/utils";
import { editedIssueAtom, issueTrackerEnvironment } from "~/state/issueTrackers";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
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
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { issueEditKey, shownIssue } from "./issueFieldPicker.logic";
import { assigneeInitials } from "./issueTrackerRows.logic";

// Fork-only state and assignee pickers for Linear and Jira issues; see CUSTOM_DEVELOPMENT.md.

type IssueField = "state" | "assignee";

interface PickerOption {
  /** Null is "Unassigned". */
  readonly id: string | null;
  readonly name: string;
  readonly color?: string;
  readonly avatarUrl?: string | null;
}

const UNASSIGNED: PickerOption = { id: null, name: "Unassigned" };

/** The issue with any state or assignee change made here that its list has not caught up with. */
export function useShownIssue(environmentId: EnvironmentId, issue: TrackerIssue): TrackerIssue {
  return shownIssue(issue, useAtomValue(editedIssueAtom(issueEditKey(environmentId, issue))));
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Wraps a state or assignee badge in a searchable picker that changes it in Linear or Jira.
 * `nested` is for badges inside a row that is itself a button: the trigger becomes a focusable
 * span, and clicks and keys stay out of the row.
 */
export function IssueFieldPicker({
  environmentId,
  issue,
  field,
  nested = false,
  className,
  children,
}: {
  environmentId: EnvironmentId;
  issue: TrackerIssue;
  field: IssueField;
  nested?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const filter = useComboboxFilter();
  const mutate = useAtomCommand(issueTrackerEnvironment.mutate, { reportFailure: false });
  const options = useEnvironmentQuery(
    open
      ? issueTrackerEnvironment.editOptions({
          environmentId,
          input: { tracker: issue.tracker, key: issue.key },
        })
      : null,
  );
  const items: ReadonlyArray<PickerOption> =
    field === "state"
      ? (options.data?.states ?? [])
      : options.data === null
        ? []
        : [UNASSIGNED, ...options.data.assignees];
  const query = search.trim();
  const filtered =
    query.length === 0
      ? items
      : items.filter((item) => filter.contains(item, query, (option) => option.name));
  const current = field === "state" ? (issue.state?.name ?? null) : (issue.assignee?.name ?? null);
  const isCurrent = (item: PickerOption) =>
    field === "state"
      ? item.name === current
      : item.id === null
        ? current === null
        : item.name === current;
  const label = field === "state" ? "status" : "assignee";
  const tracker = ISSUE_TRACKER_LABELS[issue.tracker];

  const pick = async (item: PickerOption) => {
    setOpen(false);
    if (isCurrent(item)) return;
    const input: IssueTrackerMutation =
      field === "state"
        ? { type: "setIssueState", tracker: issue.tracker, key: issue.key, stateId: item.id ?? "" }
        : { type: "setIssueAssignee", tracker: issue.tracker, key: issue.key, assigneeId: item.id };
    setSaving(true);
    const result = await mutate({ environmentId, input });
    setSaving(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: `Could not change the ${label} of ${issue.key}`,
        description: formatEnvironmentQueryError(result.cause),
      });
    }
  };

  const triggerClass = cn(
    "inline-flex min-w-0 cursor-pointer items-center rounded-sm outline-none hover:bg-foreground/[0.06] focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default",
    saving && "opacity-60",
    className,
  );

  return (
    <Combobox
      items={items}
      filteredItems={filtered}
      autoHighlight
      itemToStringLabel={(item: PickerOption) => item.name}
      isItemEqualToValue={(a: PickerOption, b: PickerOption) => a.id === b.id}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
      }}
      value={null}
      onValueChange={(item: PickerOption | null) => {
        if (item) void pick(item);
      }}
    >
      <ComboboxTrigger
        nativeButton={!nested}
        render={
          nested ? (
            <span role="button" tabIndex={0} className={triggerClass} />
          ) : (
            <button type="button" className={triggerClass} />
          )
        }
        disabled={saving}
        aria-label={`Change ${issue.key} ${label} in ${tracker}`}
        onClick={stop}
        onKeyDown={stop}
      >
        {children}
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="w-64 overflow-hidden" onClick={stop} onKeyDown={stop}>
        <ComboboxSearchInput
          aria-label={`Search ${label}`}
          placeholder={field === "state" ? "Change status…" : "Assign to…"}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {options.data === null ? (
          <div className="flex items-center gap-2 p-2 text-muted-foreground text-sm">
            {options.error === null ? (
              <>
                <Spinner aria-hidden />
                Loading…
              </>
            ) : (
              <span className="text-destructive">{options.error}</span>
            )}
          </div>
        ) : (
          <ComboboxEmpty>
            {field === "state" ? "No matching status." : "No matching people."}
          </ComboboxEmpty>
        )}
        <ComboboxList>
          {(item: PickerOption) => (
            <ComboboxItem key={item.id ?? "unassigned"} hideIndicator value={item}>
              {field === "state" ? (
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  // Each tracker defines its states' colors; showing them keeps states recognizable.
                  style={{ backgroundColor: item.color }}
                />
              ) : (
                <PersonAvatar option={item} />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
              {isCurrent(item) ? <CheckIcon aria-label="Current" className="size-3.5" /> : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

function PersonAvatar({ option }: { option: PickerOption }) {
  if (option.id === null) return <UserRoundIcon aria-hidden className="size-4" />;
  return option.avatarUrl ? (
    <img
      alt=""
      src={option.avatarUrl}
      className="size-4 shrink-0 rounded-full object-cover"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      aria-hidden
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-4xs font-medium"
    >
      {assigneeInitials(option.name)}
    </span>
  );
}
