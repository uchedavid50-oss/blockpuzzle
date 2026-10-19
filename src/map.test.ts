import { describe, expect, it } from "vitest";
import { LANDMARKS, LANDMARK_AT, LEVELS_PER_WORLD, WORLDS, decorFor, landmarkFor, mapLength, nodeStatus, nodeX, opensWorld, pathX, worldIndex, worldOf, worldProgress, worldStart } from "./map";

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

describe("worldProgress", () => {
  const j = { next: 18, stars: { 1: 3, 2: 2, 3: 3, 16: 1, 17: 3 } as Record<number, number> };
  it("counts levels cleared and stars in a world", () => {
    const w = worldProgress(1, j);
    expect(w.cleared).toBe(2);
    expect(w.stars).toBe(4);
    expect(w.maxStars).toBe(LEVELS_PER_WORLD * 3);
    expect(w.locked).toBe(false);
  });
  it("points at the first level short of three stars, never past the current one", () => {
    expect(worldProgress(0, j).first).toBe(2);
    expect(worldProgress(1, j).first).toBe(16);
  });
  it("knows a world that is still locked", () => expect(worldProgress(2, j).locked).toBe(true));
});

describe("opensWorld", () => {
  it("is true only for the first level of worlds after the first", () => {
    expect(opensWorld(1)).toBe(false);
    expect(opensWorld(LEVELS_PER_WORLD + 1)).toBe(true);
    expect(opensWorld(LEVELS_PER_WORLD + 2)).toBe(false);
  });
});

describe("landmarks", () => {
  it("puts exactly two in every world, at fixed levels", () => {
    for (let w = 0; w < WORLDS.length; w++) {
      const found = Array.from({ length: LEVELS_PER_WORLD }, (_, i) => landmarkFor(worldStart(w) + i)).filter((l) => l !== null);
      expect(found).toHaveLength(2);
      expect(found.map((l) => l!.kind)).toEqual([...LANDMARKS[w]!]);
      expect(landmarkFor(worldStart(w) + LANDMARK_AT[0])).not.toBeNull();
    }
  });
  it("stands well clear of the road, inside the map", () => {
    for (let n = 1; n <= 150; n++) {
      const l = landmarkFor(n);
      if (!l) continue;
      expect(Math.abs(l.x - pathX(l.y))).toBeGreaterThanOrEqual(0.25);
      expect(l.x).toBeGreaterThan(0.05);
      expect(l.x).toBeLessThan(0.95);
    }
  });
  it("is the same every time, and the worlds repeat their buildings", () => {
    expect(landmarkFor(worldStart(0) + 4)).toEqual(landmarkFor(worldStart(0) + 4));
    expect(landmarkFor(worldStart(10) + 4)!.kind).toBe(landmarkFor(worldStart(0) + 4)!.kind);
  });
});
