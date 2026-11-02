// Records the admin clips from the real public/admin.html (served by the game's dev server on
// GAME_URL). The two API calls are answered with made-up demo numbers, so no real player, payment or
// token ever appears. Scrolls and typing are timed to the voiceover (run `npm run voice -- admin` first).
import { chromium, type Page } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { Recorder, pauseClock } from "./lib/recorder.js";
import { admin } from "../src/specs/admin.js";
import { beatSeconds } from "../src/timing.js";

const URL = (process.env.GAME_URL ?? "http://localhost:5199/") + "admin.html";
const W = 1280, H = 800, SCALE = 2;
const NOW = new Date("2026-11-02T10:00:00Z");
const TOKEN = "demo-token-for-the-video-only-000";
const said: Record<string, number> = JSON.parse(readFileSync("src/data/voice-admin.json", "utf8")).durations;
const sec = (id: string): number => beatSeconds(admin.beats.find((b) => b.id === id)!, said);

// ---- Demo data (deterministic) ------------------------------------------------------------------
let s = 7;
const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
const hex = (n: number): string => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");
const iso = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);

const days = Array.from({ length: 14 }, (_, i) => {
  const dau = Math.round(320 - i * 9 + rnd() * 30);
  const games = Math.round(dau * (3 + rnd()));
  const adReq = Math.round(dau * 0.9), started = Math.round(dau * 0.05 + rnd() * 3);
  return {
    date: iso(i), dau,
    events: {
      session_start: Math.round(dau * 1.7), game_start: games, game_end: Math.round(games * 0.92), journey_level: Math.round(dau * 0.6),
      daily_posted: Math.round(dau * 0.35), ad_requested: adReq, ad_completed: Math.round(adReq * 0.86), ad_failed: Math.round(adReq * 0.1),
      shop_viewed: Math.round(dau * 0.22), purchase_started: started, purchase_completed: Math.max(1, Math.round(started * 0.45)),
    },
    byProp: {
      "ad_completed.placement.coin_reward": Math.round(dau * 0.3), "coins_earned.source.daily_bonus": Math.round(dau * 0.8),
      "coins_earned.source.journey": Math.round(dau * 0.5), "coins_earned.source.daily_par": Math.round(dau * 0.2),
      "coins_earned.source.weekly": Math.round(dau * 0.05), "coins_earned.source.milestone": Math.round(dau * 0.04),
      "coins_earned.source.ad": Math.round(dau * 0.3), "coins_earned.source.starter": Math.round(dau * 0.12),
      "coins_spent.item.undo3": Math.round(dau * 0.08), "coins_spent.item.theme_mint": Math.round(rnd() * 4), "coins_spent.item.theme_coral": Math.round(rnd() * 3),
      "purchase_completed.sku.coins_small": Math.round(rnd() * 2),
    },
    sums: { coins_earned: dau * 31, coins_spent: dau * 12 },
  };
});
const cohorts = days.map((d, i) => ({ firstSeen: d.date, size: Math.round(60 + rnd() * 40), d1: i >= 1 ? Math.round(38 + rnd() * 10) : null, d7: i >= 7 ? Math.round(14 + rnd() * 6) : null, d30: null }));
const sources = [{ src: "instagram", players: 412 }, { src: "tiktok", players: 288 }, { src: "whatsapp", players: 190 }, { src: "x", players: 74 }, { src: "newsletter", players: 41 }];

const PLAYER = hex(24);
const skus = [["no_interstitials", 150_000], ["coins_small", 60_000], ["theme_pack_dusk", 80_000], ["supporter_bundle", 300_000], ["coins_small", 60_000]] as const;
const payments = Array.from({ length: 9 }, (_, i) => {
  const [sku, amount] = skus[i % skus.length]!;
  const paidAt = new Date(NOW.getTime() - (i * 31 + 3) * 3_600_000).toISOString();
  const status = i === 2 ? "refunded" : i === 6 ? "disputed" : "paid";
  const player = i === 0 || i === 2 || i === 5 ? PLAYER : hex(24);
  return { reference: "bp_" + hex(24), player, account: player, sku, amount, currency: "NGN", paidAt, status, history: status === "paid" ? [] : [{ status, at: new Date(NOW.getTime() - i * 3_600_000).toISOString() }] };
});
const totals = (rows: typeof payments) => {
  const gross = rows.reduce((n, r) => n + r.amount, 0);
  const refunded = rows.filter((r) => r.status === "refunded").reduce((n, r) => n + r.amount, 0);
  const disputed = rows.filter((r) => r.status === "disputed").reduce((n, r) => n + r.amount, 0);
  return [{ currency: "NGN", count: rows.length, gross, refunded, disputed, net: gross - refunded - disputed }];
};

async function routes(page: Page): Promise<void> {
  await page.route("**/api/stats*", (r) => r.fulfill({ json: { generated: NOW.toISOString(), days, cohorts, sources } }));
  await page.route("**/api/payments*", (r) => {
    const q = new globalThis.URL(r.request().url()).searchParams;
    const player = q.get("player");
    if (player) { const rows = payments.filter((p) => p.player === player); return r.fulfill({ json: { account: player, payments: rows, totals: totals(rows) } }); }
    return r.fulfill({ json: { days: 30, payments, totals: totals(payments), truncated: false } });
  });
}

// ---- Recording ----------------------------------------------------------------------------------
const browser = await chromium.launch();
const rec = new Recorder("capture/raw", "public/clips/admin", SCALE);
mkdirSync("src/data", { recursive: true });
const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};

