// The analytics collector. It keeps only aggregate counts and approximate distinct counts (Redis
// HyperLogLogs, which cannot be read back), so no raw event and no per-player history is ever stored.
// Retention is worked out from "which cohort day" and "which later day" counters alone.

import { COUNTED_PROPS, EVENT_NAMES, SUMMED_EVENTS, type EventName } from "../events.js";
import { addDays, dayDiff } from "../streak.js";
import type { Reply } from "./handlers.js";
import { isDate, utcToday } from "./rules.js";
import type { Store } from "./store.js";

const DAY = 86_400;
const KEEP = 400 * DAY;
const MAX_EVENTS = 50;
const RATE_PER_MINUTE = 120;
const ID_RE = /^[a-z0-9]{22}$/;
const SRC_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const KNOWN = new Set<string>(EVENT_NAMES);
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

interface Clean { name: EventName; counted: string[]; sum: number } // `counted` are the "prop:value" keys worth tallying
const SUMMED = new Set<string>(SUMMED_EVENTS);
const MAX_SUMMED = 100_000; // no single coin event is bigger than this; anything larger is not counted

function cleanEvent(raw: unknown, nowMs: number): Clean | null {
  const e = raw as { name?: unknown; t?: unknown; props?: unknown } | null;
  if (!e || typeof e !== "object" || typeof e.name !== "string" || !KNOWN.has(e.name)) return null;
  if (typeof e.t !== "number" || Math.abs(e.t - nowMs) > 2 * DAY * 1000) return null; // a clock far off is a bad client
  const counted: string[] = [];
  if (e.props !== undefined) {
    if (typeof e.props !== "object" || e.props === null || Array.isArray(e.props)) return null;
    const entries = Object.entries(e.props as Record<string, unknown>);
    if (entries.length > 8) return null;
    for (const [k, v] of entries) {
      if (typeof v === "string" && v.length > 32) return null;
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return null;
      if (typeof v === "string" && COUNTED_PROPS[k]?.includes(v)) counted.push(`${k}:${v}`);
    }
  }
  const coins = (e.props as { coins?: unknown } | undefined)?.coins;
  const sum = SUMMED.has(e.name) && typeof coins === "number" && Number.isInteger(coins) && coins > 0 && coins <= MAX_SUMMED ? coins : 0;
  return { name: e.name as EventName, counted, sum };
}

/** Accepts one batch of events from a browser. Returns 400 for anything malformed, never partially counts it. */
export async function collect(store: Store, body: unknown, now = new Date()): Promise<Reply> {
  const b = (body ?? {}) as { id?: unknown; firstSeen?: unknown; src?: unknown; events?: unknown };
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return reply(400, { error: "bad id" });
  if (!isDate(b.firstSeen)) return reply(400, { error: "bad firstSeen" });
  if (b.src !== null && b.src !== undefined && (typeof b.src !== "string" || !SRC_RE.test(b.src))) return reply(400, { error: "bad src" });
  if (!Array.isArray(b.events) || b.events.length === 0 || b.events.length > MAX_EVENTS) return reply(400, { error: "bad events" });

  const cleaned: Clean[] = [];
  for (const raw of b.events) {
    const c = cleanEvent(raw, now.getTime());
    if (!c) return reply(400, { error: "bad event" });
    cleaned.push(c);
  }

  // A well-behaved client sends a few batches a minute; far more than that is not a person playing.
  const minute = Math.floor(now.getTime() / 60_000);
  const rl = await store.incr(`an:rl:${b.id}:${minute}`);
  if (rl === 1) await store.expire(`an:rl:${b.id}:${minute}`, 120);
  if (rl > RATE_PER_MINUTE) return reply(429, { error: "slow down" });

  const date = utcToday(now);
  const tally = new Map<string, number>();
  for (const c of cleaned) {
    tally.set(`an:ev:${date}:${c.name}`, (tally.get(`an:ev:${date}:${c.name}`) ?? 0) + 1);
    for (const k of c.counted) tally.set(`an:ev:${date}:${c.name}:${k}`, (tally.get(`an:ev:${date}:${c.name}:${k}`) ?? 0) + 1);
    if (c.sum > 0) tally.set(`an:sum:${date}:${c.name}`, (tally.get(`an:sum:${date}:${c.name}`) ?? 0) + c.sum);
  }
  for (const [key, n] of tally) await store.incr(key, n);

  const firstSeen = b.firstSeen as string;
  const age = dayDiff(firstSeen, date);
  await store.pfadd(`an:dau:${date}`, b.id);
  await store.pfadd(`an:coh:${firstSeen}`, b.id);
  if (age >= 0 && age <= 60) await store.pfadd(`an:ret:${firstSeen}:${age}`, b.id);
  if (typeof b.src === "string") {
    await store.pfadd(`an:src:${b.src}`, b.id);
    await store.hset("an:srcnames", b.src, "1");
  }
  // Keys only need their lifetime set once per session, not on every batch.
  if (cleaned.some((c) => c.name === "session_start")) {
    for (const k of [`an:dau:${date}`, `an:coh:${firstSeen}`, `an:ret:${firstSeen}:${age}`]) await store.expire(k, KEEP);
    for (const name of cleaned.map((c) => c.name)) await store.expire(`an:ev:${date}:${name}`, KEEP);
    for (const name of SUMMED_EVENTS) await store.expire(`an:sum:${date}:${name}`, KEEP);
  }
  return reply(200, { ok: true });
}

