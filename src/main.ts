import { SIZE, canPlace, emptyGrid, hasMoves, place, shapeSize, type Grid, type Shape } from "./board";
import { drawTray, shapeAt, shapeIndex } from "./pieces";
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
}

const BEST_KEY = "blockpuzzle.best";
const SAVE_KEY = "blockpuzzle.save";

const loadBest = (): number => {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
};

function newState(): State {
  const grid = emptyGrid();
  return { grid, tray: drawTray(grid), score: 0, best: loadBest(), combo: 0, over: false };
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
    }));
  } catch { /* ignore */ }
}

function load(): State | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { g: string; t: number[]; s: number; c: number };
    if (typeof d?.g !== "string" || d.g.length !== SIZE * SIZE || !Array.isArray(d.t)) return null;
    const grid = Array.from({ length: SIZE }, (_, r) =>
      Array.from({ length: SIZE }, (_, c) => d.g[r * SIZE + c] === "1"));
    const tray = d.t.map((i) => (i >= 0 ? shapeAt(i) : null));
    if (tray.length !== 3) return null;
    return { grid, tray, score: Number(d.s) || 0, best: loadBest(), combo: Number(d.c) || 0, over: false };
  } catch {
    return null;
  }
}

let state: State = load() ?? newState();

// ---- Transient effects (purely visual; never affect game logic) ---------------

interface Clear { cells: [number, number][]; t: number }
let clears: Clear[] = [];
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
  const top = 60;
  cell = Math.floor(Math.min(W - 24, (H - top) * 0.62) / SIZE);
  boardX = Math.floor((W - cell * SIZE) / 2);
  boardY = top;
  trayCell = Math.floor(cell * 0.6);
  trayY = boardY + cell * SIZE + (H - boardY - cell * SIZE) / 2 - trayCell * 1.5;
}

/** Top-left of tray slot i (slot is a 5x5 trayCell box). */
function slotRect(i: number): { x: number; y: number; size: number } {
  const size = trayCell * 5;
  const gap = (W - size * 3) / 4;
  return { x: gap + i * (size + gap), y: trayY - trayCell, size };
}

const MUTE_R = 18;
const muteCenter = (): [number, number] => [W - 24, 62];

// ---- Drag ----------------------------------------------------------------------

interface Drag { slot: number; shape: Shape; px: number; py: number; pointerId: number; touch: boolean }
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
  const [mx, my] = muteCenter();
  if (Math.hypot(e.clientX - mx, e.clientY - my) <= MUTE_R + 6) { toggleMute(); return; }
  if (state.over) { state = newState(); shownScore = 0; clears = []; save(); return; }
  if (drag) return;
  const slot = slotAt(e.clientX, e.clientY);
  const shape = slot >= 0 ? state.tray[slot] : null;
  if (!shape) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { slot, shape, px: e.clientX, py: e.clientY, pointerId: e.pointerId, touch: e.pointerType !== "mouse" };
});

canvas.addEventListener("pointermove", (e) => {
  if (drag && e.pointerId === drag.pointerId) { drag.px = e.clientX; drag.py = e.clientY; }
});

canvas.addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.px = e.clientX; drag.py = e.clientY;
  const t = dragTarget();
  if (t?.ok) {
    const res = place(state.grid, drag.shape, t.row, t.col, state.combo);
    const lines = res.rowsCleared.length + res.colsCleared.length;

    if (lines > 0) {
      // Record the cleared cells before the grid forgets them, so they can fade out.
      const cells = new Set<string>();
      for (const r of res.rowsCleared) for (let c = 0; c < SIZE; c++) cells.add(`${r},${c}`);
      for (const c of res.colsCleared) for (let r = 0; r < SIZE; r++) cells.add(`${r},${c}`);
      clears.push({ cells: [...cells].map((k) => k.split(",").map(Number) as [number, number]), t: 0 });
      if (lines >= 2 || res.combo >= 3) shake = Math.min(1, 0.35 + lines * 0.15);
      sfx.clear(lines, state.combo);
    } else {
      sfx.place();
    }

    state.grid = res.grid;
    state.score += res.points;
    state.combo = res.combo;
    state.tray[drag.slot] = null;
    if (state.tray.every((s) => s === null)) state.tray = drawTray(state.grid);
    if (state.score > state.best) {
      state.best = state.score;
      try { localStorage.setItem(BEST_KEY, String(state.best)); } catch { /* ignore */ }
    }
    const remaining = state.tray.filter((s): s is Shape => s !== null);
    if (!hasMoves(state.grid, remaining)) { state.over = true; sfx.gameOver(); }
    save();
  } else {
    sfx.invalid();
  }
  drag = null;
});

