import { PERFECT_BONUS, REGION_COUNT, REGION_H, REGION_W, SIZE, canPlace, canPlaceAnywhere, clearCells, clearedCells, emptyGrid, fullestLine, hasMoves, isEmpty, place, regionCells, regionOf, shapeSize, type Grid, type Shape } from "./board";
import { drawTray, shapeAt, shapeIndex } from "./pieces";
import { challengeUrl, randomSeed, type Challenge } from "./challenge";
import { goalReached, goalText, goalValue, makeLevel, starsFor } from "./journey";
import { scoreBucket, timeUntilMidnight } from "./meta";
import { seeded } from "./rng";
import { boardEmoji, shareText } from "./share";
import { weekId } from "./streak";
import { blankRun, recordMove, weeklyDone, weeklyFailed, weeklyFor, weeklySeed, weeklyValue, type WeeklyRun } from "./weekly";
import { haptic, haptics } from "./haptics";
import { isMuted, sfx, soundState, toggleMute, unlock } from "./sound";

import { canvas, ctx, W, H, dpr, cell, boardX, boardY, trayY, trayCell, COLORS, FONT, reduceMotion, layoutView, setReduceMotion, block, emptyCell, drawShape, drawCentered, easeOutBack, label, pill } from "./gfx";
import { BADGES, PALETTE, THEMES, badgesSeen, bumpStreak, checkBadges, cycleTheme, has, markBadgesSeen, markThemeShown, perkUndos, playedDailyToday, saveStats, stats, streakNow, themeIdx, themeShownAt, today, toasts, unlocked } from "./progress";
import { clearOfficial, markWeeklyCompleted, officialResult, parFor, postedResult, readJourney, saveOfficial, savePosted, weeklyCompleted, writeJourney } from "./records";
import { CARD_H, HINT_KEY, MODES_H, PRAISE, TABS, archiveDates, badgeCell, chHit, drawChallengeIntro, drawHint, drawLeaderboard, drawModes, drawPraise, drawSettings, drawStats, drawToast, lbLayout, lbTap, modesLayout, modesRow, settingsLayout, settingsTap, statsLayout, tabRect, ui, type Praise } from "./overlays";
import { askName } from "./nameDialog";
import { checkLeaderboard, fetchBoard, fetchStreaks, getPlayer, lb, postDaily, savePlayerName } from "./leaderboardClient";
import { settings } from "./settings";
import type { MoveTuple } from "./verify";

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
  moveLog: MoveTuple[]; // every placement, so a daily can be replayed and verified by the leaderboard
}

type Kind = "classic" | "zen" | "weekly" | "journey";
interface GameOpts { daily?: string | null; ch?: Challenge | null; kind?: Kind; level?: number }

setReduceMotion(settings.reduce);

const BEST_KEY = "blockpuzzle.best";
const SAVE_KEY = "blockpuzzle.save";

const bestKey = (daily: string | null): string => (daily ? `blockpuzzle.daily.${daily}` : BEST_KEY);
const loadBest = (daily: string | null = null): number => {
  try { return Number(localStorage.getItem(bestKey(daily))) || 0; } catch { return 0; }
};

/** Tray number n for the given mode. Each daily tray has its own stream, so retries cannot shift later trays. */
const makeTray = (grid: Grid, seed: string, n: number): Shape[] => drawTray(grid, seeded(`${seed}:${n}`));

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
    wk: kind === "weekly" ? blankRun() : null, moves: 0, lines: 0, won: false, stars: 0, moveLog: [],
  };
}

/** Records today's first attempt (see records.ts). `abandoned` marks one walked away from mid-game. */
function recordOfficial(abandoned: boolean): void {
  if (!state.daily || state.practice || officialResult(state.daily)) return;
  // Moves are kept only if the log is complete (a game begun before moves were recorded cannot be verified).
  const moves = state.moveLog.length === state.moves ? [...state.moveLog] : undefined;
  saveOfficial(state.daily, { score: state.score, board: boardEmoji(state.grid, colorGrid), ...(abandoned ? { abandoned: true } : {}), ...(moves ? { moves } : {}) });
}

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
      ml: state.moveLog,
      k: colorGrid.flat().map((v) => (v < 0 ? "-" : String(v))).join(""),
    }));
  } catch { /* ignore */ }
}

