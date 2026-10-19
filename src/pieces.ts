import { canPlaceAnywhere, type Grid, type Shape } from "./board.js";

// Fixed orientations only: the player cannot rotate, so rotated variants are separate entries.
const rect = (h: number, w: number): Shape =>
  Array.from({ length: h * w }, (_, i) => [Math.floor(i / w), i % w] as const);

export const SHAPES: readonly Shape[] = [
  rect(1, 1),
  rect(1, 2), rect(2, 1),
  rect(1, 3), rect(3, 1),
  rect(1, 4), rect(4, 1),
  rect(1, 5), rect(5, 1),
  rect(2, 2), rect(3, 3), rect(2, 3), rect(3, 2),
  // L corners (3 cells)
  [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 0]],
  [[0, 0], [0, 1], [1, 1]], [[0, 1], [1, 0], [1, 1]],
  // Big L corners (5 cells)
  [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]],
  // Tall/wide L (4 cells)
  [[0, 0], [1, 0], [2, 0], [2, 1]], [[0, 1], [1, 1], [2, 0], [2, 1]],
  [[0, 0], [0, 1], [1, 0], [2, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [1, 1], [1, 2]], [[0, 0], [0, 1], [0, 2], [1, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 2]], [[0, 2], [1, 0], [1, 1], [1, 2]],
  // T shapes
  [[0, 0], [0, 1], [0, 2], [1, 1]], [[0, 1], [1, 0], [1, 1], [1, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 1], [1, 0], [1, 1], [2, 1]],
  // S/Z shapes
  [[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 1], [1, 0], [1, 1], [2, 0]],
];

/**
 * How strongly the draw favours small pieces. Weight for a shape = 1 / cells^SIZE_BIAS.
 * Measured over 2000 simulated games of competent play (median moves per game):
 *   0.0 (uniform) -> 26    1.0 -> 38    1.5 -> 50    2.0 -> 74
 * Higher = longer, gentler games. This is the main difficulty dial.
 */
export const SIZE_BIAS = 1.5;

const WEIGHTS: readonly number[] = SHAPES.map((s) => 1 / Math.pow(s.length, SIZE_BIAS));
const TOTAL_WEIGHT = WEIGHTS.reduce((a, b) => a + b, 0);

function drawOne(rng: () => number): Shape {
  let x = rng() * TOTAL_WEIGHT;
  for (let i = 0; i < SHAPES.length; i++) {
    x -= WEIGHTS[i]!;
    if (x <= 0) return SHAPES[i]!;
  }
  return SHAPES[SHAPES.length - 1]!;
}

/**
 * Draws a tray of three pieces, weighted toward smaller shapes.
 *
 * Reads the board ONLY to guarantee at least one of the three fits somewhere, so the
 * player is never handed an unwinnable tray. It does not read the score, the streak or
 * any history: difficulty comes from the board filling up, never from how well you are
 * doing. Keep it that way.
 */
export function drawTray(grid: Grid, rng: () => number = Math.random): Shape[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const tray = [drawOne(rng), drawOne(rng), drawOne(rng)];
    if (tray.some((s) => canPlaceAnywhere(grid, s))) return tray;
  }
  // Board is so full that nothing fits: return a tray anyway and let the game end.
  return [drawOne(rng), drawOne(rng), drawOne(rng)];
}

/** Index of a shape in SHAPES, for saving a game in progress. -1 if it is not a catalogue shape. */
export function shapeIndex(shape: Shape): number {
  return SHAPES.indexOf(shape);
}

/** The catalogue shape at an index, or null if the index is not valid. */
export function shapeAt(i: number): Shape | null {
  return SHAPES[i] ?? null;
}