async function open(preload: boolean): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: "light" });
  if (preload) await ctx.addInitScript((t) => sessionStorage.setItem("bp.admin", t), TOKEN);
  const page = await ctx.newPage();
  await routes(page);
  await page.clock.install({ time: NOW });
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await pauseClock(page, NOW);
  await rec.use(page);
  return page;
}

/** Remembers where an element is on screen right now, for spotlights and blurs in the edit. */
async function box(page: Page, name: string, selector: string, pad = 6): Promise<void> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no ${selector}`);
  boxes[name] = { x: Math.round(b.x - pad), y: Math.round(b.y - pad), w: Math.round(b.width + pad * 2), h: Math.round(b.height + pad * 2) };
}

/** An eased scroll that puts `selector` near the top, over `seconds`. */
async function scrollToSection(page: Page, selector: string, seconds: number, offset = 70): Promise<void> {
  const from = await page.evaluate(() => scrollY);
  const to = await page.evaluate(([sel, off]) => {
    const el = document.querySelector(sel as string)!;
    return Math.min(el.getBoundingClientRect().top + scrollY - (off as number), document.documentElement.scrollHeight - innerHeight);
  }, [selector, offset] as const);
  const n = Math.round(seconds * 30);
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.evaluate((y) => window.scrollTo(0, y), from + (to - from) * e);
    await rec.hold(1 / 30);
  }
}

async function type(page: Page, text: string, seconds: number): Promise<void> {
  const per = seconds / text.length;
  for (const ch of text) { await page.keyboard.type(ch); await rec.hold(per); }
}

async function click(page: Page, selector: string): Promise<void> {
  const b = (await page.locator(selector).first().boundingBox())!;
  await rec.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.locator(selector).first().focus();
}

// Overview: everything loaded, top of the page.
{
  const page = await open(true);
  await page.clock.runFor(300);
  rec.start("overview");
  await rec.hold(Math.max(sec("hook"), sec("private")) + 0.5);
  rec.finish();
  await box(page, "cards", "#cards");
  await page.context().close();
}

// Login: an empty page, the token typed (dots) and Load; then the cards.
{
  const page = await open(false);
  rec.start("login");
  await rec.hold(sec("open"));
  await box(page, "token", "#token", 4);
  await rec.hold(0.6);
  await click(page, "#token");
  await type(page, TOKEN, 1.6);
  await rec.hold(0.4);
  await click(page, "#f button");
  await page.clock.runFor(100);
  await rec.hold(Math.max(0.5, sec("token") - 3.1));
  rec.mark("cards");
  await box(page, "cards-login", "#cards");
  await rec.hold(sec("cards") + 0.3);
  rec.finish();
  await page.context().close();
}

// Tables: each section scrolls up as its line starts.
{
  const page = await open(true);
  await page.clock.runFor(300);
  rec.start("tables");
  const sections: [string, string, string][] = [["days", "#days", "days"], ["retention", "#cohorts", "cohorts"], ["sources", "#sources", "sources"], ["money", "#money", "money"]];
  for (const [beat, sel, name] of sections) {
    await scrollToSection(page, `h2:has(+ .scroll ${sel})`, 0.9);
    await box(page, name, sel);
    await rec.hold(sec(beat) - 0.9);
  }
  rec.finish();
  // Spotlight the Day 1 / Day 7 columns: the last three header cells of the cohorts table.
  await scrollToSection(page, "h2:has(+ .scroll #cohorts)", 0.1);
  const cols = await page.evaluate(() => {
    const ths = [...document.querySelectorAll("#cohorts th")].slice(2) as HTMLElement[];
    const t = document.querySelector("#cohorts")!.getBoundingClientRect();
    const a = ths[0]!.getBoundingClientRect(), b = ths[ths.length - 1]!.getBoundingClientRect();
    return { x: a.left - 4, y: t.top - 4, w: b.right - a.left + 8, h: t.height + 8 };
  });
  boxes["retention-cols"] = { x: Math.round(cols.x), y: Math.round(cols.y), w: Math.round(cols.w), h: Math.round(cols.h) };
  await page.context().close();
}

// Payments: search one player's history; then their statuses.
{
  const page = await open(true);
  await page.clock.runFor(300);
  // Room below the page, so the list shrinking to one player's rows does not yank the scroll position.
  await page.addStyleTag({ content: "body { padding-bottom: 900px; }" });
  await page.evaluate(() => { const el = document.querySelector("#pf")!; window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 120); });
  rec.start("payments");
  await rec.hold(0.6);
  await click(page, "#pq");
  await box(page, "search", "#pq", 4);
  await type(page, PLAYER, 1.4);
  await rec.hold(0.3);
  await click(page, "#pf button");
  await page.clock.runFor(100);
  await rec.hold(Math.max(0.5, sec("search") - 2.6));
  rec.mark("status");
  await box(page, "ptotals", "#ptotals");
  await box(page, "payments", "#payments");
  const col = async (table: string, i: number, name: string): Promise<void> => {
    const r = await page.evaluate(([t, n]) => {
      const tb = document.querySelector(t as string)!.getBoundingClientRect();
      const th = document.querySelectorAll(`${t} th`)[n as number]!.getBoundingClientRect();
      return { x: th.left, y: tb.top, w: th.width, h: tb.height };
    }, [table, i] as const);
    boxes[name] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  };
  await col("#payments", 5, "status-col");
  await col("#payments", 1, "ref-col");
  await col("#payments", 2, "player-col");
  await rec.hold(sec("status") + 0.3);
  rec.finish();
  await page.context().close();
}

rec.writeIndex("src/data/admin.json", { width: W, height: H, boxes });
console.log(boxes);
await browser.close();
