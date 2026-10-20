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

// The look: bright candy backgrounds, a deep glossy well for the board, dark violet ink for text.
export const COLORS = {
  text: "#3d1a5c", dim: "#8d6aa8", combo: "#f28c00",
  bad: "rgba(240,60,90,0.45)",
};
/** The brand colours every screen draws from. */
export const BRAND = { violet: "#8a4dff", deep: "#5a22c8", magenta: "#ff4fa0", gold: "#ffc21f", teal: "#1fd6b4", sky: "#4fb8ff" };

export let reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
/** Lets the settings sheet force reduced motion on top of the system preference. */
export function setReduceMotion(v: boolean): void {
  reduceMotion = v || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}
export const FONT = "system-ui, -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif";
/** Rounded lettering where the platform has it (Apple devices do); otherwise the heaviest system face. */
export const ROUND = `'Arial Rounded MT Bold', 'Varela Round', 'Nunito', ${FONT}`;

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

/** An empty board cell: a soft sunken tile in the board's violet well. */
export function emptyCell(x: number, y: number, s: number, alt = false): void {
  const g = Math.max(1, s * 0.05);
  const grad = ctx.createLinearGradient(x, y, x, y + s);
  grad.addColorStop(0, alt ? "rgba(40,14,90,0.55)" : "rgba(30,10,72,0.55)");
  grad.addColorStop(1, alt ? "rgba(120,80,220,0.42)" : "rgba(100,64,200,0.38)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x + g, y + g, s - g * 2, s - g * 2, s * 0.24);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)"; // lit lower lip
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + g + 0.5, y + g + 1.5, s - g * 2 - 1, s - g * 2 - 1, s * 0.24);
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
  ctx.font = `900 11px ${ROUND}`;
  ctx.fillText(text, x, y);
}

/** A small glossy candy pill with a white rim: violet normally, gold when it wants attention. */
export function pill(r: { x: number; y: number; w: number; h: number }, text: string, hot: boolean): void {
  const [hi, lo] = hot ? ["#ffe066", "#f59a00"] : ["#b38aff", BRAND.deep];
  ctx.save();
  ctx.shadowColor = "rgba(60,10,90,0.25)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.roundRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, (r.h + 4) / 2); ctx.fill();
  ctx.restore();
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, hi);
  g.addColorStop(1, lo);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath(); ctx.roundRect(r.x + r.h * 0.3, r.y + 2, r.w - r.h * 0.6, r.h * 0.36, r.h * 0.18); ctx.fill();
  ctx.font = `900 13px ${ROUND}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = hot ? "#a35a00" : "#3b1291";
  ctx.strokeText(text, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.fillStyle = "#ffffff";
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

/** A gold coin of radius r centred on (x, y), in the same glossy candy look as the buttons. */
export function coin(x: number, y: number, r: number): void {
  ctx.save();
  const g = ctx.createLinearGradient(0, y - r, 0, y + r);
  g.addColorStop(0, "#fff09a");
  g.addColorStop(1, "#ffb81f");
  ctx.fillStyle = "#a86400";
  ctx.beginPath(); ctx.arc(x, y + r * 0.12, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(168,100,0,0.55)";
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.38, r * 0.28, r * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
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


// ---- Candy pieces shared by every screen ---------------------------------------------------

export const CANDY = {
  pink: ["#ff9fcf", "#ff3f97", "#b8126a"],
  violet: ["#c7a4ff", "#8a4dff", "#4b14b0"],
  blue: ["#8fd2ff", "#2f8cf0", "#1650a8"],
  green: ["#a6f27a", "#3cbf4f", "#1f7a2c"],
  gold: ["#fff09a", "#ffb81f", "#a86400"],
} as const;
export type Candy = keyof typeof CANDY;

/** The page behind every screen: a soft candy gradient with slowly drifting light. */
export function candyBackdrop(t: number, top = "#ffd9ef", bottom = "#d9c8ff"): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Big soft bubbles of light, drifting.
  for (let i = 0; i < 7; i++) {
    const r = 60 + ((i * 37) % 90);
    const x = ((i * 0.37 + (reduceMotion ? 0 : t * 0.012 * (1 + (i % 3)))) % 1.3) * (W + 2 * r) - r;
    const y = (((i * 0.61) % 1) * H * 1.1) - 20 + (reduceMotion ? 0 : Math.sin(t * 0.4 + i) * 12);
    const b = ctx.createRadialGradient(x, y, 0, x, y, r);
    b.addColorStop(0, "rgba(255,255,255,0.5)");
    b.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = b;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

/** Dims whatever is behind a sheet, with a violet tint rather than black. */
export function dim(e: number): void {
  ctx.fillStyle = `rgba(48,14,80,${0.55 * e})`;
  ctx.fillRect(0, 0, W, H);
}

/** A four-pointed twinkle. */
export function sparkle(x: number, y: number, s: number, color = "#ffffff"): void {
  if (s <= 0.2) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x + s * 0.12, y - s * 0.12, x + s, y);
  ctx.quadraticCurveTo(x + s * 0.12, y + s * 0.12, x, y + s);
  ctx.quadraticCurveTo(x - s * 0.12, y + s * 0.12, x - s, y);
  ctx.quadraticCurveTo(x - s * 0.12, y - s * 0.12, x, y - s);
  ctx.fill();
}

/** Thick-outlined glossy lettering: dark rim, white rim, gradient fill. `wave` bounces the letters. */
export function bubbleText(text: string, x: number, y: number, size: number, fill: readonly [string, string], o: { rim?: string; wave?: number; maxW?: number } = {}): void {
  ctx.save();
  ctx.font = `900 ${size}px ${ROUND}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  const letters = [...text];
  const widths = letters.map((l) => ctx.measureText(l).width);
  const total = widths.reduce((a, b) => a + b, 0);
  const sq = o.maxW && total > o.maxW ? o.maxW / total : 1;
  ctx.translate(x, y);
  ctx.scale(sq, 1);
  let cx = -total / 2;
  const pos = letters.map((l, i) => {
    const p = { l, x: cx, y: o.wave !== undefined && !reduceMotion ? Math.sin(o.wave * 5 - i * 0.55) * size * 0.05 : 0 };
    cx += widths[i]!;
    return p;
  });
  ctx.strokeStyle = o.rim ?? "#3b1291";
  ctx.lineWidth = size * 0.28;
  for (const p of pos) ctx.strokeText(p.l, p.x, p.y + size * 0.05);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * 0.13;
  for (const p of pos) ctx.strokeText(p.l, p.x, p.y);
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, fill[0]);
  g.addColorStop(1, fill[1]);
  ctx.fillStyle = g;
  for (const p of pos) ctx.fillText(p.l, p.x, p.y);
  ctx.restore();
}

