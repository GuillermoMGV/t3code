import type { ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildPullRequestMenuItems,
  pullRequestMenuTargets,
  pullRequestMenuUrl,
} from "./threadLinksMenu.logic";

const link = (
  number: number,
  baseBranch: string | null,
  source: ThreadPullRequestLink["source"] = "agent",
) =>
  ({
    host: "github.com",
    repository: "acme/app",
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    source,
    linkedAt: "2026-11-19T10:00:00.000Z",
    snapshot:
      baseBranch === null
        ? null
        : {
            state: "open",
            title: `PR ${number}`,
            headBranch: "feature",
            baseBranch,
            isDraft: false,
            updatedAt: null,
            syncedAt: "2026-11-19T10:00:00.000Z",
          },
    stack: null,
  }) as ThreadPullRequestLink;

describe("pull request menu", () => {
  it("names each pull request by its target branch, numbering only shared or unknown ones", () => {
    const targets = pullRequestMenuTargets([
      link(1, "master"),
      link(2, "develop"),
      link(3, "develop"),
      link(4, null),
      link(5, "master", "stack-dismissed"),
    ]);
    expect(targets.map((target) => target.label)).toEqual([
      "PR to master",
      "PR to develop (#2)",
      "PR to develop (#3)",
      "PR #4",
    ]);
    expect(pullRequestMenuUrl(targets, "open-pr:2")).toBe("https://github.com/acme/app/pull/3");
    expect(pullRequestMenuUrl(targets, "rename")).toBeNull();
  });

  it("offers one entry for one pull request and a submenu for several", () => {
    expect(buildPullRequestMenuItems([])).toEqual([]);
    const single = buildPullRequestMenuItems(pullRequestMenuTargets([link(1, "master")]));
    expect(single.map((item) => [item.id, item.label, item.children])).toEqual([
      ["open-pr:0", "Open PR", undefined],
    ]);
    const several = buildPullRequestMenuItems(
      pullRequestMenuTargets([link(1, "master"), link(2, "develop")]),
    );
    expect(several[0]?.label).toBe("Open PRs");
    expect(several[0]?.children?.map((child) => [child.id, child.label, child.icon])).toEqual([
      ["open-pr:0", "PR to master", "git-pull-request"],
      ["open-pr:1", "PR to develop", "git-pull-request"],
    ]);
  });
});
