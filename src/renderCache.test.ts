import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasLayer, SpriteCache, renderScale } from "./renderCache";

afterEach(() => vi.unstubAllGlobals());

describe("native raster budget", () => {
  it("preserves the browser's scale and caps high-density native raster work", () => {
    expect(renderScale(false, 411, 845, 3)).toBe(3);
    const scale = renderScale(true, 411, 845, 3);
    expect(scale).toBeLessThan(2);
    expect(411 * 845 * scale * scale).toBeCloseTo(1_000_000);
    expect(renderScale(true, 320, 480, 1)).toBe(1);
  });

  it("handles rotation, tablets and invalid device scales without changing CSS dimensions", () => {
    expect(renderScale(true, 845, 411, 3)).toBe(renderScale(true, 411, 845, 3));
    expect(renderScale(true, 1200, 1600, 2)).toBeLessThan(1);
    expect(renderScale(true, 320, 480, NaN)).toBe(1);
  });
});

describe("cached board artwork", () => {
  function renderer() {
    const context = { setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(), clearRect: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context };
    const createElement = vi.fn(() => canvas);
    vi.stubGlobal("document", { createElement });
    const target = { drawImage: vi.fn(), save: vi.fn(), translate: vi.fn(), restore: vi.fn() } as unknown as CanvasRenderingContext2D;
    return { layer: new CanvasLayer(), target, canvas, context, createElement, paint: vi.fn() };
  }
  const bounds = { x: 10, y: 20, width: 300, height: 400 };

  it("reuses artwork while repainting immediately after a move or undo", () => {
    const r = renderer();
    const original = [[0]], moved = [[1]];
    for (const grid of [original, original, moved, moved, original])
      r.layer.draw(r.target, bounds, 2, grid, r.paint);
    expect(r.paint).toHaveBeenCalledTimes(3);
    expect(r.target.drawImage).toHaveBeenCalledTimes(5);
    expect(r.createElement).toHaveBeenCalledTimes(1);
  });

  it("invalidates on resize, scale and position changes without accumulating canvases", () => {
    const r = renderer();
    r.layer.draw(r.target, bounds, 2, "board", r.paint);
    r.layer.draw(r.target, { ...bounds, width: 400 }, 2, "board", r.paint);
    r.layer.draw(r.target, bounds, 1.5, "board", r.paint);
    r.layer.draw(r.target, { ...bounds, x: 30 }, 1.5, "board", r.paint);
    expect(r.paint).toHaveBeenCalledTimes(4);
    expect(r.canvas.width).toBe(450);
    expect(r.canvas.height).toBe(600);
    expect(r.context.setTransform).toHaveBeenLastCalledWith(1.5, 0, 0, 1.5, -45, -30);
    expect(r.createElement).toHaveBeenCalledTimes(1);
  });

  it("reuses moving sprites and evicts old artwork when its storage budget fills", () => {
    const r = renderer();
    const sprites = new SpriteCache(2);
    for (const [x, key] of [[0, "blue"], [20, "blue"], [20, "patterned-blue"], [20, "green"], [0, "blue"]] as const)
      sprites.draw(r.target, x, 0, bounds, 2, key, r.paint);
    expect(r.paint).toHaveBeenCalledTimes(4);
    expect(r.createElement).toHaveBeenCalledTimes(4);
    expect(r.target.drawImage).toHaveBeenCalledTimes(5);
    expect(r.target.translate).toHaveBeenCalledWith(20, 0);
  });
});
