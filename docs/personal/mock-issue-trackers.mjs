// Minimal mocks of the Linear GraphQL API (port 4567, key "test-key") and the Jira Cloud REST API
// (port 4568, email "dev@example.com", token "test-token") for local UI checks.
// See CUSTOM_DEVELOPMENT.md, "Personalizaciones del fork". MOCK_LINEAR_PORT / MOCK_JIRA_PORT move them.
import * as NodeHttp from "node:http";

const LINEAR_PORT = Number(process.env.MOCK_LINEAR_PORT ?? 4567);
const JIRA_PORT = Number(process.env.MOCK_JIRA_PORT ?? 4568);

/** `YYYY-MM-DD` `days` from today, so the due-date badges show every urgency. */
const dueIn = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const linearIssues = [
  {
    identifier: "PRO-1234",
    title: "Login fails with SSO for invited users",
    url: "https://linear.app/acme/issue/PRO-1234/login-fails-with-sso",
    dueDate: dueIn(1),
    updatedAt: "2026-11-17T09:00:00.000Z",
    state: { name: "In Progress", color: "#f2c94c", type: "started" },
    assignee: { name: "Guillermo Miranda", avatarUrl: null },
    project: { name: "Login revamp", url: "https://linear.app/acme/project/login-revamp" },
  },
  {
    identifier: "PRO-1240",
    title: "Export threads as Markdown",
    url: "https://linear.app/acme/issue/PRO-1240/export-threads",
    dueDate: dueIn(12),
    updatedAt: "2026-11-16T09:00:00.000Z",
    state: { name: "Todo", color: "#e2e2e2", type: "unstarted" },
    assignee: null,
    project: null,
  },
  {
    identifier: "ENG-77",
    title: "Speed up sidebar rendering",
    url: "https://linear.app/acme/issue/ENG-77/speed-up-sidebar",
    dueDate: null,
    updatedAt: "2026-11-15T09:00:00.000Z",
    state: { name: "In Review", color: "#0f783c", type: "started" },
    assignee: { name: "Ada Lovelace", avatarUrl: null },
    project: { name: "Performance", url: "https://linear.app/acme/project/performance" },
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
      duedate: dueIn(-2),
      project: { key: "OPS", name: "Operations" },
    },
  },
  {
    key: "OPS-12",
    fields: {
      summary: "Document the backup restore drill",
      updated: "2026-11-16T08:00:00.000+0000",
      status: { name: "To Do", statusCategory: { key: "new", colorName: "blue-gray" } },
      assignee: null,
      duedate: dueIn(5),
      project: { key: "OPS", name: "Operations" },
    },
  },
  {
    key: "SUP-301",
    fields: {
      summary: "Customer cannot reset password",
      updated: "2026-11-15T08:00:00.000+0000",
      status: { name: "Done", statusCategory: { key: "done", colorName: "green" } },
      assignee: { displayName: "Ada Lovelace", avatarUrls: {} },
      duedate: dueIn(-10),
      project: { key: "SUP", name: "Support" },
    },
  },
];

// State and assignee pickers: what the issues can change to.
const LINEAR_STATES = [
  { id: "ls-backlog", name: "Backlog", color: "#bec2c8", type: "backlog", position: 0 },
  { id: "ls-todo", name: "Todo", color: "#e2e2e2", type: "unstarted", position: 0 },
  { id: "ls-progress", name: "In Progress", color: "#f2c94c", type: "started", position: 0 },
  { id: "ls-review", name: "In Review", color: "#0f783c", type: "started", position: 1 },
  { id: "ls-done", name: "Done", color: "#5e6ad2", type: "completed", position: 0 },
];
const LINEAR_MEMBERS = [
  { id: "lu-ada", name: "Ada Lovelace", avatarUrl: null, active: true },
  { id: "lu-grace", name: "Grace Hopper", avatarUrl: null, active: true },
  { id: "lu-guillermo", name: "Guillermo Miranda", avatarUrl: null, active: true },
];
const JIRA_STATUSES = [
  { id: "11", name: "To Do", statusCategory: { key: "new", colorName: "blue-gray" } },
  { id: "21", name: "In Progress", statusCategory: { key: "indeterminate", colorName: "yellow" } },
  { id: "31", name: "Done", statusCategory: { key: "done", colorName: "green" } },
];
const JIRA_USERS = [
  { accountId: "acc-ada", displayName: "Ada Lovelace", accountType: "atlassian" },
  { accountId: "acc-guillermo", displayName: "Guillermo Miranda", accountType: "atlassian" },
  { accountId: "acc-bot", displayName: "Automation for Jira", accountType: "app" },
];

