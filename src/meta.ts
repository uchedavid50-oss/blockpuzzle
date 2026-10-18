// Small pure helpers for the stats screen and the next-daily countdown.

export const BUCKET_LABELS = ["<100", "100+", "250+", "500+", "1k+", "2k+"] as const;
const EDGES = [100, 250, 500, 1000, 2000];

/** Which score-histogram bar a finished game belongs in. */
export function scoreBucket(score: number): number {
  let i = 0;
  while (i < EDGES.length && score >= EDGES[i]!) i++;
  return i;
}

/** Time left until the next local midnight, when the next daily appears. */
export function timeUntilMidnight(now: Date): { h: number; m: number } {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 60_000));
  return { h: Math.floor(mins / 60), m: mins % 60 };
}

export type MonthDay = readonly [month: number, day: number];

/** True if `now` falls in the yearly window from..to (inclusive). Windows may wrap the new year, like Dec 1 - Jan 6. */
export function inSeason(now: Date, from: MonthDay, to: MonthDay): boolean {
  const k = (m: number, d: number): number => m * 100 + d;
  const n = k(now.getMonth() + 1, now.getDate());
  const a = k(from[0], from[1]);
  const b = k(to[0], to[1]);
  return a <= b ? n >= a && n <= b : n >= a || n <= b;
}
