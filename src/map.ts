// The journey map: a winding road up through themed worlds, one node per level.
// Pure geometry and data only (no DOM), so the layout is identical for everyone and testable.
// x values are fractions of the map's width; y is measured in levels (level n sits at y = n).

import { seeded } from "./rng";

export const LEVELS_PER_WORLD = 15;

export type Particle = "petal" | "bubble" | "dust" | "snow" | "firefly" | "ember" | "sparkle" | "star";
export type Deco =
  | "tree" | "flower" | "palm" | "shell" | "cactus" | "rock" | "pine" | "mushroom" | "crystal" | "puff"
  // sweets
  | "lollipop" | "candyCane" | "cupcake" | "donut" | "gumdrop" | "cottonBush" | "iceCream" | "cookie";

export interface World {
  name: string;
  ground: [string, string]; // gradient from the bottom of the world to its top
  patch: string; // soft blotches that give the ground texture
  road: string;
  accent: string; // colour of cleared level nodes
  decos: Deco[];
  particle: Particle;
  night: boolean; // dark worlds get twinkling stars in the background
}

export const WORLDS: readonly World[] = [
  { name: "Sugar Meadow", ground: ["#f59fd2", "#ffd3ee"], patch: "#ffeaf7", road: "#ffffff", accent: "#ff4f9a", decos: ["lollipop", "cottonBush", "candyCane"], particle: "petal", night: false },
  { name: "Gumdrop Bay", ground: ["#5cc3f2", "#aee8ff"], patch: "#e2f8ff", road: "#ffffff", accent: "#ff8a3d", decos: ["gumdrop", "iceCream", "donut"], particle: "bubble", night: false },
  { name: "Caramel Dunes", ground: ["#f0a850", "#ffd98c"], patch: "#ffeab9", road: "#ffffff", accent: "#8a4dff", decos: ["cookie", "gumdrop", "candyCane"], particle: "dust", night: false },
  { name: "Mint Frost", ground: ["#8fe6d2", "#e8fff8"], patch: "#ffffff", road: "#ffffff", accent: "#ff5fa8", decos: ["candyCane", "iceCream", "cupcake"], particle: "snow", night: false },
  { name: "Cocoa Woods", ground: ["#45263a", "#744358"], patch: "#8f5a74", road: "#ffd9ec", accent: "#ffcf4a", decos: ["lollipop", "cookie", "cottonBush"], particle: "firefly", night: true },
  { name: "Caramel Ridge", ground: ["#55281a", "#8a482a"], patch: "#a8603a", road: "#ffe2c4", accent: "#ff7a3d", decos: ["cookie", "gumdrop", "candyCane"], particle: "ember", night: true },
  { name: "Jelly Caverns", ground: ["#251658", "#523a9a"], patch: "#6c4cc0", road: "#e6dcff", accent: "#3ee6c4", decos: ["gumdrop", "gumdrop", "lollipop"], particle: "sparkle", night: true },
  { name: "Cotton Cloud Kingdom", ground: ["#e2d2ff", "#ffe2f2"], patch: "#ffffff", road: "#ffffff", accent: "#ff5fa8", decos: ["cottonBush", "cupcake", "lollipop"], particle: "sparkle", night: false },
  { name: "Sprinkle Night", ground: ["#170f48", "#382888"], patch: "#4a38a8", road: "#ffe9f6", accent: "#ffd84a", decos: ["lollipop", "gumdrop", "donut"], particle: "star", night: true },
  { name: "Rainbow Coast", ground: ["#1c5262", "#37999c"], patch: "#52b8b8", road: "#e8fff8", accent: "#ff6fa8", decos: ["donut", "iceCream", "candyCane"], particle: "snow", night: true },
];

/** Index into WORLDS for a level; past the last world they repeat. */
export const worldIndex = (n: number): number => Math.floor((Math.max(1, n) - 1) / LEVELS_PER_WORLD);
export const worldOf = (n: number): World => WORLDS[worldIndex(n) % WORLDS.length]!;
export const worldStart = (w: number): number => w * LEVELS_PER_WORLD + 1;

/** Horizontal position of the road at height t: a sweeping S-curve whose swing breathes slowly. */
export function pathX(t: number): number {
  const swing = 0.26 + 0.06 * Math.sin(t * 0.37 + 1.1);
  return 0.5 + swing * Math.sin(t * 0.82 + 0.4);
}

/** The node for level n. */
export const nodeX = (n: number): number => pathX(n);

