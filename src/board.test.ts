import { describe, expect, it } from "vitest";
import { PERFECT_BONUS, REGION_COUNT, clearCells, clearedCells, fullestLine, isEmpty, regionCells, regionOf, SIZE, canPlace, canPlaceAnywhere, emptyGrid, hasMoves, place, type Grid, type Shape } from "./board";

const dot: Shape = [[0, 0]];
const h = (n: number): Shape => Array.from({ length: n }, (_, i) => [0, i] as const);
const v = (n: number): Shape => Array.from({ length: n }, (_, i) => [i, 0] as const);

function filled(cells: [number, number][]): Grid {
  const g = emptyGrid().map((r) => r.slice());
  for (const [r, c] of cells) g[r]![c] = true;
  return g;
}

describe("canPlace", () => {
  it("accepts in-bounds empty cells", () => expect(canPlace(emptyGrid(), h(3), 0, 0)).toBe(true));
  it("rejects out of bounds on every edge", () => {
    expect(canPlace(emptyGrid(), h(3), 0, SIZE - 2)).toBe(false);
    expect(canPlace(emptyGrid(), v(3), SIZE - 2, 0)).toBe(false);
    expect(canPlace(emptyGrid(), dot, -1, 0)).toBe(false);
    expect(canPlace(emptyGrid(), dot, 0, -1)).toBe(false);
  });
  it("rejects overlap", () => expect(canPlace(filled([[2, 2]]), h(3), 2, 0)).toBe(false));
  it("allows exact edge fit", () => expect(canPlace(emptyGrid(), h(3), SIZE - 1, SIZE - 3)).toBe(true));
});

describe("place", () => {
  it("does not mutate the input grid", () => {
    const g = emptyGrid();
    place(g, dot, 0, 0);
    expect(g[0]![0]).toBe(false);
  });
  it("throws on illegal placement", () => expect(() => place(emptyGrid(), h(3), 0, 7)).toThrow());
  it("clears a full row", () => {
    const g = filled(Array.from({ length: 7 }, (_, c) => [3, c] as [number, number]));
    const res = place(g, dot, 3, 7);
    expect(res.rowsCleared).toEqual([3]);
    expect(res.grid[3]!.every((x) => !x)).toBe(true);
  });
  it("clears a full column", () => {
    const g = filled(Array.from({ length: 7 }, (_, r) => [r, 5] as [number, number]));
    const res = place(g, dot, 7, 5);
    expect(res.colsCleared).toEqual([5]);
    expect(res.grid.every((r) => !r[5])).toBe(true);
  });
  it("clears a row and column together, including the crossing cell", () => {
    const cells: [number, number][] = [];
    for (let i = 0; i < SIZE; i++) {
      if (i !== 4) cells.push([4, i], [i, 4]);
    }
    const res = place(filled(cells), dot, 4, 4);
    expect(res.rowsCleared).toEqual([4]);
    expect(res.colsCleared).toEqual([4]);
    expect(res.grid.flat().some(Boolean)).toBe(false);
  });
  it("leaves cells in other lines untouched", () => {
    const cells: [number, number][] = Array.from({ length: 7 }, (_, c) => [0, c] as [number, number]);
    cells.push([1, 1]);
    const res = place(filled(cells), dot, 0, 7);
    expect(res.grid[1]![1]).toBe(true);
  });
  it("scores more for simultaneous clears", () => {
    const one = place(filled(Array.from({ length: 7 }, (_, c) => [0, c] as [number, number])), dot, 0, 7);
    expect(one.points).toBe(1 + SIZE);
    expect(place(emptyGrid(), dot, 0, 0).points).toBe(1);
  });
});

describe("game over", () => {
  it("canPlaceAnywhere is false on a full board", () => {
    const g = filled(Array.from({ length: SIZE * SIZE }, (_, i) => [Math.floor(i / SIZE), i % SIZE] as [number, number]));
    expect(canPlaceAnywhere(g, dot)).toBe(false);
  });
  it("hasMoves true if any shape fits", () => {
    const g = filled(Array.from({ length: SIZE * SIZE - 1 }, (_, i) => [Math.floor(i / SIZE), i % SIZE] as [number, number]));
    expect(hasMoves(g, [h(2), dot])).toBe(true);
    expect(hasMoves(g, [h(2), v(2)])).toBe(false);
  });
});

