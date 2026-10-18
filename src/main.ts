import { PERFECT_BONUS, REGION_COUNT, REGION_H, REGION_W, SIZE, canPlace, canPlaceAnywhere, clearCells, clearedCells, emptyGrid, fullestLine, hasMoves, isEmpty, place, regionCells, regionOf, shapeSize, type Grid, type Shape } from "./board";
import { drawTray, shapeAt, shapeIndex } from "./pieces";
import { challengeUrl, parseChallenge, randomSeed, type Challenge } from "./challenge";
import { goalReached, goalText, goalValue, makeLevel, starsFor } from "./journey";
import { BUCKET_LABELS, scoreBucket, timeUntilMidnight } from "./meta";
import { seeded } from "./rng";
import { boardEmoji, shareText } from "./share";
import { addDays, applyPlay, currentStreak, freezeAvailable, weekId, type StreakRec } from "./streak";
import { blankRun, recordMove, weeklyDone, weeklyFailed, weeklyFor, weeklySeed, weeklyValue, type WeeklyRun } from "./weekly";
import { haptic, haptics } from "./haptics";
import { isMuted, sfx, soundState, toggleMute, unlock } from "./sound";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

interface State {
  grid: Grid;
  tray: (Shape | null)[];
  score: number;
  best: number;
  combo: number;
  over: boolean;
  daily: string | null; // YYYY-MM-DD when playing that day's shared sequence
  undoLeft: number; // one rewind per game
  seed: string; // fixes the piece sequence; the date for a daily, otherwise random or from a challenge link
  challenge: number | null; // target score when playing a friend's challenge
  trays: number; // trays dealt so far; with the date it fixes the daily sequence
  kind: Kind;
  practice: boolean; // a daily replay or archive run: it never touches the streak or the official result
  level: number | null; // journey level
  week: string | null; // weekly challenge id (the Monday's date)
  wk: WeeklyRun | null;
  moves: number; // pieces placed this game
  lines: number; // lines cleared this game
  won: boolean; // journey level cleared
  stars: number;
}

type Kind = "classic" | "zen" | "weekly" | "journey";
interface GameOpts { daily?: string | null; ch?: Challenge | null; kind?: Kind; level?: number }

const BEST_KEY = "blockpuzzle.best";
const SAVE_KEY = "blockpuzzle.save";

const bestKey = (daily: string | null): string => (daily ? `blockpuzzle.daily.${daily}` : BEST_KEY);
const loadBest = (daily: string | null = null): number => {
  try { return Number(localStorage.getItem(bestKey(daily))) || 0; } catch { return 0; }
};

function dateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const today = (): string => dateStr(new Date());

// ---- Lifetime stats and milestone badges (device-local) -------------------------

interface Stats {
  games: number; finished: number; total: number; bestScore: number; bestCombo: number;
  lines: number; perfects: number; moves: number; bestStreak: number; challengesWon: number;
  zenLines: number; levels: number; weeklyWins: number; hist: number[];
}
const STATS_KEY = "blockpuzzle.stats";
const BADGES_KEY = "blockpuzzle.badges";
const SEEN_KEY = "blockpuzzle.badgesSeen";
const blankStats = (): Stats => ({ games: 0, finished: 0, total: 0, bestScore: 0, bestCombo: 0, lines: 0, perfects: 0, moves: 0, bestStreak: 0, challengesWon: 0, zenLines: 0, levels: 0, weeklyWins: 0, hist: [0, 0, 0, 0, 0, 0] });
const stats: Stats = (() => {
  try {
    const d = JSON.parse(localStorage.getItem(STATS_KEY) ?? "null") as Partial<Stats> | null;
    return { ...blankStats(), ...(d ?? {}) };
  } catch { return blankStats(); }
})();
const saveStats = (): void => {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* ignore */ }
};

const unlocked: string[] = (() => {
  try {
    const d = JSON.parse(localStorage.getItem(BADGES_KEY) ?? "[]") as unknown;
    return Array.isArray(d) ? d.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
})();
let badgesSeen = (() => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } })();

interface MoveInfo { lines: number; combo: number; perfect: boolean; regions: number }
interface Badge {
  id: string; name: string; desc: string; ok: (m: MoveInfo | null) => boolean;
  progress?: () => [number, number]; // [now, target], shown as a bar while locked
  reward?: string;
}
const BADGES: Badge[] = [
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

const has = (id: string): boolean => unlocked.includes(id);

// The collection: a 4x4 picture that fills in as you play. Every 40 lines, 5 journey levels or
// a weekly win reveals a tile (a win is worth two); completing it unlocks the Prism theme.
const COLLECTION_SIZE = 16;
const TILE_ORDER = [5, 10, 0, 15, 6, 9, 3, 12, 1, 14, 2, 13, 4, 11, 7, 8];
const collectionTiles = (): number =>
  Math.min(COLLECTION_SIZE, Math.floor(stats.lines / 40) + Math.floor(stats.levels / 5) + stats.weeklyWins * 2);
const TILES_KEY = "blockpuzzle.tilesSeen";
function checkCollection(): void {
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
const perkUndos = (): number => Math.min(2, Math.floor(unlocked.length / 5));
const RANKS: [number, string][] = [[0, "Rookie"], [1, "Beginner"], [3, "Player"], [6, "Skilled"], [9, "Expert"], [12, "Master"], [16, "Grandmaster"]];
const rankName = (): string => [...RANKS].reverse().find(([n]) => unlocked.length >= n)![1];

interface Toast { title: string; desc: string; t: number; label?: string }
let toasts: Toast[] = [];

/** Unlocks any badge whose condition now holds and queues a pop-up for each. */
function checkBadges(m: MoveInfo | null): void {
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
const STREAK_KEY = "blockpuzzle.streak";
function readStreak(): StreakRec | null {
  try {
    const d = JSON.parse(localStorage.getItem(STREAK_KEY) ?? "null") as Partial<StreakRec> | null;
    return d && typeof d.last === "string" && typeof d.n === "number"
      ? { last: d.last, n: d.n, ...(typeof d.freezeWeek === "string" ? { freezeWeek: d.freezeWeek } : {}) } : null;
  } catch { return null; }
}
const streakNow = (): number => currentStreak(readStreak(), today());
function bumpStreak(): void {
  const before = readStreak();
  const { rec, saved } = applyPlay(before, today());
  if (rec === before) return;
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(rec)); } catch { /* ignore */ }
  stats.bestStreak = Math.max(stats.bestStreak, rec.n);
  saveStats();
  if (saved) toasts.push({ title: "Streak saved", desc: "Your weekly freeze covered the day you missed.", t: 0, label: "STREAK FREEZE" });
  checkBadges(null);
}
const playedDailyToday = (): boolean => readStreak()?.last === today();

/** Tray number n for the given mode. Each daily tray has its own stream, so retries cannot shift later trays. */
const makeTray = (grid: Grid, seed: string, n: number): Shape[] => drawTray(grid, seeded(`${seed}:${n}`));

// Visual-only: which gem colour each filled cell wears. The rules never read it.
const THEMES: { name: string; colors: string[]; req?: string }[] = [
  { name: "Gems", colors: ["#4da3ff", "#9a7bff", "#ff6f9c", "#ffb04d", "#3fd6a0", "#3fd0e8", "#ff7a5c", "#a6e05a"] },
  { name: "Neon", colors: ["#00e5ff", "#ff2bd6", "#b6ff00", "#ff7a00", "#8a5cff", "#00ff9d", "#ff3355", "#ffee00"] },
  { name: "Pastel", colors: ["#8ecae6", "#c3a6ff", "#ffadc6", "#ffd6a5", "#9be3c0", "#a0e7f0", "#ffb5a7", "#d4e79e"] },
  // Okabe-Ito: chosen to stay distinguishable with the common kinds of colour blindness.
  { name: "Gold", req: "s1000", colors: ["#ffd75e", "#ff9f43", "#f6c177", "#e8b4a0", "#c9a227", "#ffe9a0", "#d4884a", "#b8860b"] },
  { name: "Aurora", req: "streak7", colors: ["#3ef5c0", "#4ad1ff", "#7c6bff", "#c45bff", "#ff6bd6", "#57ffa0", "#39b3ff", "#a2ff5e"] },
  { name: "Prism", req: "collection", colors: ["#ff4d6d", "#ff9f1c", "#ffe14d", "#5ce65c", "#2ec4b6", "#4d8cff", "#9b5cff", "#ff5cc8"] },
  { name: "Midnight", req: "perfect", colors: ["#5b7cff", "#8a5bff", "#2ec8ff", "#ff4fa3", "#31e6c1", "#ffd34f", "#7aa2ff", "#c06bff"] },
  { name: "Colour-blind", colors: ["#0072b2", "#e69f00", "#56b4e9", "#009e73", "#f0e442", "#d55e00", "#cc79a7", "#999999"] },
];
const THEME_KEY = "blockpuzzle.theme";
const PALETTE: string[] = [...THEMES[0]!.colors]; // mutated in place when the theme changes
let themeIdx = 0;
let themeShownAt = -10;
const themeUnlocked = (i: number): boolean => {
  const req = THEMES[i]!.req;
  return !req || (req === "collection" ? collectionTiles() >= COLLECTION_SIZE : has(req));
};
/** Next theme you have unlocked, wrapping around. */
function cycleTheme(): void {
  for (let k = 1; k <= THEMES.length; k++) {
    const i = (themeIdx + k) % THEMES.length;
    if (themeUnlocked(i)) { applyTheme(i); return; }
  }
}
function applyTheme(i: number): void {
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
const blankColors = (): number[][] => Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(-1));
const blankPop = (): number[][] => Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
const colorIndex = (shape: Shape): number => shapeIndex(shape) % PALETTE.length;
let colorGrid = blankColors();
let pop = blankPop();
let startBest = loadBest();

function newState(o: GameOpts = {}): State {
  const daily = o.daily ?? null;
  const kind: Kind = o.kind ?? "classic";
  colorGrid = blankColors();
  pop = blankPop();
  startBest = loadBest(daily);
  let grid: Grid = emptyGrid();
  let seed = daily ?? o.ch?.seed ?? "";
  let level: number | null = null;
  let week: string | null = null;
  if (kind === "journey") {
    level = Math.max(1, Math.floor(o.level ?? 1));
    const lv = makeLevel(level);
    grid = lv.prefill;
    seed = lv.seed;
    colorGrid = grid.map((row, r) => row.map((f, c) => (f ? (r + c * 2) % PALETTE.length : -1)));
  } else if (kind === "weekly") {
    week = weekId(today());
    seed = weeklySeed(week);
  }
  if (!seed) seed = randomSeed();
  // A daily replay (or an archive day you already played) is practice: the first attempt is the record.
  const practice = !!daily && officialResult(daily) !== null;
  const undoLeft = kind === "zen" ? 99 : daily || o.ch || kind !== "classic" ? 1 : 1 + perkUndos();
  return {
    grid, tray: makeTray(grid, seed, 0), score: 0, best: loadBest(daily), combo: 0, over: false, daily, trays: 1,
    undoLeft, seed, challenge: o.ch ? o.ch.target : null, kind, practice, level, week,
    wk: kind === "weekly" ? blankRun() : null, moves: 0, lines: 0, won: false, stars: 0,
  };
}

// ---- The daily's official result and par ----------------------------------------
// The first attempt at a given day is the record, and the only one that is shared as the result.
// Later attempts at that date are practice.

interface Official { score: number; board: string; abandoned?: boolean }
const officialKey = (date: string): string => `blockpuzzle.official.${date}`;
function officialResult(date: string): Official | null {
  try {
    const d = JSON.parse(localStorage.getItem(officialKey(date)) ?? "null") as Official | null;
    return d && typeof d.score === "number" && typeof d.board === "string" ? d : null;
  } catch { return null; }
}
function recordOfficial(abandoned: boolean): void {
  if (!state.daily || state.practice || officialResult(state.daily)) return;
  try {
    localStorage.setItem(officialKey(state.daily), JSON.stringify({ score: state.score, board: boardEmoji(state.grid, colorGrid), ...(abandoned ? { abandoned: true } : {}) }));
  } catch { /* ignore */ }
}
function clearOfficial(date: string): void {
  try { localStorage.removeItem(officialKey(date)); } catch { /* ignore */ }
}

/** Par for each date, from a greedy bot run offline (scripts/make-par.ts). Missing days just show no par. */
let parMap: Record<string, number> = {};
fetch("/par.json").then((r) => (r.ok ? r.json() : null)).then((d: unknown) => {
  if (d && typeof d === "object") parMap = d as Record<string, number>;
}).catch(() => { /* offline or missing: no par */ });
const parFor = (date: string | null): number | null => (date && parMap[date] ? parMap[date]! : null);

// ---- Saving a game in progress ------------------------------------------------
// Shapes are stored as catalogue indices; the grid as one 64-char string of 0/1.

function save(): void {
  try {
    if (state.over) { localStorage.removeItem(SAVE_KEY); return; }
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      g: state.grid.flat().map((f) => (f ? 1 : 0)).join(""),
      t: state.tray.map((s) => (s ? shapeIndex(s) : -1)),
      s: state.score,
      c: state.combo,
      d: state.daily,
      sd: state.seed,
      ch: state.challenge,
      n: state.trays,
      u: state.undoLeft,
      kd: state.kind,
      pr: state.practice,
      lv: state.level,
      wid: state.week,
      wk: state.wk,
      mv: state.moves,
      ln: state.lines,
      k: colorGrid.flat().map((v) => (v < 0 ? "-" : String(v))).join(""),
    }));
  } catch { /* ignore */ }
}

