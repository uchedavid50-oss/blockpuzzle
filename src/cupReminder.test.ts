import { describe, expect, it } from "vitest";
import { cupHistory, cupSummary, shouldRemind } from "./cupReminder";

describe("cup reminder", () => {
  it("fires only on the last day, for someone who has not posted, once", () => {
    expect(shouldRemind("2026-11-01", false, null)).toBe(true); // Sunday, the week of Oct 26
    expect(shouldRemind("2026-10-31", false, null)).toBe(false); // Saturday
    expect(shouldRemind("2026-10-26", false, null)).toBe(false); // Monday
    expect(shouldRemind("2026-11-01", true, null)).toBe(false); // already posted
    expect(shouldRemind("2026-11-01", false, "2026-10-26")).toBe(false); // already reminded this week
    expect(shouldRemind("2026-11-01", false, "2026-10-19")).toBe(true); // an old reminder does not count
  });
});

describe("cup history", () => {
  const rec = (rank: number, score = 100, total = 9): string => JSON.stringify({ rank, score, total, streak: 0 });
  it("reads only cup records, newest first, skipping damaged ones", () => {
    const h = cupHistory([
      ["blockpuzzle.posted.w-2026-10-19", rec(4)],
      ["blockpuzzle.posted.2026-10-19", rec(1)], // a daily, not a cup
      ["blockpuzzle.posted.w-2026-10-26", rec(2, 250)],
      ["blockpuzzle.posted.w-2026-10-12", "not json"],
      ["blockpuzzle.posted.w-2026-10-05", null],
      ["blockpuzzle.posted.w-2026-09-28", JSON.stringify({ rank: 0, score: 1, total: 1 })],
    ]);
    expect(h.map((x) => x.week)).toEqual(["2026-10-26", "2026-10-19"]);
    expect(h[0]).toMatchObject({ rank: 2, score: 250 });
  });
  it("summarises the best rank and the count", () => {
    expect(cupSummary([])).toBeNull();
    expect(cupSummary([{ week: "a", rank: 3, total: 5, score: 1 }, { week: "b", rank: 1, total: 5, score: 1 }])).toBe("Best #1 · 2 cups played");
    expect(cupSummary([{ week: "a", rank: 3, total: 5, score: 1 }])).toBe("Best #3 · 1 cup played");
  });
});
