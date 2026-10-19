// The journey map: a winding road up through themed worlds, one node per level.
// Pure geometry and data only (no DOM), so the layout is identical for everyone and testable.
// x values are fractions of the map's width; y is measured in levels (level n sits at y = n).

import { seeded } from "./rng";

export const LEVELS_PER_WORLD = 15;

export type Particle = "petal" | "bubble" | "dust" | "snow" | "firefly" | "ember" | "sparkle" | "star";
export type Deco = "tree" | "flower" | "palm" | "shell" | "cactus" | "rock" | "pine" | "mushroom" | "crystal" | "puff";

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
  { name: "Meadow Fields", ground: ["#5fbf5a", "#86d672"], patch: "#a4e58a", road: "#f4e3b5", accent: "#ff6f91", decos: ["tree", "tree", "flower"], particle: "petal", night: false },
  { name: "Coral Bay", ground: ["#2fa6cf", "#63d3e8"], patch: "#9cecf2", road: "#ffe7b0", accent: "#ff9f43", decos: ["palm", "shell", "rock"], particle: "bubble", night: false },
  { name: "Amber Dunes", ground: ["#e09a4a", "#f5c86e"], patch: "#fadb93", road: "#fff1d0", accent: "#3fb6ef", decos: ["cactus", "rock", "cactus"], particle: "dust", night: false },
  { name: "Frost Peaks", ground: ["#a9cdf0", "#e6f3ff"], patch: "#ffffff", road: "#d6e4f5", accent: "#7c6cff", decos: ["pine", "pine", "rock"], particle: "snow", night: false },
  { name: "Twilight Woods", ground: ["#241f4f", "#3f3a80"], patch: "#5550a0", road: "#c9b8ff", accent: "#ffcf4a", decos: ["mushroom", "pine", "mushroom"], particle: "firefly", night: true },
  { name: "Ember Ridge", ground: ["#3a1616", "#6a2c22"], patch: "#8a3a26", road: "#ffc29a", accent: "#ff7a3d", decos: ["rock", "crystal", "rock"], particle: "ember", night: true },
  { name: "Crystal Caverns", ground: ["#1d1840", "#3a2f6b"], patch: "#4c3f8a", road: "#b9f7ec", accent: "#3ee6c4", decos: ["crystal", "crystal", "rock"], particle: "sparkle", night: true },
  { name: "Cloud Kingdom", ground: ["#c7b8ff", "#ffd9ec"], patch: "#ffffff", road: "#ffffff", accent: "#ff5fa8", decos: ["puff", "puff", "flower"], particle: "sparkle", night: false },
  { name: "Starfall", ground: ["#0b1030", "#1e2a5c"], patch: "#2a3878", road: "#ffe9a8", accent: "#ffd84a", decos: ["crystal", "rock", "crystal"], particle: "star", night: true },
  { name: "Aurora Coast", ground: ["#0f2330", "#1f5464"], patch: "#2c7184", road: "#c8fff0", accent: "#6fffd2", decos: ["pine", "crystal", "pine"], particle: "snow", night: true },
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
  | "mushroom" | "witchTower" | "emberTower" | "crystalTower" | "volcano" | "castle" | "iceCastle" | "observatory" | "rocket";

/** The two landmarks of each world, in world order (they repeat with the worlds). */
export const LANDMARKS: readonly (readonly [LandmarkKind, LandmarkKind])[] = [
  ["cottage", "windmill"], ["lighthouse", "beachHut"], ["pyramid", "tent"], ["igloo", "cabin"], ["mushroom", "witchTower"],
  ["volcano", "emberTower"], ["crystalTower", "observatory"], ["castle", "cloudHome"], ["observatory", "rocket"], ["iceCastle", "cabin"],
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
