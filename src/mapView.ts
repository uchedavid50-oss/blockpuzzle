// The journey map screen: a scrolling road through themed worlds with a node per level.
// Rendering and its own touch handling only. Geometry and world data live in map.ts; starting a
// level is handed back to main.ts through `setMapHandlers`.

import { canvas, ctx, W, H, ROUND, COLORS, BRAND, reduceMotion, easeOutBack, block, mix, star, gem, pill, bubbleText, candyButton, roundButton, sheet } from "./gfx";
import { LEVEL_TABLE } from "./levelTable";
import { goalText, makeLevel } from "./journey";
import { readJourney, type JourneyData } from "./records";
import { PALETTE } from "./progress";
import { sfx } from "./sound";
import { haptic, haptics } from "./haptics";
import { LEVELS_PER_WORLD, WORLDS, decorFor, mapLength, nodeStatus, nodeX, pathX, worldIndex, worldOf, worldStart, type Decoration, type NodeStatus, type Particle } from "./map";

const GAP = 112; // pixels between consecutive levels
const FOOT = 150; // level 1 sits this far above the bottom edge when scrolled all the way down
const R = 25; // node radius
const MAP_W = 480; // the road is laid out in at most this width; the scenery fills the rest

interface Handlers { play: (n: number) => boolean; modes: () => void; resumable: () => number | null }
let handlers: Handlers = { play: () => false, modes: () => {}, resumable: () => null };
export const setMapHandlers = (h: Handlers): void => { handlers = h; };

interface Walk { from: number; to: number; t: number; dur: number; stars: number; unlocked: boolean; cardAt: number }
interface Iris { t: number; dir: 1 | -1; x: number; y: number; then?: () => void }
interface Press { x: number; y: number; cam0: number; moved: boolean; id: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string; star: boolean; rot: number }
interface Amb { x: number; y: number; vx: number; vy: number; life: number; size: number; phase: number; kind: Particle }

export const mapUi = { on: false };
let iris: Iris | null = null;
let cam = 0; // world pixels scrolled up from the bottom
let vel = 0;
let goal: number | null = null; // camera glides here when set
let press: Press | null = null;
let lastMove = { y: 0, t: 0 };
let card: number | null = null;
let cardT = 0;
let cardClosing = false;
let cardLevel: ReturnType<typeof makeLevel> | null = null;
let walk: Walk | null = null;
let j: JourneyData = { next: 1, stars: {} };
let clock = 0;
let shakes = new Map<number, number>();
let pops = new Map<number, number>();
let sparks: Spark[] = [];
let ambient: Amb[] = [];

// ---- Geometry ---------------------------------------------------------------------

const length = (): number => mapLength(j.next, LEVEL_TABLE.length);
const mapW = (): number => Math.min(W, MAP_W);
const sx = (fx: number): number => (W - mapW()) / 2 + fx * mapW();
const sy = (t: number): number => H - FOOT - ((t - 1) * GAP - cam);
const levelAt = (y: number): number => (H - FOOT - y + cam) / GAP + 1;
const camMax = (): number => Math.max(0, (length() - 1) * GAP - (H - FOOT - 190));
const camFor = (t: number): number => Math.max(0, Math.min(camMax(), (t - 1) * GAP - H * 0.42 + FOOT));
const diag = (): number => Math.hypot(W, H);

/** True once the map fully covers the screen, so the game underneath need not be drawn. */
export const mapCovers = (): boolean => mapUi.on && !iris;

// ---- Opening, closing, leaving ---------------------------------------------------------

/** Opens the map. After a cleared level, pass it in: the stars land, then the token walks on. */
export function openMap(cleared?: { level: number; stars: number }): void {
  j = readJourney();
  mapUi.on = true;
  card = null;
  press = null;
  vel = 0;
  goal = null;
  sparks = [];
  pops = new Map();
  shakes = new Map();
  walk = null;
  if (cleared && j.next === cleared.level + 1 && !reduceMotion) {
    // This win opened a new level: its stars land, then the token walks on to the next node.
    walk = { from: cleared.level, to: j.next, t: 0, dur: 0.9, stars: cleared.stars, unlocked: false, cardAt: -1 };
    cam = camFor(cleared.level);
  } else {
    cam = camFor(j.next);
    if (cleared) openCard(j.next, 0.55);
  }
  iris = { t: 0, dir: 1, x: W / 2, y: H / 2 };
}

function closeMap(then?: () => void): void {
  card = null;
  iris = { t: 1, dir: -1, x: W / 2, y: H / 2, then };
}

let cardDelay = 0;
function openCard(n: number, delay = 0): void {
  card = n;
  cardT = 0;
  cardDelay = delay;
  cardClosing = false;
  cardLevel = makeLevel(n);
}

function play(n: number): void {
  // main.ts may ask to confirm abandoning a game; only animate away once a level has really started.
  if (!handlers.play(n)) return;
  sfx.praise(1);
  haptics.pick();
  card = null;
  iris = { t: 1, dir: -1, x: sx(nodeX(n)), y: sy(n) };
}

// ---- Input -----------------------------------------------------------------------------

export function mapDown(e: PointerEvent): void {
  if (iris) return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  press = { x: e.clientX, y: e.clientY, cam0: cam, moved: false, id: e.pointerId };
  lastMove = { y: e.clientY, t: performance.now() };
  vel = 0;
  goal = null;
}

