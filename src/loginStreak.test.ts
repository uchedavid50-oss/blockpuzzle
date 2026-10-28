import { describe, expect, it } from "vitest";
import { ECONOMY } from "./economy";
import { nextLogin, parseLogin } from "./loginStreak";

describe("login streak", () => {
  it("starts at day 1 with no bonus", () => {
    const r = nextLogin(null, "2026-10-28");
    expect(r).toMatchObject({ day: 1, bonus: 0, fresh: true, rec: { last: "2026-10-28", n: 1 } });
  });
  it("counts consecutive days and pays the table's bonus", () => {
    let rec = nextLogin(null, "2026-10-28").rec;
    const days = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"];
    const paid: number[] = [];
    for (const d of days) { const r = nextLogin(rec, d); rec = r.rec; paid.push(r.bonus); }
    expect(rec.n).toBe(7);
    expect(paid).toEqual([ECONOMY.loginStreak[1], ECONOMY.loginStreak[2], ECONOMY.loginStreak[3], ECONOMY.loginStreak[4], ECONOMY.loginStreak[5], ECONOMY.loginStreak[6]]);
  });
  it("pays nothing twice on the same day, and does not change the record", () => {
    const first = nextLogin({ last: "2026-10-30", n: 3 }, "2026-10-30");
    expect(first).toMatchObject({ day: 3, bonus: 0, fresh: false, rec: { last: "2026-10-30", n: 3 } });
  });
  it("restarts after a missed day", () => {
    expect(nextLogin({ last: "2026-10-28", n: 6 }, "2026-10-30")).toMatchObject({ day: 1, bonus: 0 });
  });
  it("starts the cycle over after day 7", () => {
    expect(nextLogin({ last: "2026-10-28", n: 7 }, "2026-10-29")).toMatchObject({ day: 8, bonus: ECONOMY.loginStreak[0] });
    expect(nextLogin({ last: "2026-10-28", n: 13 }, "2026-10-29").bonus).toBe(ECONOMY.loginStreak[6]);
  });
  it("ignores a damaged stored record", () => {
    for (const bad of [null, 5, "x", { last: "yesterday", n: 2 }, { last: "2026-10-28", n: -1 }, { last: "2026-10-28", n: 1.5 }]) expect(parseLogin(bad)).toBeNull();
    expect(parseLogin({ last: "2026-10-28", n: 4 })).toEqual({ last: "2026-10-28", n: 4 });
  });
});
