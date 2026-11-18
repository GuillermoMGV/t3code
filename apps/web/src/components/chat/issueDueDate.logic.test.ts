import { describe, expect, it } from "vite-plus/test";

import { issueDueDateView } from "./issueDueDate.logic";

const NOW = new Date(2026, 10, 18, 23, 30);
const OPEN = { name: "In Progress", color: "#000", category: "started" };

describe("issueDueDateView", () => {
  it.each([
    ["2026-11-08", "Overdue 10 days", true],
    ["2026-11-17", "Overdue 1 day", true],
    ["2026-11-18", "Due today", true],
    ["2026-11-19", "Due tomorrow", true],
    ["2026-11-21", "Due in 3 days", true],
    ["2026-11-22", "Due in 4 days", false],
    ["2026-11-25", "Due in 7 days", false],
  ])("reads %s as %s", (dueDate, label, urgent) => {
    expect(issueDueDateView({ dueDate, state: OPEN }, NOW)).toMatchObject({ label, urgent });
  });

  it("shows far dates as a date and adds the year outside this one", () => {
    expect(issueDueDateView({ dueDate: "2026-12-24", state: OPEN }, NOW)?.label).not.toMatch(
      /2026|in/,
    );
    expect(issueDueDateView({ dueDate: "2027-01-05", state: OPEN }, NOW)?.label).toMatch(/2027/);
  });

  it("never marks finished issues urgent", () => {
    for (const category of ["completed", "canceled", "done"]) {
      expect(
        issueDueDateView({ dueDate: "2026-11-01", state: { ...OPEN, category } }, NOW)?.urgent,
      ).toBe(false);
    }
  });

  it("ignores missing or malformed dates", () => {
    expect(issueDueDateView({ dueDate: null, state: OPEN }, NOW)).toBeNull();
    expect(issueDueDateView({ state: OPEN }, NOW)).toBeNull();
    expect(issueDueDateView({ dueDate: "soon", state: OPEN }, NOW)).toBeNull();
  });
});
