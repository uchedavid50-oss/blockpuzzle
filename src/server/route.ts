// Shared plumbing for the api/ routes: JSON responses, safe body parsing, rate limits and store lookup.

import { clientIp, overLimit, type Bucket } from "./limits.js";
import { storeFromEnv } from "./redis.js";
import type { Reply } from "./handlers.js";
import type { Store } from "./store.js";

const MAX_BODY = 200_000; // a long game is well under this

export function json(status: number, body: unknown, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}

/**
 * Runs a handler with the configured store; answers 503 until Redis is attached. With `limit`, the
 * caller's address is rate-limited for that route first, and gets 429 when over.
 */
export async function withStore(fn: (store: Store) => Promise<Reply>, cache?: string, limit?: { request: Request; bucket: Bucket }): Promise<Response> {
  const store = storeFromEnv();
  if (!store) return json(503, { error: "leaderboard not configured" });
  try {
    if (limit && (await overLimit(store, limit.bucket, clientIp(limit.request.headers))))
      return json(429, { error: "slow down", message: "Too many requests. Try again in a minute." });
    const r = await fn(store);
    return json(r.status, r.body, r.status === 200 ? cache : "no-store");
  } catch (err) {
    console.error("leaderboard error", err);
    return json(500, { error: "server error" });
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error("body too large");
  return JSON.parse(text);
}

/**
 * The asking player, without putting their id in the URL (where it would land in logs): the game sends
 * it in an `X-Player` header. Older clients still send `?player=`, which is accepted too.
 */
export const playerFrom = (request: Request): string | null =>
  request.headers.get("x-player") ?? new URL(request.url).searchParams.get("player");
