import { describe, expect, it } from "vitest";
import { LEVELS_PER_WORLD, WORLDS, decorFor, mapLength, nodeStatus, nodeX, pathX, worldIndex, worldOf, worldStart } from "./map";

describe("path", () => {
  it("keeps every node well inside the map", () => {
    for (let n = 1; n <= 300; n++) {
      expect(nodeX(n)).toBeGreaterThan(0.15);
      expect(nodeX(n)).toBeLessThan(0.85);
    }
  });
  it("is continuous: the road never jumps between two close heights", () => {
    for (let t = 0; t < 160; t += 0.05) expect(Math.abs(pathX(t + 0.05) - pathX(t))).toBeLessThan(0.03);
  });
  it("puts nodes on the road", () => expect(nodeX(42)).toBe(pathX(42)));
});

describe("worlds", () => {
  it("groups levels into worlds", () => {
    expect(worldIndex(1)).toBe(0);
    expect(worldIndex(LEVELS_PER_WORLD)).toBe(0);
    expect(worldIndex(LEVELS_PER_WORLD + 1)).toBe(1);
    expect(worldStart(1)).toBe(LEVELS_PER_WORLD + 1);
  });
  it("covers the 150 calibrated levels with distinct worlds, then repeats", () => {
    expect(WORLDS.length * LEVELS_PER_WORLD).toBe(150);
    expect(worldOf(151)).toBe(worldOf(1));
  });
  it("shows the calibrated levels, or whole worlds beyond them", () => {
    expect(mapLength(1, 150)).toBe(150);
    expect(mapLength(152, 150)).toBe(165);
  });
});

describe("nodeStatus", () => {
  const j = { next: 4, stars: { 1: 3, 2: 1, 3: 2 } };
  it("marks progress", () => {
    expect(nodeStatus(2, j)).toBe("cleared");
    expect(nodeStatus(4, j)).toBe("current");
    expect(nodeStatus(5, j)).toBe("locked");
  });
});

describe("decorFor", () => {
  it("is the same scenery every time", () => expect(decorFor(9)).toEqual(decorFor(9)));
  it("never blocks the road and stays on the map", () => {
    for (let n = 1; n <= 150; n++)
      for (const d of decorFor(n)) {
        expect(Math.abs(d.x - pathX(d.y))).toBeGreaterThanOrEqual(0.17);
        expect(d.x).toBeGreaterThan(0);
        expect(d.x).toBeLessThan(1);
        expect(worldOf(n).decos).toContain(d.kind);
      }
  });
});
