import { describe, expect, it } from "vitest";
import { REGION_COUNT, SIZE, regionCells } from "./board";
import { goalReached, goalText, goalValue, makeLevel, prefillFor, starsFor } from "./journey";

describe("prefillFor", () => {
  it("is the same board every time for a level", () => expect(prefillFor(7)).toEqual(prefillFor(7)));
  it("differs between levels", () => expect(prefillFor(7)).not.toEqual(prefillFor(8)));
  it("never contains a ready-made clear", () => {
    for (let n = 1; n <= 60; n++) {
      const g = prefillFor(n);
      for (let i = 0; i < SIZE; i++) {
        expect(g[i]!.every(Boolean)).toBe(false);
        expect(g.every((r) => r[i])).toBe(false);
      }
      for (let i = 0; i < REGION_COUNT; i++) expect(regionCells(i).every(([r, c]) => g[r]![c])).toBe(false);
    }
  });
  it("gets fuller as levels rise, up to a cap", () => {
    const count = (n: number): number => prefillFor(n).flat().filter(Boolean).length;
    expect(count(30)).toBeGreaterThan(count(1));
    expect(count(200)).toBeLessThanOrEqual(Math.round(0.5 * SIZE * SIZE));
  });
});

describe("makeLevel", () => {
  it("cycles score, lines and place goals", () => {
    expect([1, 2, 3, 4].map((n) => makeLevel(n).goal.kind)).toEqual(["score", "lines", "place", "score"]);
  });
  it("is deterministic and has a seed per level", () => {
    expect(makeLevel(5)).toEqual(makeLevel(5));
    expect(makeLevel(5).seed).not.toBe(makeLevel(6).seed);
  });
  it("starts gently and grows, with sane caps", () => {
    expect(makeLevel(1).goal.target).toBeLessThan(makeLevel(40).goal.target);
    expect(makeLevel(1000).goal.target).toBeLessThanOrEqual(5000 + 40 * 1000);
    expect(makeLevel(2 + 3 * 200).goal.target).toBeLessThanOrEqual(40);
    expect(makeLevel(3 + 3 * 200).goal.target).toBeLessThanOrEqual(120);
  });
  it("clamps a bad level number", () => expect(makeLevel(0).n).toBe(1));
});

describe("goals and stars", () => {
  it("reads the right counter for each kind", () => {
    const p = { score: 300, lines: 9, moves: 20 };
    expect(goalValue(makeLevel(1), p)).toBe(300);
    expect(goalValue(makeLevel(2), p)).toBe(9);
    expect(goalValue(makeLevel(3), p)).toBe(20);
  });
  it("detects completion", () => {
    expect(goalReached(makeLevel(1), { score: 189, lines: 0, moves: 5 })).toBe(false);
    expect(goalReached(makeLevel(1), { score: 190, lines: 0, moves: 5 })).toBe(true);
  });
  it("awards more stars for fewer placements", () => {
    const lv = makeLevel(1);
    const fast = starsFor(lv, { score: 190, lines: 0, moves: lv.parMoves });
    const slow = starsFor(lv, { score: 190, lines: 0, moves: lv.parMoves * 3 });
    expect(fast).toBe(3);
    expect(slow).toBe(1);
  });
  it("describes the goal", () => {
    expect(goalText(makeLevel(1))).toBe("Reach 190 points");
    expect(goalText(makeLevel(2))).toBe("Clear 5 lines");
    expect(goalText(makeLevel(3))).toBe("Place 21 pieces");
  });
});