canvas.addEventListener("pointercancel", () => { drag = null; });
window.addEventListener("blur", save);
document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });

// ---- Rendering ------------------------------------------------------------------

const COLORS = {
  bg: "#14161c", empty: "#232733", filled: "#4da3ff",
  ok: "rgba(120,220,140,0.55)", bad: "rgba(240,90,90,0.45)",
  text: "#e8ecf4", dim: "#7b8496", combo: "#ffc555",
};

const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function box(x: number, y: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, s - 2, s - 2, s * 0.15);
  ctx.fill();
}

function drawShape(shape: Shape, x: number, y: number, s: number, color: string): void {
  for (const [r, c] of shape) box(x + c * s, y + r * s, s, color);
}

function drawMute(): void {
  const [x, y] = muteCenter();
  ctx.fillStyle = COLORS.dim;
  ctx.font = "600 17px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(isMuted() ? "\u{1F507}" : "\u{1F50A}", x, y);
}

function render(dt: number): void {
  // Count the score up rather than snapping, so a big clear reads as a big clear.
  shownScore += (state.score - shownScore) * Math.min(1, dt * 8);
  if (Math.abs(state.score - shownScore) < 0.5) shownScore = state.score;

  clears = clears.filter((c) => (c.t += dt * 3) < 1);
  shake = Math.max(0, shake - dt * 3.5);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  if (shake > 0 && !reduceMotion) {
    const a = shake * shake * 6;
    ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
  }

  ctx.fillStyle = COLORS.text;
  ctx.textBaseline = "middle";
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`Score ${Math.round(shownScore)}`, 16, 30);
  ctx.textAlign = "right";
  ctx.fillText(`Best ${state.best}`, W - 16, 30);

  if (state.combo >= 2) {
    ctx.fillStyle = COLORS.combo;
    ctx.textAlign = "center";
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.fillText(`${state.combo}x combo`, W / 2, 30);
  }

  drawMute();

  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      box(boardX + c * cell, boardY + r * cell, cell, state.grid[r]![c] ? COLORS.filled : COLORS.empty);

  // Cleared cells: shrink and fade where they used to be.
  for (const cl of clears) {
    const k = reduceMotion ? 0 : cl.t;
    const size = cell * (1 - k);
    const off = (cell - size) / 2;
    ctx.globalAlpha = 1 - cl.t;
    for (const [r, c] of cl.cells)
      box(boardX + c * cell + off, boardY + r * cell + off, size, "#eaf4ff");
    ctx.globalAlpha = 1;
  }

  const t = dragTarget();
  if (drag && t) {
    if (t.ok) {
      drawShape(drag.shape, boardX + t.col * cell, boardY + t.row * cell, cell, COLORS.ok);
    } else {
      // Show where it would land even when it cannot: silence reads as an unresponsive game.
      for (const [dr, dc] of drag.shape) {
        const r = t.row + dr;
        const c = t.col + dc;
        if (r >= 0 && r < SIZE && c >= 0 && c < SIZE)
          box(boardX + c * cell, boardY + r * cell, cell, COLORS.bad);
      }
    }
  }

  state.tray.forEach((shape, i) => {
    if (!shape || drag?.slot === i) return;
    const slot = slotRect(i);
    const { rows, cols } = shapeSize(shape);
    drawShape(shape, slot.x + (slot.size - cols * trayCell) / 2, slot.y + (slot.size - rows * trayCell) / 2, trayCell, COLORS.filled);
  });

  if (drag) {
    const { rows, cols } = shapeSize(drag.shape);
    const lift = drag.touch ? cell * 1.5 : 0;
    drawShape(drag.shape, drag.px - (cols * cell) / 2, drag.py - lift - (rows * cell) / 2, cell, COLORS.filled);
  }

  if (state.over) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgba(10,12,16,0.8)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "center";
    ctx.font = "700 36px system-ui, sans-serif";
    ctx.fillText("No moves left", W / 2, H / 2 - 20);
    ctx.font = "500 20px system-ui, sans-serif";
    ctx.fillText(`Score ${state.score} — tap to play again`, W / 2, H / 2 + 20);
  }
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
