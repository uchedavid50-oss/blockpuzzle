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
  hkeys(key: string): Promise<string[]>;
  /** Adds to a counter and returns the new value. */
  incr(key: string, by?: number): Promise<number>;
  /** Approximate distinct counting (a HyperLogLog): stores no member, so nothing can be read back. */
  pfadd(key: string, member: string): Promise<void>;
  pfcount(key: string): Promise<number>;
  /** Reads many counters at once without creating any that are missing (0 for absent). */
  mcount(keys: string[]): Promise<number[]>;
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
  async hkeys(key: string): Promise<string[]> { return [...(this.h.get(key)?.keys() ?? [])]; }
  private counters = new Map<string, number>();
  async incr(key: string, by = 1): Promise<number> {
    const n = (this.counters.get(key) ?? 0) + by;
    this.counters.set(key, n);
    return n;
  }
  // In memory this is exact; Redis's version is approximate. Either way no member can be listed.
  private pf = new Map<string, Set<string>>();
  async pfadd(key: string, member: string): Promise<void> {
    if (!this.pf.has(key)) this.pf.set(key, new Set());
    this.pf.get(key)!.add(member);
  }
  async pfcount(key: string): Promise<number> { return this.pf.get(key)?.size ?? 0; }
  async mcount(keys: string[]): Promise<number[]> { return keys.map((k) => this.counters.get(k) ?? 0); }
  /** Test helper: every key this store holds, to check what is and is not kept. */
  allKeys(): string[] { return [...this.kv.keys(), ...this.z.keys(), ...this.h.keys(), ...this.counters.keys(), ...this.pf.keys()]; }
}