function load(): State | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { g: string; t: number[]; s: number; c: number; k?: string; d?: string | null; n?: number; u?: number; sd?: string; ch?: number | null; kd?: Kind; pr?: boolean; lv?: number | null; wid?: string | null; wk?: WeeklyRun | null; mv?: number; ln?: number };
    if (typeof d?.g !== "string" || d.g.length !== SIZE * SIZE || !Array.isArray(d.t)) return null;
    const grid = Array.from({ length: SIZE }, (_, r) =>
      Array.from({ length: SIZE }, (_, c) => d.g[r * SIZE + c] === "1"));
    const tray = d.t.map((i) => (i >= 0 ? shapeAt(i) : null));
    if (tray.length !== 3) return null;
    colorGrid = Array.from({ length: SIZE }, (_, r) =>
      Array.from({ length: SIZE }, (_, c) => {
        if (!grid[r]![c]) return -1;
        const v = Number(d.k?.[r * SIZE + c]);
        return Number.isInteger(v) && v >= 0 && v < PALETTE.length ? v : 0;
      }));
    pop = blankPop();
    const daily = typeof d.d === "string" ? d.d : null;
    startBest = loadBest(daily);
    return {
      grid, tray, score: Number(d.s) || 0, best: loadBest(daily), combo: Number(d.c) || 0, over: false,
      daily, trays: Number(d.n) || 1, undoLeft: Number.isFinite(d.u) ? Math.max(0, Math.min(99, Number(d.u))) : 1,
      seed: typeof d.sd === "string" && /^[a-z0-9-]{3,24}$/i.test(d.sd) ? d.sd : daily ?? randomSeed(),
      challenge: typeof d.ch === "number" ? d.ch : null,
      kind: d.kd === "zen" || d.kd === "weekly" || d.kd === "journey" ? d.kd : "classic",
      practice: d.pr === true,
      level: typeof d.lv === "number" ? d.lv : null,
      week: typeof d.wid === "string" ? d.wid : null,
      wk: d.wk && typeof d.wk.lines === "number" ? { ...blankRun(), ...d.wk } : null,
      moves: Number(d.mv) || 0, lines: Number(d.ln) || 0, won: false, stars: 0,
    };
  } catch {
    return null;
  }
}

let state: State = load() ?? newState();
const HINT_KEY = "blockpuzzle.hintSeen";

// ---- Transient effects (purely visual; never affect game logic) ---------------

interface ClearCell { r: number; c: number; ci: number; delay: number; fired: boolean }
interface Clear { cells: ClearCell[]; t: number; lines: number; count: number }
interface Ring { x: number; y: number; t: number; max: number; color: string; w: number }
let rings: Ring[] = [];
interface Praise { text: string; t: number; level: number }
let praises: Praise[] = [];
const PRAISE = ["Nice!", "Great!", "Awesome!", "Fantastic!", "Unreal!", "Perfect!"];
const PRAISE_COLORS = ["#7fe3a8", "#5ec8ff", "#ffc555", "#ff8a5c", "#ff5fa8", "#ffe27a"];
let flash = 0; // full-screen white pulse on big clears
let jellyAmp = 0; // the board wobbles after a clear
let jellyT = 0;
let idleT = 0; // seconds since the player last did anything
let challengeBeaten = state.challenge !== null && state.score > state.challenge;
// Opened from a friend's link: offer the challenge before touching the current game.
let chIntro: Challenge | null = (() => {
  try {
    const c = parseChallenge(location.search);
    if (c) history.replaceState(null, "", location.pathname);
    return c;
  } catch { return null; }
})();
let chPress: "play" | "skip" | null = null;
let chT = 0;
const chHit = (x: number, y: number): "play" | "skip" | null =>
  Math.abs(x - W / 2) <= 100 && y >= H / 2 + 66 && y <= H / 2 + 126 ? "play"
  : Math.abs(x - W / 2) <= 100 && y >= H / 2 + 132 && y <= H / 2 + 176 ? "skip" : null;
let modesOn = false;
let modesView: "main" | "archive" = "main";
let modesT = 0;
let modesPress: { x: number; y: number } | null = null;
let statsOn = false;
let statsT = 0;
let statsPress: { x: number; y: number } | null = null;
let badgeSel = -1;
let gameCounted = state.score > 0; // this game has been added to the games-played count
let banked: number | null = null; // final score already added to the lifetime total (null = not yet)
let scorePulse = 0;
let clears: Clear[] = [];
interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string; g?: number; spark?: boolean; star?: boolean; rot?: number; vr?: number }
let particles: Particle[] = [];
interface Floater { x: number; y: number; text: string; sub: string; t: number }
let floaters: Floater[] = [];
interface Ret { shape: Shape; color: string; x0: number; y0: number; s0: number; slot: number; t: number }
let returning: Ret[] = [];
let clock = 0;
let overT = 0;
let shake = 0;
let shownScore = state.score; // the HUD number counts up toward state.score

// ---- Layout, recomputed on resize ---------------------------------------------

let dpr = 1, W = 0, H = 0, cell = 0, boardX = 0, boardY = 0, trayY = 0, trayCell = 0;
function layout(): void {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const top = 108;
  cell = Math.floor(Math.min(W - 44, (H - top) * 0.6) / SIZE);
  boardX = Math.floor((W - cell * SIZE) / 2);
  boardY = top;
  trayCell = Math.floor(Math.min(cell * 0.6, (W - 48) / 15));
  trayY = boardY + cell * SIZE + (H - boardY - cell * SIZE) / 2 - trayCell * 1.5;
}

/** Top-left of tray slot i (slot is a 5x5 trayCell box). */
function slotRect(i: number): { x: number; y: number; size: number } {
  const size = trayCell * 5;
  const gap = (W - size * 3) / 4;
  return { x: gap + i * (size + gap), y: trayY - trayCell, size };
}

const CHIP = { x: 22, y: 64, w: 108, h: 26 };
const undoRect = (): { x: number; y: number; w: number; h: number } => ({ x: W - 144, y: 64, w: 70, h: 26 });
const inRect = (r: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean =>
  x >= r.x - 4 && x <= r.x + r.w + 4 && y >= r.y - 6 && y <= r.y + r.h + 6;

const THEME_C = (): [number, number] => [W - 58, 77];
const MUTE_R = 14;
const muteCenter = (): [number, number] => [W - 26, 77];

interface Snapshot { grid: Grid; tray: (Shape | null)[]; score: number; combo: number; trays: number; colors: number[][]; moves: number; lines: number; wk: WeeklyRun | null }
let snap: Snapshot | null = null;

const canUndo = (): boolean => !!snap && state.undoLeft > 0 && !state.over && !drag;
const canUndoOver = (): boolean => !!snap && state.undoLeft > 0 && state.over && !state.won;

function undo(): void {
  if (!snap || state.undoLeft <= 0 || drag) return;
  if (state.over) {
    // Take back the losing move, and the stats it banked.
    state.over = false; overT = 0;
    if (banked !== null) {
      stats.total -= banked; stats.finished = Math.max(0, stats.finished - 1);
      stats.hist[scoreBucket(banked)] = Math.max(0, (stats.hist[scoreBucket(banked)] ?? 0) - 1);
      banked = null;
    }
    if (state.daily && !state.practice) clearOfficial(state.daily);
    if (state.won) { state.won = false; }
    saveStats();
  }
  state.grid = snap.grid;
  state.tray = snap.tray;
  state.score = snap.score;
  state.combo = snap.combo;
  state.trays = snap.trays;
  state.moves = snap.moves;
  state.lines = snap.lines;
  state.wk = snap.wk && state.wk ? { ...snap.wk, undos: state.wk.undos + 1 } : snap.wk;
  state.undoLeft--;
  colorGrid = snap.colors;
  pop = blankPop();
  clears = []; particles = []; floaters = []; rings = []; shake = 0;
  shownScore = state.score;
  snap = null;
  sfx.place();
  haptics.undo();
  save();
}

/** Starts a game, asking first if it would throw away one in progress. */
function startGame(o: GameOpts): void {
  if (state.score > 0 && !state.over && state.kind !== "zen" && !confirm("Start a new game? Your current game will be lost.")) return;
  reset(o);
}

let moves = 0; // placements this session, to time the install nudge
let overPress: "share" | "again" | "mode" | "undo" | null = null;
let hintOn = (() => {
  try { return localStorage.getItem(HINT_KEY) !== "1"; } catch { return false; }
})();
let hintT = 0;
let hintPress = false;
let sharedAt = -10; // clock time of the last "copied" confirmation

function overHit(x: number, y: number): "share" | "again" | "mode" | "undo" {
  if (Math.abs(x - W / 2) <= 96) {
    if (canUndoOver() && y >= H / 2 + 214 && y <= H / 2 + 262) return "undo";
    if (y >= H / 2 + 104 && y <= H / 2 + 156) return "share";
    if (y >= H / 2 + 160 && y <= H / 2 + 212) return "mode";
  }
  return "again";
}

/** The text and link to share for this game: a small emoji picture of the board, not just a number. */
function shareContent(): { text: string; url: string } {
  const origin = location.origin;
  if (state.kind === "journey" && state.level)
    return { text: `Block Puzzle \u00B7 Level ${state.level} ${state.won ? "\u2605".repeat(state.stars) : "(not cleared yet)"}\nCan you clear it?`, url: origin };
  if (state.kind === "zen") return { text: `Block Puzzle zen: ${state.lines} lines cleared, no game over.`, url: origin };
  if (state.daily) {
    // The official first attempt is the result that gets shared, even after a practice run.
    const off = officialResult(state.daily);
    const board = off ? off.board : boardEmoji(state.grid, colorGrid);
    const score = off ? off.score : state.score;
    return {
      text: shareText({
        title: `Block Puzzle \u00B7 ${state.daily}`, score, board, par: parFor(state.daily),
        streak: state.daily === today() ? streakNow() : 0, note: state.daily === today() ? undefined : "Archive",
      }),
      url: origin,
    };
  }
  const title = state.kind === "weekly" && state.week ? `Block Puzzle \u00B7 Weekly ${state.week}` : "Block Puzzle";
  const text = shareText({ title, score: state.score, board: boardEmoji(state.grid, colorGrid) }) + "\nBeat me on the exact same pieces!";
  // A random game's link carries its seed, so a friend plays the same pieces against my score.
  return { text, url: state.kind === "weekly" ? origin : challengeUrl(origin, state.seed, state.score) };
}

async function shareScore(): Promise<void> {
  const { text, url } = shareContent();
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
    } else {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      sharedAt = clock;
    }
  } catch (err) {
    // A cancelled share sheet is not an error; anything else falls back to copying.
    if ((err as DOMException)?.name === "AbortError") return;
    try { await navigator.clipboard.writeText(`${text}\n${url}`); sharedAt = clock; } catch { /* ignore */ }
  }
}

