// The journey map screen: a scrolling road through themed worlds with a node per level.
// Rendering and its own touch handling only. Geometry and world data live in map.ts; starting a
// level is handed back to main.ts through `setMapHandlers`.

import { canvas, ctx, W, H, ROUND, COLORS, BRAND, reduceMotion, easeOutBack, block, mix, star, gem, pill, bubbleText, candyButton, roundButton, sheet, sparkle } from "./gfx";
import { LEVEL_TABLE } from "./levelTable";
import { goalText, makeLevel } from "./journey";
import { readJourney, type JourneyData } from "./records";
import { PALETTE } from "./progress";
import { sfx } from "./sound";
import { haptic, haptics } from "./haptics";
import { drawMascot, type MascotMode } from "./mascot";
import { drawLandmark } from "./structures";
import { LEVELS_PER_WORLD, WORLDS, decorFor, landmarkFor, mapLength, nodeStatus, opensWorld, pathX, worldIndex, worldOf, worldProgress, worldStart, type Decoration, type Landmark, type NodeStatus, type Particle } from "./map";

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

// Life on the map: the opening cascade, presses, glints, flying stars, tooltips and pop-ups.
interface Popup { kind: "world" | "newWorld"; w: number; t: number; closing: boolean; then?: () => void }
let openT = 0; // seconds since the map opened; levels pop up in a wave from `focus`
let focus = 1;
let pressNode: number | null = null;
let bounces = new Map<number, number>();
let glints = new Map<number, number>();
let nextGlint = 1;
let flyers: { x: number; y: number; t: number }[] = [];
let headerPop = 0;
let headerStar = { x: 0, y: 57 };
let tip: { n: number; text: string; t: number } | null = null;
let popup: Popup | null = null;
let popupPress = false;
let hintOn = false;
const MAP_HINT_KEY = "blockpuzzle.mapHint";
let goalRate = 5; // how quickly the camera glides to `goal`
let sweep: { w: number; t: number } | null = null; // a world's name flying across the screen
let shownWorld = -1;
let streaks: { x: number; y: number; len: number; life: number; dir: number }[] = [];
let wispTrail: { x: number; y: number }[] = [];

/** How far level (or scenery at height) t has popped up since the map opened: 0 hidden, 1 settled. */
const appear = (t: number): number =>
  reduceMotion ? 1 : Math.max(0, Math.min(1, (openT - Math.min(0.6, Math.abs(t - focus) * 0.06)) / 0.4));

// ---- Geometry ---------------------------------------------------------------------

const length = (): number => mapLength(j.next, LEVEL_TABLE.length);
const mapW = (): number => Math.min(W, MAP_W);
const sx = (fx: number): number => (W - mapW()) / 2 + fx * mapW();
// The world is round: the road is laid out flat, then bent over a drum whose top edge is the horizon.
// Near the bottom of the screen nothing changes; toward the top things bunch up, shrink and slip
// over the horizon, so scrolling feels like rolling the land toward you.
const flatY = (t: number): number => H - FOOT - ((t - 1) * GAP - cam);
const horizonY = (): number => Math.max(126, Math.round(H * 0.17));
const drum = (): number => H - horizonY();
/** Bends a flat screen height over the drum: where it lands, and how much it is foreshortened (1..0). */
function bend(yf: number): { y: number; k: number } {
  const d = H - yf;
  if (d <= 0) return { y: yf, k: 1 };
  const th = d / drum();
  if (th >= Math.PI / 2) return { y: horizonY(), k: 0 };
  return { y: H - drum() * Math.sin(th), k: Math.cos(th) };
}
/** The flat height that bends to screen height y (the inverse of bend). */
function unbend(y: number): number {
  if (y >= H) return y;
  const th = Math.asin(Math.min(1, (H - y) / drum()));
  return H - th * drum();
}
const sy = (t: number): number => bend(flatY(t)).y;
/** Size of things at height t on the road: 1 up close, smaller toward the horizon. */
const ky = (t: number): number => 0.3 + 0.7 * bend(flatY(t)).k;
/** Things also draw in toward the middle as they recede. */
const pinchAt = (t: number): number => 0.62 + 0.38 * bend(flatY(t)).k;
const levelAt = (y: number): number => (H - FOOT - unbend(y) + cam) / GAP + 1;
/** The road's screen x at height t, after the pinch. */
const nx = (t: number): number => W / 2 + (sx(pathX(t)) - W / 2) * pinchAt(t);
const camToPut = (t: number, y: number): number => unbend(y) - H + FOOT + (t - 1) * GAP;
const camMax = (): number => Math.max(0, camToPut(length(), H * 0.34));
const camFor = (t: number): number => Math.max(0, Math.min(camMax(), camToPut(t, H * 0.6)));
const diag = (): number => Math.hypot(W, H);

// ---- Scroll feel -----------------------------------------------------------------------
// Things on the land hang back a little when the camera moves, then spring into place, each with
// its own lag, so a fling makes the whole road ripple like jelly. Scenery leans into the wind.
let jel = 0; // spring displacement, in pixels
let jelV = 0;
let speed = 0; // smoothed camera speed, px/s (positive = moving up the map)
/** Extra vertical offset for whatever sits at height t on the road. */
const jy = (t: number): number => jel * (0.55 + 0.45 * Math.sin(t * 0.9));
/** Screen height for drawing things on the road: like sy, plus the jelly. */
const dy = (t: number): number => bend(flatY(t) + jy(t)).y;

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
  openT = 0;
  focus = cleared ? cleared.level : j.next;
  pressNode = null;
  bounces = new Map();
  glints = new Map();
  flyers = [];
  tip = null;
  popup = null;
  try { hintOn = !cleared && localStorage.getItem(MAP_HINT_KEY) !== "1"; } catch { hintOn = false; }
  if (cleared && j.next === cleared.level + 1 && !reduceMotion) {
    // This win opened a new level: its stars land, then the token walks on to the next node.
    walk = { from: cleared.level, to: j.next, t: 0, dur: 0.5 + 0.6 * Math.max(1, Math.round(Math.abs(j.next - cleared.level))), stars: cleared.stars, unlocked: false, cardAt: -1 };
    lastSeg = -1;
    lastLand = -1;
    cam = camFor(cleared.level);
  } else {
    cam = camFor(j.next);
    if (cleared) openCard(j.next, 0.55);
    else if (!reduceMotion) {
      // Swoop in: start a few levels ahead and glide down onto where you are while the levels pop up.
      cam = camFor(Math.min(length(), j.next + 14));
      goal = camFor(j.next);
      goalRate = 1.7;
    }
  }
  jel = 0; jelV = 0; speed = 0;
  sweep = null;
  streaks = [];
  wispTrail = [];
  lastCam = cam;
  shownWorld = worldIndex(Math.max(1, Math.round(levelAt(H / 2))));
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
  iris = { t: 1, dir: -1, x: nx(n), y: sy(n) };
}