function load(): State | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { g: string; t: number[]; s: number; c: number; k?: string; d?: string | null; n?: number; u?: number; sd?: string; ch?: number | null; kd?: Kind; pr?: boolean; lv?: number | null; wid?: string | null; wk?: WeeklyRun | null; mv?: number; ln?: number; ml?: unknown };
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
      moveLog: Array.isArray(d.ml) ? (d.ml as unknown[]).filter((m): m is MoveTuple => Array.isArray(m) && m.length === 3 && m.every((n) => Number.isInteger(n))).slice(0, 3000) : [],
    };
  } catch {
    return null;
  }
}

let state: State = load() ?? newState();

// ---- Transient effects (purely visual; never affect game logic) ---------------

interface ClearCell { r: number; c: number; ci: number; delay: number; fired: boolean }
interface Clear { cells: ClearCell[]; t: number; lines: number; count: number }
interface Ring { x: number; y: number; t: number; max: number; color: string; w: number }
let rings: Ring[] = [];
let praises: Praise[] = [];
let flash = 0; // full-screen white pulse on big clears
let jellyAmp = 0; // the board wobbles after a clear
let jellyT = 0;
let idleT = 0; // seconds since the player last did anything
let challengeBeaten = state.challenge !== null && state.score > state.challenge;
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

