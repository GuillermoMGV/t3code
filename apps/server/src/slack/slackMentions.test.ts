import { describe, expect, it } from "@effect/vitest";

import { slackPlainText, toSlackMentions } from "./slackMentions.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const ts = (iso: string) => String(Date.parse(iso) / 1000);
const names = new Map([
  ["U000", "Me"],
  ["U001", "Ada"],
]);

describe("slackPlainText", () => {
  it("turns Slack markup into readable text", () => {
    expect(
      slackPlainText(
        "<@U000> see <#C1|deploys> and <https://x.dev|the doc> <!here> <!subteam^S1|@devs> <@U999> a &lt; b &amp;&amp; c",
        names,
      ),
    ).toBe("@Me see #deploys and the doc @here @devs @someone a < b && c");
  });
});

describe("toSlackMentions", () => {
  it("keeps others' mentions in the window, newest first, with channel and names", () => {
    const items = toSlackMentions(
      [
        {
          ts: ts("2026-11-17T09:00:00Z"),
          user: "U001",
          text: "<@U000> can you look?",
          permalink: "https://acme.slack.com/archives/C1/p1",
          channel: { id: "C1", name: "deploys" },
        },
        {
          ts: ts("2026-11-18T10:00:00Z"),
          user: "U002",
          username: "grace.h",
          text: "ping <@U000>",
          permalink: "https://acme.slack.com/archives/D1/p2",
          channel: { id: "D1", is_im: true },
        },
        // Own message, too old, and no permalink: all dropped.
        { ts: ts("2026-11-18T11:00:00Z"), user: "U000", permalink: "https://x", text: "<@U000>" },
        { ts: ts("2026-11-01T11:00:00Z"), user: "U001", permalink: "https://x", text: "<@U000>" },
        { ts: ts("2026-11-18T11:30:00Z"), user: "U001", text: "<@U000>" },
      ],
      { userId: "U000", names, nowMs: NOW },
    );
    expect(items.map((item) => [item.issue.key, item.actor, item.text])).toEqual([
      ["Direct message", "grace.h", "ping @Me"],
      ["#deploys", "Ada", "@Me can you look?"],
    ]);
    expect(items[1]).toMatchObject({
      id: `slack:C1:${ts("2026-11-17T09:00:00Z")}`,
      tracker: "slack",
      kind: "mention",
      read: false,
      createdAt: "2026-11-17T09:00:00.000Z",
    });
  });
});
