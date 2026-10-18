// Journey mode: numbered levels with a goal, each starting from a pre-filled board.
// Levels are generated from the level number alone, so they are identical for everyone and
// need no stored content. The piece generator is the normal one: it never reads the score.

import { REGION_COUNT, SIZE, regionCells, type Grid } from "./board";
import { seeded } from "./rng";

export type GoalKind = "score" | "lines" | "place";

export interface Level {
  n: number;
  seed: string; // drives the piece sequence
  prefill: Grid; // blocks already on the board
  goal: { kind: GoalKind; target: number };
  parMoves: number; // placements for a 3-star clear
}

export const GOAL_LABEL: Record<GoalKind, string> = { score: "Reach", lines: "Clear lines", place: "Place pieces" };

function lineComplete(g: boolean[][]): boolean {
  for (let i = 0; i < SIZE; i++) {
    if (g[i]!.every(Boolean)) return true;
    if (g.every((r) => r[i])) return true;
  }
  for (let i = 0; i < REGION_COUNT; i++) if (regionCells(i).every(([r, c]) => g[r]![c])) return true;
  return false;
}

/** A scattering of blocks that never completes a row, column or region on its own. */
export function prefillFor(n: number): Grid {
  const rng = seeded(`journey-fill:${n}`);
  const density = Math.min(0.5, 0.1 + 0.011 * n);
  const target = Math.round(density * SIZE * SIZE);
  const g: boolean[][] = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
  let placed = 0;
  let guard = 0;
  while (placed < target && guard++ < 2000) {
    const r = Math.floor(rng() * SIZE);
    const c = Math.floor(rng() * SIZE);
    if (g[r]![c]) continue;
    g[r]![c] = true;
    if (lineComplete(g)) g[r]![c] = false; // never hand the player a free clear
    else placed++;
  }
  return g;
}

export function makeLevel(n: number): Level {
  const level = Math.max(1, Math.floor(n));
  const kind: GoalKind = (["score", "lines", "place"] as const)[(level - 1) % 3]!;
  const target =
    kind === "score" ? 150 + 40 * level
    : kind === "lines" ? Math.min(40, 4 + Math.floor(level / 2))
    : Math.min(120, 18 + level);
  const parMoves =
    kind === "score" ? Math.ceil(target / 16)
    : kind === "lines" ? Math.ceil(target * 2.4)
    : target; // "place" levels are about surviving, so par is simply the target
  return { n: level, seed: `j-${level}`, prefill: prefillFor(level), goal: { kind, target }, parMoves };
}

export interface LevelProgress { score: number; lines: number; moves: number }

/** How far along the goal is, as a value that can be shown against `goal.target`. */
export function goalValue(level: Level, p: LevelProgress): number {
  return level.goal.kind === "score" ? p.score : level.goal.kind === "lines" ? p.lines : p.moves;
}

export const goalReached = (level: Level, p: LevelProgress): boolean => goalValue(level, p) >= level.goal.target;

/** 3 stars for a tight clear, 2 for a decent one, 1 for just finishing. */
export function starsFor(level: Level, p: LevelProgress): 1 | 2 | 3 {
  if (level.goal.kind === "place") {
    const per = p.score / Math.max(1, p.moves); // surviving well means scoring along the way
    return per >= 14 ? 3 : per >= 9 ? 2 : 1;
  }
  return p.moves <= level.parMoves ? 3 : p.moves <= level.parMoves * 1.5 ? 2 : 1;
}

export function goalText(level: Level): string {
  const { kind, target } = level.goal;
  return kind === "score" ? `Reach ${target.toLocaleString("en-US")} points`
    : kind === "lines" ? `Clear ${target} lines`
    : `Place ${target} pieces`;
}
