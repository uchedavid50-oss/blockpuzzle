// Offline checks that use the bot to test game design:
//   1. every journey level is winnable, and star thresholds are sensible
//   2. weekly challenge goals are reachable
//   3. how different region shapes change survival and scoring
// Run with: npx vite-node scripts/validate.ts [journey|weekly|regions]

import { goalReached, makeLevel, starsFor } from "../src/journey";
import { playBot } from "../src/solver";

const which = process.argv[2] ?? "all";
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

if (which === "all" || which === "journey") {
  console.log("== Journey levels ==");
  let unwinnable = 0;
  for (let n = 1; n <= 90; n++) {
    const lv = makeLevel(n);
    const r = playBot({
      seed: lv.seed, start: lv.prefill, maxMoves: 400,
      stop: (b) => goalReached(lv, { score: b.score, lines: b.lines, moves: b.moves }),
    });
    const won = goalReached(lv, { score: r.score, lines: r.lines, moves: r.moves });
    if (!won) unwinnable++;
    if (n <= 12 || n % 10 === 0 || !won)
      console.log(`L${String(n).padStart(2)} ${lv.goal.kind.padEnd(5)} target ${String(lv.goal.target).padStart(4)} | bot ${won ? `won in ${r.moves} moves (${starsFor(lv, { score: r.score, lines: r.lines, moves: r.moves })}*; par ${lv.parMoves})` : `FAILED (${r.dead ? "stuck" : "cap"} at ${r.score} pts, ${r.lines} lines, ${r.moves} moves)`}`);
  }
  console.log(`unwinnable for the bot: ${unwinnable} of 90\n`);
}

if (which === "all" || which === "weekly") {
  console.log("== Weekly goals (100 seeds, bot) ==");
  const seeds = Array.from({ length: 100 }, (_, i) => `w-test-${i}`);
  // "Efficiency" twists: how many bot games clear N lines within M placements?
  for (const [lines, within] of [[12, 40], [12, 45], [15, 45], [15, 50], [15, 55]] as const) {
    const runs = seeds.map((sd) => playBot({ seed: sd, maxMoves: within, stop: (r) => r.lines >= lines }));
    console.log(`clear ${lines} lines within ${within} placements: ${runs.filter((r) => r.lines >= lines).length}/100`);
  }
  const dbl = seeds.map((s) => playBot({ seed: s, maxMoves: 200, stop: (r) => r.doubles >= 4 }));
  console.log(`4 double clears: reached by ${dbl.filter((r) => r.doubles >= 4).length}/100 (mean moves ${mean(dbl.map((r) => r.moves)).toFixed(0)})`);
  const surv = seeds.map((s) => playBot({ seed: s, maxMoves: 200, stop: (r) => r.moves >= 45 }));
  console.log(`place 45 pieces: reached by ${surv.filter((r) => r.moves >= 45).length}/100`);
  const sc = seeds.map((s) => playBot({ seed: s, maxMoves: 200, stop: (r) => r.score >= 600 }));
  console.log(`score 600: reached by ${sc.filter((r) => r.score >= 600).length}/100 (mean moves ${mean(sc.map((r) => r.moves)).toFixed(0)})\n`);
}

if (which === "all" || which === "regions") {
  console.log("== Region shapes (60 seeds, up to 300 moves) ==");
  const seeds = Array.from({ length: 60 }, (_, i) => `reg-${i}`);
  const variants: [string, boolean | { h: number; w: number }][] = [
    ["rows+cols only", false], ["2x2 regions", { h: 2, w: 2 }], ["2x4 regions (current)", true], ["4x4 regions", { h: 4, w: 4 }],
  ];
  for (const [name, regions] of variants) {
    const runs = seeds.map((s) => playBot({ seed: s, maxMoves: 300, rules: { regions } }));
    const died = runs.filter((r) => r.dead).length;
    console.log(`${name.padEnd(24)} survived-all-300: ${String(60 - died).padStart(2)}/60 | mean moves ${mean(runs.map((r) => r.moves)).toFixed(0).padStart(3)} | mean score ${mean(runs.map((r) => r.score)).toFixed(0).padStart(5)} | lines/move ${(mean(runs.map((r) => r.lines)) / mean(runs.map((r) => r.moves))).toFixed(2)}`);
  }
}
