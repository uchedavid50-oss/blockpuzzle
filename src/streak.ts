// Daily streak with one automatic "freeze": missing a single day does not reset it.
// The freeze is available once per calendar week (weeks start on Monday). Pure, so it can be tested.

export interface StreakRec { last: string; n: number; freezeWeek?: string }

const toUtc = (d: string): number => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y!, m! - 1, day!);
};
const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Whole days from a to b (b - a). Uses UTC so daylight-saving shifts cannot skew it. */
export function dayDiff(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function addDays(date: string, k: number): string {
  return fmt(toUtc(date) + k * 86_400_000);
}

/** The Monday of the week containing the date: the id the weekly freeze and weekly challenge key on. */
export function weekId(date: string): string {
  const dow = new Date(toUtc(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function freezeAvailable(rec: StreakRec | null, today: string): boolean {
  return !rec || rec.freezeWeek !== weekId(today);
}

/** Records that the daily was played today. `saved` is true when a freeze bridged a missed day. */
export function applyPlay(rec: StreakRec | null, today: string): { rec: StreakRec; saved: boolean } {
  if (!rec) return { rec: { last: today, n: 1 }, saved: false };
  const gap = dayDiff(rec.last, today);
  if (gap <= 0) return { rec, saved: false }; // same day (or a clock that went backwards): nothing to do
  if (gap === 1) return { rec: { ...rec, last: today, n: rec.n + 1 }, saved: false };
  if (gap === 2 && freezeAvailable(rec, today))
    return { rec: { last: today, n: rec.n + 1, freezeWeek: weekId(today) }, saved: true };
  return { rec: { last: today, n: 1, freezeWeek: rec.freezeWeek }, saved: false };
}

/** The streak to show right now: still alive if played today or yesterday, or if a freeze would bridge it. */
export function currentStreak(rec: StreakRec | null, today: string): number {
  if (!rec) return 0;
  const gap = dayDiff(rec.last, today);
  if (gap <= 1) return rec.n;
  return gap === 2 && freezeAvailable(rec, today) ? rec.n : 0;
}
