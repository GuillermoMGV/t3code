// Fork-only Salesforce Export panel; see CUSTOM_DEVELOPMENT.md.

import { isSalesforceRecordId } from "../chat/salesforceRecordIds.logic";

/** Rows past this stop the export, so a huge query cannot exhaust the client or the socket. */
export const MAX_EXPORT_RECORDS = 50_000;

export type ExportCell = string | number | boolean | null;
export type ExportRow = Readonly<Record<string, ExportCell>>;

export interface QueryTemplate {
  readonly label: string;
  readonly soql: string;
  readonly tooling?: boolean;
}

export const QUERY_TEMPLATES: ReadonlyArray<QueryTemplate> = [
  {
    label: "Recent accounts",
    soql: "SELECT Id, Name, CreatedDate FROM Account ORDER BY CreatedDate DESC LIMIT 100",
  },
  {
    label: "Contacts with account",
    soql: "SELECT Id, Name, Email, Account.Name FROM Contact LIMIT 100",
  },
  {
    label: "Active users",
    soql: "SELECT Id, Name, Username, Profile.Name FROM User WHERE IsActive = true",
  },
  { label: "Record types", soql: "SELECT Id, Name, DeveloperName, SobjectType FROM RecordType" },
  {
    label: "Recent Apex jobs",
    soql: "SELECT Id, ApexClass.Name, Status, JobType, CreatedDate FROM AsyncApexJob ORDER BY CreatedDate DESC LIMIT 50",
  },
  {
    label: "Apex classes (Tooling)",
    soql: "SELECT Id, Name, ApiVersion, Status FROM ApexClass ORDER BY Name",
    tooling: true,
  },
];

/** The object a query reads: the first `FROM` outside parenthesized subqueries. */
export function soqlObjectName(soql: string): string | null {
  let depth = 0;
  let outer = "";
  for (const char of soql) {
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) outer += char;
  }
  return /\bfrom\s+([A-Za-z]\w*)/i.exec(outer)?.[1] ?? null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSubqueryResult(value: Record<string, unknown>): boolean {
  return Array.isArray(value.records) && typeof value.totalSize === "number";
}

/**
 * One table row per record: relationships become dotted columns (`Owner.Name`), and child
 * subqueries a JSON cell. The API's `attributes` blocks are dropped.
 */
export function flattenRecord(record: unknown): ExportRow {
  const row: Record<string, ExportCell> = {};
  const visit = (value: unknown, prefix: string) => {
    if (!isPlainObject(value)) return;
    for (const [key, field] of Object.entries(value)) {
      if (key === "attributes") continue;
      const column = prefix ? `${prefix}.${key}` : key;
      if (isPlainObject(field)) {
        if (isSubqueryResult(field)) {
          row[column] = JSON.stringify((field.records as unknown[]).map(withoutAttributes));
        } else if ("attributes" in field) {
          visit(field, column);
        } else {
          // Compound fields such as addresses and geolocations.
          row[column] = JSON.stringify(field);
        }
      } else if (Array.isArray(field)) {
        row[column] = JSON.stringify(field);
      } else if (
        field === null ||
        typeof field === "string" ||
        typeof field === "number" ||
        typeof field === "boolean"
      ) {
        row[column] = field;
      } else {
        row[column] = null;
      }
    }
  };
  visit(record, "");
  return row;
}

function withoutAttributes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAttributes);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "attributes")
      .map(([key, field]) => [key, withoutAttributes(field)]),
  );
}

/** Every column in the order it first appears. */
export function collectColumns(
  rows: ReadonlyArray<ExportRow>,
  previous: ReadonlyArray<string> = [],
) {
  const seen = new Set(previous);
  const columns = [...previous];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

export function cellText(value: ExportCell | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Columns with at least one non-empty cell. */
export function nonEmptyColumns(columns: ReadonlyArray<string>, rows: ReadonlyArray<ExportRow>) {
  return columns.filter((column) => rows.some((row) => cellText(row[column]) !== ""));
}

/** Rows where some visible cell contains every word of the query, ignoring case. */
export function filterRows(
  rows: ReadonlyArray<ExportRow>,
  columns: ReadonlyArray<string>,
  query: string,
): ReadonlyArray<ExportRow> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const text = columns
      .map((column) => cellText(row[column]))
      .join("\u0000")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

function quoteCell(text: string, separator: string): string {
  return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV (`,`) or Excel-pasteable TSV (`\t`), header first, quoted as RFC 4180 does. */
export function toDelimited(
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ExportRow>,
  separator: "," | "\t",
): string {
  const lines = [columns, ...rows.map((row) => columns.map((column) => cellText(row[column])))];
  return lines
    .map((cells) => cells.map((cell) => quoteCell(cell, separator)).join(separator))
    .join("\r\n");
}

export function toJson(columns: ReadonlyArray<string>, rows: ReadonlyArray<ExportRow>): string {
  return JSON.stringify(
    rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null]))),
    null,
    2,
  );
}

/** Columns whose values are record IDs that open in the org. */
export function isIdColumn(column: string): boolean {
  return /Id$/.test(column);
}

export function recordIdOf(value: ExportCell | undefined): string | null {
  return typeof value === "string" && isSalesforceRecordId(value) ? value : null;
}

/** The record IDs among the rows' `Id` column, without duplicates. */
export function deletableIds(rows: ReadonlyArray<ExportRow>): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = recordIdOf(row.Id);
    if (id !== null) ids.add(id);
  }
  return [...ids];
}

export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export interface QueryHistoryEntry {
  readonly soql: string;
  readonly tooling: boolean;
}

/** The query moves to the top; older duplicates go and the list keeps `max` entries. */
export function pushQueryHistory(
  history: ReadonlyArray<QueryHistoryEntry>,
  entry: QueryHistoryEntry,
  max = 30,
): QueryHistoryEntry[] {
  const key = normalizeSoql(entry.soql);
  return [
    entry,
    ...history.filter((item) => normalizeSoql(item.soql) !== key || item.tooling !== entry.tooling),
  ].slice(0, max);
}

function normalizeSoql(soql: string): string {
  return soql.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "Exported 1 record" / "Exported 1,234 of 5,000 records" with the elapsed time. */
export function exportStatus(input: {
  readonly loaded: number;
  readonly totalSize: number;
  readonly running: boolean;
  readonly stopped: boolean;
  readonly elapsedMs: number;
}): string {
  const count = input.loaded.toLocaleString("en-US");
  const noun = input.totalSize === 1 ? "record" : "records";
  const ofTotal =
    input.loaded < input.totalSize ? ` of ${input.totalSize.toLocaleString("en-US")}` : "";
  const verb = input.running ? "Exporting" : input.stopped ? "Stopped at" : "Exported";
  return `${verb} ${count}${ofTotal} ${noun}`;
}

export function formatElapsed(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(1)}ms` : `${Math.round(ms).toLocaleString("en-US")}ms`;
}
