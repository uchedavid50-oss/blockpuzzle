// Progress and customisation that lives on the device: lifetime stats, badges, the collection,
// the daily streak and colour themes. No rendering and no game state in here.

import { haptic } from "./haptics";
import { inSeason, type MonthDay } from "./meta";
import { ownsSku } from "./ownership.js";
import { sfx } from "./sound";
import { applyPlay, currentStreak, type StreakRec } from "./streak";

export function dateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const today = (): string => dateStr(new Date());

// ---- Lifetime stats and milestone badges (device-local) -------------------------

export interface Stats {
  games: number; finished: number; total: number; bestScore: number; bestCombo: number;
  lines: number; perfects: number; moves: number; bestStreak: number; challengesWon: number;
  zenLines: number; levels: number; weeklyWins: number; hist: number[];
}
export const STATS_KEY = "blockpuzzle.stats";
export const BADGES_KEY = "blockpuzzle.badges";
export const SEEN_KEY = "blockpuzzle.badgesSeen";
export const blankStats = (): Stats => ({ games: 0, finished: 0, total: 0, bestScore: 0, bestCombo: 0, lines: 0, perfects: 0, moves: 0, bestStreak: 0, challengesWon: 0, zenLines: 0, levels: 0, weeklyWins: 0, hist: [0, 0, 0, 0, 0, 0] });
export const stats: Stats = (() => {
  try {
    const d = JSON.parse(localStorage.getItem(STATS_KEY) ?? "null") as Partial<Stats> | null;
    return { ...blankStats(), ...(d ?? {}) };
  } catch { return blankStats(); }
})();
export const saveStats = (): void => {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* ignore */ }
};

export const unlocked: string[] = (() => {
  try {
    const d = JSON.parse(localStorage.getItem(BADGES_KEY) ?? "[]") as unknown;
    return Array.isArray(d) ? d.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
})();
export let badgesSeen = (() => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } })();

export interface MoveInfo { lines: number; combo: number; perfect: boolean; regions: number }
export interface Badge {
  id: string; name: string; desc: string; ok: (m: MoveInfo | null) => boolean;
  progress?: () => [number, number]; // [now, target], shown as a bar while locked
  reward?: string;
}
export const BADGES: Badge[] = [
  { id: "first", name: "First clear", desc: "Clear your first line.", ok: () => stats.lines >= 1 },
  { id: "double", name: "Double", desc: "Clear 2 lines with one piece.", ok: (m) => !!m && m.lines >= 2 },
  { id: "quad", name: "Quad", desc: "Clear 4 lines with one piece.", ok: (m) => !!m && m.lines >= 4, reward: "Gold confetti" },
  { id: "combo3", name: "On a roll", desc: "Reach a 3x combo.", ok: () => stats.bestCombo >= 3, progress: () => [stats.bestCombo, 3], reward: "Sparkle trail on held pieces" },
  { id: "combo5", name: "Unstoppable", desc: "Reach a 5x combo.", ok: () => stats.bestCombo >= 5, progress: () => [stats.bestCombo, 5], reward: "Rainbow rings" },
  { id: "combo8", name: "Untouchable", desc: "Reach an 8x combo.", ok: () => stats.bestCombo >= 8, progress: () => [stats.bestCombo, 8] },
  { id: "s500", name: "Sharp", desc: "Score 500 in one game.", ok: () => stats.bestScore >= 500, progress: () => [stats.bestScore, 500] },
  { id: "s1000", name: "Pro", desc: "Score 1,000 in one game.", ok: () => stats.bestScore >= 1000, progress: () => [stats.bestScore, 1000], reward: "Gold theme" },
  { id: "s2500", name: "Legend", desc: "Score 2,500 in one game.", ok: () => stats.bestScore >= 2500, progress: () => [stats.bestScore, 2500] },
  { id: "s5000", name: "Mythic", desc: "Score 5,000 in one game.", ok: () => stats.bestScore >= 5000, progress: () => [stats.bestScore, 5000] },
  { id: "lines50", name: "Sweeper", desc: "Clear 50 lines in total.", ok: () => stats.lines >= 50, progress: () => [stats.lines, 50] },
  { id: "lines250", name: "Demolition", desc: "Clear 250 lines in total.", ok: () => stats.lines >= 250, progress: () => [stats.lines, 250] },
  { id: "lines1000", name: "Annihilator", desc: "Clear 1,000 lines in total.", ok: () => stats.lines >= 1000, progress: () => [stats.lines, 1000] },
  { id: "games10", name: "Hooked", desc: "Play 10 games.", ok: () => stats.games >= 10, progress: () => [stats.games, 10] },
  { id: "streak3", name: "Regular", desc: "Play the daily 3 days in a row.", ok: () => stats.bestStreak >= 3, progress: () => [stats.bestStreak, 3] },
  { id: "streak7", name: "Devoted", desc: "Play the daily 7 days in a row.", ok: () => stats.bestStreak >= 7, progress: () => [stats.bestStreak, 7], reward: "Aurora theme" },
  { id: "streak30", name: "Marathon", desc: "Play the daily 30 days in a row.", ok: () => stats.bestStreak >= 30, progress: () => [stats.bestStreak, 30] },
  { id: "region", name: "Squared away", desc: "Clear a 2\u00D74 block.", ok: (m) => !!m && m.regions >= 1 },
  { id: "weekly1", name: "Challenger", desc: "Complete a weekly challenge.", ok: () => stats.weeklyWins >= 1 },
  { id: "journey5", name: "Explorer", desc: "Clear 5 journey levels.", ok: () => stats.levels >= 5, progress: () => [stats.levels, 5] },
  { id: "zen50", name: "Calm mind", desc: "Clear 50 lines in zen mode.", ok: () => stats.zenLines >= 50, progress: () => [stats.zenLines, 50] },
  { id: "rival", name: "Rival", desc: "Beat a friend's challenge score.", ok: () => stats.challengesWon >= 1 },
  { id: "perfect", name: "Spotless", desc: "Clear the entire board.", ok: () => stats.perfects >= 1, reward: "Midnight theme" },
];