function reset(o: GameOpts = {}): void {
  // Walking away from today's first attempt closes it with the score so far: no retrying until it looks good.
  if (state.daily && !state.practice && !state.over && state.score > 0) recordOfficial(true);
  state = newState(o);
  snap = null;
  gameCounted = false;
  banked = null;
  challengeBeaten = false;
  shownScore = 0;
  clears = []; particles = []; floaters = []; returning = []; rings = []; praises = []; flash = 0;
  overT = 0;
  save();
}

/** Weekly and journey bookkeeping after each placement. */
function trackModes(m: { lines: number; cells: number; points: number }): void {
  if (state.kind === "weekly" && state.wk && state.week) {
    const w = weeklyFor(state.week);
    const wasFailed = weeklyFailed(w, state.wk);
    state.wk = recordMove(state.wk, m);
    if (!wasFailed && weeklyFailed(w, state.wk)) {
      praises.push({ text: "Rule broken", t: 0, level: 1 });
      haptics.invalid();
    }
    if (weeklyDone(w, state.wk) && !weeklyCompleted(state.week)) {
      try { localStorage.setItem(`blockpuzzle.weekly.${state.week}`, "1"); } catch { /* ignore */ }
      stats.weeklyWins++;
      saveStats();
      praises.push({ text: "Complete!", t: 0, level: 5 });
      sfx.praise(5);
      flash = Math.max(flash, 0.4);
      haptic([30, 40, 30, 40, 90]);
      checkBadges(null);
    }
  }
  if (state.kind === "journey" && state.level && !state.won) {
    const lv = makeLevel(state.level);
    const prog = { score: state.score, lines: state.lines, moves: state.moves };
    if (goalReached(lv, prog)) {
      state.won = true;
      state.over = true;
      overT = 0;
      state.stars = starsFor(lv, prog);
      const j = readJourney();
      j.stars[state.level] = Math.max(j.stars[state.level] ?? 0, state.stars);
      if (state.level >= j.next) { j.next = state.level + 1; }
      writeJourney(j);
      stats.levels = Object.keys(j.stars).length;
      saveStats();
      sfx.praise(6);
      flash = 0.5;
      haptic([30, 30, 30, 30, 30, 30, 70]);
      checkBadges(null);
    }
  }
}

const weeklyCompleted = (week: string): boolean => {
  try { return localStorage.getItem(`blockpuzzle.weekly.${week}`) === "1"; } catch { return false; }
};

// Journey progress: the next level to play, and the best stars on each level cleared.
interface JourneyData { next: number; stars: Record<number, number> }
const JOURNEY_KEY = "blockpuzzle.journey";
function readJourney(): JourneyData {
  try {
    const d = JSON.parse(localStorage.getItem(JOURNEY_KEY) ?? "null") as Partial<JourneyData> | null;
    return { next: Math.max(1, Number(d?.next) || 1), stars: d?.stars && typeof d.stars === "object" ? d.stars : {} };
  } catch { return { next: 1, stars: {} }; }
}
function writeJourney(j: JourneyData): void {
  try { localStorage.setItem(JOURNEY_KEY, JSON.stringify(j)); } catch { /* ignore */ }
}

/** Ends a game that has run out of moves, banking its stats. */
function endGame(): void {
  state.over = true;
  overT = 0;
  sfx.gameOver();
  haptics.gameOver();
  if (state.kind === "classic" || state.kind === "weekly") {
    stats.finished++;
    stats.total += state.score;
    const b = scoreBucket(state.score);
    stats.hist[b] = (stats.hist[b] ?? 0) + 1;
    banked = state.score;
  }
  if (state.daily && !state.practice) recordOfficial(false);
  saveStats();
  checkBadges(null);
}

/** Zen rescue: clears the fullest line, with the usual clear animation. Returns false if there is nothing to clear. */
function easeZen(): boolean {
  const line = fullestLine(state.grid);
  if (!line) return false;
  const lr = line.cells.reduce((a, [r]) => a + r, 0) / line.cells.length;
  const lc = line.cells.reduce((a, [, c]) => a + c, 0) / line.cells.length;
  const filled = line.cells.filter(([r, c]) => state.grid[r]![c]);
  clears.push({
    lines: 1, t: 0, count: 0,
    cells: filled.map(([r, c]) => ({
      r, c, ci: colorGrid[r]![c]!, fired: false,
      delay: reduceMotion ? 0 : Math.min(0.4, Math.hypot(r - lr, c - lc) * 0.05),
    })),
  });
  for (const [r, c] of filled) colorGrid[r]![c] = -1;
  state.grid = clearCells(state.grid, line.cells);
  praises.push({ text: "Breathe", t: 0, level: 1 });
  sfx.praise(1);
  haptics.tick();
  return true;
}

// ---- Drag ----------------------------------------------------------------------

interface Drag { slot: number; shape: Shape; px: number; py: number; pointerId: number; touch: boolean; k: number; vx: number }
let drag: Drag | null = null;

/** Where the dragged shape's top-left would land on the board (snapped), or null. */
function dragTarget(): { row: number; col: number; ok: boolean } | null {
  if (!drag) return null;
  const { rows, cols } = shapeSize(drag.shape);
  const lift = drag.touch ? cell * 1.5 : 0; // keep the piece visible above a finger
  const col = Math.round((drag.px - boardX) / cell - cols / 2);
  const row = Math.round((drag.py - lift - boardY) / cell - rows / 2);
  return { row, col, ok: canPlace(state.grid, drag.shape, row, col) };
}

function slotAt(x: number, y: number): number {
  for (let i = 0; i < 3; i++) {
    const r = slotRect(i);
    if (x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size) return i;
  }
  return -1;
}

canvas.addEventListener("pointerdown", (e) => {
  unlock(); // must happen on the gesture itself, not on pointerup
  idleT = 0;
  const [mx, my] = muteCenter();
  if (Math.hypot(e.clientX - mx, e.clientY - my) <= MUTE_R + 6) { toggleMute(); return; }
  if (hintOn) { hintPress = true; return; }
  if (chIntro) { chPress = chHit(e.clientX, e.clientY); return; }
  if (statsOn) { statsPress = { x: e.clientX, y: e.clientY }; return; }
  if (modesOn) { modesPress = { x: e.clientX, y: e.clientY }; return; }
  if (state.over) {
    // Act on release, not press: share() needs a completed gesture on iOS.
    if (overT >= 0.6) overPress = overHit(e.clientX, e.clientY);
    return;
  }
  if (state.combo < 2 && Math.hypot(e.clientX - W / 2, e.clientY - 30) <= 20) {
    statsOn = true; statsT = 0; badgeSel = -1; badgesSeen = unlocked.length;
    try { localStorage.setItem(SEEN_KEY, String(badgesSeen)); } catch { /* ignore */ }
    haptics.tick();
    return;
  }
  const [tx, ty] = THEME_C();
  if (Math.hypot(e.clientX - tx, e.clientY - ty) <= 19) { cycleTheme(); themeShownAt = clock; haptics.tick(); return; }
  if (inRect(CHIP, e.clientX, e.clientY)) { modesOn = true; modesView = "main"; modesT = 0; haptics.tick(); return; }
  if (canUndo() && inRect(undoRect(), e.clientX, e.clientY)) { undo(); return; }
  if (drag) return;
  const slot = slotAt(e.clientX, e.clientY);
  const shape = slot >= 0 ? state.tray[slot] : null;
  if (!shape) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { slot, shape, px: e.clientX, py: e.clientY, pointerId: e.pointerId, touch: e.pointerType !== "mouse", k: 0, vx: 0 };
  haptics.pick();
  sfx.pick();
});

canvas.addEventListener("pointermove", (e) => {
  idleT = 0;
  if (drag && e.pointerId === drag.pointerId) {
    drag.vx = drag.vx * 0.6 + (e.clientX - drag.px) * 0.4; // sway the held piece with your hand
    drag.px = e.clientX; drag.py = e.clientY;
  }
});

