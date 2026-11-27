import { describe, expect, it } from "vite-plus/test";

import {
  issueActivityCountLabel,
  issueActivityTimeline,
  issueCommentPrompt,
} from "./issueComments.logic";

describe("issueCommentPrompt", () => {
  it("quotes every non-blank line of the comment and names its author, date and ticket", () => {
    expect(
      issueCommentPrompt(
        { key: "PRO-1", title: "Login fails", url: "https://linear.app/acme/issue/PRO-1" },
        {
          author: { name: "Patrick", avatarUrl: null },
          createdAt: "2026-11-19T09:30:00.000Z",
          body: "Tested in QA2.\n\nAll good.",
        },
      ),
    ).toBe(
      "Check this comment on ticket PRO-1 (Login fails), posted by Patrick on 2026-11-19T09:30:00.000Z:\n\n> Tested in QA2.\n> All good.\n\nhttps://linear.app/acme/issue/PRO-1",
    );
  });
});

describe("issueActivityTimeline", () => {
  it("interleaves comments and status changes newest first", () => {
    const comment = (id: string, createdAt: string) => ({
      id,
      author: null,
      createdAt,
      body: id,
      url: null,
    });
    const change = (id: string, createdAt: string) => ({
      id,
      actor: null,
      createdAt,
      from: null,
      to: { name: "Done", color: null },
    });
    // Jira and Linear dates mix offsets, so the order follows the instant, not the text.
    const timeline = issueActivityTimeline(
      [comment("c1", "2026-11-19T09:00:00.000Z"), comment("c2", "2026-11-17T09:00:00.000Z")],
      [change("s1", "2026-11-19T08:30:00.000-01:00"), change("s2", "2026-11-18T09:00:00.000Z")],
    );
    expect(timeline.map((entry) => [entry.kind, entry.createdAt])).toEqual([
      ["statusChange", "2026-11-19T08:30:00.000-01:00"],
      ["comment", "2026-11-19T09:00:00.000Z"],
      ["statusChange", "2026-11-18T09:00:00.000Z"],
      ["comment", "2026-11-17T09:00:00.000Z"],
    ]);
  });

  it("counts each kind and leaves out the empty ones", () => {
    expect(issueActivityCountLabel(3, 1)).toBe("3 comments · 1 status change");
    expect(issueActivityCountLabel(0, 2)).toBe("2 status changes");
    expect(issueActivityCountLabel(1, 0)).toBe("1 comment");
  });
});