/** How many levels the map shows: the calibrated set, or further if the player has gone beyond it. */
export const mapLength = (next: number, calibrated: number): number =>
  Math.max(calibrated, Math.ceil(next / LEVELS_PER_WORLD) * LEVELS_PER_WORLD);

export type NodeStatus = "cleared" | "current" | "locked";

export function nodeStatus(n: number, j: { next: number; stars: Record<number, number> }): NodeStatus {
  if (n === j.next) return "current";
  if ((j.stars[n] ?? 0) > 0 || n < j.next) return "cleared";
  return "locked";
}

export interface Decoration { x: number; y: number; kind: Deco; scale: number; flip: boolean; phase: number }

/**
 * Scenery around level n: a few pieces scattered in the band between n and n + 1, never on the road.
 * Seeded by the level, so the landscape is the same every time the map opens.
 */
export function decorFor(n: number): Decoration[] {
  const rng = seeded(`map:${n}`);
  const decos = worldOf(n).decos;
  const out: Decoration[] = [];
  const count = 2 + Math.floor(rng() * 2);
  for (let guard = 0; out.length < count && guard < 24; guard++) {
    const y = n + rng();
    const x = 0.05 + rng() * 0.9;
    if (Math.abs(x - pathX(y)) < 0.17) continue; // keep the road clear
    if (out.some((d) => Math.abs(d.x - x) < 0.12 && Math.abs(d.y - y) < 0.35)) continue;
    out.push({ x, y, kind: decos[Math.floor(rng() * decos.length)]!, scale: 0.75 + rng() * 0.5, flip: rng() < 0.5, phase: rng() * Math.PI * 2 });
  }
  return out;
}

export interface WorldProgress { cleared: number; stars: number; maxStars: number; first: number; locked: boolean }

/**
 * How far the player is through world w: levels cleared, stars earned out of the most possible,
 * and the first level still worth playing (the first one without three stars).
 */
export function worldProgress(w: number, j: { next: number; stars: Record<number, number> }): WorldProgress {
  const start = worldStart(w);
  let cleared = 0;
  let stars = 0;
  let first = -1;
  for (let n = start; n < start + LEVELS_PER_WORLD; n++) {
    const s = j.stars[n] ?? 0;
    if (s > 0 || n < j.next) cleared++;
    stars += s;
    if (first < 0 && s < 3 && n <= j.next) first = n;
  }
  return { cleared, stars, maxStars: LEVELS_PER_WORLD * 3, first: first < 0 ? start : first, locked: start > j.next };
}

/** True when reaching level n means stepping into a new world. */
export const opensWorld = (n: number): boolean => n > 1 && (n - 1) % LEVELS_PER_WORLD === 0;

// ---- Landmarks: big cartoon buildings beside the road, two per world ---------------------------

export type LandmarkKind =
  | "cottage" | "beachHut" | "cabin" | "cloudHome" | "windmill" | "lighthouse" | "pyramid" | "tent" | "igloo"
  | "mushroom" | "witchTower" | "emberTower" | "crystalTower" | "volcano" | "castle" | "iceCastle" | "observatory" | "rocket"
  | "gingerbread" | "cakeTower" | "lollipopTower";

/** The two landmarks of each world, in world order (they repeat with the worlds). */
export const LANDMARKS: readonly (readonly [LandmarkKind, LandmarkKind])[] = [
  ["gingerbread", "windmill"], ["lighthouse", "cakeTower"], ["pyramid", "tent"], ["igloo", "gingerbread"], ["mushroom", "lollipopTower"],
  ["volcano", "cakeTower"], ["crystalTower", "observatory"], ["castle", "cloudHome"], ["observatory", "rocket"], ["iceCastle", "lollipopTower"],
];

export interface Landmark { x: number; y: number; kind: LandmarkKind; scale: number; flip: boolean; phase: number }

/** Where in a world its two landmarks stand, as offsets from the world's first level. */
export const LANDMARK_AT = [4, 10] as const;

/**
 * The landmark standing in the band above level n, if any: one at level 5 and one at level 11 of each
 * world, set well away from the road on whichever side has more room.
 */
export function landmarkFor(n: number): Landmark | null {
  const w = worldIndex(n);
  const slot = LANDMARK_AT.findIndex((o) => worldStart(w) + o === n);
  if (slot < 0) return null;
  const y = n + 0.45;
  const x = pathX(y) < 0.5 ? 0.83 : 0.17;
  return { x, y, kind: LANDMARKS[w % LANDMARKS.length]![slot]!, scale: 1, flip: x > 0.5, phase: seeded(`landmark:${n}`)() * Math.PI * 2 };
}
