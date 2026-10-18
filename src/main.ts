import { SIZE, canPlace, canPlaceAnywhere, emptyGrid, hasMoves, place, shapeSize, type Grid, type Shape } from "./board";
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

// Visual-only: which gem colour each filled cell wears. The rules never read it.
const PALETTE = ["#4da3ff", "#9a7bff", "#ff6f9c", "#ffb04d", "#3fd6a0", "#3fd0e8", "#ff7a5c", "#a6e05a"];
const blankColors = (): number[][] => Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(-1));
const blankPop = (): number[][] => Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
const colorIndex = (shape: Shape): number => shapeIndex(shape) % PALETTE.length;
let colorGrid = blankColors();
let pop = blankPop();
let startBest = loadBest();

function newState(): State {
  colorGrid = blankColors();
  pop = blankPop();
  startBest = loadBest();
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
      k: colorGrid.flat().map((v) => (v < 0 ? "-" : String(v))).join(""),
    }));
  } catch { /* ignore */ }
}

function load(): State | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { g: string; t: number[]; s: number; c: number; k?: string };
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
    startBest = loadBest();
    return { grid, tray, score: Number(d.s) || 0, best: loadBest(), combo: Number(d.c) || 0, over: false };
  } catch {
    return null;
  }
}

let state: State = load() ?? newState();

// ---- Transient effects (purely visual; never affect game logic) ---------------

interface Clear { cells: [number, number, number][]; t: number } // [row, col, colour]
let clears: Clear[] = [];
interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string }
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
  const top = 96;
  cell = Math.floor(Math.min(W - 44, (H - top) * 0.6) / SIZE);
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

const MUTE_R = 14;
const muteCenter = (): [number, number] => [W - 26, 70];

let overPress: "share" | "again" | null = null;
let sharedAt = -10; // clock time of the last "copied" confirmation

const hitsShare = (x: number, y: number): boolean =>
  Math.abs(x - W / 2) <= 96 && y >= H / 2 + 104 && y <= H / 2 + 156;

async function shareScore(): Promise<void> {
  const text = `I scored ${state.score} in Block Puzzle. Can you beat it?`;
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

function reset(): void {
  state = newState();
  shownScore = 0;
  clears = []; particles = []; floaters = []; returning = [];
  overT = 0;
  save();
}

// ---- Drag ----------------------------------------------------------------------

interface Drag { slot: number; shape: Shape; px: number; py: number; pointerId: number; touch: boolean; k: number }
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
  if (state.over) {
    // Act on release, not press: share() needs a completed gesture on iOS.
    if (overT >= 0.6) overPress = hitsShare(e.clientX, e.clientY) ? "share" : "again";
    return;
  }
  if (drag) return;
  const slot = slotAt(e.clientX, e.clientY);
  const shape = slot >= 0 ? state.tray[slot] : null;
  if (!shape) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { slot, shape, px: e.clientX, py: e.clientY, pointerId: e.pointerId, touch: e.pointerType !== "mouse", k: 0 };
});

canvas.addEventListener("pointermove", (e) => {
  if (drag && e.pointerId === drag.pointerId) { drag.px = e.clientX; drag.py = e.clientY; }
});

canvas.addEventListener("pointerup", (e) => {
  if (overPress && state.over) {
    const want = overPress;
    overPress = null;
    const onShare = hitsShare(e.clientX, e.clientY);
    if (want === "share" && onShare) void shareScore();
    else if (want === "again" && !onShare) reset();
    return;
  }
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.px = e.clientX; drag.py = e.clientY;
  const t = dragTarget();
  const color = colorIndex(drag.shape);
  if (t?.ok) {
    const res = place(state.grid, drag.shape, t.row, t.col, state.combo);
    const lines = res.rowsCleared.length + res.colsCleared.length;

    for (const [dr, dc] of drag.shape) {
      colorGrid[t.row + dr]![t.col + dc] = color;
      pop[t.row + dr]![t.col + dc] = 1;
    }

    if (lines > 0) {
      // Record the cleared cells (and their colours) before the grid forgets them.
      const cells = new Set<string>();
      for (const r of res.rowsCleared) for (let c = 0; c < SIZE; c++) cells.add(`${r},${c}`);
      for (const c of res.colsCleared) for (let r = 0; r < SIZE; r++) cells.add(`${r},${c}`);
      const list = [...cells].map((k) => k.split(",").map(Number) as [number, number]);
      clears.push({ cells: list.map(([r, c]) => [r, c, colorGrid[r]![c]!]), t: 0 });
      let sx = 0, sy = 0;
      for (const [r, c] of list) {
        const x = boardX + (c + 0.5) * cell;
        const y = boardY + (r + 0.5) * cell;
        sx += x; sy += y;
        if (!reduceMotion) {
          const col = PALETTE[colorGrid[r]![c]!] ?? PALETTE[0]!;
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 60 + Math.random() * 160 * (1 + lines * 0.2);
            particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 90, life: 1, size: 2 + Math.random() * 3.5, color: col });
          }
        }
        colorGrid[r]![c] = -1;
      }
      const labels = ["", "", "Double!", "Triple!", "Quad!", "Incredible!"];
      floaters.push({
        x: sx / list.length, y: sy / list.length,
        text: `+${res.points}`, sub: labels[Math.min(lines, 5)] ?? "", t: 0,
      });
      if (lines >= 2 || res.combo >= 3) shake = Math.min(1, 0.35 + lines * 0.15);
      sfx.clear(lines, state.combo);
      navigator.vibrate?.(lines >= 2 ? [18, 30, 18] : 14);
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
    if (!hasMoves(state.grid, remaining)) { state.over = true; overT = 0; sfx.gameOver(); }
    save();
  } else {
    const d = dragDraw(drag);
    returning.push({ shape: drag.shape, color: PALETTE[color]!, x0: d.cx, y0: d.cy, s0: d.s, slot: drag.slot, t: 0 });
    sfx.invalid();
  }
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
  const grad = ctx.createLinearGradient(x, y, x, y + s);
  grad.addColorStop(0, mix(hex, 255, 0.32));
  grad.addColorStop(0.55, hex);
  grad.addColorStop(1, mix(hex, 0, 0.3));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x + g, y + g, w, w, rr);
  ctx.fill();
  // top gloss
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.beginPath();
  ctx.roundRect(x + g + w * 0.08, y + g + w * 0.06, w * 0.84, w * 0.38, rr * 0.8);
  ctx.fill();
  // rim
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + g + 0.5, y + g + 0.5, w - 1, w - 1, rr);
  ctx.stroke();
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
}