canvas.addEventListener("pointerup", (e) => {
  if (chPress && chIntro) {
    const want = chPress;
    const ch = chIntro;
    chPress = null;
    if (chHit(e.clientX, e.clientY) !== want) return;
    chIntro = null;
    chT = 0;
    if (want === "play") reset({ ch });
    return;
  }
  if (modesPress) {
    const down = modesPress;
    modesPress = null;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
    const l = modesLayout();
    const lx = (e.clientX - W / 2) / l.k;
    const ly = (e.clientY - H / 2) / l.k;
    const inCard = Math.abs(lx) <= l.cw / 2 && Math.abs(ly) <= MODES_H / 2;
    if (!inCard) { modesOn = false; return; }
    if (ly >= 232 && ly <= 280 && Math.abs(lx) <= 90) {
      if (modesView === "archive") modesView = "main"; else modesOn = false;
      haptics.tick();
      return;
    }
    if (modesView === "main") {
      for (let i = 0; i < 6; i++) {
        const y = -200 + i * 70;
        if (ly >= y && ly <= y + 62 && Math.abs(lx) <= l.cw / 2 - 16) { pickMode(i); return; }
      }
    } else {
      const dates = archiveDates();
      const cw2 = (l.cw - 48 - 10) / 2;
      for (let i = 0; i < dates.length; i++) {
        const x = -l.cw / 2 + 24 + (i % 2) * (cw2 + 10);
        const y = -200 + Math.floor(i / 2) * 58;
        if (lx >= x && lx <= x + cw2 && ly >= y && ly <= y + 50) {
          modesOn = false;
          startGame({ daily: dates[i]! });
          return;
        }
      }
    }
    return;
  }
  if (statsPress) {
    const down = statsPress;
    statsPress = null;
    const l = statsLayout();
    const lx = (e.clientX - W / 2) / l.k;
    const ly = (e.clientY - H / 2) / l.k;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
    for (let t = 0; t < TABS.length; t++) {
      const r = tabRect(t, l.cw);
      if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) { statsTab = t; badgeSel = -1; haptics.tick(); return; }
    }
    if (statsTab === 1) {
      for (let i = 0; i < BADGES.length; i++) {
        const b = badgeCell(i, l);
        if (lx >= b.x - b.w / 2 && lx <= b.x + b.w / 2 && ly >= b.y && ly <= b.y + 54) { badgeSel = badgeSel === i ? -1 : i; haptics.tick(); return; }
      }
    }
    const inCard = Math.abs(lx) <= l.cw / 2 && ly >= -CARD_H / 2 && ly <= CARD_H / 2;
    const onClose = Math.abs(lx) <= 90 && ly >= 244 && ly <= 294;
    if (!inCard || onClose) statsOn = false;
    return;
  }
  if (hintPress) {
    hintPress = false;
    if (hintT >= 0.5) { hintOn = false; try { localStorage.setItem(HINT_KEY, "1"); } catch { /* ignore */ } }
    return;
  }
  if (overPress && state.over) {
    const want = overPress;
    overPress = null;
    if (overHit(e.clientX, e.clientY) !== want) return;
    if (want === "share") void shareScore();
    else if (want === "undo") undo();
    else if (want === "mode") reset(state.kind !== "classic" ? {} : state.daily ? {} : { daily: today() });
    else if (state.kind === "journey") reset({ kind: "journey", level: (state.level ?? 1) + (state.won ? 1 : 0) });
    else if (state.kind !== "classic") reset({ kind: state.kind });
    else reset({ daily: state.daily, ch: state.challenge !== null ? { seed: state.seed, target: state.challenge } : null }); // a lost challenge replays the same pieces
    return;
  }
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.px = e.clientX; drag.py = e.clientY;
  const t = dragTarget();
  const color = colorIndex(drag.shape);
  if (t?.ok) {
    const res = place(state.grid, drag.shape, t.row, t.col, state.combo);
    const lines = res.rowsCleared.length + res.colsCleared.length + res.regionsCleared.length;
    const perfect = lines > 0 && isEmpty(res.grid);
    snap = {
      grid: state.grid, tray: [...state.tray], score: state.score, combo: state.combo,
      trays: state.trays, colors: colorGrid.map((r) => r.slice()),
      moves: state.moves, lines: state.lines, wk: state.wk ? { ...state.wk } : null,
    };
    if (state.daily === today() && !state.practice) bumpStreak();
    moves++;
    maybeShowInstall();

    for (const [dr, dc] of drag.shape) {
      colorGrid[t.row + dr]![t.col + dc] = color;
      pop[t.row + dr]![t.col + dc] = 1;
    }
    {
      // Landing: a shockwave ring and a puff of dust from every placed block.
      const { rows, cols } = shapeSize(drag.shape);
      rings.push({
        x: boardX + (t.col + cols / 2) * cell, y: boardY + (t.row + rows / 2) * cell, t: 0,
        max: cell * (1.3 + Math.max(rows, cols) * 0.35), color: PALETTE[color]!, w: 3,
      });
      if (!reduceMotion)
        for (const [dr, dc] of drag.shape)
          for (let i = 0; i < 2; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 30 + Math.random() * 70;
            particles.push({
              x: boardX + (t.col + dc + 0.5) * cell, y: boardY + (t.row + dr + 0.5) * cell,
              vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 0.7, size: 1.5 + Math.random() * 2,
              color: PALETTE[color]!, g: 160,
            });
          }
      scorePulse = 1;
    }

    if (lines > 0) {
      // Record the cleared cells (and their colours) before the grid forgets them.
      const list = clearedCells(res).map(([r, c]) => [r, c] as [number, number]);
      const { rows: pr, cols: pc } = shapeSize(drag.shape);
      const lr = t.row + (pr - 1) / 2;
      const lc = t.col + (pc - 1) / 2;
      clears.push({
        lines, t: 0, count: 0,
        cells: list.map(([r, c]) => ({
          r, c, ci: colorGrid[r]![c]!, fired: false,
          // The wave travels outward from where the piece landed.
          delay: reduceMotion ? 0 : Math.min(0.4, Math.hypot(r - lr, c - lc) * 0.05),
        })),
      });
      let sx = 0, sy = 0;
      for (const [r, c] of list) {
        sx += boardX + (c + 0.5) * cell;
        sy += boardY + (r + 0.5) * cell;
        colorGrid[r]![c] = -1;
      }
      rings.push({ x: sx / list.length, y: sy / list.length, t: 0, max: cell * (2.2 + lines * 0.5), color: has("combo5") ? rainbow(0) : lines >= 2 ? COLORS.combo : "#ffffff", w: 2.5 + lines * 0.5 });
      floaters.push({ x: sx / list.length, y: sy / list.length, text: `+${res.points + (perfect ? PERFECT_BONUS : 0)}`, sub: "", t: 0 });

      // Praise banner, scaled to how well that move went.
      const level = Math.min(5, lines >= 2 ? lines + (res.combo >= 3 ? 1 : 0) : res.combo >= 2 ? 1 : 0);
      if (perfect) {
        // Whole board cleared: the biggest moment in the game.
        praises.push({ text: PRAISE[5]!, t: 0, level: 6 });
        sfx.praise(6);
        flash = 0.6;
        shake = 1;
        if (!reduceMotion)
          for (let i = 0; i < 46; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 200 + Math.random() * 380;
            particles.push({
              x: W / 2, y: boardY + (cell * SIZE) / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 1.6,
              size: 5 + Math.random() * 6, color: has("quad") ? GOLDS[i % GOLDS.length]! : i % 2 ? "#ffd75e" : PALETTE[i % PALETTE.length]!,
              star: true, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, g: 480,
            });
          }
        haptic([30, 30, 30, 30, 30, 30, 70, 50, 140]);
      } else if (level > 0) { praises.push({ text: PRAISE[level - 1]!, t: 0, level }); sfx.praise(level); }
      if (lines >= 2 || res.combo >= 3) flash = Math.min(0.5, 0.14 + lines * 0.08);
      jellyAmp = Math.min(1, 0.3 + lines * 0.2);
      jellyT = 0;
      if (!reduceMotion && lines >= 2) {
        // Confetti stars, thrown up from the middle of the clear.
        for (let i = 0; i < lines * 9; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
          const v = 220 + Math.random() * 320;
          particles.push({
            x: sx / list.length, y: sy / list.length, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.4,
            size: 5 + Math.random() * 5, color: has("quad") ? GOLDS[i % GOLDS.length]! : i % 3 === 0 ? "#ffd75e" : PALETTE[i % PALETTE.length]!,
            star: true, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, g: 520,
          });
        }
      }
      if (lines >= 2 || res.combo >= 3) shake = Math.min(1, 0.35 + lines * 0.15);
      sfx.clear(lines, state.combo);
      haptics.clear(lines, res.combo);
    } else {
      sfx.place();
      haptics.drop();
    }

    state.grid = res.grid;
    const gained = res.points + (perfect ? PERFECT_BONUS : 0);
    state.score += gained;
    state.combo = res.combo;
    state.moves++;
    state.lines += lines;
    // Zen and journey games do not feed the score records: their goals are not a score race.
    const scored = state.kind === "classic" || state.kind === "weekly";
    if (!gameCounted) { gameCounted = true; stats.games++; }
    stats.moves++;
    stats.lines += lines;
    stats.bestCombo = Math.max(stats.bestCombo, res.combo);
    if (scored) stats.bestScore = Math.max(stats.bestScore, state.score);
    if (state.kind === "zen") stats.zenLines += lines;
    if (perfect) stats.perfects++;
    saveStats();
    checkBadges({ lines, combo: res.combo, perfect, regions: res.regionsCleared.length });
    if (state.challenge !== null && !challengeBeaten && state.score > state.challenge) {
      challengeBeaten = true;
      stats.challengesWon++;
      saveStats();
      praises.push({ text: "Beaten!", t: 0, level: 5 });
      sfx.praise(5);
      flash = Math.max(flash, 0.35);
      haptic([30, 40, 30, 40, 90]);
      checkBadges(null);
    }
    trackModes({ lines, cells: drag.shape.length, points: gained });
    state.tray[drag.slot] = null;
    if (state.tray.every((s) => s === null)) state.tray = makeTray(state.grid, state.seed, state.trays++);
    if (scored && state.score > state.best) {
      state.best = state.score;
      try { localStorage.setItem(bestKey(state.daily), String(state.best)); } catch { /* ignore */ }
    }
    if (!state.over) {
      let remaining = state.tray.filter((s): s is Shape => s !== null);
      // Zen has no game over: when nothing fits, the fullest line is cleared to keep you going.
      for (let guard = 0; state.kind === "zen" && !hasMoves(state.grid, remaining) && guard < 4; guard++) {
        if (!easeZen()) break;
        remaining = state.tray.filter((s): s is Shape => s !== null);
      }
      if (!hasMoves(state.grid, remaining)) endGame();
    }
    save();
  } else {
    const d = dragDraw(drag);
    returning.push({ shape: drag.shape, color: PALETTE[color]!, x0: d.cx, y0: d.cy, s0: d.s, slot: drag.slot, t: 0 });
    sfx.invalid();
    haptics.invalid();
  }
  idleT = 0;
  drag = null;
});

canvas.addEventListener("pointercancel", () => { drag = null; });
window.addEventListener("blur", save);
document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });

// ---- Rendering ------------------------------------------------------------------

const COLORS = {
  text: "#eef1f8", dim: "#7f889c", combo: "#ffc555",
  bad: "rgba(240,90,110,0.38)",
};

const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const FONT = "system-ui, -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif";

function mix(hex: string, to: number, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (to - v) * a);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** One glossy gem block. */
function block(x: number, y: number, s: number, hex: string): void {
  const g = Math.max(1, s * 0.04);
  const w = s - g * 2;
  const rr = s * 0.22;
  const dep = s * 0.11; // visible thickness: the block is a slab, lit from above
  const fh = w - dep; // height of the top face

  // Side wall: a darker copy sitting lower, so the face reads as raised.
  ctx.fillStyle = mix(hex, 0, 0.5);
  ctx.beginPath();
  ctx.roundRect(x + g, y + g + dep, w, fh, rr);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.18)"; // contact shade at the base
  ctx.beginPath();
  ctx.roundRect(x + g, y + g + dep + fh * 0.7, w, fh * 0.3, rr);
  ctx.fill();

  // Top face.
  const grad = ctx.createLinearGradient(x, y + g, x, y + g + fh);
  grad.addColorStop(0, mix(hex, 255, 0.36));
  grad.addColorStop(0.5, hex);
  grad.addColorStop(1, mix(hex, 0, 0.14));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x + g, y + g, w, fh, rr);
  ctx.fill();
  // bevel highlight along the top edge
  ctx.strokeStyle = "rgba(255,255,255,0.38)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(x + g + 0.6, y + g + 0.6, w - 1.2, fh - 1.2, rr);
  ctx.stroke();
  // soft gloss
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.roundRect(x + g + w * 0.1, y + g + fh * 0.08, w * 0.8, fh * 0.36, rr * 0.8);
  ctx.fill();
}

function emptyCell(x: number, y: number, s: number, alt = false): void {
  const g = Math.max(1, s * 0.04);
  const grad = ctx.createLinearGradient(x, y, x, y + s);
  grad.addColorStop(0, alt ? "#1a2030" : "#151925");
  grad.addColorStop(1, alt ? "#232a3d" : "#1d2230");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x + g, y + g, s - g * 2, s - g * 2, s * 0.22);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.045)"; // lit lower lip
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + g + 0.5, y + g + 1.5, s - g * 2 - 1, s - g * 2 - 1, s * 0.22);
  ctx.stroke();
}

function drawShape(shape: Shape, x: number, y: number, s: number, hex: string): void {
  for (const [r, c] of shape) block(x + c * s, y + r * s, s, hex);
}

/** Centre and cell size of the piece being dragged, easing from its tray slot up to the pointer. */
const easeOutBack = (t: number): number => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

function dragDraw(d: Drag): { cx: number; cy: number; s: number } {
  const e = 1 - Math.pow(1 - d.k, 3);
  const slot = slotRect(d.slot);
  const lift = d.touch ? cell * 1.5 : 0;
  return {
    cx: slot.x + slot.size / 2 + (d.px - (slot.x + slot.size / 2)) * e,
    cy: slot.y + slot.size / 2 + (d.py - lift - (slot.y + slot.size / 2)) * e,
    s: trayCell + (cell - trayCell) * easeOutBack(d.k), // overshoots, then settles: the pick-up "pop"
  };
}

