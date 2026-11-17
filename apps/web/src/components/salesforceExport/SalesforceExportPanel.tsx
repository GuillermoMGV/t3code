import {
  SALESFORCE_DELETE_BATCH_SIZE,
  type EnvironmentId,
  type SalesforceDataRequest,
  type SalesforceDataResult,
  type SalesforceFieldInfo,
  type SalesforceOrg,
  type SalesforceQueryPlan,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  BookmarkIcon,
  ChevronDownIcon,
  CloudIcon,
  DownloadIcon,
  EyeOffIcon,
  HistoryIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { salesforceEnvironment } from "~/state/salesforce";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { SalesforceTypeBadge, useSalesforce } from "../chat/SalesforceOrgParts";
import {
  currentSalesforceOrg,
  isProductionOrg,
  salesforceOrgName,
} from "../chat/salesforceOrgs.logic";
import {
  chunk,
  collectColumns,
  deletableIds,
  exportStatus,
  filterRows,
  flattenRecord,
  formatElapsed,
  MAX_EXPORT_RECORDS,
  nonEmptyColumns,
  QUERY_TEMPLATES,
  soqlObjectName,
  toDelimited,
  toJson,
  type ExportRow,
} from "./salesforceExport.logic";
import { SalesforceExportTable } from "./SalesforceExportTable";
import { useSalesforceExportStore } from "./salesforceExportStore";

// Fork-only Salesforce Export panel, modeled on Salesforce Inspector's Data Export; see
// CUSTOM_DEVELOPMENT.md.

interface ExportResult {
  readonly org: string;
  readonly tooling: boolean;
  readonly rows: ReadonlyArray<ExportRow>;
  readonly columns: ReadonlyArray<string>;
  readonly totalSize: number;
  readonly running: boolean;
  readonly stopped: boolean;
  readonly capped: boolean;
  readonly elapsedMs: number | null;
  readonly error: string | null;
}

type Inspection =
  | { readonly kind: "plan"; readonly plans: ReadonlyArray<SalesforceQueryPlan> }
  | {
      readonly kind: "fields";
      readonly name: string;
      readonly label: string;
      readonly fields: ReadonlyArray<SalesforceFieldInfo>;
    };

function failureMessage(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "Salesforce did not answer.";
}

/** The thread's Salesforce org, or a short pointer to the org selector when there is none. */
export function SalesforceExportPanel({
  environmentId,
  cwd,
}: {
  environmentId: EnvironmentId;
  cwd: string | null;
}) {
  const salesforce = useSalesforce(environmentId, cwd);
  const state = salesforce.state;
  const org = state === null ? null : currentSalesforceOrg(state);

  if (cwd === null || state === null || org === null) {
    const message =
      cwd === null
        ? "Open a project thread to export Salesforce data."
        : state === null || state.loading
          ? "Loading Salesforce orgs…"
          : !state.isDxProject
            ? "This workspace is not a Salesforce DX project (no sfdx-project.json)."
            : state.cli !== null && !state.cli.installed
              ? "Install the Salesforce CLI (sf) to export data."
              : "No org is connected to this thread. Pick one in the Salesforce row of the thread details panel, then come back.";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <CloudIcon aria-hidden className="size-6 text-muted-foreground" />
        <p className="max-w-80 text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  return (
    <SalesforceExportWorkbench
      key={org.username}
      environmentId={environmentId}
      cwd={cwd}
      org={org}
      openRecord={(recordId) => {
        toastManager.add({
          type: "info",
          title: `Opening ${recordId} in ${salesforceOrgName(org)}…`,
        });
        void salesforce.run(
          { type: "open", cwd, target: org.alias ?? org.username, recordId },
          "Could not open the record",
        );
      }}
    />
  );
}

function SalesforceExportWorkbench({
  environmentId,
  cwd,
  org,
  openRecord,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  org: SalesforceOrg;
  openRecord: (recordId: string) => void;
}) {
  const store = useSalesforceExportStore();
  const data = useAtomCommand(salesforceEnvironment.data, { reportFailure: false });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const runIdRef = useRef(0);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [filter, setFilter] = useState("");
  const [fieldFilter, setFieldFilter] = useState("");
  const [label, setLabel] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const activeTab = store.tabs.find((tab) => tab.id === store.activeTabId) ?? store.tabs[0]!;
  const soql = activeTab.soql;
  const target = org.username;
  const orgName = salesforceOrgName(org);
  const history = store.history[target] ?? [];
  const running = result?.running === true;

  const call = async <T extends SalesforceDataResult["type"]>(
    input: SalesforceDataRequest,
    type: T,
  ): Promise<Extract<SalesforceDataResult, { type: T }> | { error: string } | null> => {
    const response = await data({ environmentId, input });
    if (response._tag === "Success") {
      return response.value.type === type
        ? (response.value as Extract<SalesforceDataResult, { type: T }>)
        : { error: "Unexpected response." };
    }
    return isAtomCommandInterrupted(response) ? null : { error: failureMessage(response) };
  };

  const loadQuery = (text: string, tooling?: boolean) => {
    store.setSoql(activeTab.id, text);
    if (tooling !== undefined) store.setTooling(tooling);
    textareaRef.current?.focus();
  };

  const runExport = async () => {
    const query = soql.trim();
    if (query.length === 0 || running) return;
    const runId = ++runIdRef.current;
    const tooling = store.tooling;
    const started = performance.now();
    setInspection(null);
    store.recordHistory(target, { soql: query, tooling });
    let rows: ExportRow[] = [];
    let columns: string[] = [];
    let totalSize = 0;
    const snapshot = (
      patch: Pick<ExportResult, "running" | "capped" | "elapsedMs" | "error">,
    ): ExportResult => ({
      org: target,
      tooling,
      rows,
      columns,
      totalSize,
      stopped: false,
      ...patch,
    });
    setResult(snapshot({ running: true, capped: false, elapsedMs: null, error: null }));
    let request: SalesforceDataRequest = {
      type: "query",
      cwd,
      target,
      soql: query,
      queryAll: store.queryAll && !tooling,
      tooling,
    };
    for (;;) {
      const page: Extract<SalesforceDataResult, { type: "page" }> | { error: string } | null =
        await call(request, "page");
      if (runIdRef.current !== runId) return;
      const elapsedMs = performance.now() - started;
      if (page === null || "error" in page) {
        setResult(
          snapshot({
            running: false,
            capped: false,
            elapsedMs,
            error: page === null ? "Cancelled." : page.error,
          }),
        );
        return;
      }
      const added = page.records.map(flattenRecord);
      rows = rows.concat(added);
      columns = collectColumns(added, columns);
      totalSize = page.totalSize;
      const capped = page.nextRecordsUrl !== null && rows.length >= MAX_EXPORT_RECORDS;
      const done = page.nextRecordsUrl === null || capped;
      setResult(
        snapshot({ running: !done, capped, elapsedMs: done ? elapsedMs : null, error: null }),
      );
      if (done || page.nextRecordsUrl === null) return;
      request = { type: "queryMore", cwd, target, nextRecordsUrl: page.nextRecordsUrl };
    }
  };

  const stopExport = () => {
    runIdRef.current += 1;
    setResult((previous) =>
      previous === null || !previous.running
        ? previous
        : { ...previous, running: false, stopped: true },
    );
  };

  const showPlan = async () => {
    const query = soql.trim();
    if (query.length === 0) return;
    setInspecting(true);
    const response = await call(
      { type: "explain", cwd, target, soql: query, tooling: store.tooling },
      "explain",
    );
    setInspecting(false);
    if (response === null) return;
    if ("error" in response) {
      toastManager.add({ type: "error", title: "Query plan failed", description: response.error });
      return;
    }
    setInspection({ kind: "plan", plans: response.plans });
  };

  const showFields = async () => {
    const sobject = soqlObjectName(soql);
    if (sobject === null) {
      toastManager.add({ type: "warning", title: "Write a query with FROM <object> first." });
      return;
    }
    setInspecting(true);
    const response = await call(
      { type: "describe", cwd, target, sobject, tooling: store.tooling },
      "describe",
    );
    setInspecting(false);
    if (response === null) return;
    if ("error" in response) {
      toastManager.add({ type: "error", title: "Field info failed", description: response.error });
      return;
    }
    setFieldFilter("");
    setInspection({
      kind: "fields",
      name: response.name,
      label: response.label,
      fields: response.fields,
    });
  };

  const insertField = (name: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? soql.length;
    const end = textarea?.selectionEnd ?? soql.length;
    const next = `${soql.slice(0, start)}${name}${soql.slice(end)}`;
    store.setSoql(activeTab.id, next);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + name.length, start + name.length);
    });
  };

  const allColumns = result?.columns ?? [];
  const allRows = result?.rows ?? [];
  const columns = store.hideEmptyColumns ? nonEmptyColumns(allColumns, allRows) : allColumns;
  const rows = filterRows(allRows, columns, filter);
  const idsToDelete = result === null || result.tooling ? [] : deletableIds(rows);
  const production = isProductionOrg(org);

  const copy = (text: string, what: string) => {
    void writeTextToClipboard(text).then(
      () => toastManager.add({ type: "success", title: `Copied ${rows.length} rows as ${what}` }),
      () => toastManager.add({ type: "error", title: "Could not copy to the clipboard" }),
    );
  };

  const download = () => {
    const blob = new Blob([`﻿${toDelimited(columns, rows, ",")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${soqlObjectName(soql) ?? "export"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteRecords = async () => {
    const ids = idsToDelete;
    setDeleting(true);
    const deleted = new Set<string>();
    const failures: string[] = [];
    for (const batch of chunk(ids, SALESFORCE_DELETE_BATCH_SIZE)) {
      const response = await call({ type: "delete", cwd, target, ids: batch }, "delete");
      if (response === null) break;
      if ("error" in response) {
        failures.push(response.error);
        break;
      }
      for (const item of response.results) {
        if (item.success) deleted.add(item.id);
        else failures.push(`${item.id}: ${item.error ?? "not deleted"}`);
      }
    }
    setDeleting(false);
    setResult((previous) =>
      previous === null
        ? previous
        : {
            ...previous,
            rows: previous.rows.filter((row) => !deleted.has(String(row.Id ?? ""))),
            totalSize: Math.max(0, previous.totalSize - deleted.size),
          },
    );
    toastManager.add({
      type: failures.length === 0 ? "success" : "error",
      title: `Deleted ${deleted.size} of ${ids.length} records in ${orgName}`,
      ...(failures.length > 0
        ? { description: failures.slice(0, 3).join("\n") + (failures.length > 3 ? "\n…" : "") }
        : {}),
    });
  };

  const saveQuery = () => {
    const query = soql.trim();
    if (query.length === 0) return;
    const name = label.trim() || soqlObjectName(query) || query.slice(0, 40);
    store.saveQuery({ label: name, soql: query, tooling: store.tooling });
    setLabel("");
    toastManager.add({ type: "success", title: `Saved "${name}"` });
  };

  const fieldWords = fieldFilter.toLowerCase().split(/\s+/).filter(Boolean);
  const fields =
    inspection?.kind === "fields"
      ? inspection.fields.filter((field) => {
          const text = `${field.name} ${field.label} ${field.type}`.toLowerCase();
          return fieldWords.every((word) => text.includes(word));
        })
      : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <CloudIcon aria-hidden className="size-4 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium">{orgName}</span>
          <SalesforceTypeBadge type={org.type} />
          <div className="ms-auto flex flex-wrap items-center gap-1">
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="xs" />}>
                Templates
                <ChevronDownIcon aria-hidden />
              </MenuTrigger>
              <MenuPopup align="end" className="w-80">
                {QUERY_TEMPLATES.map((template) => (
                  <MenuItem
                    key={template.label}
                    onClick={() => loadQuery(template.soql, template.tooling ?? false)}
                  >
                    <span className="min-w-0 flex-1 truncate">{template.label}</span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="xs" />}>
                <HistoryIcon aria-hidden />
                History
              </MenuTrigger>
              <MenuPopup align="end" className="w-96">
                <MenuGroup>
                  <MenuGroupLabel>Recent queries in {orgName}</MenuGroupLabel>
                  <div className="max-h-72 overflow-y-auto">
                    {history.map((entry) => (
                      <MenuItem
                        key={`${entry.tooling}:${entry.soql}`}
                        onClick={() => loadQuery(entry.soql, entry.tooling)}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {entry.soql}
                        </span>
                        {entry.tooling ? <MenuItemDetail>Tooling</MenuItemDetail> : null}
                      </MenuItem>
                    ))}
                    {history.length === 0 ? <MenuItem disabled>No queries yet</MenuItem> : null}
                  </div>
                </MenuGroup>
                {history.length > 0 ? (
                  <>
                    <MenuSeparator />
                    <MenuItem onClick={() => store.clearHistory(target)}>
                      <Trash2Icon aria-hidden />
                      Clear history
                    </MenuItem>
                  </>
                ) : null}
              </MenuPopup>
            </Menu>
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="xs" />}>
                <BookmarkIcon aria-hidden />
                Saved
              </MenuTrigger>
              <MenuPopup align="end" className="w-96">
                <div className="max-h-72 overflow-y-auto">
                  {store.saved.map((entry) => (
                    <MenuItem
                      key={entry.label}
                      onClick={() => loadQuery(entry.soql, entry.tooling)}
                    >
                      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                      <Button
                        variant="ghost-destructive"
                        size="icon-micro"
                        aria-label={`Delete saved query ${entry.label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          store.removeSaved(entry.label);
                        }}
                      >
                        <XIcon aria-hidden />
                      </Button>
                    </MenuItem>
                  ))}
                  {store.saved.length === 0 ? <MenuItem disabled>No saved queries</MenuItem> : null}
                </div>
              </MenuPopup>
            </Menu>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Queries"
          className="flex items-center gap-0.5 overflow-x-auto"
        >
          {store.tabs.map((tab) => {
            const selected = tab.id === activeTab.id;
            return (
              <div
                key={tab.id}
                className={cn(
                  "flex shrink-0 items-center rounded-md border",
                  selected ? "border-border bg-accent" : "border-transparent",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="cursor-pointer px-2 py-0.5 text-xs"
                  onClick={() => store.selectTab(tab.id)}
                >
                  {soqlObjectName(tab.soql) ?? "New query"}
                </button>
                <Button
                  variant="ghost-muted"
                  size="icon-tiny"
                  aria-label="Close query tab"
                  onClick={() => store.closeTab(tab.id)}
                >
                  <XIcon aria-hidden />
                </Button>
              </div>
            );
          })}
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="New query tab"
            onClick={() => store.addTab()}
          >
            <PlusIcon aria-hidden />
          </Button>
        </div>

        <div className="font-mono">
          <Textarea
            ref={textareaRef}
            rows={5}
            size="sm"
            spellCheck={false}
            aria-label="SOQL query"
            placeholder="SELECT Id FROM Account"
            value={soql}
            onChange={(event) => store.setSoql(activeTab.id, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void runExport();
              }
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="flex items-center gap-1.5 text-xs">
            <Switch
              size="sm"
              checked={store.queryAll && !store.tooling}
              disabled={store.tooling}
              onCheckedChange={store.setQueryAll}
            />
            Deleted/archived records
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <Switch size="sm" checked={store.tooling} onCheckedChange={store.setTooling} />
            Tooling API
          </label>
          <div className="ms-auto flex items-center gap-1">
            <Input
              size="compact"
              aria-label="Query label"
              placeholder="Query label"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveQuery();
              }}
            />
            <Button variant="outline" size="xs" onClick={saveQuery} disabled={soql.trim() === ""}>
              Save query
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {running ? (
            <Button size="xs" variant="destructive-outline" onClick={stopExport}>
              <SquareIcon aria-hidden />
              Stop
            </Button>
          ) : (
            <Button size="xs" onClick={() => void runExport()} disabled={soql.trim() === ""}>
              <PlayIcon aria-hidden />
              Run export
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={inspecting || soql.trim() === ""}
            onClick={() => void showPlan()}
          >
            Query plan
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={inspecting || soql.trim() === ""}
            onClick={() => void showFields()}
          >
            Field info
          </Button>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => {
              store.setSoql(activeTab.id, "");
              textareaRef.current?.focus();
            }}
          >
            Clear
          </Button>
          <span className="ms-auto text-xs text-muted-foreground">Ctrl+Enter runs</span>
        </div>

        {inspection !== null ? (
          <div className="rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
              <span className="font-medium">
                {inspection.kind === "plan"
                  ? "Query plan"
                  : `${inspection.label} (${inspection.name}) · ${inspection.fields.length} fields`}
              </span>
              {inspection.kind === "fields" ? (
                <Input
                  size="compact"
                  aria-label="Filter fields"
                  placeholder="Filter fields"
                  value={fieldFilter}
                  onChange={(event) => setFieldFilter(event.currentTarget.value)}
                />
              ) : null}
              <Button
                variant="ghost-muted"
                size="icon-micro"
                className="ms-auto"
                aria-label="Close"
                onClick={() => setInspection(null)}
              >
                <XIcon aria-hidden />
              </Button>
            </div>
            <div className="max-h-48 overflow-auto text-xs">
              {inspection.kind === "plan" ? (
                <QueryPlans plans={inspection.plans} />
              ) : (
                <table className="w-full">
                  <tbody>
                    {fields.map((field) => (
                      <tr key={field.name} className="border-b border-border/60">
                        <td className="px-2 py-0.5">
                          <button
                            type="button"
                            className="cursor-pointer font-mono text-primary hover:underline"
                            aria-label={`Insert ${field.name} into the query`}
                            onClick={() => insertField(field.name)}
                          >
                            {field.name}
                          </button>
                        </td>
                        <td className="px-2 py-0.5 text-muted-foreground">
                          {field.type}
                          {field.referenceTo.length > 0 ? ` → ${field.referenceTo.join(", ")}` : ""}
                          {field.length ? ` (${field.length})` : ""}
                        </td>
                        <td className="truncate px-2 py-0.5">{field.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {result !== null ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
            <Button
              size="xs"
              variant="outline"
              disabled={rows.length === 0}
              onClick={() => copy(toDelimited(columns, rows, "\t"), "Excel")}
            >
              Copy (Excel)
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={rows.length === 0}
              onClick={() => copy(toDelimited(columns, rows, ","), "CSV")}
            >
              Copy (CSV)
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={rows.length === 0}
              onClick={() => copy(toJson(columns, rows), "JSON")}
            >
              Copy (JSON)
            </Button>
            <Button
              size="icon-xs"
              variant="outline"
              aria-label="Download CSV"
              disabled={rows.length === 0}
              onClick={download}
            >
              <DownloadIcon aria-hidden />
            </Button>
            <Button
              size="icon-xs"
              variant={store.hideEmptyColumns ? "secondary" : "outline"}
              aria-label={store.hideEmptyColumns ? "Show empty columns" : "Hide empty columns"}
              aria-pressed={store.hideEmptyColumns}
              onClick={() => store.setHideEmptyColumns(!store.hideEmptyColumns)}
            >
              <EyeOffIcon aria-hidden />
            </Button>
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={idsToDelete.length === 0 || running || deleting}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2Icon aria-hidden />
              {deleting ? "Deleting…" : "Delete records"}
            </Button>
            <Input
              size="compact"
              className="w-40"
              aria-label="Filter results"
              placeholder="Filter"
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
            <span
              role="status"
              className={cn(
                "ms-auto text-xs",
                result.error !== null ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {result.error !== null
                ? result.error
                : `${exportStatus({
                    loaded: result.rows.length,
                    totalSize: result.totalSize,
                    running: result.running,
                    stopped: result.stopped,
                    elapsedMs: result.elapsedMs ?? 0,
                  })}${result.elapsedMs !== null ? ` · ${formatElapsed(result.elapsedMs)}` : ""}${
                    result.capped
                      ? ` · capped at ${MAX_EXPORT_RECORDS.toLocaleString("en-US")}`
                      : ""
                  }${filter.trim() ? ` · ${rows.length} shown` : ""}`}
            </span>
          </div>
          {columns.length > 0 ? (
            <SalesforceExportTable columns={columns} rows={rows} onOpenRecord={openRecord} />
          ) : (
            <div className="border-t border-border p-4 text-center text-xs text-muted-foreground">
              {result.running ? "Running…" : result.error === null ? "No records." : null}
            </div>
          )}
        </>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {idsToDelete.length} {idsToDelete.length === 1 ? "record" : "records"} in{" "}
              {orgName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The {idsToDelete.length === 1 ? "record" : "records"} shown in the table go to the
              Recycle Bin of {orgName} ({org.username}). Records that cannot be deleted are reported
              afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {production ? (
            <div className="px-6">
              <Alert variant="error">
                <AlertTitle>This is a production org</AlertTitle>
                <AlertDescription>
                  You are deleting real data in {orgName}. Check the filter and the query before you
                  continue.
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDelete(false);
                void deleteRecords();
              }}
            >
              Delete {idsToDelete.length} {idsToDelete.length === 1 ? "record" : "records"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

function QueryPlans({ plans }: { plans: ReadonlyArray<SalesforceQueryPlan> }) {
  if (plans.length === 0) return <p className="p-2 text-muted-foreground">No plans returned.</p>;
  return (
    <table className="w-full">
      <thead className="text-muted-foreground">
        <tr className="border-b border-border/60 text-left">
          <th className="px-2 py-0.5 font-medium">Operation</th>
          <th className="px-2 py-0.5 font-medium">Cost</th>
          <th className="px-2 py-0.5 font-medium">Rows</th>
          <th className="px-2 py-0.5 font-medium">Object rows</th>
          <th className="px-2 py-0.5 font-medium">Fields</th>
        </tr>
      </thead>
      <tbody>
        {plans.map((plan) => (
          <tr
            key={`${plan.leadingOperationType}:${plan.sobjectType}:${plan.relativeCost}:${plan.fields.join(",")}`}
            className="border-b border-border/60 align-top"
          >
            <td className="px-2 py-0.5">
              {plan.leadingOperationType}
              {plan.sobjectType ? ` · ${plan.sobjectType}` : ""}
              {plan.notes.map((note) => (
                <div key={note} className="text-muted-foreground">
                  {note}
                </div>
              ))}
            </td>
            <td className="px-2 py-0.5 tabular-nums">{plan.relativeCost ?? ""}</td>
            <td className="px-2 py-0.5 tabular-nums">{plan.cardinality ?? ""}</td>
            <td className="px-2 py-0.5 tabular-nums">{plan.sobjectCardinality ?? ""}</td>
            <td className="px-2 py-0.5 font-mono">{plan.fields.join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
