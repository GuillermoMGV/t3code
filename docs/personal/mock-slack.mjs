// Mock Slack Web API (port 4569 or MOCK_SLACK_PORT, token "xoxp-test") for "Remind" and mentions.
// GET /mock/sent lists sent messages; GET /mock/mention adds a mention. Point the server at it with
// T3CODE_SLACK_API_URL=http://127.0.0.1:4569/api. See CUSTOM_DEVELOPMENT.md.
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

const ago = (minutes) => String(Date.now() / 1000 - minutes * 60);
const mention = (user, ts, text, channel) => ({
  user,
  username: members.find((member) => member.id === user)?.name,
  ts,
  text,
  channel,
  permalink: `https://acme.slack.com/archives/${channel.id}/p${ts.replace(".", "")}`,
});
const mentions = [
  mention("U001", ago(20), "<@U000> can you check <https://example.com/pr/1|this PR>?", {
    id: "C100",
    name: "deploys",
  }),
  mention("U002", ago(60 * 5), "Hey <@U000>, the build is green &amp; ready", {
    id: "D200",
    is_im: true,
  }),
  mention("U000", ago(60 * 6), "my own note to <@U000>", { id: "C100", name: "deploys" }),
  mention("U003", ago(60 * 30), "<!here> <@U000> old one from yesterday", {
    id: "C300",
    name: "general",
  }),
];

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
  if (url.pathname === "/mock/mention") {
    mentions.unshift(
      mention("U001", ago(0), `<@U000> new mention ${mentions.length}`, {
        id: "C100",
        name: "deploys",
      }),
    );
    return json(mentions[0]);
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`)
    return json({ ok: false, error: "invalid_auth" });
  const params = await readBody(req);
  const method = url.pathname.split("/").at(-1);
  switch (method) {
    case "auth.test":
      return json({ ok: true, user: "dev", team: "Acme", user_id: "U000", team_id: "T000" });
    case "search.messages": {
      if (params.get("query") !== "<@U000>") return json({ ok: false, error: "bad_query" });
      return json({ ok: true, messages: { total: mentions.length, matches: mentions } });
    }
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
