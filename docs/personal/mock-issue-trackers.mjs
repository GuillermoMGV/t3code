// Minimal mocks of the Linear GraphQL API (port 4567, key "test-key") and the Jira Cloud REST API
// (port 4568, email "dev@example.com", token "test-token") for local UI checks.
// See CUSTOM_DEVELOPMENT.md, "Personalizaciones del fork".
import * as NodeHttp from "node:http";

const linearIssues = [
  {
    identifier: "PRO-1234",
    title: "Login fails with SSO for invited users",
    url: "https://linear.app/acme/issue/PRO-1234/login-fails-with-sso",
    priorityLabel: "High",
    updatedAt: "2026-11-17T09:00:00.000Z",
    state: { name: "In Progress", color: "#f2c94c", type: "started" },
    assignee: { name: "Guillermo Miranda", avatarUrl: null },
  },
  {
    identifier: "PRO-1240",
    title: "Export threads as Markdown",
    url: "https://linear.app/acme/issue/PRO-1240/export-threads",
    priorityLabel: "Medium",
    updatedAt: "2026-11-16T09:00:00.000Z",
    state: { name: "Todo", color: "#e2e2e2", type: "unstarted" },
    assignee: null,
  },
  {
    identifier: "ENG-77",
    title: "Speed up sidebar rendering",
    url: "https://linear.app/acme/issue/ENG-77/speed-up-sidebar",
    priorityLabel: "Low",
    updatedAt: "2026-11-15T09:00:00.000Z",
    state: { name: "In Review", color: "#0f783c", type: "started" },
    assignee: { name: "Ada Lovelace", avatarUrl: null },
  },
];

const jiraIssues = [
  {
    key: "OPS-7",
    fields: {
      summary: "Rotate the production certificates",
      updated: "2026-11-17T08:00:00.000+0000",
      status: {
        name: "In Progress",
        statusCategory: { key: "indeterminate", colorName: "yellow" },
      },
      assignee: { displayName: "Guillermo Miranda", avatarUrls: {} },
      priority: { name: "High" },
    },
  },
  {
    key: "OPS-12",
    fields: {
      summary: "Document the backup restore drill",
      updated: "2026-11-16T08:00:00.000+0000",
      status: { name: "To Do", statusCategory: { key: "new", colorName: "blue-gray" } },
      assignee: null,
      priority: { name: "Medium" },
    },
  },
  {
    key: "SUP-301",
    fields: {
      summary: "Customer cannot reset password",
      updated: "2026-11-15T08:00:00.000+0000",
      status: { name: "Done", statusCategory: { key: "done", colorName: "green" } },
      assignee: { displayName: "Ada Lovelace", avatarUrls: {} },
      priority: { name: "Low" },
    },
  },
];

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
  });

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

NodeHttp.createServer(async (req, res) => {
  const raw = await readBody(req);
  if (req.headers.authorization !== "test-key") {
    return sendJson(res, 400, {
      errors: [
        { message: "Authentication required", extensions: { type: "authentication error" } },
      ],
    });
  }
  const { query, variables } = JSON.parse(raw || "{}");
  console.log("linear", query.split("{")[0].trim(), JSON.stringify(variables));
  if (query.includes("assignedIssues")) {
    return sendJson(res, 200, {
      data: { viewer: { assignedIssues: { nodes: linearIssues.slice(0, 2) } } },
    });
  }
  if (query.includes("viewer")) {
    return sendJson(res, 200, { data: { viewer: { name: "Guillermo (mock)" } } });
  }
  if (query.includes("issue(id")) {
    // MOCK_LINEAR_ANY_KEY=1 answers every `PRO-` key, to test pull request badges on real lists.
    const found =
      linearIssues.find((issue) => issue.identifier === variables.id) ??
      (process.env.MOCK_LINEAR_ANY_KEY === "1" && String(variables.id).startsWith("PRO-")
        ? { ...linearIssues[Number(variables.id.slice(4)) % 3], identifier: variables.id }
        : undefined);
    return found
      ? sendJson(res, 200, { data: { issue: found } })
      : sendJson(res, 200, { data: null, errors: [{ message: "Entity not found" }] });
  }
  if (query.includes("searchIssues")) {
    const term = String(variables.term).toLowerCase();
    const nodes = linearIssues.filter((issue) => issue.title.toLowerCase().includes(term));
    return sendJson(res, 200, { data: { searchIssues: { nodes } } });
  }
  sendJson(res, 400, { errors: [{ message: "Unknown query" }] });
}).listen(4567, "127.0.0.1", () => console.log("mock Linear on http://127.0.0.1:4567/graphql"));

const JIRA_AUTH = `Basic ${btoa("dev@example.com:test-token")}`;

NodeHttp.createServer(async (req, res) => {
  const raw = await readBody(req);
  const url = new URL(req.url, "http://127.0.0.1:4568");
  console.log("jira", req.method, url.pathname, raw);
  if (req.headers.authorization !== JIRA_AUTH) return sendJson(res, 401, {});
  if (url.pathname === "/rest/api/3/myself") {
    return sendJson(res, 200, { displayName: "Guillermo (mock Jira)" });
  }
  const issueMatch = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(url.pathname);
  if (issueMatch) {
    const found = jiraIssues.find((issue) => issue.key === decodeURIComponent(issueMatch[1]));
    return found
      ? sendJson(res, 200, found)
      : sendJson(res, 404, { errorMessages: ["Issue does not exist"] });
  }
  if (url.pathname === "/rest/api/3/search/jql" && req.method === "POST") {
    const { jql } = JSON.parse(raw || "{}");
    const text = /text ~ "((?:[^"\\]|\\.)*)"/.exec(jql)?.[1]?.toLowerCase();
    const issues = jql.includes("currentUser()")
      ? jiraIssues.filter((issue) => issue.fields.status.statusCategory.key !== "done").slice(0, 2)
      : jiraIssues.filter((issue) => issue.fields.summary.toLowerCase().includes(text ?? ""));
    return sendJson(res, 200, { issues, isLast: true });
  }
  sendJson(res, 404, { errorMessages: ["Not found"] });
}).listen(4568, "127.0.0.1", () => console.log("mock Jira on http://127.0.0.1:4568"));