function drawCentered(shape: Shape, cx: number, cy: number, s: number, hex: string, rot = 0): void {
  const { rows, cols } = shapeSize(shape);
  if (!rot) { drawShape(shape, cx - (cols * s) / 2, cy - (rows * s) / 2, s, hex); return; }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  drawShape(shape, -(cols * s) / 2, -(rows * s) / 2, s, hex);
  ctx.restore();
}

function drawMute(): void {
  const [x, y] = muteCenter();
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 15px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(isMuted() ? "\u{1F507}" : "\u{1F50A}", x, y);
}

function label(text: string, x: number, y: number, align: CanvasTextAlign): void {
  ctx.fillStyle = COLORS.dim;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.font = `600 11px ${FONT}`;
  ctx.fillText(text, x, y);
}

function drawHud(): void {
  const lv = state.kind === "journey" && state.level ? makeLevel(state.level) : null;
  const wk = state.kind === "weekly" && state.week ? weeklyFor(state.week) : null;
  let leftLabel = "SCORE";
  let rightLabel = "BEST";
  let leftValue = String(Math.round(shownScore));
  let rightValue = String(state.best);
  let hot = state.score >= state.best && state.score > 0;
  if (state.challenge !== null) {
    leftLabel = "CHALLENGE"; rightLabel = "TARGET"; rightValue = String(state.challenge); hot = state.score > state.challenge;
  } else if (lv) {
    const prog = { score: Math.round(shownScore), lines: state.lines, moves: state.moves };
    leftLabel = `LEVEL ${lv.n}`;
    rightLabel = `GOAL \u00B7 ${lv.goal.kind === "score" ? "POINTS" : lv.goal.kind === "lines" ? "LINES" : "PIECES"}`;
    leftValue = String(goalValue(lv, prog));
    rightValue = lv.goal.target.toLocaleString("en-US");
    hot = goalReached(lv, { score: state.score, lines: state.lines, moves: state.moves });
  } else if (wk && state.wk) {
    leftLabel = "WEEKLY";
    rightLabel = weeklyFailed(wk, state.wk) ? "RULE BROKEN" : `GOAL \u00B7 ${wk.unit.toUpperCase()}`;
    leftValue = String(weeklyValue(wk, state.wk));
    rightValue = String(wk.goal);
    hot = weeklyDone(wk, state.wk);
  } else if (state.kind === "zen") {
    leftLabel = "ZEN \u00B7 LINES"; rightLabel = "PLACED"; leftValue = String(state.lines); rightValue = String(state.moves); hot = false;
  } else if (state.daily) {
    leftLabel = state.practice ? (state.daily === today() ? "PRACTICE" : "ARCHIVE") : "DAILY";
    rightLabel = state.practice ? "BEST" : "BEST TODAY";
  }
  label(leftLabel, 22, 20, "left");
  label(rightLabel, W - 22, 20, "right");
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 28px ${FONT}`;
  ctx.textAlign = "left";
  ctx.save();
  ctx.translate(22, 43);
  const bump = reduceMotion ? 1 : 1 + 0.2 * scorePulse * scorePulse;
  ctx.scale(bump, bump);
  ctx.fillText(leftValue, 0, 0);
  ctx.restore();
  ctx.textAlign = "right";
  ctx.fillStyle = hot ? COLORS.combo : COLORS.text;
  ctx.fillText(rightValue, W - 22, 43);

  if (state.combo < 2) {
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 18px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u{1F3C6}", W / 2, 32);
    if (unlocked.length > badgesSeen) {
      ctx.fillStyle = COLORS.combo;
      ctx.beginPath();
      ctx.arc(W / 2 + 12, 22, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (state.combo >= 2) {
    const pulse = 1 + (reduceMotion ? 0 : 0.06 * Math.sin(clock * 9));
    const label = `${state.combo}x COMBO`;
    ctx.save();
    ctx.translate(W / 2, 34);
    ctx.scale(pulse, pulse);
    ctx.font = `800 14px ${FONT}`;
    const tw = ctx.measureText(label).width + 28;
    ctx.fillStyle = "rgba(255,197,85,0.14)";
    ctx.beginPath();
    ctx.roundRect(-tw / 2, -15, tw, 30, 15);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,197,85,0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLORS.combo;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 1);
    ctx.restore();
  }
}

function pill(r: { x: number; y: number; w: number; h: number }, text: string, hot: boolean): void {
  ctx.fillStyle = hot ? "rgba(255,197,85,0.14)" : "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fill();
  ctx.strokeStyle = hot ? "rgba(255,197,85,0.5)" : "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = hot ? COLORS.combo : COLORS.text;
  ctx.font = `600 13px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 1);
}

