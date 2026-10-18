// Builds public/par.json: a greedy-bot score for every daily from START to END.
// Re-run it (npm run par) whenever the rules or the piece set change, because par depends on both.
// Run with: npx vite-node scripts/make-par.ts

import { writeFileSync } from "node:fs";
import { greedyScore } from "../src/solver";

const START = "2026-10-01";
const END = "2028-01-31";
const MAX_MOVES = 120;

const out: Record<string, number> = {};
const d = new Date(`${START}T00:00:00Z`);
const end = new Date(`${END}T00:00:00Z`);
while (d <= end) {
  const day = d.toISOString().slice(0, 10);
  out[day] = greedyScore(day, MAX_MOVES).score;
  d.setUTCDate(d.getUTCDate() + 1);
}
writeFileSync(new URL("../public/par.json", import.meta.url), JSON.stringify(out));
const values = Object.values(out);
console.log(`wrote ${values.length} days; par ranges ${Math.min(...values)}-${Math.max(...values)}`);
