// The weekly challenge: one rule-twisted goal per week, the same for everyone, seeded by the
// week. It rotates every Monday. Pure logic only; the game feeds it what happened each move.

import { hashSeed } from "./rng";

export interface WeeklyRun {
  lines: number;
  moves: number;
  doubles: number; // moves that cleared two or more lines
  ones: number; // 1x1 pieces placed
  undos: number;
  score: number;
}
export const blankRun = (): WeeklyRun => ({ lines: 0, moves: 0, doubles: 0, ones: 0, undos: 0, score: 0 });

export interface Weekly {
  id: "efficient" | "doubles" | "survive" | "score";
  title: string;
  rule: string;
  goal: number;
  unit: string;
  limit?: number; // placements allowed, for the efficiency rule
}

const TEMPLATES: Weekly[] = [
  { id: "efficient", title: "Clean sweep", rule: "Clear 15 lines within 45 placements.", goal: 15, unit: "lines", limit: 45 },
  { id: "doubles", title: "Double trouble", rule: "Make 4 double clears (2+ lines in one move).", goal: 4, unit: "doubles" },
  { id: "survive", title: "Iron nerve", rule: "Place 45 pieces without using undo.", goal: 45, unit: "pieces" },
  { id: "score", title: "High roller", rule: "Score 600 in one game.", goal: 600, unit: "points" },
];

/** This week's challenge, chosen from the week id (the Monday's date). */
export function weeklyFor(week: string): Weekly {
  return TEMPLATES[hashSeed(`weekly:${week}`) % TEMPLATES.length]!;
}

export function weeklySeed(week: string): string {
  return `w-${week}`;
}

export function weeklyValue(w: Weekly, run: WeeklyRun): number {
  switch (w.id) {
    case "efficient": return run.lines;
    case "doubles": return run.doubles;
    case "survive": return run.moves;
    case "score": return run.score;
  }
}

/** True once the run has broken the week's rule; the attempt can no longer count. */
export function weeklyFailed(w: Weekly, run: WeeklyRun): boolean {
  return (w.id === "efficient" && run.moves >= (w.limit ?? Infinity) && run.lines < w.goal) || (w.id === "survive" && run.undos > 0);
}

export const weeklyDone = (w: Weekly, run: WeeklyRun): boolean => !weeklyFailed(w, run) && weeklyValue(w, run) >= w.goal;

/** Folds one move into the run. */
export function recordMove(run: WeeklyRun, m: { lines: number; cells: number; points: number }): WeeklyRun {
  return {
    ...run,
    lines: run.lines + m.lines,
    moves: run.moves + 1,
    doubles: run.doubles + (m.lines >= 2 ? 1 : 0),
    ones: run.ones + (m.cells === 1 ? 1 : 0),
    score: run.score + m.points,
  };
}
