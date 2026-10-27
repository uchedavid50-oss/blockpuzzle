// Rate limits. Every public endpoint is limited per network address, so a script cannot hammer one
// route (and run up the Redis bill) or create players without end. Works on any Store.

import type { Store } from "./store.js";

/** Requests allowed per minute from one address, per route. */
export const LIMITS = {
  submit: 10, start: 20, rename: 5, checkout: 6, purchase: 30, coins: 10, entitlements: 30,
  board: 60, streaks: 60, transfer: 5, collect: 300, stats: 10, payments: 20, signin: 10, save: 20,
} as const;
export type Bucket = keyof typeof LIMITS;

/** New leaderboard players one address may create in a UTC day (a school or office shares an address). */
export const NEW_PLAYERS_PER_ADDRESS_PER_DAY = 20;

/** The caller's address, as Vercel reports it. Anything that does not look like an IP shares one bucket. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0];
  const ip = (forwarded ?? headers.get("x-real-ip") ?? "").trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : "unknown";
}

/** Counts one request in this minute's window; true once the caller is over the route's limit. */
export async function overLimit(store: Store, bucket: Bucket, who: string, now = new Date()): Promise<boolean> {
  const key = `rl:${bucket}:${who}:${Math.floor(now.getTime() / 60_000)}`;
  const n = await store.incr(key);
  if (n === 1) await store.expire(key, 120);
  return n > LIMITS[bucket];
}

/** Counts a new player from this address today; true once the address has made too many. */
export async function tooManyNewPlayers(store: Store, who: string, today: string): Promise<boolean> {
  const key = `np:${who}:${today}`;
  const n = await store.incr(key);
  if (n === 1) await store.expire(key, 2 * 86_400);
  return n > NEW_PLAYERS_PER_ADDRESS_PER_DAY;
}
