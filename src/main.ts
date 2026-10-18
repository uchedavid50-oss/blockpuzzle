import { SIZE, canPlace, canPlaceAnywhere, emptyGrid, hasMoves, place, shapeSize, type Grid, type Shape } from "./board";
import { drawTray, shapeAt, shapeIndex } from "./pieces";
import { haptics } from "./haptics";
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
  trays: number; // trays dealt so far; with the date it fixes the daily sequence
}

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
const yesterday = (): string => {
  const d = new Date();
  return dateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
};

// Consecutive days on which a daily game was started. Device-local; no backend.
const STREAK_KEY = "blockpuzzle.streak";
function readStreak(): { last: string; n: number } | null {
  try {
    const d = JSON.parse(localStorage.getItem(STREAK_KEY) ?? "null") as { last?: string; n?: number } | null;
    return d && typeof d.last === "string" && typeof d.n === "number" ? { last: d.last, n: d.n } : null;
  } catch { return null; }
}
function streakNow(): number {
  const s = readStreak();
  return s && (s.last === today() || s.last === yesterday()) ? s.n : 0;
}
function bumpStreak(): void {
  const s = readStreak();
  if (s?.last === today()) return;
  const n = s?.last === yesterday() ? s.n + 1 : 1;
  try { localStorage.setItem(STREAK_KEY, JSON.stringify({ last: today(), n })); } catch { /* ignore */ }
}
const playedDailyToday = (): boolean => readStreak()?.last === today();

/** Seeded generator (mulberry32 over an FNV-1a hash), so a date gives everyone the same trays. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tray number n for the given mode. Each daily tray has its own stream, so retries cannot shift later trays. */
const makeTray = (grid: Grid, daily: string | null, n: number): Shape[] =>
  drawTray(grid, daily ? seeded(`${daily}:${n}`) : undefined);

// Visual-only: which gem colour each filled cell wears. The rules never read it.
const THEMES: { name: string; colors: string[] }[] = [
  { name: "Gems", colors: ["#4da3ff", "#9a7bff", "#ff6f9c", "#ffb04d", "#3fd6a0", "#3fd0e8", "#ff7a5c", "#a6e05a"] },
  { name: "Neon", colors: ["#00e5ff", "#ff2bd6", "#b6ff00", "#ff7a00", "#8a5cff", "#00ff9d", "#ff3355", "#ffee00"] },
  { name: "Pastel", colors: ["#8ecae6", "#c3a6ff", "#ffadc6", "#ffd6a5", "#9be3c0", "#a0e7f0", "#ffb5a7", "#d4e79e"] },
  // Okabe-Ito: chosen to stay distinguishable with the common kinds of colour blindness.
  { name: "Colour-blind", colors: ["#0072b2", "#e69f00", "#56b4e9", "#009e73", "#f0e442", "#d55e00", "#cc79a7", "#999999"] },
];
const THEME_KEY = "blockpuzzle.theme";
const PALETTE: string[] = [...THEMES[0]!.colors]; // mutated in place when the theme changes
let themeIdx = 0;
let themeShownAt = -10;
function applyTheme(i: number): void {
  themeIdx = ((i % THEMES.length) + THEMES.length) % THEMES.length;
  PALETTE.splice(0, PALETTE.length, ...THEMES[themeIdx]!.colors);
  try { localStorage.setItem(THEME_KEY, String(themeIdx)); } catch { /* ignore */ }
}
try { applyTheme(Number(localStorage.getItem(THEME_KEY)) || 0); } catch { /* ignore */ }
const blankColors = (): number[][] => Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(-1));
const blankPop = (): number[][] => Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
const colorIndex = (shape: Shape): number => shapeIndex(shape) % PALETTE.length;
let colorGrid = blankColors();
let pop = blankPop();
let startBest = loadBest();

function newState(daily: string | null = null): State {
  colorGrid = blankColors();
  pop = blankPop();
  startBest = loadBest(daily);
  const grid = emptyGrid();
  return { grid, tray: makeTray(grid, daily, 0), score: 0, best: loadBest(daily), combo: 0, over: false, daily, trays: 1, undoLeft: 1 };
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
      n: state.trays,
      u: state.undoLeft,
      k: colorGrid.flat().map((v) => (v < 0 ? "-" : String(v))).join(""),
    }));
  } catch { /* ignore */ }
}

