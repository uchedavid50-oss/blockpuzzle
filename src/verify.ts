// Replays a game from its list of moves, using the real rules and the real tray generator, so a score
// can be checked instead of trusted. The server uses this to verify leaderboard submissions; the
// client records the same move list as it plays. Pure: no DOM, no storage.

import { PERFECT_BONUS, canPlace, emptyGrid, hasMoves, isEmpty, place, type Grid, type Shape } from "./board";
import { SHAPES, drawTray } from "./pieces";
import { seeded } from "./rng";

/** Bump when scoring, the rules or the piece set change: old replays no longer reproduce. */
export const RULES_VERSION = 1;
export const MAX_MOVES = 3000;

/** One placement: [catalogue index of the piece, row, column]. */
export type MoveTuple = readonly [shape: number, row: number, col: number];

export type ReplayResult =
  | { ok: true; score: number; moves: number; lines: number; over: boolean; grid: Grid }
  | { ok: false; error: string };

export function replay(seed: string, moves: readonly MoveTuple[]): ReplayResult {
  if (!Array.isArray(moves) || moves.length === 0) return { ok: false, error: "no moves" };
  if (moves.length > MAX_MOVES) return { ok: false, error: "too many moves" };

  let grid: Grid = emptyGrid();
  let combo = 0;
  let score = 0;
  let lines = 0;
  let trayNo = 0;
  let tray: (Shape | null)[] = drawTray(grid, seeded(`${seed}:${trayNo++}`));

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!Array.isArray(m) || m.length !== 3 || !m.every((n) => Number.isInteger(n))) return { ok: false, error: `move ${i}: malformed` };
    const [idx, row, col] = m as unknown as MoveTuple;
    const shape = SHAPES[idx];
    if (!shape) return { ok: false, error: `move ${i}: unknown piece` };
    const slot = tray.indexOf(shape);
    if (slot < 0) return { ok: false, error: `move ${i}: piece is not in the tray` };
    if (!canPlace(grid, shape, row, col)) return { ok: false, error: `move ${i}: illegal placement` };

    const res = place(grid, shape, row, col, combo);
    const cleared = res.rowsCleared.length + res.colsCleared.length + res.regionsCleared.length;
    score += res.points + (cleared > 0 && isEmpty(res.grid) ? PERFECT_BONUS : 0);
    lines += cleared;
    combo = res.combo;
    grid = res.grid;
    tray[slot] = null;
    if (tray.every((s) => s === null)) tray = drawTray(grid, seeded(`${seed}:${trayNo++}`));
  }
  const over = !hasMoves(grid, tray.filter((s): s is Shape => s !== null));
  return { ok: true, score, moves: moves.length, lines, over, grid };
}