// ---- Input -----------------------------------------------------------------------------

export function mapDown(e: PointerEvent): void {
  if (iris) return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  press = { x: e.clientX, y: e.clientY, cam0: cam, moved: false, id: e.pointerId };
  lastMove = { y: e.clientY, t: performance.now() };
  vel = 0;
  goal = null;
  goalRate = 5;
  // Squash whatever is under the finger: a level node, or a pop-up's button.
  popupPress = popup !== null && inPopupButton(e.clientX, e.clientY);
  pressNode = card === null && popup === null ? nodeAt(e.clientX, e.clientY) : null;
}

export function mapMove(e: PointerEvent): void {
  if (!press || e.pointerId !== press.id || card !== null || popup !== null) return;
  const dy = e.clientY - press.y;
  if (Math.abs(dy) > 8 || Math.abs(e.clientX - press.x) > 8) { press.moved = true; pressNode = null; }
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
  pressNode = null;
  popupPress = false;
  if (p.moved) {
    if (performance.now() - lastMove.t > 90) vel = 0; // finger rested before lifting: no fling
    return;
  }
  vel = 0;
  tap(e.clientX, e.clientY);
}

export function mapCancel(): void { press = null; pressNode = null; popupPress = false; }

export function mapWheel(dy: number): void {
  if (iris || card !== null || popup !== null) return;
  goal = null;
  vel = 0;
  cam = Math.max(0, Math.min(camMax(), cam - dy));
}

const jumpBtn = (): { x: number; y: number } => ({ x: W - 44, y: H - 52 });
const modesBtn = (): { x: number; y: number; w: number; h: number } => ({ x: W - 98, y: 22, w: 82, h: 34 });

/** The level node under a screen point, if any. */
function nodeAt(x: number, y: number): number | null {
  const lo = Math.max(1, Math.floor(levelAt(y + R * 2)));
  const hi = Math.min(length(), Math.ceil(levelAt(y - R * 2)));
  for (let n = lo; n <= hi; n++) if (Math.hypot(x - nx(n), y - sy(n)) <= (R + 12) * ky(n)) return n;
  return null;
}

/** The world whose banner is under a screen point, if any. */
function bannerAt(x: number, y: number): number | null {
  if (Math.abs(x - W / 2) > 120) return null;
  const lo = worldIndex(Math.max(1, Math.floor(levelAt(y + 40))));
  const hi = worldIndex(Math.max(1, Math.ceil(levelAt(y - 40)))) + 1;
  for (let w = Math.max(1, lo); w <= hi; w++) if (worldStart(w) <= length() && Math.abs(y - sy(worldStart(w) - 0.4)) <= 24) return w;
  return null;
}

function tap(x: number, y: number): void {
  if (hintOn) { hintOn = false; try { localStorage.setItem(MAP_HINT_KEY, "1"); } catch { /* ignore */ } }
  if (popup !== null) { popupTap(x, y); return; }
  if (card !== null) { cardTap(x, y); return; }
  if (Math.hypot(x - 36, y - 39) <= 24) { haptics.tick(); closeMap(); return; }
  const m = modesBtn();
  if (x >= m.x && x <= m.x + m.w && y >= m.y - 6 && y <= m.y + m.h + 6) { haptics.tick(); closeMap(handlers.modes); return; }
  const jb = jumpBtn();
  if (!nextOnScreen() && Math.hypot(x - jb.x, y - jb.y) <= 28) { haptics.tick(); goal = camFor(j.next); return; }
  if (y < 70 && Math.abs(x - W / 2) < 100) {
    // The world name in the header opens that world's summary.
    openPopup({ kind: "world", w: worldIndex(Math.max(1, Math.min(length(), Math.round(levelAt(H / 2))))), t: 0, closing: false });
    sfx.pick();
    haptics.tick();
    return;
  }
  const n = nodeAt(x, y);
  if (n !== null) {
    if (status(n) === "locked") {
      shakes.set(n, 1);
      // A little speech bubble says what opens it.
      tip = { n, text: n > j.next + 1 ? `Reach level ${n} to unlock` : `Clear level ${j.next} first`, t: 0 };
      sfx.invalid();
      haptics.invalid();
    } else {
      bounces.set(n, 0);
      sfx.pick();
      haptics.tick();
      openCard(n);
    }
    return;
  }
  const w = bannerAt(x, y);
  if (w !== null) { openPopup({ kind: "world", w, t: 0, closing: false }); sfx.pick(); haptics.tick(); }
}

// ---- Pop-ups ------------------------------------------------------------------------------

const POP_H = 340;
const popBtn = (): { x: number; y: number; w: number; h: number } => ({ x: W / 2, y: H / 2 + POP_H / 2 - 54, w: 200, h: 54 });
const inPopupButton = (x: number, y: number): boolean => {
  const b = popBtn();
  return Math.abs(x - b.x) <= b.w / 2 + 6 && Math.abs(y - b.y) <= b.h / 2 + 8;
};

function openPopup(p: Popup): void {
  popup = p;
  if (p.kind === "newWorld") {
    sfx.praise(5);
    haptic([30, 40, 30, 40, 90]);
  }
}