function load(): State | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { g: string; t: number[]; s: number; c: number; k?: string; d?: string | null; n?: number; u?: number };
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
      daily, trays: Number(d.n) || 1, undoLeft: d.u === 0 ? 0 : 1,
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
const PRAISE = ["Nice!", "Great!", "Awesome!", "Fantastic!", "Unreal!"];
const PRAISE_COLORS = ["#7fe3a8", "#5ec8ff", "#ffc555", "#ff8a5c", "#ff5fa8"];
let flash = 0; // full-screen white pulse on big clears
let jellyAmp = 0; // the board wobbles after a clear
let jellyT = 0;
let idleT = 0; // seconds since the player last did anything
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

interface Snapshot { grid: Grid; tray: (Shape | null)[]; score: number; combo: number; trays: number; colors: number[][] }
let snap: Snapshot | null = null;

const canUndo = (): boolean => !!snap && state.undoLeft > 0 && !state.over && !drag;
const canUndoOver = (): boolean => !!snap && state.undoLeft > 0 && state.over;

function undo(): void {
  if (!snap || state.undoLeft <= 0 || drag) return;
  if (state.over) { state.over = false; overT = 0; } // take back the losing move
  state.grid = snap.grid;
  state.tray = snap.tray;
  state.score = snap.score;
  state.combo = snap.combo;
  state.trays = snap.trays;
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

function startDaily(target: string | null): void {
  if (state.score > 0 && !state.over && !confirm("Start a new game? Your current game will be lost.")) return;
  reset(target);
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

async function shareScore(): Promise<void> {
  const text = state.daily
    ? `Block Puzzle daily ${state.daily}: I scored ${state.score}. Can you beat it?`
    : `I scored ${state.score} in Block Puzzle. Can you beat it?`;
  const url = location.origin;
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      sharedAt = clock;
    }
  } catch (err) {
    // A cancelled share sheet is not an error; anything else falls back to copying.
    if ((err as DOMException)?.name === "AbortError") return;
    try { await navigator.clipboard.writeText(`${text} ${url}`); sharedAt = clock; } catch { /* ignore */ }
  }
}

