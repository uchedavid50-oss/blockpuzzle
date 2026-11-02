// Records the how-to-play clips from the real game (npm run dev on GAME_URL), one prepared board per
// scene, played with touch input so the piece lifts above the finger like on a phone.
// Usage: npm run capture:game   (needs the game dev server running; see README)
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { Recorder, pauseClock } from "./lib/recorder.js";
import { SHAPES } from "../../src/pieces.js";
import { shapeSize } from "../../src/board.js";

const URL = process.env.GAME_URL ?? "http://localhost:5199/";
const W = 390, H = 844, SCALE = 2;
const NOW = new Date("2026-11-02T10:00:00");

// Mirrors layoutView() in src/gfx.ts for this viewport.
const top = 108;
const cell = Math.floor(Math.min(W - 44, (H - top) * 0.6) / 8);
const boardX = Math.floor((W - cell * 8) / 2), boardY = top;
const trayCell = Math.floor(Math.min(cell * 0.6, (W - 48) / 15));
const trayY = boardY + cell * 8 + (H - boardY - cell * 8) / 2 - trayCell * 1.5;
const slot = (i: number): [number, number] => {
  const size = trayCell * 5, gap = (W - size * 3) / 4;
  return [gap + i * (size + gap) + size / 2, trayY - trayCell + size / 2];
};
/** Where a finger must let go for shape `s` to land with its top-left at (row, col). */
const drop = (s: number, row: number, col: number): [number, number] => {
  const { rows, cols } = shapeSize(SHAPES[s]!);
  return [boardX + (col + cols / 2) * cell, boardY + cell * 1.5 + (row + rows / 2) * cell];
};

/** A saved game in the format main.ts loads: '.' empty, a digit is a filled cell in that palette colour. */
function save(rows: string[], tray: number[], score: number, extra: Record<string, unknown> = {}): string {
  const flat = rows.join("");
  if (flat.length !== 64) throw new Error("board must be 8x8");
  return JSON.stringify({
    g: [...flat].map((ch) => (ch === "." ? 0 : 1)).join(""), k: [...flat].map((ch) => (ch === "." ? "-" : ch)).join(""),
    t: tray, s: score, c: 0, d: null, sd: "howto-video", ch: null, n: 1, u: 1, kd: "classic", pr: false, lv: null,
    wid: null, wk: null, mv: 12, ln: 6, ml: [], ...extra,
  });
}

const STATS = { games: 23, finished: 21, total: 48210, bestScore: 4120, bestCombo: 5, lines: 612, perfects: 2, moves: 1460, bestStreak: 6, challengesWon: 1, zenLines: 40, levels: 7, weeklyWins: 1, hist: [2, 5, 7, 5, 3, 1] };

// Badges a player with these stats would already have, so none pop up mid-scene.
const BADGES = ["first", "double", "quad", "combo3", "combo5", "s500", "s1000", "s2500", "lines50", "lines250", "games10", "streak3", "region", "weekly1", "journey5", "zen50", "perfect", "rival"];

const browser = await chromium.launch();
let base: Record<string, string> = {
  hintSeen: "1", installDismissed: "1", mapHint: "1", analyticsConsent: "no", tilesSeen: "99",
  journey: JSON.stringify({ next: 8, stars: { 1: 3, 2: 3, 3: 2, 4: 3, 5: 2, 6: 3, 7: 2 } }),
  best: "4120", stats: JSON.stringify(STATS), badges: JSON.stringify(BADGES), badgesSeen: String(BADGES.length),
};
let ctx: BrowserContext | null = null;

/**
 * A fresh browser context per scene: storage is written before the game's own scripts run, so the
 * game loads exactly this board (reusing a page would let it save over the board as it unloads).
 */
async function open(game: string | null): Promise<Page> {
  await ctx?.close();
  ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, hasTouch: true, isMobile: true });
  const items: Record<string, string> = { ...base, ...(game ? { save: game } : {}) };
  // Plain script text: tsx would wrap functions written here in a helper the page does not have.
  // No system share sheet in a headless browser, and a page without focus may not write to the
  // clipboard: the stubs let the game take its copy path and show "Copied!".
  await ctx.addInitScript({ content: `
    if (!sessionStorage.getItem("video.seeded")) {
      sessionStorage.setItem("video.seeded", "1");
      localStorage.clear();
      const all = ${JSON.stringify(items)};
      for (const k in all) localStorage.setItem("blockpuzzle." + k, all[k]);
    }
    delete Navigator.prototype.share;
    Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, get() { return { writeText() { return Promise.resolve(); } }; } });
  ` });
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  await page.goto(URL);
  await pauseClock(page, NOW); // fonts and first layout settle, unrecorded
  await rec.use(page);
  return page;
}

mkdirSync("capture/raw", { recursive: true });
mkdirSync("src/data", { recursive: true });
const rec = new Recorder("capture/raw", "public/clips/game", SCALE);

// Let today's bonus be paid once, then keep that wallet (with a friendlier balance) for every scene.
{
  const page = await open(null);
  await page.clock.runFor(8000);
  const w = JSON.parse(await page.evaluate(() => localStorage.getItem("blockpuzzle.wallet") ?? "{}"));
  base = { ...base, wallet: JSON.stringify({ ...w, coins: 240 }) };
}

