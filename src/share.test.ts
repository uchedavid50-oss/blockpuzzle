import { describe, expect, it } from "vitest";
import { emptyGrid, SIZE } from "./board";
import { boardEmoji, shareText } from "./share";

describe("boardEmoji", () => {
  it("is eight rows of eight squares", () => {
    const rows = boardEmoji(emptyGrid(), []).split("\n");
    expect(rows).toHaveLength(SIZE);
    for (const r of rows) expect([...r]).toHaveLength(SIZE);
  });
  it("uses black for empty and a colour per block", () => {
    const g = emptyGrid().map((r) => r.slice());
    g[0]![0] = true; g[0]![1] = true;
    const colors = emptyGrid().map(() => Array<number>(SIZE).fill(-1));
    colors[0]![0] = 0; colors[0]![1] = 2;
    expect([...boardEmoji(g, colors).split("\n")[0]!].slice(0, 3)).toEqual(["🟦", "🟥", "⬛"]);
  });
  it("tolerates a missing colour grid", () => {
    const g = emptyGrid().map((r) => r.slice());
    g[3]![3] = true;
    expect(boardEmoji(g, []).split("\n")[3]).toContain("🟦");
  });
});

describe("shareText", () => {
  const board = boardEmoji(emptyGrid(), []);
  it("puts the title first and the score line last", () => {
    const lines = shareText({ title: "Bun Blocks · 2026-10-19", score: 740, board, par: 680, streak: 6 }).split("\n");
    expect(lines[0]).toBe("Bun Blocks · 2026-10-19");
    expect(lines[lines.length - 1]).toBe("740 pts · Par 680 · 🔥 6");
  });
  it("leaves out par and streak when absent", () => {
    const text = shareText({ title: "T", score: 12, board });
    expect(text.endsWith("12 pts")).toBe(true);
    expect(text).not.toContain("Par");
    expect(text).not.toContain("🔥");
  });
  it("includes a practice note", () => expect(shareText({ title: "T", score: 1, board, note: "Practice run" })).toContain("Practice run"));
});
