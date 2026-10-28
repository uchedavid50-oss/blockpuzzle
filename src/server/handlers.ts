// The leaderboard's request handling, independent of any web framework: each function takes a store
// and plain data and returns a status and a JSON body. The api/ routes are thin wrappers around these.

import { applyPlay, currentStreak, type StreakRec } from "../streak.js";
import { RULES_VERSION, replay, type MoveTuple } from "../verify.js";
import { claimName, isRetired } from "./accounts.js";
import { tooManyNewPlayers } from "./limits.js";
import { boardAllowed, boardOpen, cleanName, isBoardId, isDate, isPlayerId, isWeekId, utcToday } from "./rules.js";
import type { Store } from "./store.js";

export interface Reply { status: number; body: Record<string, unknown> }
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

const DAY = 86_400;
const BOARD_SIZE = 25;
/** No one places a piece faster than this on average over a whole game; a quicker game was not played by hand. */
export const MIN_MS_PER_MOVE = 300;
const startKey = (date: string, player: string): string => `start:${date}:${player}`;
/** A day's markers can go after four days; a week's stay until well after the prizes are paid. */
const keepFor = (id: string): number => (isWeekId(id) ? 12 * DAY : 4 * DAY);
const MOVED = reply(410, { error: "moved", message: "This device's account was moved to another device." });
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
 * Marks the moment a player starts the day's official attempt. Only the first start counts, so the
 * server knows how long the game took and can refuse one finished faster than a person could play it.
 */
export async function startDaily(store: Store, body: unknown, now = new Date()): Promise<Reply> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isPlayerId(b.player)) return reply(400, { error: "bad player" });
  if (!isBoardId(b.date) || !boardOpen(b.date, now)) return reply(400, { error: "bad date" });
  if (await isRetired(store, b.player)) return MOVED;
  const fresh = await store.setNx(startKey(b.date, b.player), String(now.getTime()), keepFor(b.date));
  return reply(200, { ok: true, first: fresh });
}

/**
 * Accepts a day's result. The score is never taken from the client: the moves are replayed against the
 * day's real piece sequence, so only a legal game can score, and only the first attempt per player counts.
 * The attempt must have been started online (startDaily) and must have taken a humanly possible time.
 */
export async function submitScore(store: Store, body: unknown, now = new Date(), ip = "unknown"): Promise<Reply> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.v !== RULES_VERSION) return reply(409, { error: "outdated", message: "Please reload the game to update it." });
  if (!isPlayerId(b.player)) return reply(400, { error: "bad player" });
  if (!isBoardId(b.date) || !boardOpen(b.date, now)) return reply(400, { error: "bad date" });
  const name = cleanName(b.name);
  if (!name) return reply(400, { error: "bad name", message: "Use 3 to 16 letters, numbers or spaces, and keep it friendly." });

  const result = replay(b.date, b.moves as MoveTuple[]);
  if (!result.ok) return reply(422, { error: "invalid game", detail: result.error });

  const player = b.player;
  const date = b.date;
  if (await isRetired(store, player)) return MOVED;
  const started = Number(await store.get(startKey(date, player)));
  if (!started) return reply(409, { error: "not started", message: "Scores count only when the daily is started while you are online." });
  if (now.getTime() - started < result.moves * MIN_MS_PER_MOVE) return reply(422, { error: "too fast", message: "That game was finished too quickly to count." });
  if (await store.get(`sub:${date}:${player}`)) return reply(409, { error: "already submitted" });

  // A brand-new player costs their address one of a few new players a day, so nobody can flood the
  // board with throwaway accounts.
  const [known] = await store.hmget("names", [player]);
  if ((known === null || known === undefined) && (await tooManyNewPlayers(store, ip, utcToday(now))))
    return reply(429, { error: "too many players", message: "Too many new players from this network today. Try again tomorrow." });
  if (!(await claimName(store, player, name))) return reply(409, { error: "name taken", message: "Someone already uses that name. Try another." });

  // One official attempt per player per day: the first submission wins.
  if (!(await store.setNx(`sub:${date}:${player}`, "1", keepFor(date)))) return reply(409, { error: "already submitted" });

  await store.zadd(boardKey(date), result.score, player);
  await store.expire(boardKey(date), 45 * DAY);

  // Only a day's board feeds the daily streak; the Weekly Cup does not.
  let streak = 0;
  if (isDate(date)) {
    const before = await readStreak(store, player);
    const { rec } = applyPlay(before, date);
    const next: PlayerStreak = { ...rec, best: Math.max(before?.best ?? 0, rec.n) };
    await store.set(`streak:${player}`, JSON.stringify(next));
    await store.zadd("lb:streak", next.n, player);
    streak = next.n;
  }

  const rank = ((await store.zrevrank(boardKey(date), player)) ?? 0) + 1;
  return reply(200, { ok: true, score: result.score, rank, total: await store.zcard(boardKey(date)), streak, over: result.over });
}

/** Today's top scores, plus where the asking player stands. */
export async function getBoard(store: Store, query: { date?: unknown; player?: unknown }, now = new Date()): Promise<Reply> {
  const date = query.date ?? utcToday(now);
  if (!isBoardId(date) || !boardAllowed(date, now)) return reply(400, { error: "bad date" });
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

interface LiveStreak { member: string; streak: number; best: number }

/**
 * The live streak list, worked out at most every 30 seconds and kept in one key. Working it out costs a
 * read per candidate, so doing it on every request would let anyone run up the Redis bill.
 */
async function liveStreaks(store: Store, today: string): Promise<LiveStreak[]> {
  const cacheKey = `cache:streaks:${today}`;
  try {
    const cached = JSON.parse((await store.get(cacheKey)) ?? "null") as LiveStreak[] | null;
    if (Array.isArray(cached)) return cached;
  } catch { /* rebuild */ }
  const candidates = await store.zrevrange("lb:streak", 0, 99);
  const live: LiveStreak[] = [];
  for (const c of candidates) {
    const rec = await readStreak(store, c.member);
    const cur = rec ? currentStreak(rec, today) : 0;
    if (cur <= 0) { await store.zrem("lb:streak", c.member); continue; }
    live.push({ member: c.member, streak: cur, best: rec!.best });
  }
  live.sort((a, b) => b.streak - a.streak || b.best - a.best);
  await store.set(cacheKey, JSON.stringify(live));
  await store.expire(cacheKey, 30);
  return live;
}

/** The longest live daily streaks. A streak that has lapsed is dropped when it is noticed. */
export async function getStreaks(store: Store, query: { player?: unknown }, now = new Date()): Promise<Reply> {
  const live = await liveStreaks(store, utcToday(now));
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
  if (await isRetired(store, b.player)) return MOVED;
  const [existing] = await store.hmget("names", [b.player]);
  if (existing === null || existing === undefined) return reply(404, { error: "unknown player" });
  if (!(await claimName(store, b.player, name))) return reply(409, { error: "name taken", message: "Someone already uses that name. Try another." });
  return reply(200, { ok: true, name });
}