/** A fat glossy pill button with a white rim. `press` (0..1) squashes it while held. */
export function candyButton(cx: number, cy: number, w: number, h: number, text: string, kind: Candy, press = 0, size = h * 0.42): void {
  const [hi, mid, lo] = CANDY[kind];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1 + press * 0.04, 1 - press * 0.08);
  ctx.shadowColor = "rgba(60,10,90,0.3)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 12, (h + 8) / 2); ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = lo;
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2 + 5, w, h, h / 2); ctx.fill();
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, hi);
  g.addColorStop(0.6, mid);
  g.addColorStop(1, mid);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2 + press * 3, w, h - 2, h / 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.beginPath(); ctx.roundRect(-w / 2 + h * 0.35, -h / 2 + 4 + press * 3, w - h * 0.7, h * 0.32, h * 0.16); ctx.fill();
  ctx.font = `900 ${size}px ${ROUND}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.22;
  ctx.strokeStyle = lo;
  ctx.strokeText(text, 0, 1 + press * 3, w - 20);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 0, 1 + press * 3, w - 20);
  ctx.restore();
}

/** A round glossy icon button. */
export function roundButton(cx: number, cy: number, r: number, glyph: string, kind: Candy = "violet"): void {
  const [hi, , lo] = CANDY[kind];
  ctx.save();
  ctx.shadowColor = "rgba(60,10,90,0.3)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  g.addColorStop(0, hi); g.addColorStop(1, lo);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.5, r * 0.6, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  if (glyph) {
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${Math.round(r * 1.0)}px ${ROUND}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, cx, cy + 1);
  }
}

/**
 * A sheet: a pastel card in a thick white frame, with its title on a gem-violet ribbon across the top.
 * Drawn in card-local coordinates centred on (0, 0).
 */
export function sheet(w: number, h: number, title: string, accent: Candy = "violet"): void {
  const top = -h / 2;
  ctx.save();
  ctx.shadowColor = "rgba(48,10,80,0.45)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.roundRect(-w / 2 - 6, top - 6, w + 12, h + 12, 32); ctx.fill();
  ctx.restore();
  const pg = ctx.createLinearGradient(0, top, 0, -top);
  pg.addColorStop(0, "#fff7fc");
  pg.addColorStop(1, "#f1e6ff");
  ctx.fillStyle = pg;
  ctx.beginPath(); ctx.roundRect(-w / 2, top, w, h, 26); ctx.fill();
  if (title) ribbon(title, top, w, accent);
}

/** The title ribbon across the top edge (at `top`) of a sheet `w` wide. */
export function ribbon(title: string, top: number, w: number, accent: Candy = "violet"): void {
  const [hi, mid, lo] = CANDY[accent];
  ctx.font = `900 24px ${ROUND}`;
  const rw = Math.min(w - 20, Math.max(170, ctx.measureText(title).width + 64));
  ctx.fillStyle = lo;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * (rw / 2 - 14), top - 4); ctx.lineTo(s * (rw / 2 + 20), top); ctx.lineTo(s * (rw / 2 + 10), top + 15);
    ctx.lineTo(s * (rw / 2 + 20), top + 30); ctx.lineTo(s * (rw / 2 - 14), top + 28);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.roundRect(-rw / 2 - 4, top - 24, rw + 8, 54, 17); ctx.fill();
  const rg = ctx.createLinearGradient(0, top - 20, 0, top + 26);
  rg.addColorStop(0, hi); rg.addColorStop(1, mid);
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.roundRect(-rw / 2, top - 20, rw, 46, 14); ctx.fill();
  bubbleText(title, 0, top + 3, 24, ["#ffffff", "#fff0fa"], { rim: lo, maxW: rw - 24 });
}

/** A small glossy gem tile: the game's own motif, used for map stepping-stones and level markers. */
export function gem(x: number, y: number, s: number, hex: string): void {
  block(x - s / 2, y - s / 2, s, hex);
}