function drawControls(): void {
  const played = playedDailyToday();
  pill(CHIP, "Modes", !played && state.kind === "classic" && !state.daily);
  const streak = streakNow();
  if (streak > 0) {
    ctx.fillStyle = COLORS.combo;
    ctx.font = `700 14px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`\u{1F525} ${streak}`, CHIP.x + CHIP.w + 10, CHIP.y + CHIP.h / 2 + 1);
  }
  if (canUndo()) pill(undoRect(), `\u21B6 Undo${state.undoLeft > 1 ? ` ${state.undoLeft}` : ""}`, false);

  // Theme button: a round chip showing four of the current colours.
  const [tx, ty] = THEME_C();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.arc(tx, ty, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = PALETTE[i]!;
    ctx.beginPath();
    ctx.arc(tx + (i % 2 ? 3.6 : -3.6), ty + (i < 2 ? -3.6 : 3.6), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (clock - themeShownAt < 1.4) {
    ctx.globalAlpha = Math.min(1, (1.4 - (clock - themeShownAt)) * 2);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(`Theme: ${THEMES[themeIdx]!.name}`, W / 2, 16);
    ctx.globalAlpha = 1;
  }
}

function drawBoard(): void {
  const bw = cell * SIZE;
  // Slab edge: a darker panel just below, so the board has thickness.
  ctx.fillStyle = "#0b0d14";
  ctx.beginPath();
  ctx.roundRect(boardX - 10, boardY - 10 + 9, bw + 20, bw + 20, 20);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 12;
  const panel = ctx.createLinearGradient(0, boardY, 0, boardY + bw);
  panel.addColorStop(0, "#1b2030");
  panel.addColorStop(1, "#11141d");
  ctx.fillStyle = panel;
  ctx.beginPath();
  ctx.roundRect(boardX - 10, boardY - 10, bw + 20, bw + 20, 20);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(boardX - 10.5, boardY - 10.5, bw + 21, bw + 21, 20);
  ctx.stroke();

  // Each 2x4 region is outlined: filling one clears it, just like a row or column.
  ctx.strokeStyle = "rgba(255,255,255,0.11)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < REGION_COUNT; i++) {
    const [r0, c0] = regionCells(i)[0]!;
    ctx.beginPath();
    ctx.roundRect(boardX + c0 * cell + 1, boardY + r0 * cell + 1, REGION_W * cell - 2, REGION_H * cell - 2, cell * 0.28);
    ctx.stroke();
  }

  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const x = boardX + c * cell;
      const y = boardY + r * cell;
      const ci = colorGrid[r]![c]!;
      if (!state.grid[r]![c]) { emptyCell(x, y, cell, (regionOf(r, c) + Math.floor(regionOf(r, c) / 2)) % 2 === 0); continue; }
      // Landing spring: drops in oversized, squashes under, settles. Then a quick white flash.
      const pp = 1 - pop[r]![c]!;
      const sc = reduceMotion ? 1 : 1 + 0.26 * Math.exp(-4.4 * pp) * Math.cos(pp * Math.PI * 2.4);
      const s = cell * sc;
      block(x + (cell - s) / 2, y + (cell - s) / 2, s, PALETTE[ci < 0 ? 0 : ci]!);
      if (pop[r]![c]! > 0.55 && !reduceMotion) {
        ctx.fillStyle = `rgba(255,255,255,${(pop[r]![c]! - 0.55) * 1.3})`;
        ctx.beginPath();
        ctx.roundRect(x + (cell - s) / 2 + 1, y + (cell - s) / 2 + 1, s - 2, s - 2, s * 0.22);
        ctx.fill();
      }
    }
}

/** Sparks and dots flying out of a cleared cell; bigger clears throw more, faster. */
const rainbow = (i: number): string => `hsl(${(i * 47 + Math.floor(clock * 120)) % 360},95%,66%)`;
const GOLDS = ["#ffd75e", "#ffe9a0", "#ffbf3a", "#fff3c4"];

function burst(x: number, y: number, color: string, lines: number): void {
  if (reduceMotion) return;
  const n = 5 + lines * 2;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 110 + Math.random() * 240 * (1 + lines * 0.22);
    particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 100, life: 1,
      size: 2 + Math.random() * 3, color: i % 3 === 0 ? "#ffffff" : color, spark: i % 2 === 0,
    });
  }
}

let dtLast = 0;
function render(dt: number): void {
  dtLast = dt;
  clock += dt;
  // Count the score up rather than snapping, so a big clear reads as a big clear.
  shownScore += (state.score - shownScore) * Math.min(1, dt * 8);
  if (Math.abs(state.score - shownScore) < 0.5) shownScore = state.score;

  for (const cl of clears) {
    cl.t += dt * 2;
    for (const cc of cl.cells)
      if (!cc.fired && cl.t >= cc.delay) {
        cc.fired = true;
        if (cl.count++ % 2 === 0) sfx.tick(cl.count >> 1);
        if (!reduceMotion) rings.push({ x: boardX + (cc.c + 0.5) * cell, y: boardY + (cc.r + 0.5) * cell, t: 0, max: cell * 0.85, color: has("combo5") ? rainbow(cl.count) : PALETTE[cc.ci < 0 ? 0 : cc.ci]!, w: 2 });
        burst(boardX + (cc.c + 0.5) * cell, boardY + (cc.r + 0.5) * cell, PALETTE[cc.ci < 0 ? 0 : cc.ci]!, cl.lines);
      }
  }
  clears = clears.filter((cl) => cl.t < 1);
  praises = praises.filter((pr) => (pr.t += dt * 0.95) < 1);
  if (toasts[0] && (toasts[0].t += dt / 3.2) >= 1) toasts.shift();
  if (statsOn) statsT = Math.min(1, statsT + dt * 3);
  flash = Math.max(0, flash - dt * 2.6);
  jellyT += dt;
  if (!drag && !state.over && !hintOn) idleT += dt; else idleT = 0;
  if (drag) drag.vx *= Math.max(0, 1 - dt * 9);
  for (const r of rings) r.t += dt * 2.4;
  rings = rings.filter((r) => r.t < 1);
  scorePulse = Math.max(0, scorePulse - dt * 4);
  shake = Math.max(0, shake - dt * 3.5);
  for (const row of pop) for (let c = 0; c < SIZE; c++) row[c] = Math.max(0, row[c]! - dt * 3);
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g ?? 700) * dt; p.life -= dt * 1.5; if (p.vr) p.rot = (p.rot ?? 0) + p.vr * dt; }
  particles = particles.filter((p) => p.life > 0);
  for (const f of floaters) f.t += dt * 1.1;
  floaters = floaters.filter((f) => f.t < 1);
  for (const r of returning) r.t += dt * 5;
  returning = returning.filter((r) => r.t < 1);
  if (drag) drag.k = Math.min(1, drag.k + dt * 9);
  if (state.over) overT = Math.min(1, overT + dt * 2.2);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createRadialGradient(W / 2, H * 0.35, 20, W / 2, H * 0.35, Math.max(W, H) * 0.85);
  bg.addColorStop(0, "#1c2234");
  bg.addColorStop(1, "#0a0c12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  if (shake > 0 && !reduceMotion) {
    const a = shake * shake * 6;
    ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
  }

  drawHud();
  drawMute();
  drawControls();
  const jk = reduceMotion ? 0 : jellyAmp * Math.exp(-6 * jellyT) * Math.sin(jellyT * 26) * 0.04;
  const jcx = boardX + (cell * SIZE) / 2;
  const jcy = boardY + (cell * SIZE) / 2;
  ctx.save();
  ctx.translate(jcx, jcy);
  ctx.scale(1 + jk, 1 - jk * 0.8);
  ctx.translate(-jcx, -jcy);
  drawBoard();

  // Cleared cells: wait for the wave to arrive, then swell, flash white and shrink away.
  for (const cl of clears) {
    for (const cc of cl.cells) {
      const hex = PALETTE[cc.ci < 0 ? 0 : cc.ci]!;
      const k = reduceMotion ? 0 : Math.min(1, Math.max(0, (cl.t - cc.delay) / 0.6));
      const swell = 1 + 0.22 * Math.sin(Math.min(1, k * 2.2) * Math.PI);
      const size = Math.max(0.5, cell * swell * (1 - Math.pow(k, 2)));
      const off = (cell - size) / 2;
      ctx.globalAlpha = reduceMotion ? 1 - cl.t : 1 - Math.pow(k, 1.5);
      block(boardX + cc.c * cell + off, boardY + cc.r * cell + off, size, hex);
      if (k > 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - k)})`;
        ctx.beginPath();
        ctx.roundRect(boardX + cc.c * cell + off, boardY + cc.r * cell + off, size, size, size * 0.22);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  const t = dragTarget();
  if (drag && t) {
    const hex = PALETTE[colorIndex(drag.shape)]!;
    if (t.ok) {
      // Light up any line this drop would complete.
      const res = place(state.grid, drag.shape, t.row, t.col, state.combo);
      const pulse = 0.22 + 0.1 * Math.sin(clock * 10);
      ctx.fillStyle = hex;
      ctx.globalAlpha = pulse;
      for (const [r, c] of clearedCells(res)) { ctx.beginPath(); ctx.roundRect(boardX + c * cell + 2, boardY + r * cell + 2, cell - 4, cell - 4, cell * 0.2); ctx.fill(); }
      ctx.globalAlpha = 0.45;
      drawShape(drag.shape, boardX + t.col * cell, boardY + t.row * cell, cell, hex);
      ctx.globalAlpha = 1;
    } else {
      // Show where it would land even when it cannot: silence reads as an unresponsive game.
      ctx.fillStyle = COLORS.bad;
      for (const [dr, dc] of drag.shape) {
        const r = t.row + dr;
        const c = t.col + dc;
        if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
          ctx.beginPath();
          ctx.roundRect(boardX + c * cell + 2, boardY + r * cell + 2, cell - 4, cell - 4, cell * 0.2);
          ctx.fill();
        }
      }
    }
  }

  ctx.restore();

  // Tray
  state.tray.forEach((shape, i) => {
    const slot = slotRect(i);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.beginPath();
    ctx.roundRect(slot.x, slot.y, slot.size, slot.size, 18);
    ctx.fill();
    if (!shape || drag?.slot === i || returning.some((r) => r.slot === i)) return;
    const fits = canPlaceAnywhere(state.grid, shape);
    ctx.globalAlpha = fits ? 1 : 0.28;
    // After a few idle seconds the first playable piece bounces, nudging the player.
    const nudge = idleT > 6 && fits && !reduceMotion && state.tray.findIndex((t) => t && canPlaceAnywhere(state.grid, t)) === i;
    const bob = nudge ? Math.abs(Math.sin(clock * 5)) : 0;
    drawCentered(shape, slot.x + slot.size / 2, slot.y + slot.size / 2 - bob * 8, trayCell * (1 + bob * 0.12), PALETTE[colorIndex(shape)]!);
    ctx.globalAlpha = 1;
  });

  for (const r of returning) {
    const e = 1 - Math.pow(1 - r.t, 3);
    const slot = slotRect(r.slot);
    drawCentered(r.shape,
      r.x0 + (slot.x + slot.size / 2 - r.x0) * e + (reduceMotion ? 0 : Math.sin(r.t * 30) * 7 * (1 - r.t)),
      r.y0 + (slot.y + slot.size / 2 - r.y0) * e,
      r.s0 + (trayCell - r.s0) * e, r.color);
  }

  if (drag && has("combo3") && !reduceMotion && Math.random() < 0.7) {
    const d = dragDraw(drag);
    particles.push({
      x: d.cx + (Math.random() - 0.5) * d.s * 1.6, y: d.cy + (Math.random() - 0.5) * d.s * 1.6,
      vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 30, life: 0.55, size: 1.5 + Math.random() * 2.5,
      color: Math.random() < 0.5 ? "#ffffff" : PALETTE[colorIndex(drag.shape)]!, g: 20,
    });
  }

  if (drag) {
    const d = dragDraw(drag);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    drawCentered(drag.shape, d.cx, d.cy, d.s, PALETTE[colorIndex(drag.shape)]!, reduceMotion ? 0 : Math.max(-0.3, Math.min(0.3, drag.vx * 0.03)));
    ctx.restore();
  }

  if (!reduceMotion)
    for (const r of rings) {
      const e = 1 - Math.pow(1 - r.t, 3);
      ctx.globalAlpha = (1 - r.t) * 0.6;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.w * (1 - r.t) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.max * e, 0, Math.PI * 2);
      ctx.stroke();
    }

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    if (p.star) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = (i % 2 ? 0.45 : 1) * p.size * (0.5 + 0.5 * Math.min(1, p.life));
        const a = (p.rot ?? 0) + (i * Math.PI) / 5 - Math.PI / 2;
        ctx.lineTo(p.x + Math.cos(a) * rad, p.y + Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fill();
    } else if (p.spark) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1, p.size * 0.7);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * p.life), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  for (const f of floaters) {
    const rise = 1 - Math.pow(1 - f.t, 3);
    const a = f.t < 0.15 ? f.t / 0.15 : 1 - Math.pow((f.t - 0.15) / 0.85, 2);
    const pop0 = f.t < 0.2 ? 0.7 + 1.5 * f.t : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    ctx.translate(f.x, f.y - rise * cell * 1.4);
    ctx.scale(pop0, pop0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${Math.round(cell * 0.62)}px ${FONT}`;
    ctx.fillText(f.text, 0, 0);
    if (f.sub) {
      ctx.fillStyle = COLORS.combo;
      ctx.font = `800 ${Math.round(cell * 0.4)}px ${FONT}`;
      ctx.fillText(f.sub, 0, -cell * 0.6);
    }
    ctx.restore();
  }

  if (flash > 0 && !reduceMotion) {
    ctx.fillStyle = `rgba(255,255,255,${flash})`;
    ctx.fillRect(0, 0, W, H);
  }

  for (const pr of praises) drawPraise(pr);

  if (state.over) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const e = 1 - Math.pow(1 - overT, 3);
    ctx.fillStyle = `rgba(7,9,14,${0.82 * e})`;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate(W / 2, H / 2 + (1 - e) * 24);
    const cw = Math.min(W - 48, 320);
    const extra = canUndoOver() ? 52 : 0;
    const card = ctx.createLinearGradient(0, -145, 0, 225 + extra);
    card.addColorStop(0, "#222840");
    card.addColorStop(1, "#151a2a");
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = card;
    ctx.beginPath();
    ctx.roundRect(-cw / 2, -145, cw, 370 + extra, 26);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.stroke();

    const ch = state.challenge;
    const won = ch !== null && state.score > ch;
    const isBest = ch === null && !state.practice && state.score > 0 && state.score > startBest;
    const lvl = state.kind === "journey" && state.level ? makeLevel(state.level) : null;
    const par = parFor(state.daily);
    const official = state.daily ? officialResult(state.daily) : null;
    let head: string;
    let big: string;
    let sub: string;
    let gold = isBest || won;
    if (lvl) {
      const prog = { score: state.score, lines: state.lines, moves: state.moves };
      head = state.won ? `LEVEL ${lvl.n} CLEARED` : `LEVEL ${lvl.n} FAILED`;
      big = state.won ? "\u2605".repeat(state.stars) + "\u2606".repeat(3 - state.stars) : `${goalValue(lvl, prog)}/${lvl.goal.target}`;
      sub = goalText(lvl);
      gold = state.won;
    } else {
      head = ch !== null ? (won ? "CHALLENGE WON" : state.score === ch ? "TIED" : "CHALLENGE LOST")
        : state.practice ? (state.daily === today() ? "PRACTICE RUN" : "ARCHIVE RUN")
        : isBest ? "NEW BEST" : "NO MOVES LEFT";
      big = String(state.score);
      sub = ch !== null ? (won ? `Beat ${ch} by ${state.score - ch}` : `${ch - state.score} short of ${ch}`)
        : state.practice ? `Official ${official ? official.score.toLocaleString("en-US") : "\u2013"}${par ? ` \u00B7 Par ${par}` : ""}`
        : state.daily && par ? (state.score >= par ? `Par ${par} \u00B7 beat it by ${state.score - par}` : `Par ${par} \u00B7 ${par - state.score} below`)
        : `Best ${state.best}`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText(head, 0, -92);
    ctx.fillStyle = gold ? COLORS.combo : COLORS.text;
    ctx.font = `800 ${lvl ? 50 : 58}px ${FONT}`;
    ctx.fillText(big, 0, -42);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText(sub, 0, 8, cw - 32);

    const bgrad = ctx.createLinearGradient(0, 40, 0, 94);
    bgrad.addColorStop(0, "#6cb4ff");
    bgrad.addColorStop(1, "#3a82e6");
    ctx.fillStyle = bgrad;
    ctx.beginPath();
    ctx.roundRect(-96, 40, 192, 54, 27);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 18px ${FONT}`;
    ctx.fillText(lvl ? (state.won ? "Next level" : "Retry level") : "Play again", 0, 68);

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-96, 108, 192, 46, 23);
    ctx.stroke();
    ctx.fillStyle = clock - sharedAt < 1.8 ? "#7fe3a8" : COLORS.text;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(clock - sharedAt < 1.8 ? "Copied to clipboard" : "Share score", 0, 131);

    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(state.kind !== "classic" ? "Back to classic" : state.daily ? "Play a random game" : "Play today\u2019s daily", 0, 186);
    if (state.daily === today()) {
      // Plant the return trip while the player is still pleased with the result.
      const left = timeUntilMidnight(new Date());
      ctx.font = `500 12px ${FONT}`;
      ctx.fillText(`Next daily in ${left.h}h ${String(left.m).padStart(2, "0")}m`, 0, 210);
    }
    if (extra) {
      ctx.fillStyle = COLORS.combo;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText("\u21B6 Undo last move", 0, 238);
    }
    ctx.restore();
  }

  for (const t of toasts.slice(0, 1)) drawToast(t);
  if (chIntro && !hintOn) drawChallengeIntro(dtLast);
  if (statsOn) drawStats();
  if (modesOn) drawModes(dtLast);
  if (hintOn) drawHint(dtLast);
}

