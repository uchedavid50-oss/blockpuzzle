// Contact sheet of a recorded clip's frames, for checking a take: tsx scripts/sheet.ts <clip> <out.png> [step]
import { chromium } from "playwright";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const [dir, out, step = "15"] = process.argv.slice(2);
const files = readdirSync(dir!).filter((f) => f.endsWith(".png")).sort().filter((_, i) => i % Number(step) === 0).slice(0, 16);
const html = `<body style="margin:0;display:grid;grid-template-columns:repeat(${process.env.COLS ?? 8},${process.env.TW ?? 200}px);gap:4px;background:#222;font:12px sans-serif;color:#fff">` +
  files.map((f) => `<div><img src="file://${resolve(dir!, f)}" width=${process.env.TW ?? 200}><br>${f}</div>`).join("") + "</body>";
const b = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1640, height: 400 } });
const page = resolve(dir!, "..", "_sheet.html");
writeFileSync(page, html);
await p.goto("file://" + page);
await p.waitForLoadState("networkidle");
await p.screenshot({ path: out!, fullPage: true });
await b.close();
