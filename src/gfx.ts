// Drawing primitives and the shared view: the canvas, the layout numbers and the block art.
// Everything here is rendering only; it never reads game state.

import { shapeSize, type Shape } from "./board";
import { PALETTE } from "./progress";
import { settings } from "./settings";

export const canvas = document.getElementById("game") as HTMLCanvasElement;
export const ctx = canvas.getContext("2d")!;

// Layout, recomputed on resize. `export let` bindings are live: importers always see the latest values.
export let dpr = 1;
export let W = 0;
export let H = 0;
export let cell = 0;
export let boardX = 0;
export let boardY = 0;
export let trayY = 0;
export let trayCell = 0;

export function layoutView(size: number): void {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const top = 108;
  cell = Math.floor(Math.min(W - 44, (H - top) * 0.6) / size);
  boardX = Math.floor((W - cell * size) / 2);
  boardY = top;
  trayCell = Math.floor(Math.min(cell * 0.6, (W - 48) / 15));
  trayY = boardY + cell * size + (H - boardY - cell * size) / 2 - trayCell * 1.5;
}

export const COLORS = {
  text: "#eef1f8", dim: "#7f889c", combo: "#ffc555",
  bad: "rgba(240,90,110,0.38)",
};

export let reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
/** Lets the settings sheet force reduced motion on top of the system preference. */
export function setReduceMotion(v: boolean): void {
  reduceMotion = v || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}
export const FONT = "system-ui, -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif";

export function mix(hex: string, to: number, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (to - v) * a);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** One glossy gem block. */
export function block(x: number, y: number, s: number, hex: string): void {
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
  if (settings.patterns) {
    const k = PALETTE.indexOf(hex);
    if (k >= 0) pattern(k, x + s / 2, y + g + fh / 2, s * 0.2);
  }
}

/** A mark for each colour, drawn on the block face when the colour-blind patterns setting is on. */
function pattern(kind: number, cx: number, cy: number, r: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.strokeStyle = "rgba(0,0,0,0.42)";
  ctx.lineWidth = Math.max(1.5, r * 0.28);
  ctx.lineCap = "round";
  ctx.beginPath();
  switch (kind % 8) {
    case 0: ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fill(); return;
    case 1: ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.stroke(); return;
    case 2: ctx.moveTo(cx - r, cy - r * 0.4); ctx.lineTo(cx + r, cy - r * 0.4); ctx.moveTo(cx - r, cy + r * 0.4); ctx.lineTo(cx + r, cy + r * 0.4); break;
    case 3: ctx.moveTo(cx - r * 0.4, cy - r); ctx.lineTo(cx - r * 0.4, cy + r); ctx.moveTo(cx + r * 0.4, cy - r); ctx.lineTo(cx + r * 0.4, cy + r); break;
    case 4: ctx.moveTo(cx - r * 0.8, cy + r * 0.8); ctx.lineTo(cx + r * 0.8, cy - r * 0.8); break;
    case 5: ctx.moveTo(cx - r * 0.8, cy); ctx.lineTo(cx + r * 0.8, cy); ctx.moveTo(cx, cy - r * 0.8); ctx.lineTo(cx, cy + r * 0.8); break;
    case 6: ctx.moveTo(cx, cy - r * 0.85); ctx.lineTo(cx + r * 0.85, cy + r * 0.65); ctx.lineTo(cx - r * 0.85, cy + r * 0.65); ctx.closePath(); ctx.fill(); return;
    default: ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.8, cy); ctx.closePath(); ctx.fill(); return;
  }
  ctx.stroke();
}

export function emptyCell(x: number, y: number, s: number, alt = false): void {
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

export function drawShape(shape: Shape, x: number, y: number, s: number, hex: string): void {
  for (const [r, c] of shape) block(x + c * s, y + r * s, s, hex);
}

/** Centre and cell size of the piece being dragged, easing from its tray slot up to the pointer. */
export const easeOutBack = (t: number): number => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);


export function drawCentered(shape: Shape, cx: number, cy: number, s: number, hex: string, rot = 0): void {
  const { rows, cols } = shapeSize(shape);
  if (!rot) { drawShape(shape, cx - (cols * s) / 2, cy - (rows * s) / 2, s, hex); return; }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  drawShape(shape, -(cols * s) / 2, -(rows * s) / 2, s, hex);
  ctx.restore();
}

export function label(text: string, x: number, y: number, align: CanvasTextAlign): void {
  ctx.fillStyle = COLORS.dim;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.font = `600 11px ${FONT}`;
  ctx.fillText(text, x, y);
}

export function pill(r: { x: number; y: number; w: number; h: number }, text: string, hot: boolean): void {
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

export function star(x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
}

/** A small sunset scene, drawn in `size` x `size` at (x, y). The collection reveals it tile by tile. */
export function paintScene(x: number, y: number, size: number): void {
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

