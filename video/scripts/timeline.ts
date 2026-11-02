// Prints a video's timeline (beat start frames), for picking stills: tsx scripts/timeline.ts howto|admin
import { readFileSync } from "node:fs";
import { plan, type Capture } from "../src/plan.js";
import { howto } from "../src/specs/howto.js";
import { admin } from "../src/specs/admin.js";
const id = process.argv[2]!;
const spec = id === "admin" ? admin : howto;
const capture = JSON.parse(readFileSync(`src/data/${id === "admin" ? "admin" : "game"}.json`, "utf8")) as Capture;
const durations = JSON.parse(readFileSync(`src/data/voice-${id}.json`, "utf8")).durations;
const p = plan(spec, durations, capture);
for (const b of p.beats) console.log(String(b.start).padStart(5), (b.start / 30).toFixed(1).padStart(6) + "s", b.beat.id);
console.log(`total ${p.total} frames, ${(p.total / 30).toFixed(1)}s`);
