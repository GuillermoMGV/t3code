// Minimal mock of the Slack Web API (port 4569, token "xoxp-test") for local checks of the
// "Remind reviewer" button. Nothing reaches Slack: sent messages are printed and listed at
// GET /mock/sent. Start the server with T3CODE_SLACK_API_URL=http://127.0.0.1:4569/api.
// See CUSTOM_DEVELOPMENT.md, "Personalizaciones del fork". MOCK_SLACK_PORT moves it.
import * as NodeHttp from "node:http";

const PORT = Number(process.env.MOCK_SLACK_PORT ?? 4569);
const TOKEN = "xoxp-test";

const members = [
  {
    id: "U001",
    name: "ada",
    real_name: "Ada Lovelace",
    profile: { display_name: "Ada", email: "ada@example.com" },
  },
  {
    id: "U002",
    name: "grace.h",
    real_name: "Grace Hopper",
    profile: { display_name: "Grace", email: "grace@example.com" },
  },
  {
    id: "U003",
    name: "linus",
    real_name: "Linus T",
    profile: { display_name: "", email: "linus@example.com" },
  },
  { id: "U004", name: "slackbot", real_name: "Slackbot", is_bot: true, profile: {} },
];
const sent = [];

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(new URLSearchParams(data)));
  });

NodeHttp.createServer(async (req, res) => {
  const json = (body, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/mock/sent") return json(sent);
  if (req.headers.authorization !== `Bearer ${TOKEN}`)
    return json({ ok: false, error: "invalid_auth" });
  const params = await readBody(req);
  const method = url.pathname.split("/").at(-1);
  switch (method) {
    case "auth.test":
      return json({ ok: true, user: "dev", team: "Acme", user_id: "U000" });
    case "users.list":
      return json({ ok: true, members, response_metadata: { next_cursor: "" } });
    case "users.lookupByEmail": {
      const user = members.find((member) => member.profile.email === params.get("email"));
      return json(user ? { ok: true, user } : { ok: false, error: "users_not_found" });
    }
    case "users.info": {
      const user = members.find((member) => member.id === params.get("user"));
      return json(user ? { ok: true, user } : { ok: false, error: "user_not_found" });
    }
    case "conversations.open":
      return json({ ok: true, channel: { id: `D-${params.get("users")}` } });
    case "chat.postMessage": {
      const message = { channel: params.get("channel"), text: params.get("text") };
      sent.push(message);
      console.log("chat.postMessage", message);
      return json({ ok: true, channel: message.channel, ts: String(Date.now() / 1000) });
    }
    default:
      return json({ ok: false, error: "unknown_method" });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mock Slack on http://127.0.0.1:${PORT}/api`));