const light = [
  "........",
  "........",
  "........",
  "........",
  "......2.",
  "6.....22",
  "11....3.",
  "14...33.",
];

/** ONLY=hook,over re-records just those scenes (and the clips they contain). */
const want = (n: string): boolean => !process.env.ONLY || process.env.ONLY.split(",").includes(n);
let page: Page;

// 1. The payoff: one drop finishes row 5 and the 2x4 block to its right together.
if (want("hook")) {
  page = await open(save([
    "........",
    "......1.",
    ".....5..",
    "..4.....",
    "....2222",
    "3333....",
    "1......3",
    "11..22.6",
  ], [5, 13, 0], 1240));
  rec.start("hook");
  await rec.hold(0.6);
  await rec.drag(slot(0), drop(5, 5, 4), 1.1);
  rec.mark("clear");
  await rec.hold(3.2);
  rec.finish();
}

// 2-3. Drag a piece (pausing so the landing shadow shows), then the other two; the tray refills.
if (want("drag")) {
  page = await open(save(light, [29, 9, 13], 380));
  rec.start("drag");
  await rec.hold(0.5);
  await rec.drag(slot(0), drop(29, 2, 2), 2.2, 0.75, 1.2);
  await rec.hold(1.2);
  rec.finish();
  rec.start("fit");
  await rec.hold(0.3);
  await rec.drag(slot(1), drop(9, 4, 2), 1.2);
  await rec.hold(0.5);
  await rec.drag(slot(2), drop(13, 0, 6), 1.2);
  rec.mark("refill");
  await rec.hold(1.6);
  rec.finish();
}

// 4. A row clears.
if (want("row")) {
  page = await open(save([
    "........",
    "........",
    "..3.....",
    "........",
    "......5.",
    "1.....55",
    "2....4..",
    "11226...",
  ], [3, 9, 14], 860));
  rec.start("row");
  await rec.hold(0.4);
  await rec.drag(slot(0), drop(3, 7, 5), 1.2);
  rec.mark("clear");
  await rec.hold(2.2);
  rec.finish();
}

// 5. A 2x4 block clears on its own (no row or column is full).
if (want("region")) {
  page = await open(save([
    "........",
    "........",
    "1122....",
    "33......",
    "......4.",
    "......44",
    "5.......",
    "55.....2",
  ], [1, 2, 14], 1020));
  rec.start("region");
  await rec.hold(0.4);
  await rec.drag(slot(0), drop(1, 3, 2), 1.2);
  rec.mark("clear");
  await rec.hold(2.6);
  rec.finish();
}

// 6. A combo: one cell finishes a row and a column at once.
if (want("combo")) {
  page = await open(save([
    "...4....",
    "...4....",
    "...5..1.",
    "...5..11",
    "123.2671",
    "...6....",
    "...6..3.",
    "...7.33.",
  ], [0, 9, 4], 1560));
  rec.start("combo");
  await rec.hold(0.4);
  await rec.drag(slot(0), drop(0, 4, 3), 1.2);
  rec.mark("clear");
  await rec.hold(2.8);
  rec.finish();
}

// 7. Game over: after this drop nothing in the tray fits.
if (want("over")) {
  page = await open(save([
    ".1234.67",
    "123.567.",
    "12345.78",
    "1.345.78",
    "1234.6.8",
    "123.5678",
    "12.4567.",
    "1.345678",
  ].map((r) => r.replace(/8/g, "1")), [0, 10, 17], 2380));
  rec.start("over");
  await rec.hold(0.4);
  await rec.drag(slot(0), drop(0, 0, 5), 1.2);
  rec.mark("over");
  await rec.hold(3.4);
  rec.finish();
  await page.screenshot({ path: "capture/raw/over-final.png" });
  // 7b. Sharing: the link carries the game's seed, so a friend gets the same pieces.
  rec.start("share");
  await rec.hold(0.4);
  await rec.tap(195, 555);
  await rec.hold(2.6);
  rec.finish();
}

// 8. Modes (held while the voice walks through them), then Journey opens the map.
if (want("modes")) {
  page = await open(save(light, [29, 9, 13], 380));
  rec.start("modes");
  await rec.hold(0.4);
  await rec.tap(76, 77);
  await rec.hold(10);
  rec.finish();
  await page.screenshot({ path: "capture/raw/modes-final.png" });
  rec.start("journey");
  await rec.hold(0.3);
  await rec.tap(195, 462);
  await rec.hold(4.5);
  rec.finish();
  await page.screenshot({ path: "capture/raw/journey-final.png" });
}

// 9. The coin counter opens the coin shop.
if (want("coins")) {
  page = await open(save(light, [29, 9, 13], 380));
  rec.start("coins");
  await rec.hold(0.4);
  await rec.tap(195, 58);
  await rec.hold(4);
  rec.finish();
  await page.screenshot({ path: "capture/raw/coins-final.png" });
}

// 10. The trophy opens stats and badges.
if (want("stats")) {
  page = await open(save(light, [29, 9, 13], 380));
  rec.start("stats");
  await rec.hold(0.4);
  await rec.tap(195, 30);
  await rec.hold(4);
  rec.finish();
  await page.screenshot({ path: "capture/raw/stats-final.png" });
}

console.log("layout", { cell, boardX, boardY, trayY });
rec.writeIndex("src/data/game.json", { width: W, height: H, layout: { cell, boardX, boardY, trayY } });
await browser.close();