export function mapMove(e: PointerEvent): void {
  if (!press || e.pointerId !== press.id || card !== null) return;
  const dy = e.clientY - press.y;
  if (Math.abs(dy) > 8 || Math.abs(e.clientX - press.x) > 8) press.moved = true;
  if (!press.moved) return;
  const raw = press.cam0 + dy;
  // Past either end the map follows the finger with growing resistance: a rubber band.
  const over = raw < 0 ? raw : raw > camMax() ? raw - camMax() : 0;
  const prev = cam;
  cam = raw - over + over * 0.35 / (1 + Math.abs(over) / 400);
  const now = performance.now();
  const dt = Math.max(1, now - lastMove.t) / 1000;
  vel = vel * 0.25 + ((cam - prev) / dt) * 0.75;
  lastMove = { y: e.clientY, t: now };
}

export function mapUp(e: PointerEvent): void {
  if (!press || e.pointerId !== press.id) return;
  const p = press;
  press = null;
  if (p.moved) {
    if (performance.now() - lastMove.t > 90) vel = 0; // finger rested before lifting: no fling
    return;
  }
  vel = 0;
  tap(e.clientX, e.clientY);
}

export function mapCancel(): void { press = null; }

export function mapWheel(dy: number): void {
  if (iris || card !== null) return;
  goal = null;
  vel = 0;
  cam = Math.max(0, Math.min(camMax(), cam - dy));
}

const jumpBtn = (): { x: number; y: number } => ({ x: W - 44, y: H - 52 });
const modesBtn = (): { x: number; y: number; w: number; h: number } => ({ x: W - 98, y: 22, w: 82, h: 34 });

function tap(x: number, y: number): void {
  if (card !== null) { cardTap(x, y); return; }
  if (Math.hypot(x - 36, y - 39) <= 24) { haptics.tick(); closeMap(); return; }
  const m = modesBtn();
  if (x >= m.x && x <= m.x + m.w && y >= m.y - 6 && y <= m.y + m.h + 6) { haptics.tick(); closeMap(handlers.modes); return; }
  const jb = jumpBtn();
  if (!nextOnScreen() && Math.hypot(x - jb.x, y - jb.y) <= 28) { haptics.tick(); goal = camFor(j.next); return; }
  const lo = Math.max(1, Math.floor(levelAt(y + R * 2)));
  const hi = Math.min(length(), Math.ceil(levelAt(y - R * 2)));
  for (let n = lo; n <= hi; n++) {
    if (Math.hypot(x - sx(nodeX(n)), y - sy(n)) > R + 12) continue;
    if (status(n) === "locked") {
      shakes.set(n, 1);
      sfx.invalid();
      haptics.invalid();
    } else {
      sfx.pick();
      haptics.tick();
      openCard(n);
    }
    return;
  }
}

const CARD_W = (): number => Math.min(W - 40, 330);
const CARD_H = 350;
const playRect = { x: -105, y: 92, w: 210, h: 58 };

function cardTap(x: number, y: number): void {
  if (card === null || cardT < 0.4) return;
  const lx = x - W / 2;
  const ly = y - H / 2;
  const cw = CARD_W();
  if (lx >= playRect.x && lx <= playRect.x + playRect.w && ly >= playRect.y && ly <= playRect.y + playRect.h) { play(card); return; }
  const onClose = Math.hypot(lx - (cw / 2 - 26), ly - (-CARD_H / 2 + 26)) <= 22;
  const outside = Math.abs(lx) > cw / 2 || Math.abs(ly) > CARD_H / 2;
  if (onClose || outside) { cardClosing = true; haptics.tick(); }
}

// ---- State helpers ------------------------------------------------------------------------

function status(n: number): NodeStatus {
  // Mid-walk, the level being walked to stays locked until the token arrives.
  if (walk && n === walk.to && !walk.unlocked) return "locked";
  if (walk && n === walk.from && !walk.unlocked) return "current";
  return nodeStatus(n, j);
}

const nextOnScreen = (): boolean => { const y = sy(walk && !walk.unlocked ? walk.from : j.next); return y > 70 && y < H - 20; };

/** Where the player's token stands, in levels: on the current node, or partway along the road. */
function tokenT(): number {
  if (!walk) return j.next;
  const k = Math.max(0, Math.min(1, (walk.t - 0.95) / walk.dur));
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  return walk.from + (walk.to - walk.from) * e;
}

function burst(x: number, y: number, n: number, colors: string[], power = 1): void {
  if (reduceMotion) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (90 + Math.random() * 230) * power;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120 * power, life: 1, size: 3 + Math.random() * 4, color: colors[i % colors.length]!, star: i % 3 !== 0, rot: Math.random() * 6 });
  }
}

// ---- Update -----------------------------------------------------------------------------

