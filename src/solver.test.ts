import { describe, expect, it } from "vitest";
import { greedyScore } from "./solver";

describe("greedyScore", () => {
  it("is deterministic for a seed", () => {
    expect(greedyScore("2026-10-19", 40)).toEqual(greedyScore("2026-10-19", 40));
  });
  it("differs between seeds", () => {
    const scores = new Set(["a1", "b2", "c3", "d4", "e5"].map((s) => greedyScore(s, 60).score));
    expect(scores.size).toBeGreaterThan(1);
  });
  it("respects the move cap and scores something", () => {
    const r = greedyScore("2026-10-19", 25);
    expect(r.moves).toBeLessThanOrEqual(25);
    expect(r.score).toBeGreaterThan(0);
  });
});
