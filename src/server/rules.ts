// Validation rules for leaderboard input. Everything from the network is untrusted, so each field is
// checked here before it reaches storage. Pure, so it is covered by tests.

const BLOCKED = ["fuck", "shit", "cunt", "nigg", "fagg", "rape", "nazi", "hitler", "whore", "slut", "bitch", "dick", "cock", "porn", "kill yourself"];
const SQUISH = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

/** A public nickname: 3-16 letters, digits, spaces, dots, dashes or underscores, with no blocked words. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 16) return null;
  if (!/^[\p{L}\p{N} ._-]+$/u.test(name)) return null;
  const flat = SQUISH(name);
  if (BLOCKED.some((w) => flat.includes(w.replace(/[^a-z]/g, "")))) return null;
  return name;
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