function update(dt: number): void {
  clock += dt;
  if (iris) {
    iris.t += iris.dir * dt * 1.9;
    if (iris.dir === 1 && iris.t >= 1) iris = null;
    else if (iris.dir === -1 && iris.t <= 0) {
      const then = iris.then;
      iris = null;
      mapUi.on = false;
      then?.();
      return;
    }
  }

  if (walk) {
    const before = walk.t;
    walk.t += dt;
    // The level's stars land one by one on its node, then the token sets off.
    for (let i = 0; i < walk.stars; i++) {
      const at = 0.2 + i * 0.2;
      if (before < at && walk.t >= at) {
        const x = sx(nodeX(walk.from)) + (i - 1) * 17;
        burst(x, sy(walk.from) - R - 10, 8, ["#ffd75e", "#fff3c4", "#ffbf3a"], 0.6);
        sfx.tick(i * 3);
        haptic(10);
      }
    }
    goal = camFor(tokenT());
    if (!walk.unlocked && walk.t >= 0.95 + walk.dur) {
      walk.unlocked = true;
      pops.set(walk.to, 0);
      const w = worldOf(walk.to);
      burst(sx(nodeX(walk.to)), sy(walk.to), 26, [w.accent, "#ffffff", "#ffd75e", ...PALETTE.slice(0, 3)], 1);
      sfx.praise(3);
      haptic([20, 30, 40]);
      walk.cardAt = walk.t + 0.55;
    }
    if (walk.unlocked && walk.t >= walk.cardAt && card === null) {
      const to = walk.to;
      walk = null;
      goal = null;
      openCard(to);
    }
  }

  if (!press) {
    if (goal !== null) {
      cam += (goal - cam) * Math.min(1, dt * 5);
      if (Math.abs(goal - cam) < 0.5 && !walk) goal = null;
    } else {
      cam += vel * dt;
      vel *= Math.exp(-dt * 3.4);
      if (Math.abs(vel) < 4) vel = 0;
      // Spring back from an overscroll.
      const bound = cam < 0 ? 0 : cam > camMax() ? camMax() : null;
      if (bound !== null) {
        cam += (bound - cam) * Math.min(1, dt * 12);
        vel *= Math.exp(-dt * 18);
      }
    }
  }

  for (const [n, s] of shakes) { const v = s - dt * 2.4; if (v <= 0) shakes.delete(n); else shakes.set(n, v); }
  for (const [n, p] of pops) { const v = p + dt * 1.8; if (v >= 1) pops.delete(n); else pops.set(n, v); }
  for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 520 * dt; s.life -= dt * 1.1; s.rot += dt * 5; }
  sparks = sparks.filter((s) => s.life > 0);

  if (card !== null) {
    if (cardDelay > 0) cardDelay -= dt;
    else cardT = cardClosing ? cardT - dt * 4.5 : Math.min(1, cardT + dt * 3.2);
    if (cardClosing && cardT <= 0) { card = null; cardClosing = false; }
  }
  updateAmbient(dt);
}

let lastCam = 0;
let camStep = 0;
function updateAmbient(dt: number): void {
  camStep = cam - lastCam;
  lastCam = cam;
  const kind = worldOf(Math.max(1, Math.round(levelAt(H / 2)))).particle;
  if (!reduceMotion && ambient.length < 34 && Math.random() < dt * 14) {
    const falls = kind === "petal" || kind === "snow";
    const rises = kind === "bubble" || kind === "ember";
    ambient.push({
      x: Math.random() * W,
      y: falls ? -10 : rises ? H + 10 : Math.random() * H,
      vx: kind === "dust" ? 25 + Math.random() * 30 : (Math.random() - 0.5) * 18,
      vy: falls ? 22 + Math.random() * 30 : rises ? -(20 + Math.random() * 35) : (Math.random() - 0.5) * 10,
      life: 0, size: kind === "bubble" ? 3 + Math.random() * 5 : 1.5 + Math.random() * 2.5,
      phase: Math.random() * Math.PI * 2, kind,
    });
  }
  for (const a of ambient) {
    a.life += dt / (a.kind === "sparkle" || a.kind === "star" || a.kind === "firefly" ? 2.4 : 7);
    a.x += (a.vx + Math.sin(clock * 1.6 + a.phase) * 14) * dt;
    a.y += a.vy * dt + camStep * 0.6; // drift with the scroll, a little slower than the land
  }
  ambient = ambient.filter((a) => a.life < 1 && a.y > -20 && a.y < H + 20 && a.x > -20 && a.x < W + 20);
}

// ---- Drawing: landscape ----------------------------------------------------------------------

