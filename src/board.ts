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

/**
 * Besides rows and columns, a filled 2x4 region clears too. The 8x8 board splits into eight such
 * regions (four bands of two rows, each cut into a left and right half). Every placement now has
 * two independent ways to score, so near-misses are denser and combos are reachable from more spots.
 */
export const REGION_H = 2;
export const REGION_W = 4;
export const REGIONS_ACROSS = SIZE / REGION_W;
export const REGION_COUNT = (SIZE / REGION_H) * REGIONS_ACROSS;

export function regionOf(r: number, c: number): number {
  return Math.floor(r / REGION_H) * REGIONS_ACROSS + Math.floor(c / REGION_W);
}

export function regionCells(index: number): Cell[] {
  const r0 = Math.floor(index / REGIONS_ACROSS) * REGION_H;
  const c0 = (index % REGIONS_ACROSS) * REGION_W;
  const out: Cell[] = [];
  for (let r = 0; r < REGION_H; r++) for (let c = 0; c < REGION_W; c++) out.push([r0 + r, c0 + c]);
  return out;
}

export interface PlaceResult {
  grid: Grid;
  rowsCleared: number[];
  colsCleared: number[];
  regionsCleared: number[];
  /** Points for this move: 1 per cell placed, plus a line bonus scaled by the combo. */
  points: number;
  /** Combo count to carry into the next move: grows while you keep clearing, resets when you don't. */
  combo: number;
}

/** Every cell a result cleared, each listed once. */
export function clearedCells(res: Pick<PlaceResult, "rowsCleared" | "colsCleared" | "regionsCleared">): Cell[] {
  const seen = new Set<number>();
  const out: Cell[] = [];
  const add = (r: number, c: number): void => {
    const k = r * SIZE + c;
    if (!seen.has(k)) { seen.add(k); out.push([r, c]); }
  };
  for (const r of res.rowsCleared) for (let c = 0; c < SIZE; c++) add(r, c);
  for (const c of res.colsCleared) for (let r = 0; r < SIZE; r++) add(r, c);
  for (const i of res.regionsCleared) for (const [r, c] of regionCells(i)) add(r, c);
  return out;
}

/**
 * Places a shape (must be legal) and clears any completed rows, columns and 2x4 regions. Does not
 * mutate input. `combo` is how many consecutive prior moves cleared something; it multiplies the
 * line bonus. Set `regions` to false for the classic rows-and-columns-only rules.
 */
export function place(grid: Grid, shape: Shape, row: number, col: number, combo = 0, regions = true): PlaceResult {
  if (!canPlace(grid, shape, row, col)) throw new Error("illegal placement");
  const next = grid.map((r) => r.slice());
  for (const [dr, dc] of shape) next[row + dr]![col + dc] = true;

  const rowsCleared: number[] = [];
  const colsCleared: number[] = [];
  const regionsCleared: number[] = [];
  for (let i = 0; i < SIZE; i++) {
    if (next[i]!.every(Boolean)) rowsCleared.push(i);
    if (next.every((r) => r[i])) colsCleared.push(i);
  }
  if (regions)
    for (let i = 0; i < REGION_COUNT; i++) if (regionCells(i).every(([r, c]) => next[r]![c])) regionsCleared.push(i);

  // Clear only after all detection, so crossing lines and regions all fire together.
  for (const [r, c] of clearedCells({ rowsCleared, colsCleared, regionsCleared })) next[r]![c] = false;

  const lines = rowsCleared.length + colsCleared.length + regionsCleared.length;
  const bonus = lines > 0 ? Math.round(SIZE * lines * lines * (1 + 0.5 * combo)) : 0;
  return {
    grid: next,
    rowsCleared,
    colsCleared,
    regionsCleared,
    points: shape.length + bonus,
    combo: lines > 0 ? combo + 1 : 0,
  };
}

/**
 * The row, column or region that is closest to full without being full (ties go to rows first).
 * Zen mode clears it when no piece fits, so the game never ends. Null only on an empty board.
 */
export function fullestLine(grid: Grid): { kind: "row" | "col" | "region"; index: number; cells: Cell[] } | null {
  let best: { kind: "row" | "col" | "region"; index: number; cells: Cell[] } | null = null;
  let bestCount = 0;
  const consider = (kind: "row" | "col" | "region", index: number, cells: Cell[]): void => {
    const n = cells.filter(([r, c]) => grid[r]![c]).length;
    if (n < cells.length && n > bestCount) { best = { kind, index, cells }; bestCount = n; }
  };
  for (let i = 0; i < SIZE; i++) {
    consider("row", i, Array.from({ length: SIZE }, (_, c) => [i, c] as Cell));
    consider("col", i, Array.from({ length: SIZE }, (_, r) => [r, i] as Cell));
  }
  for (let i = 0; i < REGION_COUNT; i++) consider("region", i, regionCells(i));
  return best;
}

export function clearCells(grid: Grid, cells: readonly Cell[]): Grid {
  const next = grid.map((r) => r.slice());
  for (const [r, c] of cells) next[r]![c] = false;
  return next;
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

/** Extra points for clearing the whole board. */
export const PERFECT_BONUS = 100;

export function isEmpty(grid: Grid): boolean {
  return grid.every((row) => row.every((c) => !c));
}
