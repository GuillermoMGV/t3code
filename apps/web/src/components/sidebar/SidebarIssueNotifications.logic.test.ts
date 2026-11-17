import type { TrackerNotification } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterNotifications,
  showsTrackerFilter,
  unreadBadgeLabel,
} from "./SidebarIssueNotifications.logic";

const item = (id: string, tracker: TrackerNotification["tracker"]) =>
  ({ id, tracker }) as TrackerNotification;

describe("notification tracker filter", () => {
  const items = [item("a", "linear"), item("b", "jira"), item("c", "linear")];

  it("keeps only the chosen tracker's items", () => {
    expect(filterNotifications(items, "all").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(filterNotifications(items, "linear").map((x) => x.id)).toEqual(["a", "c"]);
    expect(filterNotifications(items, "jira").map((x) => x.id)).toEqual(["b"]);
  });

  it.each([
    [["linear", "jira"], [], true],
    [["linear"], [item("b", "jira")], true],
    [["linear"], [item("a", "linear")], false],
    [[], [], false],
  ] as const)("shows the filter for %j connected with %j items: %s", (connected, list, shown) => {
    expect(showsTrackerFilter(connected, list)).toBe(shown);
  });
});

describe("unreadBadgeLabel", () => {
  it.each([
    [1, "1"],
    [9, "9"],
    [10, "9+"],
    [250, "9+"],
  ])("%i reads %s", (count, label) => {
    expect(unreadBadgeLabel(count)).toBe(label);
  });
});