function popupTap(x: number, y: number): void {
  if (!popup || popup.closing || popup.t < 0.4) return;
  const p = popup;
  const inside = Math.abs(x - W / 2) <= Math.min(W - 40, 330) / 2 && Math.abs(y - H / 2) <= POP_H / 2;
  if (inPopupButton(x, y)) {
    haptics.tick();
    sfx.pick();
    p.closing = true;
    if (p.kind === "world") {
      const prog = worldProgress(p.w, j);
      if (!prog.locked) {
        // Glide to the first level in this world still worth playing, and give it a nudge.
        goal = camFor(prog.first);
        p.then = () => bounces.set(prog.first, 0);
      }
    }
  } else if (!inside && p.kind === "world") {
    p.closing = true;
    haptics.tick();
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

const nextOnScreen = (): boolean => { const y = sy(walk && !walk.unlocked ? walk.from : j.next); return y > horizonY() + 24 && y < H - 20; };

interface Hop { t: number; u: number; seg: number; segs: number; moving: boolean }
let lastSeg = -1; // the hop the character is on, to spot take-offs
let lastLand = -1; // the last hop whose landing has been celebrated

/** Where the character is, in levels, and how far through its current hop (0..1). It hops level to level. */
function hopState(): Hop {
  if (!walk) return { t: j.next, u: 0, seg: 0, segs: 1, moving: false };
  const segs = Math.max(1, Math.round(Math.abs(walk.to - walk.from)));
  const k = Math.max(0, Math.min(1, (walk.t - 0.95) / walk.dur));
  if (k <= 0) return { t: walk.from, u: 0, seg: 0, segs, moving: false };
  if (k >= 1) return { t: walk.to, u: 1, seg: segs - 1, segs, moving: false };
  const ks = k * segs;
  const seg = Math.min(segs - 1, Math.floor(ks));
  const u = ks - seg;
  const e = reduceMotion ? u : u * u * (3 - 2 * u) * 0.3 + u * 0.7; // mostly even, soft at the ends
  return { t: walk.from + ((walk.to - walk.from) * (seg + e)) / segs, u, seg, segs, moving: true };
}

/** Where the player's character stands, in levels. */
const tokenT = (): number => hopState().t;

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
  openT += dt;
  headerPop = Math.max(0, headerPop - dt * 4);
  for (const [n, b] of bounces) { const v = b + dt * 2.2; if (v >= 1) bounces.delete(n); else bounces.set(n, v); }
  for (const [n, g] of glints) { const v = g + dt * 1.5; if (v >= 1) glints.delete(n); else glints.set(n, v); }
  // Every so often a cleared level on screen catches the light.
  nextGlint -= dt;
  if (nextGlint <= 0 && !reduceMotion) {
    nextGlint = 0.9 + Math.random() * 1.4;
    const lo = Math.max(1, Math.ceil(levelAt(H)));
    const hi = Math.min(j.next - 1, Math.floor(levelAt(80)));
    if (hi >= lo) glints.set(lo + Math.floor(Math.random() * (hi - lo + 1)), 0);
  }
  for (const f of flyers) f.t += dt * 1.5;
  const landed = flyers.filter((f) => f.t >= 1).length;
  if (landed) {
    flyers = flyers.filter((f) => f.t < 1);
    headerPop = 1;
    sfx.tick(8);
    haptic(8);
  }
  if (tip) { tip.t += dt; if (tip.t > 2.2) tip = null; }
  if (popup) {
    popup.t = popup.closing ? popup.t - dt * 4.5 : Math.min(1, popup.t + dt * 3);
    // A new world rains confetti while its pop-up is up.
    if (popup.kind === "newWorld" && !popup.closing && !reduceMotion && Math.random() < dt * 40) {
      const c = [WORLDS[popup.w % WORLDS.length]!.accent, "#ffd75e", "#ffffff", ...PALETTE.slice(0, 4)];
      sparks.push({ x: Math.random() * W, y: -10, vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 80, life: 1.6, size: 3 + Math.random() * 4, color: c[Math.floor(Math.random() * c.length)]!, star: Math.random() < 0.5, rot: Math.random() * 6 });
    }
    if (popup.closing && popup.t <= 0) {
      const then = popup.then;
      popup = null;
      then?.();
    }
  }
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
        const x = nx(walk.from) + (i - 1) * 17;
        burst(x, sy(walk.from) - R - 10, 8, ["#ffd75e", "#fff3c4", "#ffbf3a"], 0.6);
        flyers.push({ x, y: sy(walk.from) - R - 10, t: -0.25 }); // then it flies up to the star counter
        sfx.tick(i * 3);
        haptic(10);
      }
    }
    const hs = hopState();
    if (hs.moving && hs.seg !== lastSeg) {
      lastSeg = hs.seg; // take-off: a puff of dust at the feet
      burst(nx(hs.t), sy(hs.t) - 4, 6, ["#ffffff", "#f4e3b5"], 0.35);
      sfx.pick();
    }
    if (hs.moving && hs.u > 0.88 && hs.seg !== lastLand) {
      lastLand = hs.seg; // landing: the node it lands on bounces
      const landT = walk.from + ((walk.to - walk.from) * (hs.seg + 1)) / hs.segs;
      burst(nx(landT), sy(landT), 9, [worldOf(Math.round(landT)).accent, "#ffffff", "#ffd75e"], 0.45);
      bounces.set(Math.round(landT), 0);
      haptics.tick();
    }
    goal = camFor(tokenT());
    if (!walk.unlocked && walk.t >= 0.95 + walk.dur) {
      walk.unlocked = true;
      pops.set(walk.to, 0);
      const w = worldOf(walk.to);
      burst(nx(walk.to), sy(walk.to), 26, [w.accent, "#ffffff", "#ffd75e", ...PALETTE.slice(0, 3)], 1);
      sfx.praise(3);
      haptic([20, 30, 40]);
      walk.cardAt = walk.t + 1.1; // long enough to see the character cheer
    }
    if (walk.unlocked && walk.t >= walk.cardAt && card === null && popup === null) {
      const to = walk.to;
      walk = null;
      goal = null;
      // Stepping into a new world is an occasion: celebrate it before showing the level.
      if (opensWorld(to)) openPopup({ kind: "newWorld", w: worldIndex(to), t: 0, closing: false, then: () => openCard(to) });
      else openCard(to);
    }
  }

  if (!press) {
    if (goal !== null) {
      cam += (goal - cam) * Math.min(1, dt * goalRate);
      if (Math.abs(goal - cam) < 0.5 && !walk) { goal = null; goalRate = 5; }
    } else {
      cam += vel * dt;
      vel *= Math.exp(-dt * 3.4);
      if (Math.abs(vel) < 4 && cam >= -0.5 && cam <= camMax() + 0.5) vel = 0;
      // Spring back from an overscroll, loosely enough to bounce past and wobble back.
      const bound = cam < 0 ? 0 : cam > camMax() ? camMax() : null;
      if (bound !== null) {
        if (reduceMotion) { cam += (bound - cam) * Math.min(1, dt * 12); vel = 0; }
        else {
          vel += (bound - cam) * 160 * dt;
          vel *= Math.exp(-dt * 6);
        }
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

function updateScrollFeel(dt: number): void {
  if (reduceMotion) { jel = 0; speed = 0; return; }
  const v = dt > 0 ? camStep / dt : 0;
  speed += (v - speed) * Math.min(1, dt * 10);
  // A lightly damped spring chasing "hang back by an amount proportional to speed".
  const target = Math.max(-34, Math.min(34, -speed * 0.022));
  jelV += (target - jel) * 140 * dt;
  jelV *= Math.exp(-dt * 7);
  jel += jelV * dt;
  // Speed lines on a fast fling.
  const fast = Math.abs(speed);
  if (fast > 700 && Math.random() < dt * fast * 0.03)
    streaks.push({ x: Math.random() * W, y: Math.random() * H, len: Math.min(160, fast * 0.08), life: 1, dir: Math.sign(speed) });
  for (const st of streaks) { st.life -= dt * 3.2; st.y += st.dir * fast * 0.9 * dt; }
  streaks = streaks.filter((st) => st.life > 0);
  // Crossing into another world: its name flies in.
  const w = worldIndex(Math.max(1, Math.round(levelAt(H / 2))));
  if (w !== shownWorld) {
    shownWorld = w;
    if (openT > 0.8 && !walk) {
      sweep = { w, t: 0 };
      const world = WORLDS[w % WORLDS.length]!;
      burst(W / 2, H * 0.38, 30, [world.accent, "#ffffff", "#ffd75e", ...PALETTE.slice(0, 3)], 0.9);
      sfx.praise(2);
      haptic([12, 30, 12]);
    }
  }
  if (sweep) { sweep.t += dt; if (sweep.t > 2.4) sweep = null; }
}
function updateAmbient(dt: number): void {
  camStep = cam - lastCam;
  lastCam = cam;
  updateScrollFeel(dt);
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
      const y = sy(n + h01(i, n));
      const kk = ky(n + h01(i, n));
      const x = W / 2 + (h01(n, i) * W - W / 2) * pinchAt(n + h01(i, n));
      const r = (30 + h01(n + 7, i) * 60) * kk;
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

/** The world on the horizon (where the sky takes its colour from). */
const horizonWorld = (): (typeof WORLDS)[number] => worldOf(Math.max(1, Math.min(length(), Math.floor(levelAt(horizonY() + 30)))));

/** The sky behind the curve of the world: a fixed backdrop with slow clouds and twinkling sparkles. */
function drawSky(): void {
  const world = horizonWorld();
  const hz = horizonY();
  const g = ctx.createLinearGradient(0, 0, 0, hz + 20);
  if (world.night) {
    g.addColorStop(0, mix(world.ground[0], 0, 0.35));
    g.addColorStop(1, mix(world.accent, 255, 0.15));
  } else {
    g.addColorStop(0, mix(world.accent, 255, 0.4));
    g.addColorStop(1, "#fff3c9");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, hz + 20);
  // A low sun (or moon) glowing on the horizon.
  const sunX = W * 0.72;
  const sun = ctx.createRadialGradient(sunX, hz, 4, sunX, hz, hz * 0.9);
  sun.addColorStop(0, world.night ? "rgba(230,235,255,0.6)" : "rgba(255,250,210,0.95)");
  sun.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, hz + 20);
  for (let i = 0; i < 4; i++) {
    const x = ((i * 157 + clock * (7 + i * 2)) % (W + 240)) - 120;
    const y = hz * (0.45 + h01(i, 8) * 0.35);
    const c = 0.6 + h01(i, 5) * 0.5;
    ctx.globalAlpha = world.night ? 0.14 : 0.8;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(x, y, 44 * c, 12 * c, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 18 * c, y - 7 * c, 20 * c, 14 * c, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 14 * c, y - 10 * c, 24 * c, 16 * c, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 9; i++) {
    const tw = reduceMotion ? 0.6 : Math.max(0, Math.sin(clock * (1.6 + h01(i, 2)) + i * 2.1));
    sparkle(h01(i, 7) * W, 70 + h01(i, 9) * (hz - 60), (5 + h01(i, 3) * 6) * tw);
  }
}

/** How far the horizon dips at screen x: the land's edge is round, like the top of a planet. */
const bow = (x: number): number => ((x - W / 2) / (W / 2)) ** 2 * 30;

/** Far hills where the land curves out of sight, and a haze that softens what sits right on it. */
function drawHorizon(): void {
  const world = horizonWorld();
  const hz = horizonY();
  // Round off the land's top edge by painting the sky back over its corners.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  for (let i = 30; i >= 0; i--) ctx.lineTo((i / 30) * W, hz + bow((i / 30) * W));
  ctx.closePath();
  ctx.clip();
  drawSky();
  ctx.restore();
  const ridge = (lift: number, amp: number, seed: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, hz + bow(0) + 12);
    for (let i = 0; i <= 30; i++) {
      const u = i / 30;
      ctx.lineTo(u * W, hz + bow(u * W) - lift - amp * (0.6 + 0.5 * Math.sin(u * 7 + seed) + 0.25 * Math.sin(u * 17 + seed * 3)));
    }
    ctx.lineTo(W, hz + bow(W) + 12);
    ctx.closePath();
    ctx.fill();
  };
  ridge(4, 16, 1.2, mix(world.ground[1], 255, 0.35));
  ridge(-6, 12, 4.4, mix(world.ground[1], 255, 0.12));
  const haze = ctx.createLinearGradient(0, hz - 4, 0, hz + 46);
  haze.addColorStop(0, world.night ? "rgba(200,190,255,0.35)" : "rgba(255,250,235,0.7)");
  haze.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, hz - 4, W, 50);
}

/** A shimmering river along each border between worlds; the road crosses it on a little bridge. */
function drawRivers(lo: number, hi: number, part: "water" | "bridge"): void {
  for (let w = Math.max(1, worldIndex(Math.max(1, Math.floor(lo)))); w <= worldIndex(Math.max(1, Math.ceil(hi))) + 1; w++) {
    const t = worldStart(w) - 0.5;
    if (worldStart(w) > length()) continue;
    const fc = flatY(t) + jy(t) * 0.6;
    const depth = bend(fc).k;
    if (depth < 0.05 || bend(fc).y > H + 60) continue;
    const half = GAP * 0.17;
    const world = WORLDS[w % WORLDS.length]!;
    const edge = (side: -1 | 1, x: number): number =>
      bend(fc + side * half + Math.sin(x * 0.025 + w * 2 + (side > 0 ? 1.7 : 0)) * 5).y;
    if (part === "water") {
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 15) ctx.lineTo(x, edge(-1, x));
      for (let x = W + 10; x >= -10; x -= 15) ctx.lineTo(x, edge(1, x));
      ctx.closePath();
      const top = edge(-1, W / 2);
      const bot = edge(1, W / 2);
      const g = ctx.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, world.night ? "#5a7bff" : "#8fe3ff");
      g.addColorStop(0.5, world.night ? "#3b4fd6" : "#3fb6f0");
      g.addColorStop(1, world.night ? "#6a5bff" : "#7fd0ff");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 3 * depth;
      ctx.stroke();
      // Glints drifting downstream.
      for (let i = 0; i < 9; i++) {
        const x = ((i * 53 + clock * (26 + (i % 3) * 10)) % (W + 60)) - 30;
        const lane = (i % 3) - 1;
        const y = (edge(-1, x) + edge(1, x)) / 2 + lane * (bot - top) * 0.22;
        ctx.globalAlpha = 0.55 + 0.35 * Math.sin(clock * 3 + i);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.ellipse(x, y, 10 * depth, 1.8 * depth, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4; i++) {
        const x = h01(i, w) * W;
        const tw = reduceMotion ? 0.6 : Math.max(0, Math.sin(clock * 2.4 + i * 1.7 + w));
        sparkle(x, (edge(-1, x) + edge(1, x)) / 2, 6 * depth * tw);
      }
    } else {
      // Bridge: planks across the water where the road meets it, with a rail each side.
      const x = nx(t);
      const top = edge(-1, x) - 4 * depth;
      const bot = edge(1, x) + 4 * depth;
      const bw = 58 * ky(t);
      ctx.fillStyle = "#8a5530";
      ctx.beginPath(); ctx.roundRect(x - bw / 2, top + 3, bw, bot - top, 6 * depth); ctx.fill();
      ctx.fillStyle = "#c98a52";
      ctx.beginPath(); ctx.roundRect(x - bw / 2, top, bw, bot - top, 6 * depth); ctx.fill();
      ctx.strokeStyle = "rgba(90,50,20,0.45)";
      ctx.lineWidth = 1.5;
      const planks = 5;
      for (let i = 1; i < planks; i++) {
        const y = top + ((bot - top) * i) / planks;
        ctx.beginPath(); ctx.moveTo(x - bw / 2 + 3, y); ctx.lineTo(x + bw / 2 - 3, y); ctx.stroke();
      }
      ctx.fillStyle = "#6b3f20";
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.roundRect(x + side * bw / 2 - 3 * depth, top - 6 * depth, 6 * depth, bot - top + 8 * depth, 3 * depth); ctx.fill();
      }
    }
  }
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
  const flat = !side ? sx(d.x) : d.x < 0.5 ? (d.x / 0.5) * margin : W - margin + ((d.x - 0.5) / 0.5) * margin;
  const x = W / 2 + (flat - W / 2) * pinchAt(d.y);
  const y = dy(d.y);
  if (y < -80 || y > H + 40) return;
  const depth = ky(d.y);
  if (depth < 0.31) return; // right on the horizon: not up yet
  const grow = appear(d.y + 0.3); // scenery springs up just after the levels near it
  if (grow <= 0) return;
  const s = 28 * d.scale * depth;
  const sway = reduceMotion ? 0 : Math.sin(clock * 1.3 + d.phase) * 0.045;
  shadow(x, y, s * 0.55 * grow);
  ctx.save();
  ctx.translate(x, y);
  if (grow < 1) ctx.scale(0.6 + 0.4 * grow, easeOutBack(grow));
  if (!reduceMotion) ctx.rotate(Math.max(-0.35, Math.min(0.35, speed * 0.00016))); // the wind of the scroll
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
  // Drawn in short pieces so it can taper toward the horizon.
  const pts: { x: number; y: number; k: number; t: number }[] = [];
  for (let t = a; t <= b + 0.001; t += 0.06) pts.push({ x: nx(t), y: dy(t), k: ky(t), t });
  const pass = (width: number, color: (t: number) => string, off = 0): void => {
    ctx.lineCap = "round";
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      ctx.strokeStyle = color(p.t);
      ctx.lineWidth = width * p.k;
      ctx.beginPath(); ctx.moveTo(p.x, p.y + off * p.k); ctx.lineTo(q.x, q.y + off * q.k); ctx.stroke();
    }
  };
  pass(34, () => "rgba(0,0,0,0.2)", 6);
  pass(32, (t) => mix(worldOf(Math.max(1, Math.round(t))).road, 0, 0.28));
  pass(24, (t) => worldOf(Math.max(1, Math.round(t))).road);
  // Gem stepping-stones along the middle: lit in the game's colours where you've already been.
  const reached = tokenT();
  for (let t = Math.ceil(a * 4) / 4; t <= b; t += 0.25) {
    if (Math.abs(t - Math.round(t)) < 0.3) continue; // nodes sit on the whole numbers
    const x = nx(t);
    const y = dy(t);
    const kk = ky(t);
    if (kk < 0.33) continue;
    if (t < reached) {
      // They hop in a wave, higher the faster you scroll.
      const bob = reduceMotion ? 0 : Math.sin(clock * 3 + t * 4) * (1.2 + Math.min(7, Math.abs(speed) * 0.006));
      gem(x, y + bob * kk, 11 * kk, PALETTE[Math.round(t * 4) % PALETTE.length]!);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.strokeStyle = "rgba(90,40,140,0.18)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - 4.5 * kk, y - 4.5 * kk, 9 * kk, 9 * kk, 3 * kk); ctx.fill(); ctx.stroke();
    }
  }
}

