// The shareable result: a small emoji picture of your final board plus score, par and streak.
// It shows how the run went without giving anything away, so it is safe to paste anywhere.

import { SIZE, type Grid } from "./board";

const SQUARES = ["🟦", "🟪", "🟥", "🟧", "🟩", "🟫", "🟨", "⬜"];

/** The board as eight rows of emoji: a coloured square for each block, black for empty. */
export function boardEmoji(grid: Grid, colors: readonly (readonly number[])[]): string {
  const rows: string[] = [];
  for (let r = 0; r < SIZE; r++) {
    let line = "";
    for (let c = 0; c < SIZE; c++) {
      line += grid[r]![c] ? SQUARES[Math.max(0, colors[r]?.[c] ?? 0) % SQUARES.length] : "⬛";
    }
    rows.push(line);
  }
  return rows.join("\n");
}

export interface ShareInfo {
  title: string; // e.g. "Block Puzzle · 2026-10-19"
  score: number;
  board: string; // from boardEmoji
  par?: number | null;
  streak?: number;
  note?: string; // e.g. "Practice run"
}

export function shareText(i: ShareInfo): string {
  const bits = [`${i.score.toLocaleString("en-US")} pts`];
  if (i.par) bits.push(`Par ${i.par.toLocaleString("en-US")}`);
  if (i.streak && i.streak > 0) bits.push(`🔥 ${i.streak}`);
  return [i.title, ...(i.note ? [i.note] : []), "", i.board, "", bits.join(" · ")].join("\n");
}
