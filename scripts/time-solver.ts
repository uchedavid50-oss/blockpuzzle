import { greedyScore } from "../src/solver";
const t = Date.now();
const r = greedyScore("2026-10-19");
console.log(r, `${Date.now() - t}ms`);