function drawBanner(w: number): void {
  const n = worldStart(w);
  const y = dy(n - 0.4); // nearer the new world's first node, clear of the crown below
  if (y < -40 || y > H + 40) return;
  const world = WORLDS[w % WORLDS.length]!;
  const locked = n > j.next && !(walk && n === walk.to);
  const x = W / 2;
  const bw = 210;
  const sway = reduceMotion ? 0 : Math.sin(clock * 1.4 + w) * 0.015;
  const k = appear(n - 0.4);
  const depth = ky(n - 0.4);
  if (k <= 0 || depth < 0.32) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sway + (1 - k) * 0.3);
  ctx.scale(easeOutBack(k) * depth, easeOutBack(k) * depth);
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
  const x = nx(n) + (shake > 0 ? Math.sin(shake * 40) * 7 * shake : 0);
  const y = dy(n);
  if (y < -60 || y > H + 60) return;
  const depth = ky(n);
  if (depth < 0.32) return; // still behind the horizon
  const gate = n % LEVELS_PER_WORLD === 0; // the last level of a world is a bigger landmark
  let r = R * (st === "current" ? 1.15 : 1) * (gate ? 1.12 : 1);
  if (pop !== undefined) r *= reduceMotion ? 1 : 0.5 + 0.5 * easeOutBack(Math.min(1, pop * 1.6));
  const k = appear(n);
  if (k <= 0) return;
  r *= easeOutBack(k);
  if (pressNode === n) r *= 0.88;
  // Squash and stretch with the scroll: taller when moving fast, settling as the jelly does.
  const stretch = 1 + Math.min(0.16, Math.abs(jelV) * 0.0009);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(depth / stretch, depth * stretch); // everything about the node shrinks with distance
  ctx.translate(-x, -y);
  const b = bounces.get(n);
  if (b !== undefined && !reduceMotion) r *= 1 + 0.2 * Math.sin(b * Math.PI * 3) * (1 - b);

  if (st === "current") {
    // A soft glow breathing behind the level you are on.
    const gr = r * (2.2 + (reduceMotion ? 0 : 0.25 * Math.sin(clock * 3)));
    const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, gr);
    halo.addColorStop(0, "rgba(255,240,170,0.55)");
    halo.addColorStop(1, "rgba(255,240,170,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, y, gr, 0, Math.PI * 2); ctx.fill();
  }

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
  const glint = glints.get(n);
  if (glint !== undefined) {
    // A band of light sweeps across the gem.
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x - r, y - r, r * 2, r * 2 - 1, rr); ctx.clip();
    ctx.translate(x - r * 2 + glint * r * 4, y);
    ctx.rotate(0.5);
    const band = ctx.createLinearGradient(-r * 0.4, 0, r * 0.4, 0);
    band.addColorStop(0, "rgba(255,255,255,0)");
    band.addColorStop(0.5, "rgba(255,255,255,0.75)");
    band.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = band;
    ctx.fillRect(-r * 0.4, -r * 2, r * 0.8, r * 4);
    ctx.restore();
  }

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
      // Earned stars twinkle as the gem catches the light.
      if (on && glint !== undefined) sparkle(sxp + 4, syp - 4, 7 * Math.sin(glint * Math.PI));
    }
  }
  ctx.restore();
}

