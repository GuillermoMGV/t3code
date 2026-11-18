import type { TrackerNotification } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterNotifications,
  notificationFilterSources,
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
    [["linear", "jira"], [], ["linear", "jira"]],
    [["slack", "linear"], [], ["linear", "slack"]],
    [["linear"], [item("b", "jira")], ["linear", "jira"]],
    [["linear"], [item("a", "linear")], []],
    [["slack"], [], []],
    [[], [], []],
  ] as const)("offers sources for %j connected with %j items: %j", (connected, list, sources) => {
    expect(notificationFilterSources(connected, list)).toEqual(sources);
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
