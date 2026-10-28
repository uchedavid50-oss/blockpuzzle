// The login streak: opening the game on consecutive days. Pure, so the rule is tested; the storage and
// the payment are in coins.ts. A streak gives bonus coins on some days (ECONOMY.loginStreak) and
// restarts when a day is missed. It only ever pays coins: nothing about play depends on it.

import { addDays } from "./streak.js";
import { ECONOMY } from "./economy.js";

export interface LoginRec { last: string; n: number }

/** Parses a stored record; anything malformed counts as no record. */
export function parseLogin(raw: unknown): LoginRec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { last, n } = raw as { last?: unknown; n?: unknown };
  return typeof last === "string" && /^\d{4}-\d{2}-\d{2}$/.test(last) && typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 100_000 ? { last, n } : null;
}

/** The record after opening the game on `today`, the streak day it reached (1+), and the bonus for it. */
export function nextLogin(rec: LoginRec | null, today: string): { rec: LoginRec; day: number; bonus: number; fresh: boolean } {
  if (rec && rec.last === today) return { rec, day: rec.n, bonus: 0, fresh: false }; // already counted today
  const n = rec && rec.last === addDays(today, -1) ? rec.n + 1 : 1;
  const table = ECONOMY.loginStreak;
  return { rec: { last: today, n }, day: n, bonus: table[(n - 1) % table.length] ?? 0, fresh: true };
}
