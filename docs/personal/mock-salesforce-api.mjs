// Minimal mock of the Salesforce REST API (port 4569) for checking the Salesforce Export panel
// without touching a real org. Start the dev server with T3CODE_SALESFORCE_API_URL pointing here.
// See CUSTOM_DEVELOPMENT.md, "Personalizaciones del fork". MOCK_SALESFORCE_PORT moves it.
import * as NodeHttp from "node:http";

const PORT = Number(process.env.MOCK_SALESFORCE_PORT ?? 4569);
const PAGE_SIZE = 2000;
const TOTAL = 4500;
const PAGE_DELAY_MS = 400;

const CHECKSUM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

/** An 18-character ID with a valid case checksum, so the panel links it. */
function recordId(index) {
  const id15 = `001FT000${String(index).padStart(7, "0")}`;
  let suffix = "";
  for (let block = 0; block < 3; block += 1) {
    let bits = 0;
    for (let bit = 0; bit < 5; bit += 1) {
      const char = id15[block * 5 + bit];
      if (char >= "A" && char <= "Z") bits |= 1 << bit;
    }
    suffix += CHECKSUM_CHARS[bits];
  }
  return `${id15}${suffix}`;
}

function account(index) {
  return {
    attributes: {
      type: "Account",
      url: `/services/data/v62.0/sobjects/Account/${recordId(index)}`,
    },
    Id: recordId(index),
    Name: `Mock Account ${index}`,
    Phone: null,
    Industry: index % 3 === 0 ? "Banking" : "Real Estate",
    Owner: { attributes: { type: "User" }, Name: index % 2 === 0 ? "Ada Lovelace" : "Alan Turing" },
    CreatedDate: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
  };
}

function limitOf(soql) {
  const match = /\blimit\s+(\d+)/i.exec(soql);
  return match ? Math.min(Number(match[1]), TOTAL) : TOTAL;
}

// Cursor id -> { offset, total }.
const cursors = new Map();
let cursorCount = 0;

function page(offset, total) {
  const end = Math.min(offset + PAGE_SIZE, total);
  const records = [];
  for (let index = offset; index < end; index += 1) records.push(account(index + 1));
  let nextRecordsUrl;
  if (end < total) {
    const cursor = `01gMOCK${(cursorCount += 1)}-${end}`;
    cursors.set(cursor, { offset: end, total });
    nextRecordsUrl = `/services/data/v62.0/query/${cursor}`;
  }
  return {
    totalSize: total,
    done: end >= total,
    ...(nextRecordsUrl ? { nextRecordsUrl } : {}),
    records,
  };
}

const fields = [
  ["Id", "Account ID", "id", [], 18],
  ["Name", "Account Name", "string", [], 255],
  ["Phone", "Account Phone", "phone", [], 40],
  ["Industry", "Industry", "picklist", [], 255],
  ["OwnerId", "Owner ID", "reference", ["User"], 18],
  ["CreatedDate", "Created Date", "datetime", [], 0],
].map(([name, label, type, referenceTo, length]) => ({
  name,
  label,
  type,
  referenceTo,
  relationshipName: name === "OwnerId" ? "Owner" : null,
  length,
  nillable: name !== "Id",
  custom: false,
}));

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = NodeHttp.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  if (request.headers.authorization !== "Bearer mock-token") {
    return send(response, 401, [
      { message: "Session expired or invalid", errorCode: "INVALID_SESSION_ID" },
    ]);
  }
  const path = url.pathname.replace(/^\/services\/data\/v[\d.]+/, "");
  console.log(request.method, url.pathname, url.search.slice(0, 80));

  if (request.method === "DELETE" && path === "/composite/sobjects") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    return send(
      response,
      200,
      ids.map((id, index) =>
        index === 1
          ? {
              id,
              success: false,
              errors: [
                { statusCode: "ENTITY_IS_LOCKED", message: "Record is locked by an approval." },
              ],
            }
          : { id, success: true, errors: [] },
      ),
    );
  }

  const soql = url.searchParams.get("q") ?? url.searchParams.get("explain") ?? "";
  if (/\bFORM\b/.test(soql)) {
    return send(response, 400, [
      { message: "unexpected token: 'FORM'", errorCode: "MALFORMED_QUERY" },
    ]);
  }

  if (/^\/(?:tooling\/)?query(?:All)?\/$/.test(path) && url.searchParams.has("explain")) {
    return send(response, 200, {
      plans: [
        {
          cardinality: 1,
          fields: ["Id"],
          leadingOperationType: "Index",
          notes: [],
          relativeCost: 0.0005,
          sobjectCardinality: TOTAL,
          sobjectType: "Account",
        },
        {
          cardinality: TOTAL,
          fields: [],
          leadingOperationType: "TableScan",
          notes: [
            {
              description: "Not considering filter for optimization because unindexed",
              fields: ["Industry"],
              tableEnumOrId: "Account",
            },
          ],
          relativeCost: 2.1,
          sobjectCardinality: TOTAL,
          sobjectType: "Account",
        },
      ],
      sourceQuery: soql,
    });
  }

  if (/^\/(?:tooling\/)?query(?:All)?\/$/.test(path)) {
    return setTimeout(() => send(response, 200, page(0, limitOf(soql))), PAGE_DELAY_MS);
  }

  const more = /^\/(?:tooling\/)?query\/([\w-]+)$/.exec(path);
  if (more) {
    const cursor = cursors.get(more[1]);
    if (!cursor)
      return send(response, 400, [
        { message: "invalid query locator", errorCode: "INVALID_QUERY_LOCATOR" },
      ]);
    return setTimeout(() => send(response, 200, page(cursor.offset, cursor.total)), PAGE_DELAY_MS);
  }

  const describe = /^\/(?:tooling\/)?sobjects\/(\w+)\/describe$/.exec(path);
  if (describe) {
    if (describe[1].toLowerCase() !== "account") {
      return send(response, 404, [
        { message: `sObject type '${describe[1]}' is not supported.`, errorCode: "NOT_FOUND" },
      ]);
    }
    return send(response, 200, { name: "Account", label: "Account", fields });
  }

  send(response, 404, [
    { message: `No mock for ${request.method} ${url.pathname}`, errorCode: "NOT_FOUND" },
  ]);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock Salesforce API on http://127.0.0.1:${PORT} (token "mock-token")`);
});
