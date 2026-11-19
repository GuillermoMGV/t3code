import { describe, expect, it } from "vite-plus/test";

import { issueCommentPrompt } from "./issueComments.logic";

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
