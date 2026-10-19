import { describe, expect, it } from "vitest";
import { cleanName, dateAllowed, isDate, isPlayerId, utcToday } from "./rules";

describe("cleanName", () => {
  it("accepts ordinary nicknames and tidies spacing", () => {
    expect(cleanName("Ada")).toBe("Ada");
    expect(cleanName("  Block   Master  ")).toBe("Block Master");
    expect(cleanName("night_owl-99")).toBe("night_owl-99");
    expect(cleanName("Zoë Ñandú")).toBe("Zoë Ñandú");
  });
  it("enforces the length limits", () => {
    expect(cleanName("ab")).toBeNull();
    expect(cleanName("a".repeat(17))).toBeNull();
    expect(cleanName("a".repeat(16))).not.toBeNull();
  });
  it("rejects markup, symbols and non-strings", () => {
    for (const bad of ["<script>x</script>", "name!!!", "a@b.com", "hi\u0000there", "👾👾👾"]) expect(cleanName(bad)).toBeNull();
    for (const bad of [null, undefined, 42, {}, ["abc"]]) expect(cleanName(bad)).toBeNull();
  });
  it("blocks offensive words even when spaced out or decorated", () => {
    expect(cleanName("f u c k")).toBeNull();
    expect(cleanName("SH1T head".replace("1", "i"))).toBeNull();
    expect(cleanName("xx_hitler_xx")).toBeNull();
  });
});

describe("ids and dates", () => {
  it("accepts only well-formed player ids", () => {
    expect(isPlayerId("a".repeat(24))).toBe(true);
    expect(isPlayerId("0123456789abcdef0123456789abcdef")).toBe(true);
    for (const bad of ["short", "G".repeat(24), "a".repeat(33), "", 7, null]) expect(isPlayerId(bad)).toBe(false);
  });
  it("accepts only real calendar dates", () => {
    expect(isDate("2026-10-19")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "26-10-19", "2026-10-19T00:00", "", null, 20261019]) expect(isDate(bad)).toBe(false);
  });
  it("allows today and the day either side in UTC, nothing else", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(dateAllowed("2026-10-19", now)).toBe(true);
    expect(dateAllowed("2026-10-18", now)).toBe(true);
    expect(dateAllowed("2026-10-20", now)).toBe(true);
    expect(dateAllowed("2026-10-17", now)).toBe(false);
    expect(dateAllowed("2026-10-21", now)).toBe(false);
    expect(utcToday(now)).toBe("2026-10-19");
  });
});
