// A greedy bot that plays a seeded sequence of trays. Run offline (scripts/make-par.ts) to
// give each day's daily a "par" score, so a score has a scale to be read against.
// It plays by the real rules and the real tray generator; it never sees the human's game.

import { SIZE, canPlace, emptyGrid, place, type Grid, type Shape } from "./board";
import { drawTray } from "./pieces";
import { seeded } from "./rng";

/** How bad a board is to leave behind: cells walled in by blocks are hard to ever fill. */
function clutter(grid: Grid): number {
  let dead = 0;
  let tight = 0;
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      if (grid[r]![c]) continue;
      let filled = 0;
      if (r === 0 || grid[r - 1]![c]) filled++;
      if (r === SIZE - 1 || grid[r + 1]![c]) filled++;
      if (c === 0 || grid[r]![c - 1]) filled++;
      if (c === SIZE - 1 || grid[r]![c + 1]) filled++;
      if (filled === 4) dead++;
      else if (filled === 3) tight++;
    }
  return dead * 6 + tight * 1.5;
}

export interface SolveResult { score: number; moves: number }

interface Move { i: number; r: number; c: number }

/**
 * Looks ahead across the whole tray: tries the pieces in every order, keeping only the few most
 * promising placements at each step (a beam), and returns the sequence that ends best.
 */
function plan(grid: Grid, tray: readonly (Shape | null)[], combo: number, beam: number): { total: number; moves: Move[] } {
  const search = (g: Grid, left: number[], cmb: number): { total: number; moves: Move[] } => {
    let best = { total: -clutter(g), moves: [] as Move[] };
    for (const i of left) {
      const shape = tray[i]!;
      const options: { r: number; c: number; res: ReturnType<typeof place>; rank: number }[] = [];
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
          if (!canPlace(g, shape, r, c)) continue;
          const res = place(g, shape, r, c, cmb);
          options.push({ r, c, res, rank: res.points * 3 - clutter(res.grid) });
        }
      options.sort((x, y) => y.rank - x.rank);
      for (const o of options.slice(0, beam)) {
        const rest = search(o.res.grid, left.filter((k) => k !== i), o.res.combo);
        const total = o.res.points * 3 + rest.total;
        if (total > best.total || (best.moves.length === 0 && total >= best.total))
          best = { total, moves: [{ i, r: o.r, c: o.c }, ...rest.moves] };
      }
    }
    return best;
  };
  const left = tray.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  return search(grid, left, combo);
}

/**
 * Plays up to `maxMoves` placements tray by tray. `start` lets a journey level begin from a
 * pre-filled board.
 */
export function greedyScore(seed: string, maxMoves = 120, start: Grid = emptyGrid(), beam = 3): SolveResult {
  let grid = start;
  let score = 0;
  let combo = 0;
  let moves = 0;
  let trayNo = 0;
  while (moves < maxMoves) {
    const tray = drawTray(grid, seeded(`${seed}:${trayNo++}`)) as (Shape | null)[];
    const { moves: seq } = plan(grid, tray, combo, beam);
    if (seq.length === 0) break; // nothing fits: the game is over
    for (const m of seq) {
      if (moves >= maxMoves) break;
      const res = place(grid, tray[m.i]!, m.r, m.c, combo);
      grid = res.grid;
      score += res.points;
      combo = res.combo;
      moves++;
    }
    // A plan may leave a piece unplaced; the real game would too, but then the bot is stuck.
    if (seq.length < tray.filter(Boolean).length) break;
  }
  return { score, moves };
}
