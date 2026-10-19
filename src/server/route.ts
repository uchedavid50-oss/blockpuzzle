// Shared plumbing for the api/ routes: JSON responses, safe body parsing and store lookup.

import { storeFromEnv } from "./redis.js";
import type { Reply } from "./handlers.js";
import type { Store } from "./store.js";

const MAX_BODY = 200_000; // a long game is well under this

export function json(status: number, body: unknown, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}

/** Runs a handler with the configured store; answers 503 until Redis is attached. */
export async function withStore(fn: (store: Store) => Promise<Reply>, cache?: string): Promise<Response> {
  const store = storeFromEnv();
  if (!store) return json(503, { error: "leaderboard not configured" });
  try {
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