export const has = (id: string): boolean => unlocked.includes(id);

// The collection: a 4x4 picture that fills in as you play. Every 40 lines, 5 journey levels or
// a weekly win reveals a tile (a win is worth two); completing it unlocks the Prism theme.
export const COLLECTION_SIZE = 16;
export const TILE_ORDER = [5, 10, 0, 15, 6, 9, 3, 12, 1, 14, 2, 13, 4, 11, 7, 8];
export const collectionTiles = (): number =>
  Math.min(COLLECTION_SIZE, Math.floor(stats.lines / 40) + Math.floor(stats.levels / 5) + stats.weeklyWins * 2);
export const TILES_KEY = "blockpuzzle.tilesSeen";
export function checkCollection(): void {
  const now = collectionTiles();
  let seen = 0;
  try { seen = Number(localStorage.getItem(TILES_KEY)) || 0; } catch { /* ignore */ }
  if (now <= seen) return;
  try { localStorage.setItem(TILES_KEY, String(now)); } catch { /* ignore */ }
  toasts.push(now >= COLLECTION_SIZE
    ? { title: "Collection complete", desc: "Unlocked: Prism theme", t: 0, label: "COLLECTION" }
    : { title: "New collection tile", desc: `${now} of ${COLLECTION_SIZE} revealed`, t: 0, label: "COLLECTION" });
  sfx.praise(1);
}
/** Every 5 badges earns one extra undo at the start of each random (non-daily) game, up to +2. */
export const perkUndos = (): number => Math.min(2, Math.floor(unlocked.length / 5));
export const RANKS: [number, string][] = [[0, "Rookie"], [1, "Beginner"], [3, "Player"], [6, "Skilled"], [9, "Expert"], [12, "Master"], [16, "Grandmaster"]];
export const rankName = (): string => [...RANKS].reverse().find(([n]) => unlocked.length >= n)![1];

export interface Toast { title: string; desc: string; t: number; label?: string }
export let toasts: Toast[] = [];

/** Unlocks any badge whose condition now holds and queues a pop-up for each. */
export function checkBadges(m: MoveInfo | null): void {
  checkCollection();
  let any = false;
  for (const b of BADGES) {
    if (unlocked.includes(b.id) || !b.ok(m)) continue;
    const before = perkUndos();
    unlocked.push(b.id);
    toasts.push({ title: b.name, desc: b.reward ? `Unlocked: ${b.reward}` : b.desc, t: 0 });
    if (perkUndos() > before) toasts.push({ title: "Extra undo earned", desc: "Random games now start with more undos.", t: 0, label: "PERK EARNED" });
    any = true;
  }
  if (!any) return;
  try { localStorage.setItem(BADGES_KEY, JSON.stringify(unlocked)); } catch { /* ignore */ }
  sfx.praise(1);
  haptic([15, 30, 15]);
}

