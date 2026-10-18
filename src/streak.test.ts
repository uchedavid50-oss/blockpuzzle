import { describe, expect, it } from "vitest";
import { addDays, applyPlay, currentStreak, dayDiff, freezeAvailable, weekId } from "./streak";

describe("date helpers", () => {
  it("dayDiff and addDays agree, across month and year ends", () => {
    expect(dayDiff("2026-10-31", "2026-11-02")).toBe(2);
    expect(dayDiff("2026-12-31", "2027-01-01")).toBe(1);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("weekId is the Monday of that week", () => {
    expect(weekId("2026-10-19")).toBe("2026-10-19"); // a Monday
    expect(weekId("2026-10-25")).toBe("2026-10-19"); // the Sunday after
    expect(weekId("2026-10-18")).toBe("2026-10-12"); // the Sunday before
  });
});

describe("applyPlay", () => {
  it("starts at 1", () => expect(applyPlay(null, "2026-10-19").rec).toEqual({ last: "2026-10-19", n: 1 }));
  it("same day changes nothing", () => {
    const rec = { last: "2026-10-19", n: 5 };
    expect(applyPlay(rec, "2026-10-19").rec).toBe(rec);
  });
  it("the next day extends it", () => expect(applyPlay({ last: "2026-10-19", n: 5 }, "2026-10-20").rec.n).toBe(6));
  it("one missed day is bridged by the weekly freeze", () => {
    const r = applyPlay({ last: "2026-10-19", n: 23 }, "2026-10-21"); // Mon -> Wed
    expect(r.saved).toBe(true);
    expect(r.rec.n).toBe(24);
    expect(r.rec.freezeWeek).toBe("2026-10-19");
  });
  it("a second miss in the same week is not bridged", () => {
    const first = applyPlay({ last: "2026-10-19", n: 23 }, "2026-10-21").rec; // used Mon-week freeze
    const r = applyPlay(first, "2026-10-23"); // Wed -> Fri: another single miss, same week
    expect(r.saved).toBe(false);
    expect(r.rec.n).toBe(1);
  });
  it("the freeze comes back the next week", () => {
    const used = { last: "2026-10-21", n: 24, freezeWeek: "2026-10-19" };
    expect(freezeAvailable(used, "2026-10-26")).toBe(true);
    expect(applyPlay({ ...used, last: "2026-10-26" }, "2026-10-28").saved).toBe(true);
  });
  it("two or more missed days reset it", () => {
    expect(applyPlay({ last: "2026-10-19", n: 23 }, "2026-10-22").rec.n).toBe(1);
  });
});

describe("currentStreak", () => {
  it("is alive today or yesterday", () => {
    expect(currentStreak({ last: "2026-10-19", n: 4 }, "2026-10-19")).toBe(4);
    expect(currentStreak({ last: "2026-10-18", n: 4 }, "2026-10-19")).toBe(4);
  });
  it("still shows when a freeze would save it, and drops when it would not", () => {
    expect(currentStreak({ last: "2026-10-17", n: 9 }, "2026-10-19")).toBe(9);
    expect(currentStreak({ last: "2026-10-17", n: 9, freezeWeek: "2026-10-19" }, "2026-10-19")).toBe(0);
    expect(currentStreak({ last: "2026-10-10", n: 9 }, "2026-10-19")).toBe(0);
    expect(currentStreak(null, "2026-10-19")).toBe(0);
  });
});
