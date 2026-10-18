import { describe, expect, it } from "vitest";
import { blankRun, recordMove, weeklyDone, weeklyFailed, weeklyFor, weeklySeed, weeklyValue, type Weekly } from "./weekly";

const byId = (id: Weekly["id"]): Weekly => {
  for (let d = 1; d < 200; d++) {
    const w = weeklyFor(`2026-01-${String((d % 28) + 1).padStart(2, "0")}-${d}`);
    if (w.id === id) return w;
  }
  throw new Error("template not reachable");
};

describe("weeklyFor", () => {
  it("is the same for everyone in a week", () => expect(weeklyFor("2026-10-19")).toEqual(weeklyFor("2026-10-19")));
  it("rotates through every template over time", () => {
    const ids = new Set(Array.from({ length: 60 }, (_, i) => weeklyFor(`wk-${i}`).id));
    expect(ids.size).toBe(4);
  });
  it("has a seed per week", () => expect(weeklySeed("2026-10-19")).not.toBe(weeklySeed("2026-10-26")));
});

describe("recordMove", () => {
  it("accumulates lines, doubles, ones and score", () => {
    let r = blankRun();
    r = recordMove(r, { lines: 1, cells: 3, points: 20 });
    r = recordMove(r, { lines: 2, cells: 1, points: 50 });
    r = recordMove(r, { lines: 0, cells: 4, points: 4 });
    expect(r).toEqual({ lines: 3, moves: 3, doubles: 1, ones: 1, undos: 0, score: 74 });
  });
});

describe("rules", () => {
  it("clean sweep needs 15 lines inside 45 placements", () => {
    const w = byId("efficient");
    let r = blankRun();
    for (let i = 0; i < 15; i++) r = recordMove(r, { lines: 1, cells: 4, points: 10 });
    expect(weeklyValue(w, r)).toBe(15);
    expect(weeklyDone(w, r)).toBe(true);
    // 45 placements with only 14 lines: out of moves, so the attempt can no longer count.
    let slow = blankRun();
    for (let i = 0; i < 45; i++) slow = recordMove(slow, { lines: i < 14 ? 1 : 0, cells: 3, points: 3 });
    expect(weeklyFailed(w, slow)).toBe(true);
    expect(weeklyDone(w, slow)).toBe(false);
    // the 45th placement may still be the one that finishes it
    let last = blankRun();
    for (let i = 0; i < 44; i++) last = recordMove(last, { lines: i < 14 ? 1 : 0, cells: 3, points: 3 });
    last = recordMove(last, { lines: 1, cells: 3, points: 3 });
    expect(weeklyDone(w, last)).toBe(true);
  });
  it("iron nerve fails on undo", () => {
    const w = byId("survive");
    let r = blankRun();
    for (let i = 0; i < 45; i++) r = recordMove(r, { lines: 0, cells: 3, points: 3 });
    expect(weeklyDone(w, r)).toBe(true);
    expect(weeklyDone(w, { ...r, undos: 1 })).toBe(false);
  });
  it("double trouble counts only multi-line moves", () => {
    const w = byId("doubles");
    let r = blankRun();
    for (let i = 0; i < 3; i++) r = recordMove(r, { lines: 2, cells: 4, points: 40 });
    expect(weeklyDone(w, r)).toBe(false);
    r = recordMove(r, { lines: 3, cells: 4, points: 90 });
    expect(weeklyDone(w, r)).toBe(true);
  });
  it("high roller reads the score", () => {
    const w = byId("score");
    expect(weeklyDone(w, { ...blankRun(), score: 599 })).toBe(false);
    expect(weeklyDone(w, { ...blankRun(), score: 600 })).toBe(true);
  });
});
