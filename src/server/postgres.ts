// The same Store, on Postgres (Neon). Selected with STORE=postgres; Redis stays the default so that
// switching is a deliberate act, never a side effect of a database URL being present.
//
// Neon's serverless driver speaks HTTP, which suits Vercel functions (no connection to keep open).
// Tables are generic (one per Redis type the Store uses) and created on first use.

import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { Store } from "./store.js";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bp_kv (key text PRIMARY KEY, value text NOT NULL, expires_at timestamptz)`,
  `CREATE TABLE IF NOT EXISTS bp_zset (key text NOT NULL, member text NOT NULL, score double precision NOT NULL, PRIMARY KEY (key, member))`,
  `CREATE INDEX IF NOT EXISTS bp_zset_score ON bp_zset (key, score DESC, member DESC)`,
  `CREATE TABLE IF NOT EXISTS bp_hash (key text NOT NULL, field text NOT NULL, value text NOT NULL, PRIMARY KEY (key, field))`,
  `CREATE TABLE IF NOT EXISTS bp_counter (key text PRIMARY KEY, n bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bp_distinct (key text NOT NULL, h text NOT NULL, PRIMARY KEY (key, h))`,
  `CREATE TABLE IF NOT EXISTS bp_expiry (key text PRIMARY KEY, expires_at timestamptz NOT NULL)`,
];

export class PostgresStore implements Store {
  private ready: Promise<void> | null = null;
  constructor(private q: Query) {}

  private async run(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    this.ready ??= (async () => { for (const s of SCHEMA) await this.q(s); })().catch((e) => { this.ready = null; throw e; });
    await this.ready;
    return this.q(text, params);
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    // Sets when absent, or when the old value has expired (as Redis would have dropped it).
    const rows = await this.run(
      `INSERT INTO bp_kv (key, value, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
       WHERE bp_kv.expires_at IS NOT NULL AND bp_kv.expires_at < now() RETURNING key`, [key, value, ttlSeconds]);
    return rows.length === 1;
  }
  async get(key: string): Promise<string | null> {
    const rows = await this.run(`SELECT value FROM bp_kv WHERE key = $1 AND (expires_at IS NULL OR expires_at >= now())`, [key]);
    return rows[0] ? String(rows[0].value) : null;
  }
  async set(key: string, value: string): Promise<void> {
    await this.run(`INSERT INTO bp_kv (key, value, expires_at) VALUES ($1, $2, NULL) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = NULL`, [key, value]);
  }
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.run(`UPDATE bp_kv SET expires_at = now() + make_interval(secs => $2) WHERE key = $1`, [key, ttlSeconds]);
    await this.run(`INSERT INTO bp_expiry (key, expires_at) VALUES ($1, now() + make_interval(secs => $2)) ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at`, [key, ttlSeconds]);
    await this.purge();
  }
  /** Drops sorted sets, hashes and counters whose expiry has passed, as Redis would have. */
  private async purge(): Promise<void> {
    const gone = await this.run(`DELETE FROM bp_expiry WHERE expires_at < now() RETURNING key`);
    const keys = gone.map((r) => String(r.key));
    if (keys.length === 0) return;
    for (const t of ["bp_zset", "bp_hash", "bp_counter", "bp_distinct"]) await this.run(`DELETE FROM ${t} WHERE key = ANY($1)`, [keys]);
  }
  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.run(`INSERT INTO bp_zset (key, member, score) VALUES ($1, $2, $3) ON CONFLICT (key, member) DO UPDATE SET score = EXCLUDED.score`, [key, member, score]);
  }
  async zrem(key: string, member: string): Promise<void> {
    await this.run(`DELETE FROM bp_zset WHERE key = $1 AND member = $2`, [key, member]);
  }
  async zcard(key: string): Promise<number> {
    return Number((await this.run(`SELECT count(*) AS n FROM bp_zset WHERE key = $1`, [key]))[0]?.n ?? 0);
  }
  async zscore(key: string, member: string): Promise<number | null> {
    const r = await this.run(`SELECT score FROM bp_zset WHERE key = $1 AND member = $2`, [key, member]);
    return r[0] ? Number(r[0].score) : null;
  }
  async zrevrank(key: string, member: string): Promise<number | null> {
    const s = await this.zscore(key, member);
    if (s === null) return null;
    const r = await this.run(`SELECT count(*) AS n FROM bp_zset WHERE key = $1 AND (score > $2 OR (score = $2 AND member > $3))`, [key, s, member]);
    return Number(r[0]?.n ?? 0);
  }
  async zrevrange(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]> {
    if (stop < start) return [];
    const r = await this.run(`SELECT member, score FROM bp_zset WHERE key = $1 ORDER BY score DESC, member DESC OFFSET $2 LIMIT $3`, [key, start, stop - start + 1]);
    return r.map((x) => ({ member: String(x.member), score: Number(x.score) }));
  }
  async hset(key: string, field: string, value: string): Promise<void> {
    await this.run(`INSERT INTO bp_hash (key, field, value) VALUES ($1, $2, $3) ON CONFLICT (key, field) DO UPDATE SET value = EXCLUDED.value`, [key, field, value]);
  }
  async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    if (fields.length === 0) return [];
    const r = await this.run(`SELECT field, value FROM bp_hash WHERE key = $1 AND field = ANY($2)`, [key, fields]);
    const m = new Map(r.map((x) => [String(x.field), String(x.value)]));
    return fields.map((f) => m.get(f) ?? null);
  }
  async hkeys(key: string): Promise<string[]> {
    return (await this.run(`SELECT field FROM bp_hash WHERE key = $1 ORDER BY field`, [key])).map((x) => String(x.field));
  }
  async incr(key: string, by = 1): Promise<number> {
    const r = await this.run(`INSERT INTO bp_counter (key, n) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET n = bp_counter.n + EXCLUDED.n RETURNING n`, [key, by]);
    return Number(r[0]?.n);
  }
  // Like the HyperLogLog it stands in for, this keeps no member: only a one-way hash, so ids cannot be listed.
  async pfadd(key: string, member: string): Promise<void> {
    const h = createHash("sha256").update(`${key}\0${member}`).digest("hex");
    await this.run(`INSERT INTO bp_distinct (key, h) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [key, h]);
  }
  async pfcount(key: string): Promise<number> {
    return Number((await this.run(`SELECT count(*) AS n FROM bp_distinct WHERE key = $1`, [key]))[0]?.n ?? 0);
  }
  async mcount(keys: string[]): Promise<number[]> {
    if (keys.length === 0) return [];
    const r = await this.run(`SELECT key, n FROM bp_counter WHERE key = ANY($1)`, [keys]);
    const m = new Map(r.map((x) => [String(x.key), Number(x.n)]));
    return keys.map((k) => m.get(k) ?? 0);
  }
}

/** A Store on the given Neon connection string. */
export function postgresStore(databaseUrl: string): PostgresStore {
  const sql = neon(databaseUrl);
  return new PostgresStore((text, params) => sql.query(text, params ?? []) as Promise<Record<string, unknown>[]>);
}
