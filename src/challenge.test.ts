import { describe, expect, it } from "vitest";
import { challengeUrl, parseChallenge, randomSeed } from "./challenge";

describe("parseChallenge", () => {
  it("accepts a valid link", () => expect(parseChallenge("?c=ab12cd&t=1240")).toEqual({ seed: "ab12cd", target: 1240 }));
  it("accepts a zero target", () => expect(parseChallenge("?c=abc&t=0")).toEqual({ seed: "abc", target: 0 }));
  it("rejects a missing seed or score", () => {
    expect(parseChallenge("?t=100")).toBeNull();
    expect(parseChallenge("?c=abc123")).toBeNull();
    expect(parseChallenge("")).toBeNull();
  });
  it("rejects bad seeds", () => {
    expect(parseChallenge("?c=ab&t=5")).toBeNull(); // too short
    expect(parseChallenge(`?c=${"a".repeat(25)}&t=5`)).toBeNull(); // too long
    expect(parseChallenge("?c=<script>&t=5")).toBeNull();
    expect(parseChallenge("?c=ab%20cd&t=5")).toBeNull();
  });
  it("rejects bad scores", () => {
    expect(parseChallenge("?c=abc123&t=-5")).toBeNull();
    expect(parseChallenge("?c=abc123&t=1.5")).toBeNull();
    expect(parseChallenge("?c=abc123&t=1e9")).toBeNull();
    expect(parseChallenge("?c=abc123&t=99999999")).toBeNull(); // over the cap
    expect(parseChallenge("?c=abc123&t=abc")).toBeNull();
  });
});

describe("challengeUrl / randomSeed", () => {
  it("round-trips through parseChallenge", () => {
    const url = new URL(challengeUrl("https://example.com", "ab12cd", 1240));
    expect(parseChallenge(url.search)).toEqual({ seed: "ab12cd", target: 1240 });
  });
  it("clamps odd scores", () => {
    expect(challengeUrl("https://x.y", "abc", -4)).toContain("t=0");
    expect(challengeUrl("https://x.y", "abc", 12.9)).toContain("t=12");
  });
  it("makes valid, varied seeds", () => {
    const a = randomSeed();
    expect(parseChallenge(`?c=${a}&t=1`)).not.toBeNull();
    expect(randomSeed(() => 0)).toBe("000000");
  });
});