/** Big bouncy banner in the middle of the board: pops in with overshoot, holds, then floats off. */
function drawPraise(pr: Praise): void {
  const t = pr.t;
  const pop = t < 0.18 ? easeOutBack(t / 0.18) : 1;
  const fade = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
  const rise = t > 0.72 ? ((t - 0.72) / 0.28) * cell * 0.9 : 0;
  const size = Math.round(cell * (1.05 + pr.level * 0.12));
  const color = PRAISE_COLORS[pr.level - 1]!;
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.translate(W / 2, boardY + cell * 3.4 - rise);
  ctx.rotate(-0.07 + (reduceMotion ? 0 : Math.sin(t * 14) * 0.02));
  ctx.scale(pop, pop);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.strokeStyle = "rgba(10,12,20,0.9)";
  ctx.lineWidth = size * 0.22;
  ctx.strokeText(pr.text, 0, 0);
  ctx.shadowBlur = 0;
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillText(pr.text, 0, 0);
  ctx.restore();
}

function star(x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
}

/** Slides a "badge unlocked" card down from the top, holds, then tucks it away. */
function drawToast(t: Toast): void {
  const inT = Math.min(1, t.t / 0.1);
  const outT = t.t > 0.88 ? (t.t - 0.88) / 0.12 : 0;
  const slide = easeOutBack(inT) * (1 - outT);
  const w = Math.min(W - 32, 320);
  const y = -70 + slide * 190;
  ctx.save();
  ctx.translate(W / 2, y);
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#1e2438";
  ctx.beginPath();
  ctx.roundRect(-w / 2, 0, w, 60, 18);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,197,85,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const g = ctx.createLinearGradient(0, 14, 0, 46);
  g.addColorStop(0, "#fff0b3");
  g.addColorStop(1, "#ffb42e");
  ctx.fillStyle = g;
  star(-w / 2 + 34, 30, 17);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.combo;
  ctx.font = `800 11px ${FONT}`;
  ctx.fillText(t.label ?? "BADGE UNLOCKED", -w / 2 + 62, 17);
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 16px ${FONT}`;
  ctx.fillText(t.title, -w / 2 + 62, 35);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText(t.desc, -w / 2 + 62, 51, w - 76);
  ctx.restore();
}

// ---- Stats screen ------------------------------------------------------------------

const CARD_H = 600;
const TABS = ["Stats", "Badges", "Collection"] as const;
let statsTab = 0;
/** Card is laid out in a 600-unit-tall box and scaled down to fit short screens. */
function statsLayout(): { k: number; cw: number } {
  const k = Math.min(1, (H - 24) / CARD_H);
  return { k, cw: Math.min((W - 24) / k, 360) };
}
function badgeCell(i: number, l: { cw: number }): { x: number; y: number; w: number } {
  const w = (l.cw - 32) / 4;
  return { x: -l.cw / 2 + 16 + w * (i % 4) + w / 2, y: -170 + Math.floor(i / 4) * 56, w };
}
const tabRect = (i: number, cw: number): { x: number; y: number; w: number; h: number } => {
  const w = (cw - 48) / 3;
  return { x: -cw / 2 + 24 + i * w, y: -250, w, h: 32 };
};

/** A small sunset scene, drawn in `size` x `size` at (x, y). The collection reveals it tile by tile. */
function paintScene(x: number, y: number, size: number): void {
  const sky = ctx.createLinearGradient(0, y, 0, y + size);
  sky.addColorStop(0, "#2a1b63");
  sky.addColorStop(0.5, "#d4559a");
  sky.addColorStop(0.78, "#ffb15c");
  sky.addColorStop(1, "#ffe39a");
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    ctx.arc(x + ((i * 53) % 97) / 97 * size, y + ((i * 31) % 41) / 100 * size, 0.9 + (i % 3) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const sun = ctx.createRadialGradient(x + size * 0.5, y + size * 0.66, 2, x + size * 0.5, y + size * 0.66, size * 0.3);
  sun.addColorStop(0, "#fffbe0");
  sun.addColorStop(0.35, "#ffd86b");
  sun.addColorStop(1, "rgba(255,170,80,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(x, y, size, size);
  const ridge = (color: string, base: number, amp: number, seed: number): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + size);
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      ctx.lineTo(x + t * size, y + size * (base - amp * (Math.sin(t * 7 + seed) * 0.5 + Math.sin(t * 17 + seed * 2) * 0.25 + 0.6)));
    }
    ctx.lineTo(x + size, y + size);
    ctx.fill();
  };
  ridge("#6a3a7d", 0.8, 0.2, 1);
  ridge("#3d2160", 0.9, 0.17, 3);
  ridge("#1c1238", 1.0, 0.13, 5);
}

function drawStats(): void {
  const l = statsLayout();
  const e = 1 - Math.pow(1 - statsT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = `rgba(7,9,14,${0.86 * e})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  const cw = l.cw;
  const card = ctx.createLinearGradient(0, -CARD_H / 2, 0, CARD_H / 2);
  card.addColorStop(0, "#222840");
  card.addColorStop(1, "#151a2a");
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(-cw / 2, -CARD_H / 2, cw, CARD_H, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText("Your progress", 0, -276);
  TABS.forEach((name, i) => {
    const r = tabRect(i, cw);
    const on = statsTab === i;
    ctx.fillStyle = on ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
    ctx.beginPath();
    ctx.roundRect(r.x + 2, r.y, r.w - 4, r.h, 16);
    ctx.fill();
    ctx.fillStyle = on ? COLORS.text : COLORS.dim;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(name, r.x + r.w / 2, r.y + r.h / 2 + 1);
  });

  if (statsTab === 0) drawStatsTab(cw);
  else if (statsTab === 1) drawBadgesTab(l);
  else drawCollectionTab(cw);

  const bg = ctx.createLinearGradient(0, 246, 0, 290);
  bg.addColorStop(0, "#6cb4ff");
  bg.addColorStop(1, "#3a82e6");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-84, 248, 168, 42, 21);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 16px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("Close", 0, 270);
  ctx.restore();
}

function drawStatsTab(cw: number): void {
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.combo;
  ctx.font = `700 13px ${FONT}`;
  const perk = perkUndos();
  ctx.fillText(`Rank: ${rankName()}${perk ? `  \u00B7  +${perk} undo${perk > 1 ? "s" : ""} in random games` : ""}`, 0, -196, cw - 40);

  const avg = stats.finished ? Math.round(stats.total / stats.finished) : 0;
  const tiles: [string, string][] = [
    ["Games", stats.games.toLocaleString()], ["Best score", stats.bestScore.toLocaleString()], ["Average", avg.toLocaleString()],
    ["Best combo", `${stats.bestCombo}x`], ["Lines cleared", stats.lines.toLocaleString()], ["Perfect clears", String(stats.perfects)],
  ];
  const tw = (cw - 48 - 20) / 3;
  tiles.forEach(([name, value], i) => {
    const x = -cw / 2 + 24 + (i % 3) * (tw + 10);
    const y = -172 + Math.floor(i / 3) * 70;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.roundRect(x, y, tw, 62, 14);
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.font = `800 ${value.length > 9 ? 13 : 20}px ${FONT}`;
    ctx.fillText(value, x + tw / 2, y + 25, tw - 8);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(name, x + tw / 2, y + 46, tw - 8);
  });

  // Score distribution: where your finished games land.
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 14px ${FONT}`;
  ctx.fillText("Score distribution", -cw / 2 + 24, -16);
  const peak = Math.max(1, ...stats.hist);
  stats.hist.forEach((count, i) => {
    const y = 4 + i * 23;
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(BUCKET_LABELS[i]!, -cw / 2 + 24, y + 9);
    const maxW = cw - 48 - 64;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.roundRect(-cw / 2 + 64, y, maxW, 18, 6);
    ctx.fill();
    if (count > 0) {
      const g = ctx.createLinearGradient(-cw / 2 + 64, 0, -cw / 2 + 64 + maxW, 0);
      g.addColorStop(0, "#6cb4ff");
      g.addColorStop(1, "#9a7bff");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(-cw / 2 + 64, y, Math.max(8, (maxW * count) / peak), 18, 6);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "right";
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText(String(count), -cw / 2 + 64 + maxW - 6, y + 10);
  });

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 12px ${FONT}`;
  const rec = readStreak();
  const freeze = freezeAvailable(rec, today()) ? "freeze ready" : "freeze used this week";
  ctx.fillText(`Daily streak ${streakNow()} \u00B7 best ${stats.bestStreak} \u00B7 ${freeze}`, 0, 168, cw - 40);
  ctx.fillText(`Weekly wins ${stats.weeklyWins} \u00B7 Journey levels ${stats.levels} \u00B7 Zen lines ${stats.zenLines}`, 0, 192, cw - 40);
}

function drawBadgesTab(l: { cw: number }): void {
  const cw = l.cw;
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 15px ${FONT}`;
  ctx.fillText("Badges", -cw / 2 + 24, -196);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `700 13px ${FONT}`;
  ctx.fillText(`${unlocked.length} / ${BADGES.length}`, cw / 2 - 24, -196);

  ctx.textAlign = "center";
  BADGES.forEach((b, i) => {
    const c = badgeCell(i, l);
    const got = unlocked.includes(b.id);
    if (badgeSel === i) {
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.beginPath();
      ctx.roundRect(c.x - c.w / 2 + 2, c.y - 3, c.w - 4, 54, 12);
      ctx.fill();
    }
    if (got) {
      const g = ctx.createLinearGradient(0, c.y, 0, c.y + 30);
      g.addColorStop(0, "#fff0b3");
      g.addColorStop(1, "#ffb42e");
      ctx.fillStyle = g;
      ctx.shadowColor = "rgba(255,180,46,0.6)";
      ctx.shadowBlur = 10;
      star(c.x, c.y + 14, 14);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1.5;
      star(c.x, c.y + 14, 13);
      ctx.stroke();
      const pr = b.progress?.();
      if (pr) {
        const bw = c.w - 22;
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.beginPath();
        ctx.roundRect(c.x - bw / 2, c.y + 44, bw, 4, 2);
        ctx.fill();
        ctx.fillStyle = COLORS.combo;
        ctx.beginPath();
        ctx.roundRect(c.x - bw / 2, c.y + 44, Math.max(3, bw * Math.min(1, pr[0] / pr[1])), 4, 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = got ? COLORS.text : "#586079";
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(b.name, c.x, c.y + 35, c.w - 4);
  });

  const sel = badgeSel >= 0 ? BADGES[badgeSel] : undefined;
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText(sel ? `${sel.name}: ${sel.desc}` : "Tap a badge to see how to earn it.", 0, 178, cw - 40);
  if (sel) {
    const pr = sel.progress?.();
    const got = unlocked.includes(sel.id);
    ctx.fillStyle = COLORS.combo;
    ctx.font = `700 12px ${FONT}`;
    const bits = [
      got ? "Earned" : pr ? `Progress ${Math.min(pr[0], pr[1]).toLocaleString()} / ${pr[1].toLocaleString()}` : "",
      sel.reward ? `Reward: ${sel.reward}` : "",
    ].filter(Boolean);
    ctx.fillText(bits.join("  \u00B7  "), 0, 200, cw - 40);
  } else {
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText("Every 5 badges: +1 undo in random games.", 0, 200, cw - 40);
  }
}

function drawCollectionTab(cw: number): void {
  const n = collectionTiles();
  const size = Math.min(264, cw - 64);
  const tile = size / 4;
  const x0 = -size / 2;
  const y0 = -196;
  const shown = new Set(TILE_ORDER.slice(0, n));
  for (let i = 0; i < COLLECTION_SIZE; i++) {
    const tx = x0 + (i % 4) * tile;
    const ty = y0 + Math.floor(i / 4) * tile;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(tx + 1.5, ty + 1.5, tile - 3, tile - 3, 8);
    ctx.clip();
    if (shown.has(i)) {
      paintScene(x0, y0, size);
    } else {
      ctx.fillStyle = "#12162a";
      ctx.fillRect(tx, ty, tile, tile);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.font = `700 ${Math.round(tile * 0.4)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("?", tx + tile / 2, ty + tile / 2 + 1);
    }
    ctx.restore();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 15px ${FONT}`;
  ctx.fillText(`${n} / ${COLLECTION_SIZE} tiles`, 0, y0 + size + 24);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 12px ${FONT}`;
  const toNext = 40 - (stats.lines % 40);
  ctx.fillText(n >= COLLECTION_SIZE ? "Complete! The Prism theme is yours." : `Next tile in ${toNext} lines, or a weekly win or 5 journey levels.`, 0, y0 + size + 46, cw - 40);
  ctx.fillStyle = COLORS.combo;
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText(n >= COLLECTION_SIZE ? "Unlocked: Prism theme" : "Reward: Prism theme when complete", 0, y0 + size + 68, cw - 40);
}