function layout(): void {
  layoutView(SIZE);
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

interface Snapshot { grid: Grid; tray: (Shape | null)[]; score: number; combo: number; trays: number; colors: number[][]; moves: number; lines: number; wk: WeeklyRun | null; moveLog: MoveTuple[] }
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
  state.moveLog = snap.moveLog;
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
let overPress: "share" | "again" | "mode" | "undo" | "board" | null = null;
let sharedAt = -10; // clock time of the last "copied" confirmation

/** Today's finished first attempt can open the leaderboard from the game-over card. */
const lbButtonShown = (): boolean => lb.available && !!state.daily && !state.practice && state.daily === today() && state.kind === "classic";

function overHit(x: number, y: number): "share" | "again" | "mode" | "undo" | "board" {
  if (Math.abs(x - W / 2) <= 96) {
    const dy = lbButtonShown() ? 56 : 0;
    if (canUndoOver() && y >= H / 2 + 214 + dy && y <= H / 2 + 262 + dy) return "undo";
    if (y >= H / 2 + 104 && y <= H / 2 + 156) return "share";
    if (dy && y >= H / 2 + 160 && y <= H / 2 + 208) return "board";
    if (y >= H / 2 + 160 + dy && y <= H / 2 + 212 + dy) return "mode";
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
      markWeeklyCompleted(state.week);
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

function pickMode(i: number): void {
  haptics.tick();
  if (i === 5) { ui.modesView = "archive"; return; }
  if (i === 6) { ui.modesOn = false; openLeaderboard(); return; }
  ui.modesOn = false;
  if (i === 0) startGame({});
  else if (i === 1) startGame({ daily: today() });
  else if (i === 2) startGame({ kind: "weekly" });
  else if (i === 3) startGame({ kind: "journey", level: readJourney().next });
  else startGame({ kind: "zen" });
}

// ---- Leaderboard flow -----------------------------------------------------------------

/** Today's first attempt can be posted if it finished with a complete, replayable move list. */
function canPostToday(): boolean {
  const off = officialResult(today());
  return !!off?.moves && off.moves.length > 0 && !postedResult(today());
}

function syncLeaderboardState(): void {
  ui.lbCanPost = canPostToday();
  const p = postedResult(today());
  ui.lbPosted = p ? { rank: p.rank, total: p.total, score: p.score } : null;
}

async function refreshBoards(): Promise<void> {
  ui.lbLoading = true;
  syncLeaderboardState();
  const [board, streaks] = await Promise.all([fetchBoard(today()), fetchStreaks()]);
  ui.lbBoard = board;
  ui.lbStreaks = streaks;
  ui.lbLoading = false;
  if (!board && !streaks) ui.lbMsg = "Could not load the leaderboard. Check your connection.";
}

function openLeaderboard(): void {
  ui.lbOn = true; ui.lbT = 0; ui.lbTab = 0; ui.lbMsg = ""; ui.lbBoard = null; ui.lbStreaks = null;
  void refreshBoards();
}

/** Asks for a nickname if needed, then posts the first attempt. The server verifies it by replaying the moves. */
async function postMyScore(): Promise<void> {
  const date = today();
  const off = officialResult(date);
  if (!off?.moves || postedResult(date)) return;
  let name = getPlayer().name;
  let problem = "";
  for (;;) {
    const entered = await askName(name, problem);
    if (!entered) return;
    ui.lbMsg = "Posting\u2026";
    const r = await postDaily(date, off.moves, entered);
    if (r.ok) {
      savePlayerName(entered);
      savePosted(date, { rank: r.rank, total: r.total, score: r.score, streak: r.streak });
      ui.lbMsg = `Posted! You are #${r.rank} of ${r.total.toLocaleString("en-US")}.`;
      sfx.praise(2);
      haptic([20, 30, 20]);
      await refreshBoards();
      return;
    }
    if (r.error === "bad name") { name = entered; problem = r.message ?? "That name is not allowed."; continue; }
    if (r.error === "already submitted") {
      ui.lbMsg = "You already posted today.";
      savePosted(date, { rank: 0, total: 0, score: off.score, streak: 0 });
      await refreshBoards();
      return;
    }
    ui.lbMsg = r.message ?? "Could not post your score.";
    return;
  }
}

void checkLeaderboard();

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
  if (ui.hintOn) { ui.hintPress = true; return; }
  if (ui.chIntro) { ui.chPress = chHit(e.clientX, e.clientY); return; }
  if (ui.statsOn) { ui.statsPress = { x: e.clientX, y: e.clientY }; return; }
  if (ui.lbOn) { ui.lbPress = { x: e.clientX, y: e.clientY }; return; }
  if (ui.settingsOn) { ui.settingsPress = { x: e.clientX, y: e.clientY }; return; }
  if (ui.modesOn) { ui.modesPress = { x: e.clientX, y: e.clientY }; return; }
  if (state.over) {
    // Act on release, not press: share() needs a completed gesture on iOS.
    if (overT >= 0.6) overPress = overHit(e.clientX, e.clientY);
    return;
  }
  if (state.combo < 2 && Math.hypot(e.clientX - W / 2, e.clientY - 30) <= 20) {
    ui.statsOn = true; ui.statsT = 0; ui.badgeSel = -1; markBadgesSeen();
    haptics.tick();
    return;
  }
  const [tx, ty] = THEME_C();
  if (Math.hypot(e.clientX - tx, e.clientY - ty) <= 19) { cycleTheme(); markThemeShown(clock); haptics.tick(); return; }
  if (inRect(CHIP, e.clientX, e.clientY)) { ui.modesOn = true; ui.modesView = "main"; ui.modesT = 0; haptics.tick(); return; }
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
  if (ui.lbPress) {
    const down = ui.lbPress;
    ui.lbPress = null;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
    const l = lbLayout();
    const act = lbTap((e.clientX - W / 2) / l.k, (e.clientY - H / 2) / l.k);
    if (act === "close") ui.lbOn = false;
    else if (act === "tab0" || act === "tab1") { ui.lbTab = act === "tab0" ? 0 : 1; ui.lbMsg = ""; haptics.tick(); }
    else if (act === "post") void postMyScore();
    return;
  }
  if (ui.settingsPress) {
    const down = ui.settingsPress;
    ui.settingsPress = null;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
    const l = settingsLayout();
    if (settingsTap((e.clientX - W / 2) / l.k, (e.clientY - H / 2) / l.k)) ui.settingsOn = false;
    return;
  }
  if (ui.chPress && ui.chIntro) {
    const want = ui.chPress;
    const ch = ui.chIntro;
    ui.chPress = null;
    if (chHit(e.clientX, e.clientY) !== want) return;
    ui.chIntro = null;
    ui.chT = 0;
    if (want === "play") reset({ ch });
    return;
  }
  if (ui.modesPress) {
    const down = ui.modesPress;
    ui.modesPress = null;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
    const l = modesLayout();
    const lx = (e.clientX - W / 2) / l.k;
    const ly = (e.clientY - H / 2) / l.k;
    const inCard = Math.abs(lx) <= l.cw / 2 && Math.abs(ly) <= MODES_H / 2;
    if (!inCard) { ui.modesOn = false; return; }
    if (ui.modesView === "main" && Math.hypot(lx - (l.cw / 2 - 38), ly + 251) <= 22) {
      ui.modesOn = false; ui.settingsOn = true; ui.settingsT = 0; ui.settingsNote = "";
      haptics.tick();
      return;
    }
    if (ly >= 232 && ly <= 280 && Math.abs(lx) <= 90) {
      if (ui.modesView === "archive") ui.modesView = "main"; else ui.modesOn = false;
      haptics.tick();
      return;
    }
    if (ui.modesView === "main") {
      for (let i = 0; i < (lb.available ? 7 : 6); i++) {
        const { y, h } = modesRow(i);
        if (ly >= y && ly <= y + h && Math.abs(lx) <= l.cw / 2 - 16) { pickMode(i); return; }
      }
    } else {
      const dates = archiveDates();
      const cw2 = (l.cw - 48 - 10) / 2;
      for (let i = 0; i < dates.length; i++) {
        const x = -l.cw / 2 + 24 + (i % 2) * (cw2 + 10);
        const y = -200 + Math.floor(i / 2) * 58;
        if (lx >= x && lx <= x + cw2 && ly >= y && ly <= y + 50) {
          ui.modesOn = false;
          startGame({ daily: dates[i]! });
          return;
        }
      }
    }
    return;
  }
  if (ui.statsPress) {
    const down = ui.statsPress;
    ui.statsPress = null;
    const l = statsLayout();
    const lx = (e.clientX - W / 2) / l.k;
    const ly = (e.clientY - H / 2) / l.k;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
    for (let t = 0; t < TABS.length; t++) {
      const r = tabRect(t, l.cw);
      if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) { ui.statsTab = t; ui.badgeSel = -1; haptics.tick(); return; }
    }
    if (ui.statsTab === 1) {
      for (let i = 0; i < BADGES.length; i++) {
        const b = badgeCell(i, l);
        if (lx >= b.x - b.w / 2 && lx <= b.x + b.w / 2 && ly >= b.y && ly <= b.y + 54) { ui.badgeSel = ui.badgeSel === i ? -1 : i; haptics.tick(); return; }
      }
    }
    const inCard = Math.abs(lx) <= l.cw / 2 && ly >= -CARD_H / 2 && ly <= CARD_H / 2;
    const onClose = Math.abs(lx) <= 90 && ly >= 244 && ly <= 294;
    if (!inCard || onClose) ui.statsOn = false;
    return;
  }
  if (ui.hintPress) {
    ui.hintPress = false;
    if (ui.hintT >= 0.5) { ui.hintOn = false; try { localStorage.setItem(HINT_KEY, "1"); } catch { /* ignore */ } }
    return;
  }
  if (overPress && state.over) {
    const want = overPress;
    overPress = null;
    if (overHit(e.clientX, e.clientY) !== want) return;
    if (want === "share") void shareScore();
    else if (want === "undo") undo();
    else if (want === "board") openLeaderboard();
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
      moves: state.moves, lines: state.lines, wk: state.wk ? { ...state.wk } : null, moveLog: [...state.moveLog],
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
    state.moveLog.push([shapeIndex(drag.shape), t.row, t.col]);
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

function drawMute(): void {
  const [x, y] = muteCenter();
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 15px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(isMuted() ? "\u{1F507}" : "\u{1F50A}", x, y);
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
    leftLabel = wk.limit ? `WEEKLY \u00B7 ${Math.max(0, wk.limit - state.wk.moves)} LEFT` : "WEEKLY";
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
  if (ui.statsOn) ui.statsT = Math.min(1, ui.statsT + dt * 3);
  flash = Math.max(0, flash - dt * 2.6);
  jellyT += dt;
  if (!drag && !state.over && !ui.hintOn) idleT += dt; else idleT = 0;
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
    const dy = lbButtonShown() ? 56 : 0;
    const extra = (canUndoOver() ? 52 : 0) + dy;
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
    if (dy) {
      const posted = postedResult(state.daily!);
      ctx.strokeStyle = "rgba(255,197,85,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-96, 162, 192, 44, 22);
      ctx.stroke();
      ctx.fillStyle = COLORS.combo;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText(posted && posted.rank > 0 ? `\u{1F3C6} Leaderboard \u00B7 #${posted.rank}` : "\u{1F3C6} Leaderboard", 0, 185);
    }
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(state.kind !== "classic" ? "Back to classic" : state.daily ? "Play a random game" : "Play today\u2019s daily", 0, 186 + dy);
    if (state.daily === today()) {
      // Plant the return trip while the player is still pleased with the result.
      const left = timeUntilMidnight(new Date());
      ctx.font = `500 12px ${FONT}`;
      ctx.fillText(`Next daily in ${left.h}h ${String(left.m).padStart(2, "0")}m`, 0, 210 + dy);
    }
    if (extra) {
      ctx.fillStyle = COLORS.combo;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText("\u21B6 Undo last move", 0, 238 + dy);
    }
    ctx.restore();
  }

  for (const t of toasts.slice(0, 1)) drawToast(t);
  if (ui.chIntro && !ui.hintOn) drawChallengeIntro(dtLast, state.score > 0 && !state.over);
  if (ui.statsOn) drawStats();
  if (ui.modesOn) drawModes(dtLast);
  if (ui.settingsOn) drawSettings(dtLast);
  if (ui.lbOn) drawLeaderboard(dtLast);
  if (ui.hintOn) drawHint(dtLast);
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
