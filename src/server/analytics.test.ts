import { describe, expect, it } from "vitest";
import { EVENT_NAMES } from "../events.js";
import { collect, getStats, tokenOk } from "./analytics.js";
import { MemoryStore } from "./store.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const id = (n: number): string => n.toString(36).padStart(22, "a");
const ev = (name: string, props?: Record<string, unknown>) => ({ name, t: NOW.getTime(), ...(props ? { props } : {}) });
const batch = (n: number, firstSeen: string, events: unknown[], src: string | null = null) => ({ id: id(n), firstSeen, src, events });

describe("collect: what it accepts", () => {
  it("takes a well-formed batch", async () => {
    const s = new MemoryStore();
    const r = await collect(s, batch(1, "2026-10-20", [ev("session_start"), ev("game_start", { mode: "classic" })]), NOW);
    expect(r.status).toBe(200);
  });
  it("rejects bad ids, dates, sources and event lists", async () => {
    const s = new MemoryStore();
    for (const bad of [
      { ...batch(1, "2026-10-20", [ev("game_start")]), id: "short" },
      { ...batch(1, "2026-10-20", [ev("game_start")]), id: "A".repeat(22) },
      batch(1, "yesterday", [ev("game_start")]),
      batch(1, "2026-10-20", [ev("game_start")], "bad src!"),
      batch(1, "2026-10-20", []),
      batch(1, "2026-10-20", Array.from({ length: 51 }, () => ev("game_start"))),
      null, "text", 5,
    ]) expect((await collect(s, bad, NOW)).status).toBe(400);
  });
  it("rejects unknown events, far-off clocks and awkward props, and counts none of a bad batch", async () => {
    const s = new MemoryStore();
    for (const bad of [
      ev("steal_data"),
      { name: "game_start", t: NOW.getTime() - 5 * 86_400_000 },
      ev("game_start", { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 }),
      ev("game_start", { mode: "x".repeat(33) }),
      ev("game_start", { nested: { a: 1 } }),
      ev("game_start", ["x"] as unknown as Record<string, unknown>),
    ]) expect((await collect(s, batch(1, "2026-10-20", [ev("game_start"), bad]), NOW)).status).toBe(400);
    expect(s.allKeys().filter((k) => k.startsWith("an:ev:"))).toEqual([]); // the good event in a bad batch was not counted either
  });
  it("accepts every event name the game can send", async () => {
    const s = new MemoryStore();
    expect((await collect(s, batch(2, "2026-10-20", EVENT_NAMES.map((n) => ev(n))), NOW)).status).toBe(200);
  });
  it("rate-limits one id, not others", async () => {
    const s = new MemoryStore();
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await collect(s, batch(1, "2026-10-20", [ev("game_start")]), NOW)).status;
    expect(last).toBe(429);
    expect((await collect(s, batch(2, "2026-10-20", [ev("game_start")]), NOW)).status).toBe(200);
  });
});

describe("collect: what it keeps", () => {
  it("keeps only counters and distinct counts, never an event or a player record", async () => {
    const s = new MemoryStore();
    await collect(s, batch(7, "2026-10-20", [ev("session_start"), ev("game_end", { mode: "daily", score: 812 })], "tiktok"), NOW);
    const keys = s.allKeys();
    expect(keys.every((k) => k.startsWith("an:"))).toBe(true);
    // the id appears only in a short-lived rate-limit counter, never in a stored profile
    expect(keys.filter((k) => k.includes(id(7))).every((k) => k.startsWith("an:rl:"))).toBe(true);
    expect(keys.some((k) => /score|812/.test(k))).toBe(false);
  });
  it("counts events and the allow-listed properties, and ignores the rest", async () => {
    const s = new MemoryStore();
    await collect(s, batch(1, "2026-10-20", [ev("game_start", { mode: "daily" }), ev("game_start", { mode: "daily" }), ev("game_start", { mode: "not-a-mode" })]), NOW);
    const stats = await getStats(s, NOW, 1);
    const day = (stats.body.days as { events: Record<string, number>; byProp: Record<string, number> }[])[0]!;
    expect(day.events.game_start).toBe(3);
    expect(day.byProp["game_start.mode.daily"]).toBe(2);
    expect(Object.keys(day.byProp)).toHaveLength(1);
  });
  it("counts a player once however often they report", async () => {
    const s = new MemoryStore();
    for (let i = 0; i < 5; i++) await collect(s, batch(1, "2026-10-20", [ev("game_start")]), NOW);
    await collect(s, batch(2, "2026-10-20", [ev("game_start")]), NOW);
    const days = (await getStats(s, NOW, 1)).body.days as { dau: number }[];
    expect(days[0]!.dau).toBe(2);
  });
});

describe("retention and sources", () => {
  it("works out day-1 and day-7 retention for a cohort", async () => {
    const s = new MemoryStore();
    const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
    const at = (iso: string, n: number, firstSeen: string) => collect(s, { ...batch(n, firstSeen, []), events: [{ name: "game_start", t: day(iso).getTime() }] }, day(iso));
    for (let n = 1; n <= 4; n++) await at("2026-10-10", n, "2026-10-10"); // four players arrive on the 10th
    await at("2026-10-11", 1, "2026-10-10");
    await at("2026-10-11", 2, "2026-10-10"); // two come back the next day
    await at("2026-10-17", 1, "2026-10-10"); // one is still around a week later
    const stats = await getStats(s, NOW, 14);
    const c = (stats.body.cohorts as { firstSeen: string; size: number; d1: number | null; d7: number | null; d30: number | null }[]).find((x) => x.firstSeen === "2026-10-10")!;
    expect(c.size).toBe(4);
    expect(c.d1).toBe(50);
    expect(c.d7).toBe(25);
    expect(c.d30).toBeNull(); // too early to say
  });
  it("ranks acquisition sources by how many distinct players came", async () => {
    const s = new MemoryStore();
    await collect(s, batch(1, "2026-10-20", [ev("session_start")], "tiktok"), NOW);
    await collect(s, batch(2, "2026-10-20", [ev("session_start")], "tiktok"), NOW);
    await collect(s, batch(3, "2026-10-20", [ev("session_start")], "twitter"), NOW);
    expect((await getStats(s, NOW)).body.sources).toEqual([{ src: "tiktok", players: 2 }, { src: "twitter", players: 1 }]);
  });
  it("reading the report creates no keys", async () => {
    const s = new MemoryStore();
    await getStats(s, NOW, 14);
    expect(s.allKeys()).toEqual([]);
  });
});

describe("tokenOk (the admin guard)", () => {
  it("needs the exact bearer token", () => {
    expect(tokenOk("Bearer s3cret", "s3cret")).toBe(true);
    expect(tokenOk("Bearer s3cre", "s3cret")).toBe(false);
    expect(tokenOk("Bearer s3cretX", "s3cret")).toBe(false);
    expect(tokenOk("s3cret", "s3cret")).toBe(false);
    expect(tokenOk(null, "s3cret")).toBe(false);
  });
  it("is closed when no token is configured", () => {
    expect(tokenOk("Bearer ", "")).toBe(false);
    expect(tokenOk("Bearer anything", undefined)).toBe(false);
  });
});