/** The player's piece: a glossy block in a white pin, hopping along as it travels. */
/** Blip, the cartoon character: stands beside the current level, hops between levels, cheers on arrival. */
function drawToken(): void {
  const hs = hopState();
  const t = hs.t;
  const depth = ky(t);
  if (depth < 0.32) return;
  const baseX = nx(t);
  const groundY = dy(t) - 3 * depth;
  const side = baseX > W - 78 ? -1 : 1; // stand on whichever side of the node has room
  const px = baseX + side * 32 * depth;
  const hopping = walk !== null && hs.moving;
  const arc = hopping && !reduceMotion ? Math.sin(Math.PI * hs.u) * 60 * depth : 0;
  const target = walk ? walk.to : Math.min(length(), j.next + 1);
  const face = nx(target) >= baseX ? 1 : -1; // looks toward where it is heading

  // squash and stretch through the hop: crouch, stretch in the air, squash on landing
  let sqy = 1;
  if (hopping && !reduceMotion) {
    const u = hs.u;
    const crouch = u < 0.18 ? Math.sin((u / 0.18) * Math.PI) : 0;
    const land = u > 0.82 ? Math.sin(((u - 0.82) / 0.18) * Math.PI) : 0;
    sqy = 1 - 0.2 * crouch + 0.1 * Math.sin(Math.PI * u) - 0.22 * land;
  } else if (!reduceMotion) {
    sqy = 1 + Math.sin(clock * 2.6) * 0.012;
  }
  const mode: MascotMode = walk ? (hs.moving ? "hop" : walk.unlocked ? "cheer" : "idle") : "idle";

  shadow(px, groundY, 17 * depth * Math.max(0.4, 1 - arc / (110 * depth)));
  const k = 0.95 * depth;
  ctx.save();
  ctx.translate(px, groundY - arc);
  ctx.scale(face * k, k);
  drawMascot({
    mode, clock, hop: hs.u, squashX: 1 / Math.pow(Math.max(0.5, sqy), 0.6), squashY: sqy, look: 0.9,
    color: PALETTE[0]!, wave: !walk && clock % 7 > 5.6 && !reduceMotion,
  });
  ctx.restore();
  if (hopping && !reduceMotion && Math.random() < 0.45)
    sparks.push({ x: px + (Math.random() - 0.5) * 18, y: groundY - arc - 26 * depth, vx: (Math.random() - 0.5) * 30, vy: 10 + Math.random() * 20, life: 0.55, size: 2 + Math.random() * 2, color: Math.random() < 0.5 ? "#ffffff" : "#ffd75e", star: true, rot: Math.random() * 6 });
}

