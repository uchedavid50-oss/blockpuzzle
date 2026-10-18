// Pure game logic. No DOM, no rendering, no imports.

export const SIZE = 8;

export type Cell = readonly [row: number, col: number];
/** A piece shape: filled cells as [row, col] offsets from its top-left. */
export type Shape = readonly Cell[];
export type Grid = readonly (readonly boolean[])[];

export function emptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

export function canPlace(grid: Grid, shape: Shape, row: number, col: number): boolean {
  return shape.every(([dr, dc]) => {
    const r = row + dr;
    const c = col + dc;
    return inBounds(r, c) && !grid[r]![c];
  });
}

export interface PlaceResult {
  grid: Grid;
  rowsCleared: number[];
  colsCleared: number[];
  /** Points for this move: 1 per cell placed, plus a line bonus scaled by the combo. */
  points: number;
  /** Combo count to carry into the next move: grows while you keep clearing, resets when you don't. */
  combo: number;
}

/**
 * Places a shape (must be legal) and clears any completed rows/columns. Does not mutate input.
 * `combo` is how many consecutive prior moves cleared something; it multiplies the line bonus.
 */
export function place(grid: Grid, shape: Shape, row: number, col: number, combo = 0): PlaceResult {
  if (!canPlace(grid, shape, row, col)) throw new Error("illegal placement");
  const next = grid.map((r) => r.slice());
  for (const [dr, dc] of shape) next[row + dr]![col + dc] = true;

  const rowsCleared: number[] = [];
  const colsCleared: number[] = [];
  for (let i = 0; i < SIZE; i++) {
    if (next[i]!.every(Boolean)) rowsCleared.push(i);
    if (next.every((r) => r[i])) colsCleared.push(i);
  }
  // Clear after detection so crossing lines both clear.
  for (const r of rowsCleared) for (let c = 0; c < SIZE; c++) next[r]![c] = false;
  for (const c of colsCleared) for (let r = 0; r < SIZE; r++) next[r]![c] = false;

  const lines = rowsCleared.length + colsCleared.length;
  const bonus = lines > 0 ? Math.round(SIZE * lines * lines * (1 + 0.5 * combo)) : 0;
  return {
    grid: next,
    rowsCleared,
    colsCleared,
    points: shape.length + bonus,
    combo: lines > 0 ? combo + 1 : 0,
  };
}

export function canPlaceAnywhere(grid: Grid, shape: Shape): boolean {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (canPlace(grid, shape, r, c)) return true;
  return false;
}

/** True if any of the given shapes still fits somewhere. False means game over. */
export function hasMoves(grid: Grid, shapes: readonly Shape[]): boolean {
  return shapes.some((s) => canPlaceAnywhere(grid, s));
}

export function shapeSize(shape: Shape): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const [r, c] of shape) {
    rows = Math.max(rows, r + 1);
    cols = Math.max(cols, c + 1);
  }
  return { rows, cols };
}
