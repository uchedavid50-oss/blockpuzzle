// A greedy bot that plays a seeded sequence of trays. Run offline (scripts/make-par.ts) to
// give each day's daily a "par" score, so a score has a scale to be read against.
// It plays by the real rules and the real tray generator; it never sees the human's game.

import { PERFECT_BONUS, SIZE, canPlace, emptyGrid, isEmpty, place, type Grid, type RegionShape, type Shape } from "./board";
import { drawTray, shapeIndex } from "./pieces";
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
export interface Rules { regions: boolean | RegionShape }
const DEFAULT_RULES: Rules = { regions: true };

/**
 * Looks ahead across the whole tray: tries the pieces in every order, keeping only the few most
 * promising placements at each step (a beam), and returns the sequence that ends best.
 */
function plan(grid: Grid, tray: readonly (Shape | null)[], combo: number, beam: number, rules: Rules): { total: number; moves: Move[] } {
  const search = (g: Grid, left: number[], cmb: number): { total: number; moves: Move[] } => {
    let best = { total: -clutter(g), moves: [] as Move[] };
    for (const i of left) {
      const shape = tray[i]!;
      const options: { r: number; c: number; res: ReturnType<typeof place>; rank: number }[] = [];
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
          if (!canPlace(g, shape, r, c)) continue;
          const res = place(g, shape, r, c, cmb, rules.regions);
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

export interface BotRun { score: number; lines: number; moves: number; doubles: number; ones: number; dead: boolean }

/**
 * Plays tray by tray until `stop` says so, the move cap is hit, or nothing fits. `start` lets a
 * journey level begin from a pre-filled board. `avoidOnes` keeps the bot off 1x1 pieces when it can.
 */
export function playBot(opts: {
  seed: string; maxMoves?: number; start?: Grid; beam?: number; rules?: Rules;
  stop?: (r: BotRun) => boolean;
  /** Receives every placement as [piece index, row, col], so a game can be replayed or submitted. */
  moveLog?: [number, number, number][];
}): BotRun {
  const { seed, maxMoves = 120, beam = 3, rules = DEFAULT_RULES } = opts;
  let grid = opts.start ?? emptyGrid();
  const run: BotRun = { score: 0, lines: 0, moves: 0, doubles: 0, ones: 0, dead: false };
  let combo = 0;
  let trayNo = 0;
  while (run.moves < maxMoves) {
    const tray = drawTray(grid, seeded(`${seed}:${trayNo++}`)) as (Shape | null)[];
    const { moves: seq } = plan(grid, tray, combo, beam, rules);
    if (seq.length === 0) { run.dead = true; break; }
    for (const m of seq) {
      if (run.moves >= maxMoves) break;
      const shape = tray[m.i]!;
      const res = place(grid, shape, m.r, m.c, combo, rules.regions);
      const lines = res.rowsCleared.length + res.colsCleared.length + res.regionsCleared.length;
      grid = res.grid;
      run.score += res.points + (lines > 0 && isEmpty(res.grid) ? PERFECT_BONUS : 0);
      opts.moveLog?.push([shapeIndex(shape), m.r, m.c]);
      run.lines += lines;
      run.moves++;
      if (lines >= 2) run.doubles++;
      if (shape.length === 1) run.ones++;
      combo = res.combo;
      if (opts.stop?.(run)) return run;
    }
    // A plan may leave a piece unplaced; the real game would too, but then the bot is stuck.
    if (seq.length < tray.filter(Boolean).length) { run.dead = true; break; }
  }
  return run;
}

export interface SolveResult { score: number; moves: number }

/** The score a bot reaches in up to `maxMoves` placements: the basis for each day's par. */
export function greedyScore(seed: string, maxMoves = 120, start: Grid = emptyGrid(), beam = 3): SolveResult {
  const r = playBot({ seed, maxMoves, start, beam });
  return { score: r.score, moves: r.moves };
}
