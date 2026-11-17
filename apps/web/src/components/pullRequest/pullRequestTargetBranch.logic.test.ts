import { describe, expect, it } from "vite-plus/test";

import { filterByTargetBranch, pullRequestTargetBranches } from "./pullRequestTargetBranch.logic";

const groups = [
  {
    key: "authored",
    entries: [
      { number: 1, baseBranch: "master" },
      { number: 2, baseBranch: "develop" },
    ],
  },
  { key: "reviewing", entries: [{ number: 3, baseBranch: "develop" }] },
];

describe("target branch filter", () => {
  it("lists each target branch once, keeping a selected one that no row uses", () => {
    expect(pullRequestTargetBranches(groups, undefined)).toEqual(["develop", "master"]);
    expect(pullRequestTargetBranches(groups, "release")).toEqual(["develop", "master", "release"]);
  });

  it("keeps only the rows that merge into the chosen branch, in every group", () => {
    expect(
      filterByTargetBranch(groups, "develop").map((group) => group.entries.map((e) => e.number)),
    ).toEqual([[2], [3]]);
    expect(filterByTargetBranch(groups, undefined)).toBe(groups);
  });
});
