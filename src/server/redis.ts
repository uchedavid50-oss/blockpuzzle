// Redis over HTTP (the Upstash REST API, which Vercel's Redis integration provides). Each command is
// a JSON array posted to the REST URL, so no client library is needed.

import type { Store } from "./store.js";
import { postgresStore } from "./postgres.js";

type Fetch = typeof fetch;

export class RedisStore implements Store {
  constructor(private url: string, private token: string, private doFetch: Fetch = fetch) {}

  private async cmd(...args: (string | number)[]): Promise<unknown> {
    const res = await this.doFetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`redis ${args[0]}: HTTP ${res.status}`);
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (data.error) throw new Error(`redis ${args[0]}: ${data.error}`);
    return data.result ?? null;
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.cmd("SET", key, value, "NX", "EX", ttlSeconds)) === "OK";
  }
  async get(key: string): Promise<string | null> { return (await this.cmd("GET", key)) as string | null; }
  async set(key: string, value: string): Promise<void> { await this.cmd("SET", key, value); }
  async expire(key: string, ttlSeconds: number): Promise<void> { await this.cmd("EXPIRE", key, ttlSeconds); }
  async zadd(key: string, score: number, member: string): Promise<void> { await this.cmd("ZADD", key, score, member); }
  async zrem(key: string, member: string): Promise<void> { await this.cmd("ZREM", key, member); }
  async zcard(key: string): Promise<number> { return Number(await this.cmd("ZCARD", key)); }
  async zscore(key: string, member: string): Promise<number | null> {
    const r = await this.cmd("ZSCORE", key, member);
    return r === null ? null : Number(r);
  }
  async zrevrank(key: string, member: string): Promise<number | null> {
    const r = await this.cmd("ZREVRANK", key, member);
    return r === null ? null : Number(r);
  }
  async zrevrange(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]> {
    const flat = (await this.cmd("ZREVRANGE", key, start, stop, "WITHSCORES")) as string[] | null;
    const out: { member: string; score: number }[] = [];
    for (let i = 0; flat && i + 1 < flat.length; i += 2) out.push({ member: String(flat[i]), score: Number(flat[i + 1]) });
    return out;
  }
  async hset(key: string, field: string, value: string): Promise<void> { await this.cmd("HSET", key, field, value); }
  async hkeys(key: string): Promise<string[]> { return ((await this.cmd("HKEYS", key)) as string[] | null) ?? []; }
  async hdel(key: string, field: string): Promise<void> { await this.cmd("HDEL", key, field); }
  async del(key: string): Promise<void> { await this.cmd("DEL", key); }
  async sadd(key: string, member: string): Promise<void> { await this.cmd("SADD", key, member); }
  async srem(key: string, member: string): Promise<void> { await this.cmd("SREM", key, member); }
  async smembers(key: string): Promise<string[]> { return ((await this.cmd("SMEMBERS", key)) as string[] | null) ?? []; }
  async incr(key: string, by = 1): Promise<number> { return Number(await this.cmd("INCRBY", key, by)); }
  async pfadd(key: string, member: string): Promise<void> { await this.cmd("PFADD", key, member); }
  async pfcount(key: string): Promise<number> { return Number(await this.cmd("PFCOUNT", key)); }
  async mcount(keys: string[]): Promise<number[]> {
    if (keys.length === 0) return [];
    return (((await this.cmd("MGET", ...keys)) as (string | null)[] | null) ?? []).map((v) => Number(v ?? 0) || 0);
  }
  async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    if (fields.length === 0) return [];
    return (await this.cmd("HMGET", key, ...fields)) as (string | null)[];
  }
}

/** The store configured by the environment, or null if no Redis is attached yet. */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): Store | null {
  // Local development and tests can supply an in-memory store (see scripts/dev-api.ts).
  const injected = (globalThis as { __blockpuzzleStore?: Store }).__blockpuzzleStore;
  if (injected) return injected;
  // Postgres (Neon) only when asked for by name: a database URL being present must never move live data.
  if (env.STORE === "postgres" && env.DATABASE_URL) return postgresStore(env.DATABASE_URL);
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new RedisStore(url, token) : null;
}
