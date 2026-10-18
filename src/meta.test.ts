import { describe, expect, it } from "vitest";
import { BUCKET_LABELS, scoreBucket, timeUntilMidnight } from "./meta";

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
