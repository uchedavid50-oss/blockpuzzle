// Small records kept in localStorage: each day's official result, par, journey progress and
// completed weeklies. Reads are forgiving: a missing or corrupt value is just "no record".

// ---- The daily's official result and par ----------------------------------------
// The first attempt at a given day is the record, and the only one that is shared as the result.
// Later attempts at that date are practice.

export interface Official { score: number; board: string; abandoned?: boolean }
export const officialKey = (date: string): string => `blockpuzzle.official.${date}`;
export function officialResult(date: string): Official | null {
  try {
    const d = JSON.parse(localStorage.getItem(officialKey(date)) ?? "null") as Official | null;
    return d && typeof d.score === "number" && typeof d.board === "string" ? d : null;
  } catch { return null; }
}
export function saveOfficial(date: string, rec: Official): void {
  try { localStorage.setItem(officialKey(date), JSON.stringify(rec)); } catch { /* ignore */ }
}
export function clearOfficial(date: string): void {
  try { localStorage.removeItem(officialKey(date)); } catch { /* ignore */ }
}

/** Par for each date, from a greedy bot run offline (scripts/make-par.ts). Missing days just show no par. */
export let parMap: Record<string, number> = {};
fetch("/par.json").then((r) => (r.ok ? r.json() : null)).then((d: unknown) => {
  if (d && typeof d === "object") parMap = d as Record<string, number>;
}).catch(() => { /* offline or missing: no par */ });
export const parFor = (date: string | null): number | null => (date && parMap[date] ? parMap[date]! : null);


export const markWeeklyCompleted = (week: string): void => {
  try { localStorage.setItem(`blockpuzzle.weekly.${week}`, "1"); } catch { /* ignore */ }
};
export const weeklyCompleted = (week: string): boolean => {
  try { return localStorage.getItem(`blockpuzzle.weekly.${week}`) === "1"; } catch { return false; }
};

// Journey progress: the next level to play, and the best stars on each level cleared.
export interface JourneyData { next: number; stars: Record<number, number> }
export const JOURNEY_KEY = "blockpuzzle.journey";
export function readJourney(): JourneyData {
  try {
    const d = JSON.parse(localStorage.getItem(JOURNEY_KEY) ?? "null") as Partial<JourneyData> | null;
    return { next: Math.max(1, Number(d?.next) || 1), stars: d?.stars && typeof d.stars === "object" ? d.stars : {} };
  } catch { return { next: 1, stars: {} }; }
}
export function writeJourney(j: JourneyData): void {
  try { localStorage.setItem(JOURNEY_KEY, JSON.stringify(j)); } catch { /* ignore */ }
}