function reset(daily: string | null = null): void {
  state = newState(daily);
  snap = null;
  shownScore = 0;
  clears = []; particles = []; floaters = []; returning = []; rings = []; praises = []; flash = 0;
  overT = 0;
  save();
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
  if (state.over) {
    // Act on release, not press: share() needs a completed gesture on iOS.
    if (overT >= 0.6) overPress = overHit(e.clientX, e.clientY);
    return;
  }
  const [tx, ty] = THEME_C();
  if (Math.hypot(e.clientX - tx, e.clientY - ty) <= 19) { applyTheme(themeIdx + 1); themeShownAt = clock; haptics.tick(); return; }
  if (inRect(CHIP, e.clientX, e.clientY)) { startDaily(state.daily ? null : today()); return; }
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
    else if (want === "mode") reset(state.daily ? null : today());
    else reset(state.daily);
    return;
  }
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.px = e.clientX; drag.py = e.clientY;
  const t = dragTarget();
  const color = colorIndex(drag.shape);
  if (t?.ok) {
    const res = place(state.grid, drag.shape, t.row, t.col, state.combo);
    const lines = res.rowsCleared.length + res.colsCleared.length;
    snap = {
      grid: state.grid, tray: [...state.tray], score: state.score, combo: state.combo,
      trays: state.trays, colors: colorGrid.map((r) => r.slice()),
    };
    if (state.daily === today()) bumpStreak();
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
      const cells = new Set<string>();
      for (const r of res.rowsCleared) for (let c = 0; c < SIZE; c++) cells.add(`${r},${c}`);
      for (const c of res.colsCleared) for (let r = 0; r < SIZE; r++) cells.add(`${r},${c}`);
      const list = [...cells].map((k) => k.split(",").map(Number) as [number, number]);
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
      rings.push({ x: sx / list.length, y: sy / list.length, t: 0, max: cell * (2.2 + lines * 0.5), color: lines >= 2 ? COLORS.combo : "#ffffff", w: 2.5 + lines * 0.5 });
      floaters.push({ x: sx / list.length, y: sy / list.length, text: `+${res.points}`, sub: "", t: 0 });

      // Praise banner, scaled to how well that move went.
      const level = Math.min(5, lines >= 2 ? lines + (res.combo >= 3 ? 1 : 0) : res.combo >= 2 ? 1 : 0);
      if (level > 0) { praises.push({ text: PRAISE[level - 1]!, t: 0, level }); sfx.praise(level); }
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
            size: 5 + Math.random() * 5, color: i % 3 === 0 ? "#ffd75e" : PALETTE[i % PALETTE.length]!,
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
    state.score += res.points;
    state.combo = res.combo;
    state.tray[drag.slot] = null;
    if (state.tray.every((s) => s === null)) state.tray = makeTray(state.grid, state.daily, state.trays++);
    if (state.score > state.best) {
      state.best = state.score;
      try { localStorage.setItem(bestKey(state.daily), String(state.best)); } catch { /* ignore */ }
    }
    const remaining = state.tray.filter((s): s is Shape => s !== null);
    if (!hasMoves(state.grid, remaining)) { state.over = true; overT = 0; sfx.gameOver(); haptics.gameOver(); }
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

function emptyCell(x: number, y: number, s: number): void {
  const g = Math.max(1, s * 0.04);
  const grad = ctx.createLinearGradient(x, y, x, y + s);
  grad.addColorStop(0, "#151925");
  grad.addColorStop(1, "#1d2230");
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
  label(state.daily ? "DAILY" : "SCORE", 22, 20, "left");
  label(state.daily ? "BEST TODAY" : "BEST", W - 22, 20, "right");
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 28px ${FONT}`;
  ctx.textAlign = "left";
  ctx.save();
  ctx.translate(22, 43);
  const bump = reduceMotion ? 1 : 1 + 0.2 * scorePulse * scorePulse;
  ctx.scale(bump, bump);
  ctx.fillText(String(Math.round(shownScore)), 0, 0);
  ctx.restore();
  ctx.textAlign = "right";
  ctx.fillStyle = state.score >= state.best && state.score > 0 ? COLORS.combo : COLORS.text;
  ctx.fillText(String(state.best), W - 22, 43);

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
  pill(CHIP, state.daily ? "Random game" : played ? "Daily \u2713" : "Play daily", !state.daily && !played);
  const streak = streakNow();
  if (streak > 0) {
    ctx.fillStyle = COLORS.combo;
    ctx.font = `700 14px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`\u{1F525} ${streak}`, CHIP.x + CHIP.w + 10, CHIP.y + CHIP.h / 2 + 1);
  }
  if (canUndo()) pill(undoRect(), "\u21B6 Undo", false);

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

  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const x = boardX + c * cell;
      const y = boardY + r * cell;
      const ci = colorGrid[r]![c]!;
      if (!state.grid[r]![c]) { emptyCell(x, y, cell); continue; }
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
        if (!reduceMotion) rings.push({ x: boardX + (cc.c + 0.5) * cell, y: boardY + (cc.r + 0.5) * cell, t: 0, max: cell * 0.85, color: PALETTE[cc.ci < 0 ? 0 : cc.ci]!, w: 2 });
        burst(boardX + (cc.c + 0.5) * cell, boardY + (cc.r + 0.5) * cell, PALETTE[cc.ci < 0 ? 0 : cc.ci]!, cl.lines);
      }
  }
  clears = clears.filter((cl) => cl.t < 1);
  praises = praises.filter((pr) => (pr.t += dt * 0.95) < 1);
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
      const lines = { rows: res.rowsCleared, cols: res.colsCleared };
      const pulse = 0.22 + 0.1 * Math.sin(clock * 10);
      ctx.fillStyle = hex;
      ctx.globalAlpha = pulse;
      for (const r of lines.rows)
        for (let c = 0; c < SIZE; c++) { ctx.beginPath(); ctx.roundRect(boardX + c * cell + 2, boardY + r * cell + 2, cell - 4, cell - 4, cell * 0.2); ctx.fill(); }
      for (const c of lines.cols)
        for (let r = 0; r < SIZE; r++) { ctx.beginPath(); ctx.roundRect(boardX + c * cell + 2, boardY + r * cell + 2, cell - 4, cell - 4, cell * 0.2); ctx.fill(); }
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

    const isBest = state.score > 0 && state.score > startBest;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText(isBest ? "NEW BEST" : "NO MOVES LEFT", 0, -92);
    ctx.fillStyle = isBest ? COLORS.combo : COLORS.text;
    ctx.font = `800 58px ${FONT}`;
    ctx.fillText(String(state.score), 0, -42);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText(`Best ${state.best}`, 0, 8);

    const bgrad = ctx.createLinearGradient(0, 40, 0, 94);
    bgrad.addColorStop(0, "#6cb4ff");
    bgrad.addColorStop(1, "#3a82e6");
    ctx.fillStyle = bgrad;
    ctx.beginPath();
    ctx.roundRect(-96, 40, 192, 54, 27);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 18px ${FONT}`;
    ctx.fillText("Play again", 0, 68);

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
    ctx.fillText(state.daily ? "Play a random game" : "Play today\u2019s daily", 0, 186);
    if (extra) {
      ctx.fillStyle = COLORS.combo;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText("\u21B6 Undo last move", 0, 238);
    }
    ctx.restore();
  }

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
    ["Fill", "a whole row or column to clear it."],
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