// Consecutive days on which a daily game was started. Device-local; no backend.
// One missed day is bridged by a weekly freeze (see streak.ts).
export const STREAK_KEY = "blockpuzzle.streak";
export function readStreak(): StreakRec | null {
  try {
    const d = JSON.parse(localStorage.getItem(STREAK_KEY) ?? "null") as Partial<StreakRec> | null;
    return d && typeof d.last === "string" && typeof d.n === "number"
      ? { last: d.last, n: d.n, ...(typeof d.freezeWeek === "string" ? { freezeWeek: d.freezeWeek } : {}) } : null;
  } catch { return null; }
}
export const streakNow = (): number => currentStreak(readStreak(), today());
export function bumpStreak(): void {
  const before = readStreak();
  const { rec, saved } = applyPlay(before, today());
  if (rec === before) return;
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(rec)); } catch { /* ignore */ }
  stats.bestStreak = Math.max(stats.bestStreak, rec.n);
  saveStats();
  if (saved) toasts.push({ title: "Streak saved", desc: "Your weekly freeze covered the day you missed.", t: 0, label: "STREAK FREEZE" });
  checkBadges(null);
}
export const playedDailyToday = (): boolean => readStreak()?.last === today();


// Colour themes. Purely visual: the rules never read them.
export const THEMES: { name: string; colors: string[]; req?: string; season?: { from: MonthDay; to: MonthDay; label: string } }[] = [
  { name: "Gems", colors: ["#4da3ff", "#9a7bff", "#ff6f9c", "#ffb04d", "#3fd6a0", "#3fd0e8", "#ff7a5c", "#a6e05a"] },
  { name: "Neon", colors: ["#00e5ff", "#ff2bd6", "#b6ff00", "#ff7a00", "#8a5cff", "#00ff9d", "#ff3355", "#ffee00"] },
  { name: "Pastel", colors: ["#8ecae6", "#c3a6ff", "#ffadc6", "#ffd6a5", "#9be3c0", "#a0e7f0", "#ffb5a7", "#d4e79e"] },
  { name: "Gold", req: "s1000", colors: ["#ffd75e", "#ff9f43", "#f6c177", "#e8b4a0", "#c9a227", "#ffe9a0", "#d4884a", "#b8860b"] },
  { name: "Aurora", req: "streak7", colors: ["#3ef5c0", "#4ad1ff", "#7c6bff", "#c45bff", "#ff6bd6", "#57ffa0", "#39b3ff", "#a2ff5e"] },
  { name: "Prism", req: "collection", colors: ["#ff4d6d", "#ff9f1c", "#ffe14d", "#5ce65c", "#2ec4b6", "#4d8cff", "#9b5cff", "#ff5cc8"] },
  { name: "Midnight", req: "perfect", colors: ["#5b7cff", "#8a5bff", "#2ec8ff", "#ff4fa3", "#31e6c1", "#ffd34f", "#7aa2ff", "#c06bff"] },
  // Paid packs (Shop). Cosmetic only.
  { name: "Dusk Plum", req: "pack:dusk", colors: ["#7e57c2", "#ab47bc", "#ec407a", "#ef6c00", "#26a69a", "#42a5f5", "#9ccc65", "#ffca28"] },
  { name: "Midnight Ink", req: "pack:dusk", colors: ["#3949ab", "#5e35b1", "#8e24aa", "#d81b60", "#00897b", "#039be5", "#7cb342", "#f9a825"] },
  { name: "Slate", req: "pack:dusk", colors: ["#6d8fb3", "#8f7fb3", "#b37f96", "#b3917f", "#7fb39a", "#7fa9b3", "#a3b37f", "#b3a77f"] },
  { name: "Ember Glow", req: "pack:dusk", colors: ["#ff6b35", "#f7c59f", "#efefd0", "#004e89", "#1a659e", "#ff9f1c", "#e71d36", "#2ec4b6"] },
  { name: "Lemon", req: "pack:citrus", colors: ["#ffd60a", "#ff9e00", "#ff5400", "#9ef01a", "#38b000", "#00b4d8", "#7209b7", "#f72585"] },
  { name: "Lime Fizz", req: "pack:citrus", colors: ["#c6ff00", "#00e676", "#1de9b6", "#00e5ff", "#ffea00", "#ffab00", "#ff6d00", "#ff4081"] },
  { name: "Orange Grove", req: "pack:citrus", colors: ["#ff9a00", "#ffb703", "#fb8500", "#e63946", "#2a9d8f", "#8ecae6", "#219ebc", "#a8dadc"] },
  { name: "Tangerine Pop", req: "pack:citrus", colors: ["#ff7b00", "#ff9500", "#ffb700", "#ff006e", "#8338ec", "#3a86ff", "#06d6a0", "#fb5607"] },
  // Limited-time themes: usable only during their window each year.
  { name: "Pumpkin", season: { from: [10, 15], to: [11, 3], label: "Oct 15 \u2013 Nov 3" }, colors: ["#ff7a1a", "#ffb347", "#7bd16f", "#b57aff", "#ff5a3c", "#ffd23f", "#4fc3a1", "#e8590c"] },
  { name: "Frost", season: { from: [12, 1], to: [1, 6], label: "Dec 1 \u2013 Jan 6" }, colors: ["#8fd3ff", "#d6f0ff", "#5aa9ff", "#b8c6ff", "#7ee8e0", "#e8f7ff", "#9bb7ff", "#6fe0ff"] },
  { name: "Bloom", season: { from: [3, 15], to: [4, 30], label: "Mar 15 \u2013 Apr 30" }, colors: ["#ff8fb1", "#ffc2d4", "#9be37f", "#ffe66d", "#c3a6ff", "#7fd8be", "#ffa6a6", "#b5e48c"] },
  { name: "Sunny", season: { from: [6, 15], to: [8, 31], label: "Jun 15 \u2013 Aug 31" }, colors: ["#ffd23f", "#ff7f50", "#2ec4b6", "#ff5d8f", "#4cc9f0", "#9ef01a", "#ff9f1c", "#7b6cff"] },
  // Okabe-Ito: chosen to stay distinguishable with the common kinds of colour blindness.
  { name: "Colour-blind", colors: ["#0072b2", "#e69f00", "#56b4e9", "#009e73", "#f0e442", "#d55e00", "#cc79a7", "#999999"] },
];
export const THEME_KEY = "blockpuzzle.theme";
export const PALETTE: string[] = [...THEMES[0]!.colors]; // mutated in place when the theme changes
export let themeIdx = 0;
export let themeShownAt = -10;
export const themeUnlocked = (i: number): boolean => {
  const { req, season } = THEMES[i]!;
  if (season) return inSeason(new Date(), season.from, season.to);
  if (req === "pack:dusk") return ownsSku("theme_pack_dusk");
  if (req === "pack:citrus") return ownsSku("theme_pack_citrus");
  return !req || (req === "collection" ? collectionTiles() >= COLLECTION_SIZE : has(req));
};
/** Next theme you have unlocked, wrapping around. */
export function cycleTheme(): void {
  for (let k = 1; k <= THEMES.length; k++) {
    const i = (themeIdx + k) % THEMES.length;
    if (themeUnlocked(i)) { applyTheme(i); return; }
  }
}
export function applyTheme(i: number): void {
  themeIdx = ((i % THEMES.length) + THEMES.length) % THEMES.length;
  if (!themeUnlocked(themeIdx)) themeIdx = 0;
  PALETTE.splice(0, PALETTE.length, ...THEMES[themeIdx]!.colors);
  try { localStorage.setItem(THEME_KEY, THEMES[themeIdx]!.name); } catch { /* ignore */ }
}
try {
  // Saved by name. Older versions saved a position (0-3), where 3 was the colour-blind palette.
  const saved = localStorage.getItem(THEME_KEY) ?? "";
  const byName = THEMES.findIndex((t) => t.name === saved);
  applyTheme(byName >= 0 ? byName : saved === "3" ? THEMES.findIndex((t) => t.name === "Colour-blind") : Number(saved) || 0);
} catch { /* ignore */ }

/** The trophy has been opened: every badge so far counts as seen. */
export function markBadgesSeen(): void {
  badgesSeen = unlocked.length;
  try { localStorage.setItem(SEEN_KEY, String(badgesSeen)); } catch { /* ignore */ }
}

/** When the theme name was last flashed on screen (clock seconds); the HUD fades it out. */
export function markThemeShown(t: number): void {
  themeShownAt = t;
}
