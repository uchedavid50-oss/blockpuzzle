import { describe, expect, it } from "vitest";
import { MemoryStore, type Store } from "./store.js";
import { postgresStore } from "./postgres.js";

// The same behaviour, on the in-memory store and (when DATABASE_URL is set) on a real Neon database.
// Keys carry a random prefix so runs never collide and never touch real data.
const url = process.env.DATABASE_URL;
const backends: [string, () => Store][] = [["memory", () => new MemoryStore()]];
if (url) backends.push(["neon postgres", () => postgresStore(url)]);

describe.each(backends)("Store contract: %s", { timeout: 60_000 }, (_name, make) => {
  const p = `t${Math.random().toString(36).slice(2, 10)}:`;

  it("setNx sets once, get and set read and write", async () => {
    const s = make();
    expect(await s.setNx(p + "a", "1", 60)).toBe(true);
    expect(await s.setNx(p + "a", "2", 60)).toBe(false);
    expect(await s.get(p + "a")).toBe("1");
    await s.set(p + "a", "3");
    expect(await s.get(p + "a")).toBe("3");
    expect(await s.get(p + "missing")).toBeNull();
  });

  it("orders a sorted set highest first, ranks, and removes", async () => {
    const s = make();
    const k = p + "z";
    await s.zadd(k, 10, "a"); await s.zadd(k, 30, "b"); await s.zadd(k, 20, "c"); await s.zadd(k, 20, "d");
    expect(await s.zcard(k)).toBe(4);
    expect(await s.zscore(k, "c")).toBe(20);
    expect((await s.zrevrange(k, 0, 9)).map((e) => e.member)).toEqual(["b", "d", "c", "a"]);
    expect(await s.zrevrank(k, "b")).toBe(0);
    expect(await s.zrevrank(k, "c")).toBe(2);
    expect(await s.zrevrank(k, "nobody")).toBeNull();
    await s.zadd(k, 5, "b"); // an update, not a duplicate
    expect(await s.zcard(k)).toBe(4);
    await s.zrem(k, "b");
    expect(await s.zcard(k)).toBe(3);
    expect((await s.zrevrange(k, 1, 1)).map((e) => e.member)).toEqual(["c"]);
  });

  it("hashes, counters and distinct counts", async () => {
    const s = make();
    await s.hset(p + "h", "x", "1"); await s.hset(p + "h", "y", "2");
    expect(await s.hmget(p + "h", ["y", "q", "x"])).toEqual(["2", null, "1"]);
    expect((await s.hkeys(p + "h")).sort()).toEqual(["x", "y"]);
    expect(await s.incr(p + "c")).toBe(1);
    expect(await s.incr(p + "c", 4)).toBe(5);
    expect(await s.mcount([p + "c", p + "none"])).toEqual([5, 0]);
    await s.pfadd(p + "d", "u1"); await s.pfadd(p + "d", "u1"); await s.pfadd(p + "d", "u2");
    expect(await s.pfcount(p + "d")).toBe(2);
  });

  it("sets, field and key deletion", async () => {
    const s = make();
    await s.sadd(p + "s", "a"); await s.sadd(p + "s", "a"); await s.sadd(p + "s", "b");
    expect((await s.smembers(p + "s")).sort()).toEqual(["a", "b"]);
    await s.srem(p + "s", "a");
    expect(await s.smembers(p + "s")).toEqual(["b"]);
    await s.hset(p + "h2", "x", "1"); await s.hset(p + "h2", "y", "2");
    await s.hdel(p + "h2", "x");
    expect(await s.hkeys(p + "h2")).toEqual(["y"]);
    await s.set(p + "k", "v");
    await s.del(p + "k"); await s.del(p + "h2"); await s.del(p + "s");
    expect(await s.get(p + "k")).toBeNull();
    expect(await s.hkeys(p + "h2")).toEqual([]);
    expect(await s.smembers(p + "s")).toEqual([]);
  });
});
