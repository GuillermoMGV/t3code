import { useState } from "react";

import { cn } from "~/lib/utils";
import { cellText, isIdColumn, recordIdOf, type ExportRow } from "./salesforceExport.logic";

// Fork-only Salesforce Export panel; see CUSTOM_DEVELOPMENT.md.

const ROW_HEIGHT = 28;
const OVERSCAN = 12;
const SAMPLE_ROWS = 50;

/** A width per column from its header and the first rows, so scrolling never reflows. */
function columnWidth(column: string, rows: ReadonlyArray<ExportRow>): number {
  let longest = column.length;
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    longest = Math.max(longest, cellText(row[column]).length);
  }
  return Math.min(320, Math.max(72, longest * 7 + 20));
}

/** Only the rows in view are in the DOM, so tens of thousands of records scroll smoothly. */
export function SalesforceExportTable({
  columns,
  rows,
  onOpenRecord,
}: {
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<ExportRow>;
  onOpenRecord: (recordId: string) => void;
}) {
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const template = columns.map((column) => `${columnWidth(column, rows)}px`).join(" ");
  const first = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = rows.slice(first, last);

  return (
    <div
      role="table"
      aria-rowcount={rows.length + 1}
      className="min-h-0 flex-1 overflow-auto border-t border-border font-mono text-xs"
      onScroll={(event) => {
        const target = event.currentTarget;
        setViewport({ top: target.scrollTop, height: target.clientHeight });
      }}
    >
      <div className="w-max min-w-full">
        <div
          role="row"
          className="sticky top-0 z-10 grid border-b border-border bg-muted font-sans font-medium text-muted-foreground"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((column) => (
            <div role="columnheader" key={column} className="truncate px-2 py-1.5">
              {column}
            </div>
          ))}
        </div>
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
          {visible.map((row, offset) => {
            const index = first + offset;
            return (
              <div
                role="row"
                aria-rowindex={index + 2}
                key={index}
                className={cn(
                  "absolute inset-x-0 grid items-center border-b border-border/60",
                  index % 2 === 1 && "bg-muted/40",
                )}
                style={{
                  top: index * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  gridTemplateColumns: template,
                }}
              >
                {columns.map((column) => {
                  const value = row[column];
                  const recordId = isIdColumn(column) ? recordIdOf(value) : null;
                  return (
                    <div role="cell" key={column} className="truncate px-2">
                      {recordId !== null ? (
                        <button
                          type="button"
                          className="cursor-pointer text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
                          aria-label={`Open ${recordId} in the org`}
                          onClick={() => onOpenRecord(recordId)}
                        >
                          {recordId}
                        </button>
                      ) : (
                        cellText(value)
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