// Notifications bell: times are relative to start, so the 3-day Jira window always holds them.
// GET /mock/notify on either port adds a fresh event, to watch the badge appear.
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const jiraTime = (iso) => iso.replace("Z", "+0000");
let linearNotificationSeq = 0;
const linearNotification = (type, issueIndex, minutes, extra = {}) => {
  const issue = linearIssues[issueIndex];
  return {
    id: `mock-notification-${++linearNotificationSeq}`,
    type,
    readAt: null,
    createdAt: minutesAgo(minutes),
    snoozedUntilAt: null,
    actor: { name: "Ada Lovelace" },
    issue: {
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      state: { name: issue.state.name },
    },
    comment: null,
    ...extra,
  };
};
const linearNotifications = [
  linearNotification("issueCommentMention", 0, 12, {
    comment: { body: "@guillermo can you confirm the SSO fix works for invited users?" },
  }),
  linearNotification("issueAssignedToYou", 1, 90),
  linearNotification("issueStatusChanged", 2, 300, { actor: { name: "Grace Hopper" } }),
  linearNotification("issueNewComment", 0, 60 * 26, {
    readAt: minutesAgo(60 * 25),
    comment: { body: "Reproduced on staging, logs attached." },
  }),
];

const ME = "acc-guillermo";
const ADA = { accountId: "acc-ada", displayName: "Ada Lovelace" };
const adf = (...content) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content }],
});
const jiraActivity = {
  "OPS-7": {
    comments: [
      {
        id: "5001",
        created: jiraTime(minutesAgo(20)),
        author: ADA,
        body: adf(
          { type: "text", text: "New certificates are ready, " },
          { type: "mention", attrs: { id: ME, text: "@Guillermo" } },
          { type: "text", text: " please roll them out." },
        ),
      },
      {
        id: "5002",
        created: jiraTime(minutesAgo(10)),
        author: { accountId: ME, displayName: "Guillermo Miranda" },
        body: adf({ type: "text", text: "On it." }),
      },
    ],
    histories: [
      {
        id: "9001",
        created: jiraTime(minutesAgo(45)),
        author: ADA,
        items: [
          {
            field: "assignee",
            fieldId: "assignee",
            from: null,
            to: ME,
            toString: "Guillermo Miranda",
          },
          { field: "status", fieldId: "status", fromString: "To Do", toString: "In Progress" },
        ],
      },
    ],
  },
  "OPS-12": {
    comments: [
      {
        id: "5003",
        created: jiraTime(minutesAgo(60 * 30)),
        author: ADA,
        body: adf({ type: "text", text: "Drill scheduled for Friday." }),
      },
    ],
    histories: [],
  },
};

