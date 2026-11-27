import { describe, expect, it } from "vite-plus/test";

import {
  hostPullRequestFilters,
  joinPullRequestAuthors,
  matchesPullRequestAuthors,
  pullRequestAuthorLogins,
} from "./pullRequestAuthorFilter.logic";

describe("pull request author filter", () => {
  it("reads comma-separated logins without blanks or repeats", () => {
    expect(pullRequestAuthorLogins(undefined)).toEqual([]);
    expect(pullRequestAuthorLogins("ana")).toEqual(["ana"]);
    expect(pullRequestAuthorLogins(" ana, bilal ,,ANA")).toEqual(["ana", "bilal"]);
  });

  it("joins logins and drops the ones that do not fit the saved length", () => {
    expect(joinPullRequestAuthors([])).toBeUndefined();
    expect(joinPullRequestAuthors(["ana", "bilal", "Ana"])).toBe("ana,bilal");
    const long = "x".repeat(150);
    expect(joinPullRequestAuthors([long, "y".repeat(60), "zed"])).toBe(`${long},zed`);
  });

  it("matches any of the chosen authors, with me naming the viewer", () => {
    expect(matchesPullRequestAuthors("Bilal", undefined)).toBe(true);
    expect(matchesPullRequestAuthors("Bilal", "ana,bilal")).toBe(true);
    expect(matchesPullRequestAuthors("carla", "ana,bilal")).toBe(false);
    expect(matchesPullRequestAuthors(undefined, "ana")).toBe(false);
    expect(matchesPullRequestAuthors("carla", "ana,me", "carla")).toBe(true);
  });

  it("sends a single author to the host and keeps several on the page", () => {
    expect(hostPullRequestFilters({ author: "ana", draft: "hide" })).toEqual({
      author: "ana",
      draft: "hide",
    });
    expect(hostPullRequestFilters({ author: "ana,bilal", draft: "hide" })).toEqual({
      draft: "hide",
    });
  });
});