/** A big cartoon building beside the road. */
function drawLandmarkAt(lm: Landmark): void {
  const x = W / 2 + (sx(lm.x) - W / 2) * pinchAt(lm.y);
  const y = dy(lm.y);
  if (y < -150 || y > H + 60) return;
  const depth = ky(lm.y);
  if (depth < 0.31) return; // on the horizon: not up yet
  const grow = appear(lm.y + 0.3);
  if (grow <= 0) return;
  const k = 0.82 * depth;
  shadow(x, y, 46 * k * grow);
  ctx.save();
  ctx.translate(x, y);
  if (grow < 1) ctx.scale(0.6 + 0.4 * grow, easeOutBack(grow));
  if (!reduceMotion) ctx.rotate(Math.max(-0.2, Math.min(0.2, speed * 0.0001))); // the wind of the scroll
  ctx.scale(lm.flip ? -k : k, k);
  drawLandmark(lm.kind, clock + lm.phase);
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

  // Stars still on their way up are not counted yet, so the total ticks up as each one lands.
  const unspawned = walk ? Array.from({ length: walk.stars }, (_, i) => i).filter((i) => walk!.t < 0.2 + i * 0.2).length : 0;
  const total = Object.values(j.stars).reduce((a, b) => a + b, 0) - flyers.length - unspawned;
  const world = worldOf(Math.max(1, Math.min(length(), Math.round(levelAt(H / 2)))));
  bubbleText(world.name, W / 2, 32, 20, ["#ffffff", "#f3e9ff"], { maxW: W - 230 });
  const line = `\u2605 ${total}  \u00B7  Level ${j.next}`;
  ctx.font = `900 13px ${ROUND}`;
  const lw = ctx.measureText(line).width;
  headerStar = { x: W / 2 - lw / 2 + 6, y: 57 };
  ctx.save();
  ctx.translate(W / 2, 57);
  const bump = 1 + 0.35 * headerPop * headerPop;
  ctx.scale(bump, bump);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = BRAND.deep;
  ctx.strokeText(line, 0, 0);
  ctx.fillStyle = headerPop > 0.3 ? "#ffffff" : "#ffe27a";
  ctx.fillText(line, 0, 0);
  ctx.restore();
}

