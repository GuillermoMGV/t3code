import { describe, expect, it } from "vite-plus/test";

import {
  chunk,
  collectColumns,
  deletableIds,
  exportStatus,
  filterRows,
  flattenRecord,
  nonEmptyColumns,
  pushQueryHistory,
  soqlObjectName,
  toDelimited,
  toJson,
} from "./salesforceExport.logic";

const ACCOUNT_ID = "001FT000012K8XgYAK";

describe("soqlObjectName", () => {
  it("names the outer object, skipping subqueries", () => {
    expect(soqlObjectName("SELECT Id FROM Account WHERE Id = 'x'")).toBe("Account");
    expect(
      soqlObjectName("select Id, (SELECT Id FROM Contacts) from Custom__c where Name != null"),
    ).toBe("Custom__c");
    expect(soqlObjectName("SELECT Id")).toBeNull();
  });
});

describe("flattenRecord", () => {
  it("flattens relationships, drops attributes and keeps child subqueries as JSON", () => {
    const row = flattenRecord({
      attributes: { type: "Contact", url: "/x" },
      Id: ACCOUNT_ID,
      Owner: { attributes: { type: "User" }, Name: "Ada", Manager: null },
      Account: null,
      MailingAddress: { city: "Zurich", country: "CH" },
      Cases: {
        totalSize: 1,
        done: true,
        records: [{ attributes: { type: "Case" }, Subject: "Help" }],
      },
      Amount: 12.5,
      IsActive: false,
    });
    expect(row).toEqual({
      Id: ACCOUNT_ID,
      "Owner.Name": "Ada",
      "Owner.Manager": null,
      Account: null,
      MailingAddress: '{"city":"Zurich","country":"CH"}',
      Cases: '[{"Subject":"Help"}]',
      Amount: 12.5,
      IsActive: false,
    });
  });
});

describe("columns and filtering", () => {
  const rows = [
    { Id: ACCOUNT_ID, Name: "Acme", Phone: null },
    { Id: "001FT000012K8XhYAK", Name: "Globex", "Owner.Name": "Ada", Phone: null },
  ];

  it("collects columns in first-seen order and hides empty ones", () => {
    const columns = collectColumns(rows);
    expect(columns).toEqual(["Id", "Name", "Phone", "Owner.Name"]);
    expect(nonEmptyColumns(columns, rows)).toEqual(["Id", "Name", "Owner.Name"]);
  });

  it("matches every word across the visible cells, ignoring case", () => {
    expect(filterRows(rows, ["Name", "Owner.Name"], "glo ADA")).toEqual([rows[1]]);
    expect(filterRows(rows, ["Name"], "ada")).toEqual([]);
    expect(filterRows(rows, ["Name"], "  ")).toBe(rows);
  });

  it("lists each record Id once for deletion", () => {
    expect(deletableIds([...rows, rows[0]!, { Id: "not-an-id" }])).toEqual([
      ACCOUNT_ID,
      "001FT000012K8XhYAK",
    ]);
  });
});

describe("export formats", () => {
  const columns = ["Name", "Note"];
  const rows = [
    { Name: "Acme, Inc.", Note: 'Said "hi"\nthen left' },
    { Name: "Tab\there", Note: null },
  ];

  it("quotes CSV cells with commas, quotes or line breaks", () => {
    expect(toDelimited(columns, rows, ",")).toBe(
      'Name,Note\r\n"Acme, Inc.","Said ""hi""\nthen left"\r\nTab\there,',
    );
  });

  it("quotes TSV cells that contain tabs so Excel keeps the columns", () => {
    expect(toDelimited(columns, rows, "\t")).toBe(
      'Name\tNote\r\nAcme, Inc.\t"Said ""hi""\nthen left"\r\n"Tab\there"\t',
    );
  });

  it("writes JSON with only the visible columns", () => {
    expect(JSON.parse(toJson(["Name"], rows))).toEqual([
      { Name: "Acme, Inc." },
      { Name: "Tab\there" },
    ]);
  });
});

describe("pushQueryHistory", () => {
  it("moves a repeated query to the top and caps the list", () => {
    const history = [
      { soql: "SELECT Id FROM Account", tooling: false },
      { soql: "SELECT Id FROM Contact", tooling: false },
    ];
    expect(
      pushQueryHistory(history, { soql: "select  id from account", tooling: false }, 2),
    ).toEqual([
      { soql: "select  id from account", tooling: false },
      { soql: "SELECT Id FROM Contact", tooling: false },
    ]);
    expect(pushQueryHistory(history, { soql: "SELECT Id FROM User", tooling: false }, 2)).toEqual([
      { soql: "SELECT Id FROM User", tooling: false },
      { soql: "SELECT Id FROM Account", tooling: false },
    ]);
  });
});

describe("chunk and status", () => {
  it("splits deletes into API-sized batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("describes progress and the final count", () => {
    const base = { elapsedMs: 0, running: false, stopped: false };
    expect(exportStatus({ ...base, loaded: 1, totalSize: 1 })).toBe("Exported 1 record");
    expect(exportStatus({ ...base, running: true, loaded: 2000, totalSize: 5000 })).toBe(
      "Exporting 2,000 of 5,000 records",
    );
    expect(exportStatus({ ...base, stopped: true, loaded: 2000, totalSize: 5000 })).toBe(
      "Stopped at 2,000 of 5,000 records",
    );
  });
});