// Ticket comments for the thread panel's comments popover (PRO-1234 has some, the others none).
const LINEAR_COMMENTS = {
  "PRO-1234": [
    {
      id: "lc-1",
      url: "https://linear.app/mock/issue/PRO-1234#comment-lc-1",
      body: "Tested on QA2 with this record: [https://example.com/lightning/r/Lead/00Q/view?ws=%2Flightning](<https://example.com/lightning/r/Lead/00Q/view?ws=%2Flightning>)\n\nSSO works, but the redirect after login lands on /home instead of the original page.",
      createdAt: minutesAgo(90),
      user: { name: "ada@example.com", displayName: "ada", avatarUrl: null },
    },
    {
      id: "lc-2",
      url: "https://linear.app/mock/issue/PRO-1234#comment-lc-2",
      body: "Thanks! I'll look at the redirect. Is it OK to release the SSO part today?",
      createdAt: minutesAgo(30),
      user: { name: "Guillermo Miranda", displayName: "guillermo", avatarUrl: null },
    },
    {
      id: "lc-3",
      body: "Yes, go ahead with PROD.",
      createdAt: minutesAgo(5),
      user: null,
    },
  ],
};

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
  if (req.url === "/mock/notify") {
    linearNotifications.unshift(
      linearNotification("issueNewComment", 2, 0, {
        comment: { body: `Mock comment #${linearNotificationSeq + 1} on the sidebar work.` },
      }),
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.headers.authorization !== "test-key") {
    return sendJson(res, 400, {
      errors: [
        { message: "Authentication required", extensions: { type: "authentication error" } },
      ],
    });
  }
  const { query, variables } = JSON.parse(raw || "{}");
  console.log("linear", query.split("{")[0].trim(), JSON.stringify(variables));
  if (query.includes("notificationUpdate")) {
    const data = {};
    for (const [name, value] of Object.entries(variables)) {
      if (!name.startsWith("id")) continue;
      const item = linearNotifications.find((notification) => notification.id === value);
      if (item) item.readAt = variables.readAt;
      data[`n${name.slice(2)}`] = { success: Boolean(item) };
    }
    return sendJson(res, 200, { data });
  }
  if (query.includes("notifications(")) {
    return sendJson(res, 200, { data: { notifications: { nodes: linearNotifications } } });
  }
  if (query.includes("assignedIssues")) {
    return sendJson(res, 200, {
      data: { viewer: { assignedIssues: { nodes: linearIssues.slice(0, 2) } } },
    });
  }
  if (query.includes("viewer")) {
    return sendJson(res, 200, { data: { viewer: { name: "Guillermo Miranda" } } });
  }
  if (query.includes("query EditOptions")) {
    const team = { states: { nodes: LINEAR_STATES }, members: { nodes: LINEAR_MEMBERS } };
    return sendJson(res, 200, { data: { issue: { team } } });
  }
  if (query.includes("issueUpdate")) {
    const issue = linearIssues.find((item) => item.identifier === variables.id);
    if (!issue)
      return sendJson(res, 200, { data: null, errors: [{ message: "Entity not found" }] });
    const { stateId, assigneeId } = variables.input;
    if (stateId !== undefined) {
      const state = LINEAR_STATES.find((item) => item.id === stateId);
      if (!state) return sendJson(res, 200, { data: null, errors: [{ message: "Invalid state" }] });
      issue.state = { name: state.name, color: state.color, type: state.type };
    }
    if (assigneeId !== undefined) {
      const member = LINEAR_MEMBERS.find((item) => item.id === assigneeId);
      issue.assignee = member ? { name: member.name, avatarUrl: member.avatarUrl } : null;
    }
    issue.updatedAt = new Date().toISOString();
    return sendJson(res, 200, { data: { issueUpdate: { success: true } } });
  }
  if (query.includes("query IssueComments")) {
    const comments = LINEAR_COMMENTS[variables.id] ?? [];
    return sendJson(res, 200, { data: { issue: { comments: { nodes: comments } } } });
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
  if (query.includes("issues(first")) {
    return sendJson(res, 200, { data: { issues: { nodes: linearIssues } } });
  }
  if (query.includes("searchIssues")) {
    const term = String(variables.term).toLowerCase();
    const nodes = linearIssues.filter((issue) => issue.title.toLowerCase().includes(term));
    return sendJson(res, 200, { data: { searchIssues: { nodes } } });
  }
  sendJson(res, 400, { errors: [{ message: "Unknown query" }] });
}).listen(LINEAR_PORT, "127.0.0.1", () =>
  console.log(`mock Linear on http://127.0.0.1:${LINEAR_PORT}/graphql`),
);

const JIRA_AUTH = `Basic ${btoa("dev@example.com:test-token")}`;