describe("combo scoring", () => {
  it("leaves the line bonus untouched at combo 0", () => {
    const g = filled(Array.from({ length: 7 }, (_, i) => [0, i] as [number, number]));
    const res = place(g, dot, 0, 7, 0);
    expect(res.rowsCleared).toEqual([0]);
    expect(res.points).toBe(1 + SIZE); // 1 cell + 8 * 1 line^2 * 1.0
  });

  it("scales the line bonus by the combo and carries the streak forward", () => {
    const g = filled(Array.from({ length: 7 }, (_, i) => [0, i] as [number, number]));
    const res = place(g, dot, 0, 7, 2);
    expect(res.points).toBe(1 + SIZE * 2); // 8 * 1 * (1 + 0.5 * 2) = 16
    expect(res.combo).toBe(3);
  });

  it("resets the combo on a move that clears nothing", () => {
    expect(place(emptyGrid(), dot, 4, 4, 5).combo).toBe(0);
  });

  it("gives no bonus at all when nothing clears, whatever the combo", () => {
    expect(place(emptyGrid(), dot, 4, 4, 9).points).toBe(1);
  });
});


describe("perfect clear", () => {
  it("isEmpty is true only for a blank board", () => {
    expect(isEmpty(emptyGrid())).toBe(true);
    expect(isEmpty(filled([[4, 4]]))).toBe(false);
  });
  it("clearing the last blocks leaves an empty board", () => {
    const g = filled(Array.from({ length: 7 }, (_, c) => [2, c] as [number, number]));
    const res = place(g, dot, 2, 7);
    expect(res.rowsCleared).toEqual([2]);
    expect(isEmpty(res.grid)).toBe(true);
  });
  it("a clear that leaves other blocks behind is not perfect", () => {
    const cells = Array.from({ length: 7 }, (_, c) => [2, c] as [number, number]);
    cells.push([5, 5]);
    expect(isEmpty(place(filled(cells), dot, 2, 7).grid)).toBe(false);
  });
  it("the bonus is a positive constant", () => expect(PERFECT_BONUS).toBeGreaterThan(0));
});

describe("2x4 regions", () => {
  it("there are eight regions that tile the board exactly once", () => {
    expect(REGION_COUNT).toBe(8);
    const seen = new Set<number>();
    for (let i = 0; i < REGION_COUNT; i++) for (const [r, c] of regionCells(i)) { seen.add(r * SIZE + c); expect(regionOf(r, c)).toBe(i); }
    expect(seen.size).toBe(SIZE * SIZE);
  });
  it("filling a 2x4 region clears it, without needing a full row or column", () => {
    const cells = regionCells(0).filter(([r, c]) => !(r === 1 && c === 3));
    const res = place(filled(cells as [number, number][]), dot, 1, 3);
    expect(res.regionsCleared).toEqual([0]);
    expect(res.rowsCleared).toEqual([]);
    expect(res.colsCleared).toEqual([]);
    expect(isEmpty(res.grid)).toBe(true);
  });
  it("regions are 2 rows by 4 columns, so a 4x2 block elsewhere does not count", () => {
    const cells: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]];
    const res = place(filled(cells), dot, 3, 1);
    expect(res.regionsCleared).toEqual([]);
  });
  it("a row and the region it completes score together and clear in one pass", () => {
    // Row 1 and region 0 (rows 0-1, cols 0-3) both complete with the last cell at (1,3).
    const cells: [number, number][] = [];
    for (let c = 0; c < SIZE; c++) if (c !== 3) cells.push([1, c]);
    for (let c = 0; c < 4; c++) cells.push([0, c]);
    const res = place(filled(cells), dot, 1, 3);
    expect(res.rowsCleared).toEqual([1]);
    expect(res.regionsCleared).toEqual([0]);
    expect(res.points).toBe(1 + SIZE * 4); // two "lines" at once: 8 * 2^2
    expect(res.grid[0]!.slice(0, 4).every((x) => !x)).toBe(true);
  });
  it("classic rules (regions off) ignore regions", () => {
    const cells = regionCells(0).filter(([r, c]) => !(r === 1 && c === 3));
    const res = place(filled(cells as [number, number][]), dot, 1, 3, 0, false);
    expect(res.regionsCleared).toEqual([]);
    expect(res.grid[1]![3]).toBe(true);
  });
  it("clearedCells lists each cell once even when lines cross", () => {
    const list = clearedCells({ rowsCleared: [0], colsCleared: [0], regionsCleared: [0] });
    const keys = list.map(([r, c]) => r * SIZE + c);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(18); // row 0 (8) + column 0 (7 new) + region 0 (3 new)
  });
});

describe("fullestLine (zen rescue)", () => {
  it("returns null on an empty board", () => expect(fullestLine(emptyGrid())).toBeNull());
  it("picks the line nearest to full that is not already full", () => {
    const g = filled([[2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6]]); // row 2 is 7/8
    const best = fullestLine(g)!;
    expect(best.kind).toBe("row");
    expect(best.index).toBe(2);
    expect(best.cells.length).toBe(8);
  });
  it("clearing it frees the cells", () => {
    const g = filled([[2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6]]);
    const cleared = clearCells(g, fullestLine(g)!.cells);
    expect(isEmpty(cleared)).toBe(true);
  });
});