export interface DayStats { date: string; dau: number; events: Record<string, number>; byProp: Record<string, number>; sums: Record<string, number> }
export interface Cohort { firstSeen: string; size: number; d1: number | null; d7: number | null; d30: number | null }

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Daily active players, event counts, cohort retention and acquisition sources, for the admin page. */
export async function getStats(store: Store, now = new Date(), days = 14): Promise<Reply> {
  const today = utcToday(now);
  const dayList = Array.from({ length: days }, (_, i) => addDays(today, -i));
  const perDay: DayStats[] = [];
  for (const date of dayList) {
    const events: Record<string, number> = {};
    const byProp: Record<string, number> = {};
    // One round trip per day: every counter that could exist for it, read without creating any.
    const keys: string[] = [];
    const labels: { name: string; label: string | null }[] = [];
    for (const name of EVENT_NAMES) {
      keys.push(`an:ev:${date}:${name}`); labels.push({ name, label: null });
      for (const [prop, values] of Object.entries(COUNTED_PROPS))
        for (const v of values) { keys.push(`an:ev:${date}:${name}:${prop}:${v}`); labels.push({ name, label: `${name}.${prop}.${v}` }); }
    }
    const counts = await store.mcount(keys);
    counts.forEach((n, i) => {
      if (!n) return;
      const l = labels[i]!;
      if (l.label === null) events[l.name] = n; else byProp[l.label] = n;
    });
    const sums: Record<string, number> = {};
    (await store.mcount(SUMMED_EVENTS.map((n) => `an:sum:${date}:${n}`))).forEach((n, i) => { if (n) sums[SUMMED_EVENTS[i]!] = n; });
    perDay.push({ date, dau: await store.pfcount(`an:dau:${date}`), events, byProp, sums });
  }
  const cohorts: Cohort[] = [];
  for (const firstSeen of dayList) {
    const size = await store.pfcount(`an:coh:${firstSeen}`);
    if (size === 0) continue;
    const ret = async (d: number): Promise<number | null> => (dayDiff(firstSeen, today) >= d ? pct(await store.pfcount(`an:ret:${firstSeen}:${d}`), size) : null);
    cohorts.push({ firstSeen, size, d1: await ret(1), d7: await ret(7), d30: await ret(30) });
  }
  const sources: { src: string; players: number }[] = [];
  for (const src of await store.hkeys("an:srcnames")) sources.push({ src, players: await store.pfcount(`an:src:${src}`) });
  sources.sort((a, b) => b.players - a.players);
  return reply(200, { generated: now.toISOString(), days: perDay, cohorts, sources });
}

/** Constant-time comparison, so the admin token cannot be guessed from response timing. */
export function tokenOk(header: string | null, token: string | undefined): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const given = header.slice(7);
  let diff = given.length ^ token.length;
  for (let i = 0; i < Math.max(given.length, token.length); i++) diff |= (given.charCodeAt(i) || 0) ^ (token.charCodeAt(i) || 0);
  return diff === 0;
}
