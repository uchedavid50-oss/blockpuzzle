import { describe, expect, it } from "vitest";
import { BUCKET_LABELS, inSeason, scoreBucket, timeUntilMidnight } from "./meta";

describe("scoreBucket", () => {
  it("covers every score exactly once", () => {
    expect(scoreBucket(0)).toBe(0);
    expect(scoreBucket(99)).toBe(0);
    expect(scoreBucket(100)).toBe(1);
    expect(scoreBucket(499)).toBe(2);
    expect(scoreBucket(500)).toBe(3);
    expect(scoreBucket(1999)).toBe(4);
    expect(scoreBucket(2000)).toBe(5);
    expect(scoreBucket(999999)).toBe(BUCKET_LABELS.length - 1);
  });
});

describe("timeUntilMidnight", () => {
  it("counts down to the next local midnight", () => {
    expect(timeUntilMidnight(new Date(2026, 9, 19, 16, 48, 0))).toEqual({ h: 7, m: 12 });
    expect(timeUntilMidnight(new Date(2026, 9, 19, 23, 59, 30))).toEqual({ h: 0, m: 1 });
    expect(timeUntilMidnight(new Date(2026, 9, 19, 0, 0, 0))).toEqual({ h: 24, m: 0 });
  });
});

describe("inSeason", () => {
  it("handles a window inside one year, inclusive at both ends", () => {
    expect(inSeason(new Date(2026, 9, 15), [10, 15], [11, 3])).toBe(true);
    expect(inSeason(new Date(2026, 10, 3), [10, 15], [11, 3])).toBe(true);
    expect(inSeason(new Date(2026, 9, 14), [10, 15], [11, 3])).toBe(false);
    expect(inSeason(new Date(2026, 10, 4), [10, 15], [11, 3])).toBe(false);
  });
  it("handles a window that wraps the new year", () => {
    expect(inSeason(new Date(2026, 11, 25), [12, 1], [1, 6])).toBe(true);
    expect(inSeason(new Date(2027, 0, 5), [12, 1], [1, 6])).toBe(true);
    expect(inSeason(new Date(2027, 0, 7), [12, 1], [1, 6])).toBe(false);
    expect(inSeason(new Date(2026, 5, 1), [12, 1], [1, 6])).toBe(false);
  });
});