// ---- Modes sheet ------------------------------------------------------------------

const MODES_H = 580;
function modesLayout(): { k: number; cw: number } {
  const k = Math.min(1, (H - 24) / MODES_H);
  return { k, cw: Math.min((W - 24) / k, 350) };
}

/** The last fortnight of dailies, newest first, for the archive. */
const archiveDates = (): string[] => Array.from({ length: 14 }, (_, i) => addDays(today(), -(i + 1)));

function pickMode(i: number): void {
  haptics.tick();
  if (i === 5) { modesView = "archive"; return; }
  modesOn = false;
  if (i === 0) startGame({});
  else if (i === 1) startGame({ daily: today() });
  else if (i === 2) startGame({ kind: "weekly" });
  else if (i === 3) startGame({ kind: "journey", level: readJourney().next });
  else startGame({ kind: "zen" });
}

function drawModes(dt: number): void {
  modesT = Math.min(1, modesT + dt * 3);
  const l = modesLayout();
  const e = 1 - Math.pow(1 - modesT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = `rgba(7,9,14,${0.86 * e})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  const cw = l.cw;
  const card = ctx.createLinearGradient(0, -MODES_H / 2, 0, MODES_H / 2);
  card.addColorStop(0, "#222840");
  card.addColorStop(1, "#151a2a");
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(-cw / 2, -MODES_H / 2, cw, MODES_H, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText(modesView === "main" ? "Choose a mode" : "Daily archive", 0, -252);

  if (modesView === "main") {
    const t = today();
    const off = officialResult(t);
    const par = parFor(t);
    const wk = weeklyFor(weekId(t));
    const j = readJourney();
    const stars = Object.values(j.stars).reduce((a, b) => a + b, 0);
    const rows: { icon: string; name: string; sub: string; tag?: string; hot?: boolean }[] = [
      { icon: "\u{1F3B2}", name: "Classic", sub: "Endless. Chase your best score." },
      {
        icon: "\u{1F4C5}", name: "Daily",
        sub: off ? `Your result: ${off.score.toLocaleString("en-US")}${par ? ` \u00B7 par ${par}` : ""}. Replays are practice.` : `Same pieces for everyone${par ? ` \u00B7 par ${par}` : ""}.`,
        tag: streakNow() > 0 ? `\u{1F525} ${streakNow()}` : undefined, hot: !off,
      },
      { icon: "\u26A1", name: `Weekly: ${wk.title}`, sub: wk.rule, tag: weeklyCompleted(weekId(t)) ? "\u2713 done" : undefined, hot: !weeklyCompleted(weekId(t)) },
      { icon: "\u{1F9ED}", name: "Journey", sub: `Level ${j.next} next \u00B7 ${stars} \u2605 earned` },
      { icon: "\u{1F33F}", name: "Zen", sub: "No game over. Relax and clear lines." },
      { icon: "\u{1F5C2}", name: "Daily archive", sub: "Replay the last two weeks of dailies." },
    ];
    rows.forEach((r, i) => {
      const y = -200 + i * 70;
      ctx.fillStyle = r.hot ? "rgba(255,197,85,0.09)" : "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.roundRect(-cw / 2 + 16, y, cw - 32, 62, 16);
      ctx.fill();
      if (r.hot) {
        ctx.strokeStyle = "rgba(255,197,85,0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.textAlign = "left";
      ctx.font = `600 24px ${FONT}`;
      ctx.fillStyle = COLORS.text;
      ctx.fillText(r.icon, -cw / 2 + 30, y + 31);
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText(r.name, -cw / 2 + 68, y + 21, cw - 150);
      ctx.fillStyle = COLORS.dim;
      ctx.font = `500 12px ${FONT}`;
      ctx.fillText(r.sub, -cw / 2 + 68, y + 43, cw - 110);
      if (r.tag) {
        ctx.textAlign = "right";
        ctx.fillStyle = COLORS.combo;
        ctx.font = `800 12px ${FONT}`;
        ctx.fillText(r.tag, cw / 2 - 28, y + 21);
      }
    });
  } else {
    const dates = archiveDates();
    const cw2 = (cw - 48 - 10) / 2;
    dates.forEach((d, i) => {
      const x = -cw / 2 + 24 + (i % 2) * (cw2 + 10);
      const y = -200 + Math.floor(i / 2) * 58;
      const off = officialResult(d);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.roundRect(x, y, cw2, 50, 14);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.text;
      ctx.font = `700 14px ${FONT}`;
      const [yy, mm, dd] = d.split("-").map(Number);
      ctx.fillText(new Date(yy!, mm! - 1, dd!).toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" }), x + 14, y + 19);
      ctx.fillStyle = off ? COLORS.combo : COLORS.dim;
      ctx.font = `600 12px ${FONT}`;
      ctx.fillText(off ? `${off.score.toLocaleString("en-US")}${parFor(d) ? ` / par ${parFor(d)}` : ""}` : "Not played", x + 14, y + 38, cw2 - 24);
    });
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText("Archive runs never count toward your streak.", 0, 218);
  }

  const bg = ctx.createLinearGradient(0, 232, 0, 280);
  bg.addColorStop(0, "#6cb4ff");
  bg.addColorStop(1, "#3a82e6");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-84, 236, 168, 42, 21);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 16px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(modesView === "archive" ? "Back" : "Close", 0, 258);
  ctx.restore();
}

function drawChallengeIntro(dt: number): void {
  chT = Math.min(1, chT + dt * 2.2);
  const e = 1 - Math.pow(1 - chT, 3);
  const ch = chIntro!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = `rgba(7,9,14,${0.88 * e})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  const cw = Math.min(W - 40, 330);
  const card = ctx.createLinearGradient(0, -170, 0, 190);
  card.addColorStop(0, "#2a2447");
  card.addColorStop(1, "#151a2a");
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(-cw / 2, -170, cw, 360, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,197,85,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.combo;
  ctx.font = `800 13px ${FONT}`;
  ctx.fillText("A FRIEND CHALLENGED YOU", 0, -128);
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText("Beat this score", 0, -92);
  const g = ctx.createLinearGradient(0, -70, 0, -10);
  g.addColorStop(0, "#fff0b3");
  g.addColorStop(1, "#ffb42e");
  ctx.fillStyle = g;
  ctx.font = `900 68px ${FONT}`;
  ctx.fillText(ch.target.toLocaleString(), 0, -40);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 14px ${FONT}`;
  ctx.fillText("on the exact same pieces they got.", 0, 8);
  if (state.score > 0 && !state.over) {
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText("This replaces your current game.", 0, 34);
  }

  const bg = ctx.createLinearGradient(0, 66, 0, 126);
  bg.addColorStop(0, "#ffd166");
  bg.addColorStop(1, "#f59e0b");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-100, 66, 200, 56, 28);
  ctx.fill();
  ctx.fillStyle = "#2a1a00";
  ctx.font = `800 19px ${FONT}`;
  ctx.fillText("Accept challenge", 0, 95);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText("Not now", 0, 154);
  ctx.restore();
}

function drawHint(dt: number): void {
  hintT = Math.min(1, hintT + dt * 2.2);
  const e = 1 - Math.pow(1 - hintT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = `rgba(7,9,14,${0.86 * e})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  const cw = Math.min(W - 40, 340);
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  const card = ctx.createLinearGradient(0, -190, 0, 190);
  card.addColorStop(0, "#222840");
  card.addColorStop(1, "#151a2a");
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(-cw / 2, -190, cw, 380, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText("How to play", 0, -148);

  const steps = [
    ["Drag", "a piece from the tray onto the board."],
    ["Fill", "a row, column or outlined 2\u00D74 block."],
    ["Chain", "clears for combo bonuses. No timer, no rotating."],
  ];
  steps.forEach(([head, body], i) => {
    const y = -82 + i * 62;
    ctx.fillStyle = PALETTE[i]!;
    ctx.beginPath();
    ctx.arc(-cw / 2 + 36, y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(String(i + 1), -cw / 2 + 36, y + 1);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 15px ${FONT}`;
    ctx.fillText(head!, -cw / 2 + 62, y - 10);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText(body!, -cw / 2 + 62, y + 10, cw - 84);
    ctx.textAlign = "center";
  });
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText("The game ends when no piece fits.", 0, 106);

  const bg = ctx.createLinearGradient(0, 128, 0, 176);
  bg.addColorStop(0, "#6cb4ff");
  bg.addColorStop(1, "#3a82e6");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-84, 134, 168, 46, 23);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText("Got it", 0, 158);
  ctx.restore();
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  render(dt);
  requestAnimationFrame(frame);
}

(window as unknown as { soundState: typeof soundState }).soundState = soundState;

window.addEventListener("resize", layout);
layout();
requestAnimationFrame(frame);

// Production only: in dev a service worker happily serves yesterday's bundle back to you.
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));

// ---- Install nudge ---------------------------------------------------------------
// Chrome/Android hand us an install event; iOS Safari has none, so it gets instructions.

interface InstallEvent extends Event { prompt(): Promise<void> }
const INSTALL_KEY = "blockpuzzle.installDismissed";
let installEvent: InstallEvent | null = null;
let installShown = false;

const standalone =
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;
const iosSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e as InstallEvent;
});

function dismissedInstall(): boolean {
  try { return localStorage.getItem(INSTALL_KEY) === "1"; } catch { return false; }
}

function maybeShowInstall(): void {
  if (installShown || standalone || moves < 6 || dismissedInstall()) return;
  if (!installEvent && !iosSafari) return;
  installShown = true;

  const bar = document.createElement("div");
  bar.style.cssText =
    "position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:10;" +
    "display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:16px;" +
    "background:rgba(28,33,50,0.96);border:1px solid rgba(255,255,255,0.12);color:#eef1f8;" +
    "font:500 14px system-ui,-apple-system,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,0.5)";
  const msg = document.createElement("span");
  msg.style.flex = "1";
  msg.textContent = installEvent
    ? "Install Block Puzzle for quick, offline play."
    : "Add to Home Screen: tap Share, then \u201cAdd to Home Screen\u201d.";
  bar.append(msg);

  const close = (remember: boolean): void => {
    if (remember) { try { localStorage.setItem(INSTALL_KEY, "1"); } catch { /* ignore */ } }
    bar.remove();
  };
  const btn = (text: string, primary: boolean, on: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText =
      "border:0;border-radius:999px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;" +
      (primary ? "background:#4da3ff;color:#fff" : "background:transparent;color:#9aa3b8");
    b.onclick = on;
    return b;
  };
  if (installEvent) {
    bar.append(btn("Install", true, () => { void installEvent?.prompt(); close(true); }));
  }
  bar.append(btn(installEvent ? "Not now" : "Got it", false, () => close(true)));
  document.body.append(bar);
}
