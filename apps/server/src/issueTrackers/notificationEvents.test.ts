import { describe, expect, it } from "@effect/vitest";

import {
  adfToText,
  applyReadState,
  deriveJiraNotifications,
  initialReadIds,
  type JiraNotificationIssue,
  mergeNotifications,
  toLinearNotification,
} from "./notificationEvents.ts";

const ME = "acc-me";
const ADA = { accountId: "acc-ada", displayName: "Ada Lovelace" };
const SELF = { accountId: ME, displayName: "Me" };
const options = {
  accountId: ME,
  siteUrl: "https://acme.atlassian.net",
  sinceMs: Date.parse("2026-11-14T00:00:00Z"),
};

const adf = (...content: unknown[]) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content }],
});

const issue: JiraNotificationIssue = {
  key: "OPS-7",
  fields: {
    summary: "Rotate certificates",
    comment: {
      comments: [
        {
          id: "10",
          created: "2026-11-17T08:00:00.000+0000",
          author: ADA,
          body: adf({ type: "text", text: "Looks good" }),
        },
        {
          id: "11",
          created: "2026-11-17T09:00:00.000+0000",
          author: ADA,
          body: adf(
            { type: "text", text: "Can you check, " },
            { type: "mention", attrs: { id: ME, text: "@Me" } },
          ),
        },
        {
          id: "12",
          created: "2026-11-17T10:00:00.000+0000",
          author: SELF,
          body: adf({ type: "text", text: "Done" }),
        },
        { id: "9", created: "2026-11-01T10:00:00.000+0000", author: ADA, body: "old" },
      ],
    },
  },
  changelog: {
    histories: [
      {
        id: "100",
        created: "2026-11-16T08:00:00.000+0000",
        author: ADA,
        items: [
          { field: "assignee", fieldId: "assignee", from: null, to: ME, toString: "Me" },
          { field: "status", fieldId: "status", fromString: "To Do", toString: "In Progress" },
          { field: "labels", fieldId: "labels", toString: "infra" },
        ],
      },
      {
        id: "101",
        created: "2026-11-16T09:00:00.000+0000",
        author: SELF,
        items: [
          { field: "status", fieldId: "status", fromString: "In Progress", toString: "Done" },
        ],
      },
      {
        id: "102",
        created: "2026-11-16T10:00:00.000+0000",
        author: ADA,
        items: [
          { field: "assignee", fieldId: "assignee", from: ME, to: "acc-bob", toString: null },
        ],
      },
    ],
  },
};

describe("deriveJiraNotifications", () => {
  it("turns changelog and comments into events, newest first, without the user's own actions", () => {
    const events = deriveJiraNotifications([issue], options);
    expect(
      events.map((event) => [event.id, event.kind, event.actor, event.detail ?? event.text]),
    ).toEqual([
      ["jira:OPS-7:comment:11", "mention", "Ada Lovelace", "Can you check, @Me"],
      ["jira:OPS-7:comment:10", "comment", "Ada Lovelace", "Looks good"],
      ["jira:OPS-7:history:102:assignee", "unassigned", "Ada Lovelace", null],
      ["jira:OPS-7:history:100:assignee", "assigned", "Ada Lovelace", null],
      ["jira:OPS-7:history:100:status", "statusChanged", "Ada Lovelace", "To Do → In Progress"],
    ]);
    expect(events[0]).toMatchObject({
      tracker: "jira",
      issue: {
        key: "OPS-7",
        title: "Rotate certificates",
        url: "https://acme.atlassian.net/browse/OPS-7",
      },
      createdAt: "2026-11-17T09:00:00.000Z",
      read: false,
    });
  });

  it("gives the same ids on every poll, so read state survives", () => {
    const first = deriveJiraNotifications([issue], options).map((event) => event.id);
    expect(deriveJiraNotifications([issue], options).map((event) => event.id)).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it("skips issues with keys that are not issue keys", () => {
    expect(deriveJiraNotifications([{ ...issue, key: "not a key" }], options)).toEqual([]);
  });
});

describe("Jira read state", () => {
  const events = deriveJiraNotifications([issue], options);

  it("starts events older than a day as read on the first check", () => {
    expect(initialReadIds(events, Date.parse("2026-11-17T12:00:00Z"))).toEqual([
      "jira:OPS-7:history:102:assignee",
      "jira:OPS-7:history:100:assignee",
      "jira:OPS-7:history:100:status",
    ]);
  });

  it("marks only the stored ids as read", () => {
    const read = applyReadState(events, new Set(["jira:OPS-7:comment:10"]));
    expect(read.filter((event) => event.read).map((event) => event.id)).toEqual([
      "jira:OPS-7:comment:10",
    ]);
  });
});

describe("adfToText", () => {
  it("joins text and mentions across blocks", () => {
    expect(
      adfToText({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hi" }] },
          { type: "paragraph", content: [{ type: "mention", attrs: { id: "x", text: "@Ada" } }] },
        ],
      })
        .replace(/\s+/g, " ")
        .trim(),
    ).toBe("Hi @Ada");
  });
});

describe("toLinearNotification", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const node = {
    id: "n1",
    type: "issueCommentMention",
    readAt: null,
    createdAt: "2026-11-17T11:00:00.000Z",
    actor: { name: "Ada" },
    issue: {
      identifier: "PRO-1",
      title: "Login",
      url: "https://linear.app/a/issue/PRO-1",
      state: { name: "Todo" },
    },
    comment: { body: "Hey   @me\nplease look" },
  };

  it.each([
    ["issueCommentMention", "mention", null],
    ["issueAssignedToYou", "assigned", null],
    ["issueStatusChanged", "statusChanged", "Todo"],
    ["issuePriorityUrgent", "other", "Priority urgent"],
  ])("maps %s to %s", (type, kind, detail) => {
    expect(toLinearNotification({ ...node, type }, now)).toMatchObject({ kind, detail });
  });

  it("keeps Linear's read state and the comment text", () => {
    expect(toLinearNotification(node, now)).toMatchObject({
      id: "linear:n1",
      read: false,
      actor: "Ada",
      text: "Hey @me please look",
      issue: { key: "PRO-1" },
    });
    expect(toLinearNotification({ ...node, readAt: "2026-11-17T11:30:00.000Z" }, now)?.read).toBe(
      true,
    );
  });

  it("leaves out snoozed and non-issue notifications", () => {
    expect(
      toLinearNotification({ ...node, snoozedUntilAt: "2026-11-18T00:00:00.000Z" }, now),
    ).toBeNull();
    expect(toLinearNotification({ ...node, issue: null }, now)).toBeNull();
  });
});

describe("mergeNotifications", () => {
  it("sorts newest first and drops repeats", () => {
    const [a, b] = deriveJiraNotifications([issue], options);
    expect(mergeNotifications([b!, a!], [a!]).map((item) => item.id)).toEqual([a!.id, b!.id]);
  });
});
