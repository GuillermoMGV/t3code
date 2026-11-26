import { describe, expect, it } from "vite-plus/test";

import { orderPullRequestsByBaseBranch, pendingReviewActors } from "./threadDetailsPrOrder.logic";

const actor = (login: string) => ({ login, name: null, avatarUrl: null });

describe("orderPullRequestsByBaseBranch", () => {
  it("puts develop first and master second, keeping the rest in order", () => {
    const prs = [
      { n: 1, base: "master" },
      { n: 2, base: "feature/x" },
      { n: 3, base: "develop" },
      { n: 4, base: null },
      { n: 5, base: "Develop" },
    ];
    expect(orderPullRequestsByBaseBranch(prs, (pr) => pr.base).map((pr) => pr.n)).toEqual([
      3, 5, 1, 2, 4,
    ]);
  });
});

describe("pendingReviewActors", () => {
  it("lists requested reviewers on open pull requests, without the author", () => {
    expect(
      pendingReviewActors({
        state: "open",
        author: actor("Me"),
        reviewers: [
          actor("ada"),
          actor("me"),
          actor("acme/reviewers"),
          { ...actor("lola"), isBot: true },
        ],
      }).map((reviewer) => reviewer.login),
    ).toEqual(["ada"]);
  });

  it("is empty for closed pull requests or unloaded details", () => {
    expect(pendingReviewActors(null)).toEqual([]);
    expect(
      pendingReviewActors({ state: "merged", author: null, reviewers: [actor("ada")] }),
    ).toEqual([]);
  });
});
