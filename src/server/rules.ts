// Validation rules for leaderboard input. Everything from the network is untrusted, so each field is
// checked here before it reaches storage. Pure, so it is covered by tests.

import { addDays, weekId } from "../streak.js";

const BLOCKED = ["fuck", "shit", "cunt", "nigg", "fagg", "rape", "nazi", "hitler", "whore", "slut", "bitch", "dick", "cock", "porn", "kill yourself"]
  .map((w) => w.replace(/[^a-z]/g, ""));
/** Each blocked word as a pattern where any vowel may also be written as a digit ("f4ck", "sh1t"). */
const BLOCKED_LOOSE = BLOCKED.map((w) => new RegExp(w.replace(/[aeiou]/g, "[aeiouy#]")));

/** Digits and letters from other scripts that are used to dodge a word filter or copy someone's name. */
const LOOKALIKE: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ѕ: "s", ԁ: "d", ј: "j",
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
};

/** The plain latin letters a name reads as: accents dropped, lookalikes and number swaps undone. */
export function skeleton(name: string, oneAs: "i" | "l" = "i"): string {
  return [...name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()]
    .map((c) => (c === "1" ? oneAs : LOOKALIKE[c] ?? c))
    .join("")
    .replace(/[^a-z]/g, "");
}

/** A public nickname: 3-16 letters, digits, spaces, dots, dashes or underscores, with no blocked words. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 16) return null;
  if (!/^[\p{L}\p{N} ._-]+$/u.test(name)) return null;
  const forms = [skeleton(name), skeleton(name, "l")];
  if (BLOCKED.some((w) => forms.some((f) => f.includes(w)))) return null;
  // Digits kept as a wildcard, so a digit standing in for a vowel is caught whichever vowel it hides.
  const loose = [...name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()]
    .map((c) => (/[0-9]/.test(c) ? "#" : LOOKALIKE[c] ?? c)).join("").replace(/[^a-z#]/g, "");
  if (BLOCKED_LOOSE.some((re) => re.test(loose))) return null;
  return name;
}

/** What makes two names "the same" for ownership: lookalikes and case count as the same name. */
export function nameKey(name: string): string {
  const k = skeleton(name);
  return k.length >= 3 ? k : name.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** A player id is a random hex string the client makes once and keeps. */
export const isPlayerId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{24,32}$/.test(v);

export const isDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/**
 * Players use their own local date, which can be a day ahead of or behind UTC, so a date is accepted
 * if it is within a day of today in UTC. This also stops anyone posting to old or far-future boards.
 */
export function dateAllowed(date: string, now: Date): boolean {
  const diff = Math.abs(new Date(`${date}T00:00:00Z`).getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return diff <= 86_400_000;
}

export const utcToday = (now: Date): string => now.toISOString().slice(0, 10);

// ---- Weekly Cup boards ----------------------------------------------------------------------
// A board is named by a day ("2026-10-28", the daily) or by a week ("w-2026-10-26", the Monday): the
// Weekly Cup. The name is also the piece-sequence seed, so the server replays either one the same way.

export const isWeekId = (v: unknown): v is string =>
  typeof v === "string" && /^w-\d{4}-\d{2}-\d{2}$/.test(v) && isDate(v.slice(2)) && weekId(v.slice(2)) === v.slice(2);
export const isBoardId = (v: unknown): v is string => isDate(v) || isWeekId(v);

/** The first day after the week (so the week is Monday through Sunday, in UTC). */
const weekEnd = (id: string): string => addDays(id.slice(2), 7);

/** Whether a board can still be played and posted: a day by dateOpen, a week while any time zone is inside it. */
export function boardOpen(id: string, now: Date): boolean {
  if (!id.startsWith("w-")) return dateOpen(id, now);
  const earliest = utcToday(new Date(now.getTime() - 12 * 3_600_000));
  const latest = utcToday(new Date(now.getTime() + 14 * 3_600_000));
  return id.slice(2) <= latest && earliest < weekEnd(id);
}

/** Whether a board may be read: a day by dateAllowed, a week from its start until 60 days after it ended. */
export function boardAllowed(id: string, now: Date): boolean {
  if (!id.startsWith("w-")) return dateAllowed(id, now);
  const today = utcToday(now);
  return id.slice(2) <= addDays(today, 1) && addDays(weekEnd(id), 60) >= today;
}

/** A week is over once no time zone is still inside it, so nobody can post to it any more. */
export const weekOver = (id: string, now: Date): boolean => utcToday(new Date(now.getTime() - 12 * 3_600_000)) >= weekEnd(id);

/**
 * Whether date is a calendar day somewhere on Earth right now (time zones run from UTC-12 to UTC+14).
 * Stricter than dateAllowed: a day's game can only be started or posted while that day exists, so
 * nobody can post tomorrow's board early from a time zone they are not in.
 */
export function dateOpen(date: string, now: Date): boolean {
  const earliest = utcToday(new Date(now.getTime() - 12 * 3_600_000));
  const latest = utcToday(new Date(now.getTime() + 14 * 3_600_000));
  return date >= earliest && date <= latest;
}