function drawJump(): void {
  if (nextOnScreen()) return;
  const { x, y } = jumpBtn();
  const up = sy(j.next) < horizonY() + 24;
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

/**
 * A glowing wisp that flies the road ahead of you, from your level a few levels on and back,
 * leaving a trail of sparkles: it shows where the journey goes next.
 */
function drawWisp(): void {
  if (reduceMotion || walk) return;
  const span = Math.min(3.2, length() - j.next);
  if (span <= 0.2) return;
  const phase = (clock * 0.16) % 2;
  const k = phase < 1 ? phase : 2 - phase;
  const e = k * k * (3 - 2 * k);
  const t = j.next + 0.15 + e * span;
  const x = nx(t) + Math.sin(clock * 2.3) * 14 * ky(t);
  const y = dy(t) - 34 + Math.sin(clock * 3.1) * 8;
  wispTrail.push({ x, y });
  if (wispTrail.length > 26) wispTrail.shift();
  const accent = worldOf(Math.max(1, Math.round(t))).accent;
  wispTrail.forEach((p, i) => {
    const a = i / wispTrail.length;
    ctx.globalAlpha = a * 0.5;
    ctx.fillStyle = i % 3 === 0 ? "#ffffff" : accent;
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 + a * 5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 30);
  glow.addColorStop(0, "rgba(255,255,255,0.95)");
  glow.addColorStop(0.25, mix(accent, 255, 0.4));
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill();
  sparkle(x, y, 9 + Math.sin(clock * 9) * 3);
  if (Math.random() < 0.25) sparks.push({ x, y, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30, life: 0.6, size: 2 + Math.random() * 2, color: Math.random() < 0.5 ? "#ffffff" : accent, star: true, rot: Math.random() * 6 });
}

/** Big soft orbs drifting in front of the map, moving faster than the land: it reads as depth. */
function drawForeground(): void {
  if (reduceMotion) return;
  const span = H + 400;
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side < 0 ? W * (0.02 + h01(i, 1) * 0.16) : W * (0.82 + h01(i, 2) * 0.16);
    const y = ((h01(i, 3) * span + cam * (1.5 + h01(i, 4) * 0.5)) % span + span) % span - 200;
    const r = 34 + h01(i, 5) * 46;
    const b = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tint = i % 3 === 0 ? "255,240,180" : i % 3 === 1 ? "255,200,240" : "210,230,255";
    b.addColorStop(0, `rgba(${tint},0.32)`);
    b.addColorStop(0.7, `rgba(${tint},0.12)`);
    b.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = b;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawStreaks(): void {
  ctx.lineCap = "round";
  for (const st of streaks) {
    ctx.globalAlpha = Math.max(0, st.life) * 0.55;
    const g = ctx.createLinearGradient(st.x, st.y, st.x, st.y - st.dir * st.len);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(st.x, st.y - st.dir * st.len); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** A world's name flying in letter by letter as you scroll into it, with a band of light behind. */
function drawSweep(): void {
  if (!sweep) return;
  const world = WORLDS[sweep.w % WORLDS.length]!;
  const t = sweep.t;
  const out = Math.max(0, (t - 1.7) / 0.7); // leaving: rises and fades
  const y = H * 0.36 - out * 40;
  // Light band
  const bandA = Math.min(1, t * 4) * (1 - out);
  const bw = W * Math.min(1, t * 2.5);
  const band = ctx.createLinearGradient(0, y - 50, 0, y + 50);
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(0.5, `rgba(255,255,255,${0.55 * bandA})`);
  band.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = band;
  ctx.fillRect(W / 2 - bw / 2, y - 50, bw, 100);
  ctx.globalAlpha = 1 - out;
  ctx.font = `900 11px ${ROUND}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = mix(world.accent, 0, 0.45);
  ctx.fillText(`WORLD ${sweep.w + 1}`, W / 2, y - 34);
  // Letters arrive from alternate sides, spinning, and land with a bounce.
  const size = Math.min(44, (W - 40) / Math.max(6, world.name.length * 0.62));
  ctx.font = `900 ${size}px ${ROUND}`;
  const letters = [...world.name];
  const widths = letters.map((l) => ctx.measureText(l).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = W / 2 - total / 2;
  letters.forEach((l, i) => {
    const w = widths[i]!;
    const k = Math.max(0, Math.min(1, (t - i * 0.045) / 0.45));
    if (k > 0 && l !== " ") {
      const e = easeOutBack(k);
      const from = i % 2 === 0 ? -1 : 1;
      const lx = cx + w / 2 + from * (1 - e) * W * 0.7;
      const ly = y + (1 - e) * 60 * from + Math.sin(clock * 5 - i * 0.6) * 3 * k;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate((1 - e) * from * 2.5);
      bubbleText(l, 0, 0, size, ["#ffffff", mix(world.accent, 255, 0.35)], { rim: mix(world.accent, 0, 0.5) });
      ctx.restore();
    }
    cx += w;
  });
  ctx.globalAlpha = 1;
}

/** Earned stars flying from a level up to the star counter, on a curve. */
function drawFlyers(): void {
  for (const f of flyers) {
    if (f.t <= 0) continue;
    const e = f.t * f.t * (3 - 2 * f.t);
    const cx = (f.x + headerStar.x) / 2 + (f.x < W / 2 ? -60 : 60);
    const cy = Math.min(f.y, headerStar.y) - 40;
    const x = (1 - e) * (1 - e) * f.x + 2 * (1 - e) * e * cx + e * e * headerStar.x;
    const y = (1 - e) * (1 - e) * f.y + 2 * (1 - e) * e * cy + e * e * headerStar.y;
    const size = 11 - 4 * e;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(e * 6);
    star(0, 0, size);
    ctx.fillStyle = "#ffd23f";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    sparkle(x - size, y + size * 0.6, 4 * (1 - e));
  }
}

/** A speech bubble over a node: the locked-level tooltip, and the first-visit hint. */
function speech(n: number, text: string, t: number, lift: number): void {
  const x = Math.max(90, Math.min(W - 90, nx(n)));
  const y = dy(n) - lift;
  const k = reduceMotion ? 1 : easeOutBack(Math.min(1, t / 0.25));
  ctx.save();
  ctx.font = `900 13px ${ROUND}`;
  const w = ctx.measureText(text).width + 28;
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.shadowColor = "rgba(60,10,90,0.3)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.roundRect(-w / 2, -18, w, 36, 18); ctx.fill();
  const tx = Math.max(-w / 2 + 16, Math.min(w / 2 - 16, nx(n) - x));
  ctx.beginPath(); ctx.moveTo(tx - 8, 16); ctx.lineTo(tx, 27); ctx.lineTo(tx + 8, 16); ctx.closePath(); ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(138,77,255,0.35)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(-w / 2, -18, w, 36, 18); ctx.stroke();
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

function drawTips(): void {
  if (tip) {
    ctx.globalAlpha = tip.t > 1.8 ? Math.max(0, 1 - (tip.t - 1.8) / 0.4) : 1;
    speech(tip.n, tip.text, tip.t, R + 34);
    ctx.globalAlpha = 1;
  }
  if (hintOn && !walk && card === null && popup === null && openT > 0.9) {
    const bob = reduceMotion ? 0 : Math.sin(clock * 3) * 4;
    speech(j.next, "Tap a level to play!", openT - 0.9, R * 1.15 + 92 + bob);
  }
}

function drawPopup(): void {
  if (!popup) return;
  const p = popup;
  const e = Math.max(0, p.t);
  const world = WORLDS[p.w % WORLDS.length]!;
  const cw = Math.min(W - 40, 330);
  const top = -POP_H / 2;
  ctx.fillStyle = `rgba(48,14,80,${0.55 * Math.min(1, e * 1.4)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  const sc = reduceMotion ? 1 : p.closing ? 0.85 + 0.15 * e : easeOutBack(Math.min(1, e));
  ctx.scale(sc, sc);
  ctx.globalAlpha = Math.min(1, e * 2);

  if (p.kind === "newWorld") {
    // Slowly turning light behind the card.
    if (!reduceMotion) {
      ctx.save();
      ctx.rotate(clock * 0.3);
      ctx.fillStyle = "rgba(255,240,170,0.18)";
      for (let i = 0; i < 12; i++) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, Math.max(W, H), (i / 12) * Math.PI * 2, (i / 12) * Math.PI * 2 + 0.22);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    sheet(cw, POP_H, "New world!", "gold");
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `900 12px ${ROUND}`;
    ctx.fillText(`WORLD ${p.w + 1} UNLOCKED`, 0, top + 58);
    bubbleText(world.name, 0, top + 104, 32, ["#ffffff", mix(world.accent, 255, 0.4)], { rim: mix(world.accent, 0, 0.5), wave: clock, maxW: cw - 40 });
    // A row of gems in the new world's colours, bobbing in turn.
    for (let i = 0; i < 5; i++) {
      const bob = reduceMotion ? 0 : Math.sin(clock * 4 - i * 0.7) * 5;
      const pop = reduceMotion ? 1 : easeOutBack(Math.max(0, Math.min(1, (e - 0.3 - i * 0.08) / 0.3)));
      if (pop <= 0) continue;
      gem((i - 2) * 40, top + 168 + bob, 30 * pop, i === 2 ? world.accent : PALETTE[(i + p.w) % PALETTE.length]!);
    }
    const prev = worldProgress(p.w - 1, j);
    ctx.fillStyle = COLORS.text;
    ctx.font = `900 14px ${ROUND}`;
    ctx.fillText(`${WORLDS[(p.w - 1) % WORLDS.length]!.name} complete \u00B7 \u2605 ${prev.stars} / ${prev.maxStars}`, 0, top + 222, cw - 40);
    candyButton(0, POP_H / 2 - 54, 200, 54, "Let's go!", "green", popupPress ? 1 : 0, 22);
  } else {
    const prog = worldProgress(p.w, j);
    sheet(cw, POP_H, `World ${p.w + 1}`);
    roundButton(cw / 2 - 26, top + 26, 14, "\u2715", "pink");
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    bubbleText(world.name, 0, top + 70, 26, ["#ffffff", mix(world.accent, 255, 0.4)], { rim: mix(world.accent, 0, 0.5), maxW: cw - 70 });
    // One little gem per level: lit when cleared, gold with three stars, hollow if still to do.
    const cellW = Math.min(18, (cw - 60) / LEVELS_PER_WORLD * 2 - 4);
    for (let i = 0; i < LEVELS_PER_WORLD; i++) {
      const n = worldStart(p.w) + i;
      const row = i < 8 ? 0 : 1;
      const col = row === 0 ? i : i - 8;
      const count = row === 0 ? 8 : 7;
      const x = (col - (count - 1) / 2) * (cellW + 6);
      const y = top + 118 + row * (cellW + 8);
      const s = j.stars[n] ?? 0;
      const appearK = reduceMotion ? 1 : easeOutBack(Math.max(0, Math.min(1, (e - 0.2 - i * 0.03) / 0.3)));
      if (appearK <= 0) continue;
      if (s > 0 || n < j.next) gem(x, y, cellW * appearK, s >= 3 ? "#ffc21f" : world.accent);
      else {
        ctx.strokeStyle = n === j.next ? world.accent : "rgba(90,40,140,0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(x - cellW / 2 * appearK, y - cellW / 2 * appearK, cellW * appearK, cellW * appearK, 5); ctx.stroke();
      }
    }
    ctx.fillStyle = COLORS.text;
    ctx.font = `900 15px ${ROUND}`;
    ctx.fillText(`Levels ${prog.cleared} / ${LEVELS_PER_WORLD}`, 0, top + 186);
    // Star progress bar, filling up as the pop-up opens.
    const bw = cw - 80;
    const fill = (prog.stars / prog.maxStars) * Math.min(1, e);
    ctx.fillStyle = "rgba(138,77,255,0.15)";
    ctx.beginPath(); ctx.roundRect(-bw / 2, top + 206, bw, 16, 8); ctx.fill();
    if (fill > 0) {
      const g = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      g.addColorStop(0, "#ffe066"); g.addColorStop(1, "#ffa800");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(-bw / 2, top + 206, Math.max(16, bw * fill), 16, 8); ctx.fill();
    }
    star(-bw / 2 - 2, top + 214, 12);
    ctx.fillStyle = "#ffd23f"; ctx.fill();
    ctx.strokeStyle = "#c77800"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = COLORS.dim;
    ctx.font = `900 12px ${ROUND}`;
    ctx.fillText(prog.locked ? `Unlocks after level ${worldStart(p.w) - 1}` : `\u2605 ${prog.stars} / ${prog.maxStars}`, 0, top + 240);
    candyButton(0, POP_H / 2 - 54, 200, 54, prog.locked ? "OK" : prog.cleared === 0 ? "Start here" : "Go there", prog.locked ? "violet" : "green", popupPress ? 1 : 0, 21);
  }
  ctx.restore();
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

  drawSky();
  drawGround(lo, hi);
  drawRivers(lo, hi, "water");
  drawHorizon();
  const decos: { d: Decoration; n: number; side: boolean }[] = [];
  const wide = W - mapW() > 140;
  for (let n = Math.max(0, Math.floor(lo) - 1); n <= Math.min(length() + 2, Math.ceil(hi)); n++) {
    for (const d of decorFor(Math.max(1, n))) decos.push({ d: n === 0 ? { ...d, y: d.y - 1 } : d, n, side: false });
    if (wide) for (const d of decorFor(Math.max(1, n) + 1050)) decos.push({ d: { ...d, y: d.y - 1050 - (n === 0 ? 1 : 0) }, n, side: true });
  }
  const scene: { y: number; draw: () => void }[] = decos.map(({ d, n, side }) => ({ y: d.y, draw: () => drawDeco(d, worldOf(Math.max(1, n)), side) }));
  for (let n = Math.max(1, Math.floor(lo) - 1); n <= Math.min(length(), Math.ceil(hi) + 1); n++) {
    const lm = landmarkFor(n);
    if (lm) scene.push({ y: lm.y, draw: () => drawLandmarkAt(lm) });
  }
  scene.sort((a, b) => b.y - a.y); // further up the screen first, so nearer things overlap them
  drawRoad(lo, hi);
  drawRivers(lo, hi, "bridge");
  for (const item of scene) item.draw();
  for (let w = Math.max(1, worldIndex(Math.max(1, Math.floor(lo)))); w <= worldIndex(Math.max(1, Math.ceil(hi))) + 1; w++)
    if (worldStart(w) <= length()) drawBanner(w);
  for (let n = Math.max(1, Math.floor(lo)); n <= Math.min(length(), Math.ceil(hi)); n++) drawNode(n);
  const endY = sy(length() + 0.75);
  if (ky(length() + 0.75) > 0.45) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `800 14px ${ROUND}`;
    ctx.textAlign = "center";
    ctx.fillText("More worlds coming soon", W / 2, endY);
  }
  drawToken();
  drawWisp();
  drawTips();
  drawAmbient();
  drawForeground();
  drawStreaks();
  drawSweep();
  drawHeader();
  drawJump();
  drawFlyers();
  drawCard();
  drawPopup();
  drawSparks(); // on top, so confetti falls over the pop-ups too
  ctx.restore();
}
