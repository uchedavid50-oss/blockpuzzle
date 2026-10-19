// The storage the leaderboard needs, as a small interface. Production uses Redis over HTTP (redis.ts);
// tests and local development use the in-memory version below.

export interface Store {
  /** Sets the key only if it does not exist yet. Returns true if it was set. */
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  zcard(key: string): Promise<number>;
  zscore(key: string, member: string): Promise<number | null>;
  /** Zero-based rank counting from the highest score, or null if absent. */
  zrevrank(key: string, member: string): Promise<number | null>;
  zrevrange(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]>;
  hset(key: string, field: string, value: string): Promise<void>;
  hmget(key: string, fields: string[]): Promise<(string | null)[]>;
}

export class MemoryStore implements Store {
  private kv = new Map<string, string>();
  private z = new Map<string, Map<string, number>>();
  private h = new Map<string, Map<string, string>>();

  async setNx(key: string, value: string, _ttlSeconds?: number): Promise<boolean> {
    if (this.kv.has(key)) return false;
    this.kv.set(key, value);
    return true;
  }
  async get(key: string): Promise<string | null> { return this.kv.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.kv.set(key, value); }
  async expire(): Promise<void> { /* no expiry in memory */ }
  async zadd(key: string, score: number, member: string): Promise<void> {
    if (!this.z.has(key)) this.z.set(key, new Map());
    this.z.get(key)!.set(member, score);
  }
  async zrem(key: string, member: string): Promise<void> { this.z.get(key)?.delete(member); }
  async zcard(key: string): Promise<number> { return this.z.get(key)?.size ?? 0; }
  async zscore(key: string, member: string): Promise<number | null> { return this.z.get(key)?.get(member) ?? null; }
  private sorted(key: string): { member: string; score: number }[] {
    // Highest score first; ties by member, as Redis orders equal scores.
    return [...(this.z.get(key) ?? [])].map(([member, score]) => ({ member, score })).sort((a, b) => b.score - a.score || (a.member < b.member ? 1 : -1));
  }
  async zrevrank(key: string, member: string): Promise<number | null> {
    const i = this.sorted(key).findIndex((e) => e.member === member);
    return i < 0 ? null : i;
  }
  async zrevrange(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]> {
    return this.sorted(key).slice(start, stop + 1);
  }
  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.h.has(key)) this.h.set(key, new Map());
    this.h.get(key)!.set(field, value);
  }
  async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    return fields.map((f) => this.h.get(key)?.get(f) ?? null);
  }
}
