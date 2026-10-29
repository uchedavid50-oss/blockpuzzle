// Weekly Cup nudges. Pure, so the rules are tested; the storage and the toast are in main.ts.
//
// One reminder per week, on the cup's last day (Sunday), and only for a player who has not posted yet:
// someone who already posted needs no nudge, and nobody is nagged on the days before.

import { addDays, weekId } from "./streak.js";

export interface CupHistoryEntry { week: string; rank: number; total: number; score: number }

/** Whether to remind on `today`: the week's last day, not yet posted, not yet reminded this week. */
export function shouldRemind(today: string, posted: boolean, remindedWeek: string | null): boolean {
  const week = weekId(today);
  return addDays(week, 6) === today && !posted && remindedWeek !== week;
}

/** Reads past cups from stored `blockpuzzle.posted.w-YYYY-MM-DD` records, newest first. */
export function cupHistory(entries: Iterable<[string, string | null]>): CupHistoryEntry[] {
  const out: CupHistoryEntry[] = [];
  for (const [key, raw] of entries) {
    const m = /^blockpuzzle\.posted\.w-(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (!m || raw === null) continue;
    try {
      const d = JSON.parse(raw) as Partial<CupHistoryEntry>;
      if (typeof d.rank === "number" && d.rank >= 1 && typeof d.score === "number" && typeof d.total === "number") out.push({ week: m[1]!, rank: d.rank, total: d.total, score: d.score });
    } catch { /* a damaged record is skipped */ }
  }
  return out.sort((a, b) => (a.week < b.week ? 1 : -1));
}

/** "Best #2 · 3 cups played" for the footer, or null if none yet. */
export function cupSummary(history: readonly CupHistoryEntry[]): string | null {
  if (history.length === 0) return null;
  const best = Math.min(...history.map((h) => h.rank));
  return `Best #${best} · ${history.length} cup${history.length === 1 ? "" : "s"} played`;
}