function drawShape(shape: Shape, x: number, y: number, s: number, hex: string): void {
  for (const [r, c] of shape) block(x + c * s, y + r * s, s, hex);
}

/** Centre and cell size of the piece being dragged, easing from its tray slot up to the pointer. */
function dragDraw(d: Drag): { cx: number; cy: number; s: number } {
  const e = 1 - Math.pow(1 - d.k, 3);
  const slot = slotRect(d.slot);
  const lift = d.touch ? cell * 1.5 : 0;
  return {
    cx: slot.x + slot.size / 2 + (d.px - (slot.x + slot.size / 2)) * e,
    cy: slot.y + slot.size / 2 + (d.py - lift - (slot.y + slot.size / 2)) * e,
    s: trayCell + (cell - trayCell) * e,
  };
}

function drawCentered(shape: Shape, cx: number, cy: number, s: number, hex: string): void {
  const { rows, cols } = shapeSize(shape);
  drawShape(shape, cx - (cols * s) / 2, cy - (rows * s) / 2, s, hex);
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
  label("SCORE", 22, 20, "left");
  label("BEST", W - 22, 20, "right");
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 30px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(String(Math.round(shownScore)), 22, 46);
  ctx.textAlign = "right";
  ctx.fillStyle = state.score >= state.best && state.score > 0 ? COLORS.combo : COLORS.text;
  ctx.fillText(String(state.best), W - 22, 46);

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

function drawBoard(): void {
  const bw = cell * SIZE;
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
      const sc = 1 + 0.13 * Math.sin(pop[r]![c]! * Math.PI);
      const s = cell * sc;
      block(x + (cell - s) / 2, y + (cell - s) / 2, s, PALETTE[ci < 0 ? 0 : ci]!);
    }
}

function render(dt: number): void {
  clock += dt;
  // Count the score up rather than snapping, so a big clear reads as a big clear.
  shownScore += (state.score - shownScore) * Math.min(1, dt * 8);
  if (Math.abs(state.score - shownScore) < 0.5) shownScore = state.score;

  clears = clears.filter((c) => (c.t += dt * 2.6) < 1);
  shake = Math.max(0, shake - dt * 3.5);
  for (const row of pop) for (let c = 0; c < SIZE; c++) row[c] = Math.max(0, row[c]! - dt * 5);
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 700 * dt; p.life -= dt * 1.5; }
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
  drawBoard();

  // Cleared cells: swell, glow white, then shrink away.
  for (const cl of clears) {
    const k = reduceMotion ? 0 : cl.t;
    const swell = 1 + 0.18 * Math.sin(Math.min(1, k * 2.2) * Math.PI);
    const size = cell * swell * (1 - Math.pow(k, 2));
    const off = (cell - size) / 2;
    ctx.globalAlpha = 1 - Math.pow(cl.t, 1.5);
    for (const [r, c, ci] of cl.cells) {
      const hex = PALETTE[ci < 0 ? 0 : ci]!;
      block(boardX + c * cell + off, boardY + r * cell + off, size, hex);
      ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
      ctx.beginPath();
      ctx.roundRect(boardX + c * cell + off, boardY + r * cell + off, size, size, size * 0.22);
      ctx.fill();
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
    drawCentered(shape, slot.x + slot.size / 2, slot.y + slot.size / 2, trayCell, PALETTE[colorIndex(shape)]!);
    ctx.globalAlpha = 1;
  });

  for (const r of returning) {
    const e = 1 - Math.pow(1 - r.t, 3);
    const slot = slotRect(r.slot);
    drawCentered(r.shape,
      r.x0 + (slot.x + slot.size / 2 - r.x0) * e,
      r.y0 + (slot.y + slot.size / 2 - r.y0) * e,
      r.s0 + (trayCell - r.s0) * e, r.color);
  }

  if (drag) {
    const d = dragDraw(drag);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    drawCentered(drag.shape, d.cx, d.cy, d.s, PALETTE[colorIndex(drag.shape)]!);
    ctx.restore();
  }

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * p.life), 0, Math.PI * 2);
    ctx.fill();
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

  if (state.over) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const e = 1 - Math.pow(1 - overT, 3);
    ctx.fillStyle = `rgba(7,9,14,${0.82 * e})`;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate(W / 2, H / 2 + (1 - e) * 24);
    const cw = Math.min(W - 48, 320);
    const card = ctx.createLinearGradient(0, -145, 0, 165);
    card.addColorStop(0, "#222840");
    card.addColorStop(1, "#151a2a");
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = card;
    ctx.beginPath();
    ctx.roundRect(-cw / 2, -145, cw, 310, 26);
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
    ctx.restore();
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