/** A small stable hash in [0, 1) for scenery that does not need a full seeded stream. */
const h01 = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function drawGround(lo: number, hi: number): void {
  const w0 = worldIndex(Math.max(1, Math.floor(lo)));
  const w1 = worldIndex(Math.max(1, Math.ceil(hi)));
  for (let w = w0; w <= w1; w++) {
    const world = WORLDS[w % WORLDS.length]!;
    const bottom = w === 0 ? H + 400 : sy(worldStart(w) - 0.5);
    const top = sy(worldStart(w + 1) - 0.5);
    const g = ctx.createLinearGradient(0, bottom, 0, top);
    g.addColorStop(0, world.ground[0]);
    g.addColorStop(1, world.ground[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.max(-1, top), W, Math.min(H + 1, bottom) - Math.max(-1, top));
    if (w > 0) {
      // Melt the border between two worlds over most of a level's height.
      const prev = WORLDS[(w - 1) % WORLDS.length]!;
      const b = sy(worldStart(w) - 0.5);
      const m = ctx.createLinearGradient(0, b + GAP * 0.7, 0, b - GAP * 0.7);
      m.addColorStop(0, prev.ground[1]);
      m.addColorStop(1, world.ground[0]);
      ctx.fillStyle = m;
      ctx.fillRect(0, b - GAP * 0.7, W, GAP * 1.4);
    }
  }

  // Soft blotches and, in the night worlds, twinkling stars.
  for (let n = Math.floor(lo) - 1; n <= Math.ceil(hi); n++) {
    if (n < -2) continue;
    const world = worldOf(Math.max(1, n));
    for (let i = 0; i < 3; i++) {
      const x = h01(n, i) * W;
      const y = sy(n + h01(i, n));
      const r = 30 + h01(n + 7, i) * 60;
      ctx.globalAlpha = world.night ? 0.22 : 0.3;
      ctx.fillStyle = world.patch;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.4, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (world.night)
      for (let i = 0; i < 7; i++) {
        const x = h01(n * 3 + i, 9) * W;
        const y = sy(n + h01(i * 5, n));
        ctx.globalAlpha = 0.35 + 0.45 * Math.sin(clock * (1.2 + h01(i, n)) + i * 2 + n);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + h01(n, i * 3) * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  ctx.globalAlpha = 1;
}

/** Slow clouds drifting across, moving at half the scroll speed so the land seems to have depth. */
function drawClouds(): void {
  const night = worldOf(Math.max(1, Math.round(levelAt(H / 2)))).night;
  for (let i = 0; i < 6; i++) {
    const span = H + 260;
    const y = ((i * 337 + cam * 0.5) % span + span) % span - 130;
    const x = ((i * 211 + clock * (8 + i * 3)) % (W + 300)) - 150;
    const s = 0.8 + (i % 3) * 0.35;
    ctx.globalAlpha = night ? 0.06 : 0.42;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(x, y, 60 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 26 * s, y - 8 * s, 30 * s, 20 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 20 * s, y - 14 * s, 34 * s, 24 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function shadow(x: number, y: number, w: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(x, y, w, w * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawDeco(d: Decoration, world: (typeof WORLDS)[number], side = false): void {
  // `side` scenery fills the margins either side of the road on screens wider than the map.
  const margin = (W - mapW()) / 2;
  const x = !side ? sx(d.x) : d.x < 0.5 ? (d.x / 0.5) * margin : W - margin + ((d.x - 0.5) / 0.5) * margin;
  const y = sy(d.y);
  if (y < -80 || y > H + 40) return;
  const s = 28 * d.scale;
  const sway = reduceMotion ? 0 : Math.sin(clock * 1.3 + d.phase) * 0.045;
  shadow(x, y, s * 0.55);
  ctx.save();
  ctx.translate(x, y);
  if (d.flip) ctx.scale(-1, 1);
  const snowy = world.particle === "snow";
  switch (d.kind) {
    case "tree": {
      ctx.rotate(sway);
      ctx.fillStyle = "#8a5a33";
      ctx.beginPath(); ctx.roundRect(-s * 0.09, -s * 0.7, s * 0.18, s * 0.7, 3); ctx.fill();
      const g = ctx.createRadialGradient(-s * 0.15, -s * 1.15, 2, 0, -s, s * 0.75);
      g.addColorStop(0, "#9be36f"); g.addColorStop(1, "#2f8f3e");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -s * 1.05, s * 0.48, 0, Math.PI * 2);
      ctx.arc(-s * 0.32, -s * 0.8, s * 0.36, 0, Math.PI * 2);
      ctx.arc(s * 0.32, -s * 0.8, s * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff5a6e";
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc((i - 1) * s * 0.28, -s * (0.85 + (i % 2) * 0.3), s * 0.06, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case "flower": {
      ctx.rotate(sway * 2);
      ctx.strokeStyle = "#3d9a48"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.1, -s * 0.3, 0, -s * 0.55); ctx.stroke();
      const c = ["#ff6f91", "#ffd75e", "#c3a6ff", "#ffffff"][Math.floor(d.phase) % 4]!;
      ctx.fillStyle = c;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + clock * 0.3;
        ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.13, -s * 0.58 + Math.sin(a) * s * 0.13, s * 0.1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#ffbf3a";
      ctx.beginPath(); ctx.arc(0, -s * 0.58, s * 0.07, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "palm": {
      ctx.rotate(sway);
      ctx.strokeStyle = "#a8743f"; ctx.lineWidth = s * 0.14; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.25, -s * 0.6, s * 0.1, -s * 1.25); ctx.stroke();
      ctx.fillStyle = "#2fae5a";
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.translate(s * 0.1, -s * 1.25);
        ctx.rotate(-Math.PI / 2 + (i - 2) * 0.62 + Math.sin(clock * 2 + d.phase + i) * 0.05);
        ctx.beginPath(); ctx.ellipse(s * 0.38, 0, s * 0.42, s * 0.11, 0.25, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = "#7a4b25";
      ctx.beginPath(); ctx.arc(s * 0.04, -s * 1.17, s * 0.08, 0, Math.PI * 2); ctx.arc(s * 0.18, -s * 1.15, s * 0.08, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "shell": {
      const g = ctx.createLinearGradient(0, -s * 0.5, 0, 0);
      g.addColorStop(0, "#ffd1dc"); g.addColorStop(1, "#ff8fab");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-s * 0.35, 0); ctx.arc(0, 0, s * 0.35, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(160,60,90,0.4)"; ctx.lineWidth = 1.5;
      for (let i = 1; i < 5; i++) { const a = Math.PI + (i / 5) * Math.PI; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * s * 0.35, Math.sin(a) * s * 0.35); ctx.stroke(); }
      break;
    }
    case "cactus": {
      ctx.fillStyle = "#3ea55b";
      ctx.beginPath();
      ctx.roundRect(-s * 0.13, -s * 1.0, s * 0.26, s, s * 0.13);
      ctx.roundRect(-s * 0.42, -s * 0.72, s * 0.18, s * 0.38, s * 0.09);
      ctx.roundRect(s * 0.24, -s * 0.85, s * 0.18, s * 0.42, s * 0.09);
      ctx.roundRect(-s * 0.4, -s * 0.42, s * 0.3, s * 0.13, s * 0.06);
      ctx.roundRect(s * 0.1, -s * 0.52, s * 0.3, s * 0.13, s * 0.06);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(-s * 0.06, -s * 0.92, s * 0.04, s * 0.8);
      ctx.fillStyle = "#ff6f91";
      ctx.beginPath(); ctx.arc(0, -s * 1.02, s * 0.08, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "rock": {
      const base = world.night ? "#5b5873" : "#9aa0ad";
      ctx.fillStyle = mix(base, 0, 0.25);
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, 0); ctx.lineTo(-s * 0.38, -s * 0.36); ctx.lineTo(-s * 0.05, -s * 0.5); ctx.lineTo(s * 0.32, -s * 0.38); ctx.lineTo(s * 0.5, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.moveTo(-s * 0.38, -s * 0.36); ctx.lineTo(-s * 0.05, -s * 0.5); ctx.lineTo(s * 0.32, -s * 0.38); ctx.lineTo(s * 0.05, -s * 0.2); ctx.closePath(); ctx.fill();
      if (snowy) { ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.38); ctx.lineTo(-s * 0.05, -s * 0.5); ctx.lineTo(s * 0.25, -s * 0.4); ctx.lineTo(-s * 0.05, -s * 0.34); ctx.closePath(); ctx.fill(); }
      break;
    }
    case "pine": {
      ctx.rotate(sway * 0.6);
      ctx.fillStyle = "#6b4426";
      ctx.fillRect(-s * 0.07, -s * 0.25, s * 0.14, s * 0.25);
      for (let i = 0; i < 3; i++) {
        const w = s * (0.55 - i * 0.12);
        const y0 = -s * (0.2 + i * 0.36);
        ctx.fillStyle = world.night && !snowy ? "#1f5a4a" : "#2c7a4b";
        ctx.beginPath(); ctx.moveTo(-w, y0); ctx.lineTo(0, y0 - s * 0.55); ctx.lineTo(w, y0); ctx.closePath(); ctx.fill();
        if (snowy) {
          ctx.fillStyle = "#f4fbff";
          ctx.beginPath(); ctx.moveTo(-w * 0.45, y0 - s * 0.3); ctx.lineTo(0, y0 - s * 0.55); ctx.lineTo(w * 0.45, y0 - s * 0.3); ctx.quadraticCurveTo(0, y0 - s * 0.22, -w * 0.45, y0 - s * 0.3); ctx.fill();
        }
      }
      break;
    }
    case "mushroom": {
      ctx.rotate(sway);
      const glow = 0.55 + 0.45 * Math.sin(clock * 2 + d.phase);
      ctx.fillStyle = "#efe2c8";
      ctx.beginPath(); ctx.roundRect(-s * 0.1, -s * 0.45, s * 0.2, s * 0.45, s * 0.08); ctx.fill();
      ctx.save();
      ctx.shadowColor = "#c77dff"; ctx.shadowBlur = reduceMotion ? 8 : 18 * glow;
      ctx.fillStyle = d.phase > Math.PI ? "#c45bff" : "#ff5a8a";
      ctx.beginPath(); ctx.ellipse(0, -s * 0.45, s * 0.42, s * 0.3, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const [dx, dy, r] of [[-0.2, -0.55, 0.06], [0.08, -0.65, 0.07], [0.24, -0.52, 0.05]] as const) { ctx.beginPath(); ctx.arc(dx * s, dy * s, r * s, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case "crystal": {
      const glow = 0.5 + 0.5 * Math.sin(clock * 1.7 + d.phase);
      ctx.save();
      ctx.shadowColor = world.accent; ctx.shadowBlur = reduceMotion ? 8 : 10 + 14 * glow;
      for (const [dx, h, w, tilt] of [[-0.22, 0.65, 0.16, -0.25], [0.2, 0.55, 0.15, 0.3], [0, 1.0, 0.2, 0]] as const) {
        ctx.save();
        ctx.translate(dx * s, 0);
        ctx.rotate(tilt);
        const g = ctx.createLinearGradient(-w * s, 0, w * s, 0);
        g.addColorStop(0, mix(world.accent, 255, 0.55)); g.addColorStop(0.5, world.accent); g.addColorStop(1, mix(world.accent, 0, 0.35));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(-w * s, 0); ctx.lineTo(-w * s, -h * s * 0.75); ctx.lineTo(0, -h * s); ctx.lineTo(w * s, -h * s * 0.75); ctx.lineTo(w * s, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      break;
    }
    case "puff": {
      const bob = reduceMotion ? 0 : Math.sin(clock * 1.2 + d.phase) * 3;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(-s * 0.3, -s * 0.3 + bob, s * 0.28, 0, Math.PI * 2);
      ctx.arc(0, -s * 0.45 + bob, s * 0.36, 0, Math.PI * 2);
      ctx.arc(s * 0.32, -s * 0.3 + bob, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(200,180,255,0.35)";
      ctx.beginPath(); ctx.ellipse(0, -s * 0.12 + bob, s * 0.55, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// ---- Drawing: the road and its nodes ------------------------------------------------------

function drawRoad(lo: number, hi: number): void {
  const a = Math.max(0.55, lo - 0.5);
  const b = Math.min(length() + 0.45, hi + 0.5);
  if (b <= a) return;
  const pts: [number, number][] = [];
  for (let t = a; t <= b + 0.001; t += 0.05) pts.push([sx(pathX(t)), sy(t)]);
  const stroke = (color: string, width: number, dy = 0): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy)));
    ctx.stroke();
  };
  stroke("rgba(0,0,0,0.2)", 34, 6);
  stroke(mix(worldOf(Math.max(1, Math.round((lo + hi) / 2))).road, 0, 0.28), 32);
  // The road surface takes each world's colour.
  for (let t = Math.floor(a); t < b; t++) {
    const from = Math.max(a, t);
    const to = Math.min(b, t + 1);
    ctx.strokeStyle = worldOf(Math.max(1, t)).road;
    ctx.lineWidth = 24;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let u = from; u <= to + 0.001; u += 0.05) (u === from ? ctx.moveTo(sx(pathX(u)), sy(u)) : ctx.lineTo(sx(pathX(u)), sy(u)));
    ctx.stroke();
  }
  // Gem stepping-stones along the middle: lit in the game's colours where you've already been.
  const reached = tokenT();
  for (let t = Math.ceil(a * 4) / 4; t <= b; t += 0.25) {
    if (Math.abs(t - Math.round(t)) < 0.3) continue; // nodes sit on the whole numbers
    const x = sx(pathX(t));
    const y = sy(t);
    if (t < reached) {
      const bob = reduceMotion ? 0 : Math.sin(clock * 3 + t * 4) * 1.2;
      gem(x, y + bob, 11, PALETTE[Math.round(t * 4) % PALETTE.length]!);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.strokeStyle = "rgba(90,40,140,0.18)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - 4.5, y - 4.5, 9, 9, 3); ctx.fill(); ctx.stroke();
    }
  }
}

function drawBanner(w: number): void {
  const n = worldStart(w);
  const y = sy(n - 0.4); // nearer the new world's first node, clear of the crown below
  if (y < -40 || y > H + 40) return;
  const world = WORLDS[w % WORLDS.length]!;
  const locked = n > j.next && !(walk && n === walk.to);
  const x = W / 2;
  const bw = 210;
  const sway = reduceMotion ? 0 : Math.sin(clock * 1.4 + w) * 0.015;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sway);
  // Folded ribbon tails.
  ctx.fillStyle = mix(world.accent, 0, 0.45);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * (bw / 2 - 8), -8); ctx.lineTo(s * (bw / 2 + 22), -6); ctx.lineTo(s * (bw / 2 + 12), 8); ctx.lineTo(s * (bw / 2 + 22), 22); ctx.lineTo(s * (bw / 2 - 8), 20);
    ctx.closePath(); ctx.fill();
  }
  const g = ctx.createLinearGradient(0, -20, 0, 20);
  g.addColorStop(0, mix(world.accent, 255, 0.2));
  g.addColorStop(1, mix(world.accent, 0, 0.15));
  ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  ctx.fillStyle = locked ? "#6b7183" : g;
  ctx.beginPath(); ctx.roundRect(-bw / 2, -20, bw, 40, 12); ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `800 9px ${ROUND}`;
  ctx.fillText(`WORLD ${w + 1}${locked ? " · \u{1F512}" : ""}`, 0, -8);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 15px ${ROUND}`;
  ctx.fillText(world.name, 0, 8, bw - 24);
  ctx.restore();
}

function drawNode(n: number): void {
  const st = status(n);
  const world = worldOf(n);
  const shake = shakes.get(n) ?? 0;
  const pop = pops.get(n);
  const x = sx(nodeX(n)) + (shake > 0 ? Math.sin(shake * 40) * 7 * shake : 0);
  const y = sy(n);
  if (y < -60 || y > H + 60) return;
  const gate = n % LEVELS_PER_WORLD === 0; // the last level of a world is a bigger landmark
  let r = R * (st === "current" ? 1.15 : 1) * (gate ? 1.12 : 1);
  if (pop !== undefined) r *= reduceMotion ? 1 : 0.5 + 0.5 * easeOutBack(Math.min(1, pop * 1.6));

  if (st === "current" && !reduceMotion) {
    // Ripples spreading from the level you are on.
    for (let i = 0; i < 2; i++) {
      const k = (clock * 0.8 + i * 0.5) % 1;
      ctx.strokeStyle = world.accent;
      ctx.globalAlpha = (1 - k) * 0.6;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.ellipse(x, y + 4, r + k * 26, (r + k * 26) * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Each level is a big glossy gem block in a white frame, like a piece waiting to be placed.
  const base = st === "locked" ? "#aaa0c4" : world.accent;
  const rr = r * 0.42;
  shadow(x, y + r * 0.95, r * 0.95);
  ctx.fillStyle = gate && st !== "locked" ? "#ffd23f" : "#ffffff";
  ctx.beginPath(); ctx.roundRect(x - r - 3.5, y - r - 3.5, r * 2 + 7, r * 2 + 12, rr + 3); ctx.fill();
  ctx.fillStyle = mix(base, 0, 0.42); // the block's thickness
  ctx.beginPath(); ctx.roundRect(x - r, y - r + 5, r * 2, r * 2, rr); ctx.fill();
  const g = ctx.createLinearGradient(0, y - r, 0, y + r);
  g.addColorStop(0, mix(base, 255, 0.45));
  g.addColorStop(0.55, base);
  g.addColorStop(1, mix(base, 0, 0.12));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(x - r, y - r, r * 2, r * 2 - 1, rr); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath(); ctx.roundRect(x - r * 0.72, y - r * 0.84, r * 1.44, r * 0.5, r * 0.25); ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${n >= 100 ? 16 : 19}px ${ROUND}`;
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = mix(base, 0, 0.5);
  ctx.strokeText(String(n), x, y + 1);
  ctx.fillStyle = st === "locked" ? "#f1ecf8" : "#ffffff";
  ctx.fillText(String(n), x, y + 1);

  if (gate) {
    // A little crown marks the end of a world.
    ctx.fillStyle = st === "locked" ? "#b9bfcc" : "#ffd75e";
    const cy = y - r - 6;
    ctx.beginPath();
    ctx.moveTo(x - 11, cy + 5); ctx.lineTo(x - 12, cy - 6); ctx.lineTo(x - 5, cy - 1); ctx.lineTo(x, cy - 9); ctx.lineTo(x + 5, cy - 1); ctx.lineTo(x + 12, cy - 6); ctx.lineTo(x + 11, cy + 5);
    ctx.closePath(); ctx.fill();
  }

  // Stars earned, in a little arc over the node (below it on a gate, where the crown is).
  if (st === "cleared" || (walk && n === walk.from)) {
    const earned = j.stars[n] ?? 0;
    for (let i = 0; i < 3; i++) {
      let k = 1;
      if (walk && n === walk.from) k = Math.max(0, Math.min(1, (walk.t - 0.2 - i * 0.2) / 0.35));
      const on = i < earned;
      const sxp = x + (i - 1) * 17;
      const syp = gate ? y + r + 13 - (i === 1 ? -3 : 0) : y - r - 9 - (i === 1 ? 4 : 0);
      const sc = on && walk && n === walk.from && i < walk.stars ? easeOutBack(k) : 1;
      if (sc <= 0.01) continue;
      star(sxp, syp, 8 * sc);
      ctx.fillStyle = on ? "#ffd23f" : "rgba(0,0,0,0.28)";
      ctx.fill();
      ctx.strokeStyle = on ? "#b8860b" : "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

/** The player's piece: a glossy block in a white pin, hopping along as it travels. */
function drawToken(): void {
  const t = tokenT();
  const x = sx(pathX(t));
  const y = sy(t);
  const travelling = walk !== null && t > walk.from && t < walk.to;
  const hop = reduceMotion ? 0 : travelling ? Math.abs(Math.sin((t - (walk?.from ?? 0)) * Math.PI * 2)) * 16 : Math.abs(Math.sin(clock * 2.6)) * 7;
  const lift = R * 1.15 + 30 + hop;
  ctx.save();
  ctx.translate(x + 18, y - lift);
  const squash = reduceMotion ? 1 : 1 + Math.sin(clock * 5.2) * 0.03;
  ctx.scale(1 / squash, squash);
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 0, 21, Math.PI * 0.78, Math.PI * 2.22);
  ctx.lineTo(0, 30);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = "transparent";
  block(-14, -15, 28, PALETTE[0]!);
  ctx.restore();
}

// ---- Drawing: chrome ------------------------------------------------------------------------

function drawHeader(): void {
  const g = ctx.createLinearGradient(0, 0, 0, 104);
  g.addColorStop(0, "rgba(90,34,200,0.5)");
  g.addColorStop(1, "rgba(90,34,200,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 104);

  roundButton(36, 39, 19, "", "violet");
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(40, 31); ctx.lineTo(32, 39); ctx.lineTo(40, 47); ctx.stroke();
  pill(modesBtn(), "Modes", false);

  const total = Object.values(j.stars).reduce((a, b) => a + b, 0);
  const world = worldOf(Math.max(1, Math.min(length(), Math.round(levelAt(H / 2)))));
  bubbleText(world.name, W / 2, 32, 20, ["#ffffff", "#f3e9ff"], { maxW: W - 230 });
  const line = `\u2605 ${total}  \u00B7  Level ${j.next}`;
  ctx.font = `900 13px ${ROUND}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = BRAND.deep;
  ctx.strokeText(line, W / 2, 57);
  ctx.fillStyle = "#ffe27a";
  ctx.fillText(line, W / 2, 57);
}

function drawJump(): void {
  if (nextOnScreen()) return;
  const { x, y } = jumpBtn();
  const up = sy(j.next) < 70;
  const b = reduceMotion ? 0 : Math.sin(clock * 4) * 3;
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(x, y + b, 24, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = "transparent";
  block(x - 11, y - 13 + b, 22, PALETTE[0]!);
  ctx.fillStyle = BRAND.deep;
  ctx.beginPath();
  const ay = y + b + (up ? -30 : 30);
  ctx.moveTo(x - 7, ay + (up ? 5 : -5)); ctx.lineTo(x, ay + (up ? -3 : 3)); ctx.lineTo(x + 7, ay + (up ? 5 : -5));
  ctx.closePath(); ctx.fill();
}

function drawAmbient(): void {
  for (const a of ambient) {
    const fade = Math.min(1, a.life * 6, (1 - a.life) * 4);
    switch (a.kind) {
      case "petal":
        ctx.globalAlpha = fade * 0.85; ctx.fillStyle = a.phase > 3 ? "#ffc2d4" : "#ffffff";
        ctx.beginPath(); ctx.ellipse(a.x, a.y, a.size * 1.6, a.size * 0.8, clock * 2 + a.phase, 0, Math.PI * 2); ctx.fill(); break;
      case "bubble":
        ctx.globalAlpha = fade * 0.6; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2); ctx.stroke(); break;
      case "dust":
        ctx.globalAlpha = fade * 0.45; ctx.fillStyle = "#fff1d0";
        ctx.beginPath(); ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2); ctx.fill(); break;
      case "snow":
        ctx.globalAlpha = fade * 0.9; ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2); ctx.fill(); break;
      case "firefly":
      case "ember": {
        const c = a.kind === "firefly" ? "#fff38a" : "#ff8a3d";
        ctx.globalAlpha = fade * (0.5 + 0.5 * Math.sin(clock * 6 + a.phase));
        const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.size * 4);
        g.addColorStop(0, c); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.size * 4, 0, Math.PI * 2); ctx.fill();
        break;
      }
      default: {
        // sparkle / star: a four-pointed twinkle that swells and fades
        const s = a.size * 2.4 * Math.sin(a.life * Math.PI);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = a.kind === "star" ? "#ffe27a" : "#ffffff";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y - s); ctx.quadraticCurveTo(a.x, a.y, a.x + s, a.y); ctx.quadraticCurveTo(a.x, a.y, a.x, a.y + s);
        ctx.quadraticCurveTo(a.x, a.y, a.x - s, a.y); ctx.quadraticCurveTo(a.x, a.y, a.x, a.y - s);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawSparks(): void {
  for (const s of sparks) {
    ctx.globalAlpha = Math.max(0, Math.min(1, s.life * 1.5));
    ctx.fillStyle = s.color;
    if (s.star) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      star(0, 0, s.size * (0.5 + 0.5 * s.life)); ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 0.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawCard(): void {
  if (card === null || cardDelay > 0 || !cardLevel) return;
  const n = card;
  const e = cardClosing ? cardT : Math.max(0, cardT);
  const world = worldOf(n);
  const earned = j.stars[n] ?? 0;
  const cw = CARD_W();
  ctx.fillStyle = `rgba(48,14,80,${0.55 * Math.min(1, e * 1.4)})`;
  ctx.fillRect(0, 0, W, H);
  const sc = reduceMotion ? 1 : cardClosing ? 0.85 + 0.15 * e : easeOutBack(Math.min(1, e));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(sc, sc);
  ctx.globalAlpha = Math.min(1, e * 2);

  sheet(cw, CARD_H, `Level ${n}`);
  roundButton(cw / 2 - 26, -CARD_H / 2 + 26, 14, "\u2715", "pink");
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `900 11px ${ROUND}`;
  ctx.fillText(`WORLD ${worldIndex(n) + 1} · ${world.name.toUpperCase()}`, 0, -CARD_H / 2 + 54, cw - 40);

  // Stars: each pops in a moment after the last.
  for (let i = 0; i < 3; i++) {
    const k = reduceMotion ? 1 : Math.max(0, Math.min(1, (cardT - 0.25 - i * 0.12) / 0.35));
    const big = i === 1 ? 30 : 24;
    const yy = -62 + (i === 1 ? -10 : 0);
    if (k <= 0) continue;
    ctx.save();
    ctx.translate((i - 1) * 64, yy);
    ctx.rotate((i - 1) * 0.18);
    ctx.scale(easeOutBack(k), easeOutBack(k));
    star(0, 0, big);
    const on = i < earned;
    const sg = ctx.createLinearGradient(0, -big, 0, big);
    sg.addColorStop(0, on ? "#fff3a0" : "#efe4fb"); sg.addColorStop(1, on ? "#ffb300" : "#d2c0ea");
    ctx.fillStyle = sg; ctx.fill();
    ctx.strokeStyle = on ? "#c77800" : "#b49cd6"; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
  }

  // Goal
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.roundRect(-cw / 2 + 24, -6, cw - 48, 74, 18); ctx.fill();
  ctx.strokeStyle = "rgba(138,77,255,0.2)"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = COLORS.dim;
  ctx.font = `900 11px ${ROUND}`;
  ctx.fillText("GOAL", 0, 12);
  ctx.fillStyle = COLORS.text;
  ctx.font = `900 20px ${ROUND}`;
  ctx.fillText(goalText(cardLevel), 0, 40, cw - 70);

  // Play button: a candy pill that breathes.
  const resume = handlers.resumable() === n;
  const breathe = reduceMotion ? 1 : 1 + Math.sin(clock * 4) * 0.025;
  ctx.save();
  ctx.translate(0, playRect.y + playRect.h / 2);
  ctx.scale(breathe, breathe);
  candyButton(0, 0, playRect.w, playRect.h, resume ? "Resume" : earned > 0 ? "Replay" : "Play!", "green", 0, 23);
  ctx.restore();

  if (earned > 0 && earned < 3) {
    ctx.fillStyle = "#9a8c78";
    ctx.font = `600 12px ${ROUND}`;
    ctx.fillText(`Finish in fewer moves for ${earned + 1} ★`, 0, CARD_H / 2 - 18, cw - 40);
  }
  ctx.restore();
}

// ---- Frame ------------------------------------------------------------------------------------

export function drawMap(dt: number): void {
  if (!mapUi.on) return;
  update(dt);
  if (!mapUi.on) return;

  const lo = levelAt(H + 60);
  const hi = levelAt(-60);
  ctx.save();
  if (iris) {
    // Iris wipe: the map opens out of (or closes into) a circle, with a soft white rim.
    const k = iris.t;
    const e = iris.dir === 1 ? 1 - Math.pow(1 - k, 3) : k * k * (3 - 2 * k);
    const r = Math.max(0.5, diag() * e);
    ctx.beginPath(); ctx.arc(iris.x, iris.y, r, 0, Math.PI * 2);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 6 * (1 - e) + 1; ctx.stroke();
    ctx.restore();
    ctx.clip();
    if (iris.dir === -1 && !reduceMotion) {
      // Leaving: the map dives toward the point it closes on.
      const z = 1 + (1 - e) * 0.5;
      ctx.translate(iris.x, iris.y); ctx.scale(z, z); ctx.translate(-iris.x, -iris.y);
    }
  }

  drawGround(lo, hi);
  drawClouds();
  const decos: { d: Decoration; n: number; side: boolean }[] = [];
  const wide = W - mapW() > 140;
  for (let n = Math.max(0, Math.floor(lo) - 1); n <= Math.min(length() + 2, Math.ceil(hi)); n++) {
    for (const d of decorFor(Math.max(1, n))) decos.push({ d: n === 0 ? { ...d, y: d.y - 1 } : d, n, side: false });
    if (wide) for (const d of decorFor(Math.max(1, n) + 1050)) decos.push({ d: { ...d, y: d.y - 1050 - (n === 0 ? 1 : 0) }, n, side: true });
  }
  decos.sort((a, b) => b.d.y - a.d.y); // further up the screen first, so nearer things overlap them
  drawRoad(lo, hi);
  for (const { d, n, side } of decos) drawDeco(d, worldOf(Math.max(1, n)), side);
  for (let w = Math.max(1, worldIndex(Math.max(1, Math.floor(lo)))); w <= worldIndex(Math.max(1, Math.ceil(hi))) + 1; w++)
    if (worldStart(w) <= length()) drawBanner(w);
  for (let n = Math.max(1, Math.floor(lo)); n <= Math.min(length(), Math.ceil(hi)); n++) drawNode(n);
  const endY = sy(length() + 0.75);
  if (endY > -40) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `800 14px ${ROUND}`;
    ctx.textAlign = "center";
    ctx.fillText("More worlds coming soon", W / 2, endY);
  }
  drawToken();
  drawSparks();
  drawAmbient();
  drawHeader();
  drawJump();
  drawCard();
  ctx.restore();
}
