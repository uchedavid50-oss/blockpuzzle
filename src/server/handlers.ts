// The leaderboard's request handling, independent of any web framework: each function takes a store
// and plain data and returns a status and a JSON body. The api/ routes are thin wrappers around these.

import { applyPlay, currentStreak, type StreakRec } from "../streak.js";
import { RULES_VERSION, replay, type MoveTuple } from "../verify.js";
import { cleanName, dateAllowed, isDate, isPlayerId, utcToday } from "./rules.js";
import type { Store } from "./store.js";

export interface Reply { status: number; body: Record<string, unknown> }
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

const DAY = 86_400;
const BOARD_SIZE = 25;
const boardKey = (date: string): string => `lb:${date}`;

interface PlayerStreak extends StreakRec { best: number }
async function readStreak(store: Store, player: string): Promise<PlayerStreak | null> {
  try {
    const d = JSON.parse((await store.get(`streak:${player}`)) ?? "null") as Partial<PlayerStreak> | null;
    return d && typeof d.last === "string" && typeof d.n === "number"
      ? { last: d.last, n: d.n, best: typeof d.best === "number" ? d.best : d.n, ...(typeof d.freezeWeek === "string" ? { freezeWeek: d.freezeWeek } : {}) }
      : null;
  } catch { return null; }
}

/**
 * Accepts a day's result. The score is never taken from the client: the moves are replayed against the
 * day's real piece sequence, so only a legal game can score, and only the first attempt per player counts.
 */
export async function submitScore(store: Store, body: unknown, now = new Date()): Promise<Reply> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.v !== RULES_VERSION) return reply(409, { error: "outdated", message: "Please reload the game to update it." });
  if (!isPlayerId(b.player)) return reply(400, { error: "bad player" });
  if (!isDate(b.date) || !dateAllowed(b.date, now)) return reply(400, { error: "bad date" });
  const name = cleanName(b.name);
  if (!name) return reply(400, { error: "bad name", message: "Use 3 to 16 letters, numbers or spaces, and keep it friendly." });

  const result = replay(b.date, b.moves as MoveTuple[]);
  if (!result.ok) return reply(422, { error: "invalid game", detail: result.error });

  const player = b.player;
  const date = b.date;
  // One official attempt per player per day: the first submission wins.
  if (!(await store.setNx(`sub:${date}:${player}`, "1", 4 * DAY))) return reply(409, { error: "already submitted" });

  await store.zadd(boardKey(date), result.score, player);
  await store.expire(boardKey(date), 45 * DAY);
  await store.hset("names", player, name);

  const before = await readStreak(store, player);
  const { rec } = applyPlay(before, date);
  const next: PlayerStreak = { ...rec, best: Math.max(before?.best ?? 0, rec.n) };
  await store.set(`streak:${player}`, JSON.stringify(next));
  await store.zadd("lb:streak", next.n, player);

  const rank = ((await store.zrevrank(boardKey(date), player)) ?? 0) + 1;
  return reply(200, { ok: true, score: result.score, rank, total: await store.zcard(boardKey(date)), streak: next.n, over: result.over });
}

/** Today's top scores, plus where the asking player stands. */
export async function getBoard(store: Store, query: { date?: unknown; player?: unknown }, now = new Date()): Promise<Reply> {
  const date = query.date ?? utcToday(now);
  if (!isDate(date) || !dateAllowed(date, now)) return reply(400, { error: "bad date" });
  const key = boardKey(date);
  const top = await store.zrevrange(key, 0, BOARD_SIZE - 1);
  const names = await store.hmget("names", top.map((e) => e.member));
  const supporters = await store.hmget("supporters", top.map((e) => e.member));
  const me = isPlayerId(query.player) ? query.player : null;
  let mine: { rank: number; score: number } | null = null;
  if (me) {
    const [rank, score] = await Promise.all([store.zrevrank(key, me), store.zscore(key, me)]);
    if (rank !== null && score !== null) mine = { rank: rank + 1, score };
  }
  return reply(200, {
    date, total: await store.zcard(key), me: mine,
    top: top.map((e, i) => ({ rank: i + 1, name: names[i] ?? "Player", score: e.score, you: e.member === me, supporter: supporters[i] !== null })),
  });
}

/** The longest live daily streaks. A streak that has lapsed is dropped when it is noticed. */
export async function getStreaks(store: Store, query: { player?: unknown }, now = new Date()): Promise<Reply> {
  const today = utcToday(now);
  const candidates = await store.zrevrange("lb:streak", 0, 99);
  const live: { member: string; streak: number; best: number }[] = [];
  for (const c of candidates) {
    const rec = await readStreak(store, c.member);
    const cur = rec ? currentStreak(rec, today) : 0;
    if (cur <= 0) { await store.zrem("lb:streak", c.member); continue; }
    live.push({ member: c.member, streak: cur, best: rec!.best });
  }
  live.sort((a, b) => b.streak - a.streak || b.best - a.best);
  const top = live.slice(0, BOARD_SIZE);
  const names = await store.hmget("names", top.map((e) => e.member));
  const supporters = await store.hmget("supporters", top.map((e) => e.member));
  const me = isPlayerId(query.player) ? query.player : null;
  const mineIdx = me ? live.findIndex((e) => e.member === me) : -1;
  return reply(200, {
    top: top.map((e, i) => ({ rank: i + 1, name: names[i] ?? "Player", streak: e.streak, best: e.best, you: e.member === me, supporter: supporters[i] !== null })),
    me: mineIdx >= 0 ? { rank: mineIdx + 1, streak: live[mineIdx]!.streak } : null,
  });
}

/** Changes a nickname. Only players who already have a posted result can have one. */
export async function renamePlayer(store: Store, body: unknown): Promise<Reply> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isPlayerId(b.player)) return reply(400, { error: "bad player" });
  const name = cleanName(b.name);
  if (!name) return reply(400, { error: "bad name", message: "Use 3 to 16 letters, numbers or spaces, and keep it friendly." });
  const [existing] = await store.hmget("names", [b.player]);
  if (existing === null) return reply(404, { error: "unknown player" });
  await store.hset("names", b.player, name);
  return reply(200, { ok: true, name });
}
