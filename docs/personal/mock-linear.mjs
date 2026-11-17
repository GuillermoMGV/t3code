// Minimal mock of Linear's GraphQL API for local UI checks. Accepts only the key "test-key".
import * as NodeHttp from "node:http";

const issues = [
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

NodeHttp.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== "test-key") {
      return send(400, {
        errors: [
          { message: "Authentication required", extensions: { type: "authentication error" } },
        ],
      });
    }
    const { query, variables } = JSON.parse(raw || "{}");
    console.log(new Date().toISOString(), query.split("{")[0].trim(), JSON.stringify(variables));
    if (query.includes("assignedIssues")) {
      return send(200, { data: { viewer: { assignedIssues: { nodes: issues.slice(0, 2) } } } });
    }
    if (query.includes("viewer"))
      return send(200, { data: { viewer: { name: "Guillermo (mock)" } } });
    if (query.includes("issue(id")) {
      const found = issues.find((issue) => issue.identifier === variables.id);
      return found
        ? send(200, { data: { issue: found } })
        : send(200, {
            data: null,
            errors: [{ message: "Entity not found", extensions: { type: "invalid input" } }],
          });
    }
    if (query.includes("searchIssues")) {
      const term = String(variables.term).toLowerCase();
      return send(200, {
        data: {
          searchIssues: {
            nodes: issues.filter((issue) => issue.title.toLowerCase().includes(term)),
          },
        },
      });
    }
    send(400, { errors: [{ message: "Unknown query" }] });
  });
}).listen(4567, "127.0.0.1", () => console.log("mock linear on http://127.0.0.1:4567/graphql"));