NodeHttp.createServer(async (req, res) => {
  const raw = await readBody(req);
  const url = new URL(req.url, `http://127.0.0.1:${JIRA_PORT}`);
  console.log("jira", req.method, url.pathname, raw);
  if (url.pathname === "/mock/notify") {
    const comments = jiraActivity["OPS-7"].comments;
    comments.push({
      id: String(6000 + comments.length),
      created: jiraTime(minutesAgo(0)),
      author: ADA,
      body: adf({ type: "text", text: `Mock Jira comment #${comments.length}.` }),
    });
    return sendJson(res, 200, { ok: true });
  }
  if (req.headers.authorization !== JIRA_AUTH) return sendJson(res, 401, {});
  if (url.pathname === "/rest/api/3/myself") {
    return sendJson(res, 200, { accountId: ME, displayName: "Guillermo Miranda" });
  }
  // /rest/api/3/issue/{key}/transitions and /rest/api/3/issue/{key}/assignee
  const [, , , , section, editKey, edit] = url.pathname.split("/");
  if (section === "issue" && (edit === "transitions" || edit === "assignee")) {
    const issue = jiraIssues.find((item) => item.key === decodeURIComponent(editKey));
    if (!issue) return sendJson(res, 404, { errorMessages: ["Issue does not exist"] });
    if (edit === "transitions" && req.method === "GET") {
      const transitions = JIRA_STATUSES.filter(
        (status) => status.name !== issue.fields.status.name,
      ).map((status) => ({ id: status.id, name: status.name, to: status }));
      return sendJson(res, 200, { transitions });
    }
    const body = JSON.parse(raw || "{}");
    if (edit === "transitions") {
      const status = JIRA_STATUSES.find((item) => item.id === body.transition?.id);
      // Like a real workflow screen: "Done" needs a resolution this mock never gets.
      if (status?.name === "Done") {
        return sendJson(res, 400, {
          errorMessages: [],
          errors: { resolution: "Resolution is required." },
        });
      }
      if (!status) return sendJson(res, 400, { errorMessages: ["Transition is not valid."] });
      issue.fields.status = { name: status.name, statusCategory: status.statusCategory };
    } else {
      const user = JIRA_USERS.find((item) => item.accountId === body.accountId);
      issue.fields.assignee = user ? { displayName: user.displayName, avatarUrls: {} } : null;
    }
    issue.fields.updated = jiraTime(new Date().toISOString());
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname === "/rest/api/3/user/assignable/search") {
    return sendJson(res, 200, JIRA_USERS);
  }
  const commentsMatch = /^\/rest\/api\/3\/issue\/([^/]+)\/comment$/.exec(url.pathname);
  if (commentsMatch) {
    const comments = jiraActivity[decodeURIComponent(commentsMatch[1])]?.comments ?? [];
    return sendJson(res, 200, {
      comments: comments.toSorted((a, b) => Date.parse(b.created) - Date.parse(a.created)),
    });
  }
  const issueMatch = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(url.pathname);
  if (issueMatch) {
    const found = jiraIssues.find((issue) => issue.key === decodeURIComponent(issueMatch[1]));
    return found
      ? sendJson(res, 200, found)
      : sendJson(res, 404, { errorMessages: ["Issue does not exist"] });
  }
  if (url.pathname === "/rest/api/3/search/jql" && req.method === "POST") {
    const { jql, expand } = JSON.parse(raw || "{}");
    if (jql.includes("assignee WAS currentUser()") && expand === "changelog") {
      const issues = jiraIssues
        .filter((issue) => jiraActivity[issue.key])
        .map((issue) => ({
          key: issue.key,
          fields: {
            summary: issue.fields.summary,
            comment: { comments: jiraActivity[issue.key].comments },
          },
          changelog: { histories: jiraActivity[issue.key].histories },
        }));
      return sendJson(res, 200, { issues, isLast: true });
    }
    const text = /text ~ "((?:[^"\\]|\\.)*)"/.exec(jql)?.[1]?.toLowerCase();
    const issues = jql.includes("currentUser()")
      ? jiraIssues.filter((issue) => issue.fields.status.statusCategory.key !== "done").slice(0, 2)
      : jiraIssues.filter((issue) => issue.fields.summary.toLowerCase().includes(text ?? ""));
    return sendJson(res, 200, { issues, isLast: true });
  }
  sendJson(res, 404, { errorMessages: ["Not found"] });
}).listen(JIRA_PORT, "127.0.0.1", () => console.log(`mock Jira on http://127.0.0.1:${JIRA_PORT}`));
