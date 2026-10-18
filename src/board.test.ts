import { describe, expect, it } from "vitest";
import { PERFECT_BONUS, isEmpty, SIZE, canPlace, canPlaceAnywhere, emptyGrid, hasMoves, place, type Grid, type Shape } from "./board";

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
