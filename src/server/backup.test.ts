import { describe, expect, it } from "vitest";
import { backup, restore, type Cmd } from "./backup";

/** The few Redis commands the backup uses, over plain maps: enough to prove a round trip. */
function fakeRedis(): { cmd: Cmd; dump: () => unknown } {
  const str = new Map<string, string>(), z = new Map<string, Map<string, number>>(), h = new Map<string, Map<string, string>>(), ttl = new Map<string, number>();
  const all = (): string[] => [...str.keys(), ...z.keys(), ...h.keys()];
  const cmd: Cmd = async (...a) => {
    const [op, key] = [String(a[0]), String(a[1])];
    switch (op) {
      case "SCAN": return ["0", all()];
      case "TYPE": return str.has(key) ? "string" : z.has(key) ? "zset" : h.has(key) ? "hash" : "none";
      case "TTL": return ttl.get(key) ?? -1;
      case "GET": return str.get(key) ?? null;
      case "PFCOUNT": return 42;
      case "ZRANGE": return [...(z.get(key) ?? [])].sort((x, y) => x[1] - y[1]).flatMap(([m, s]) => [m, String(s)]);
      case "HGETALL": return [...(h.get(key) ?? [])].flat();
      case "DEL": str.delete(key); z.delete(key); h.delete(key); ttl.delete(key); return 1;
      case "SET": str.set(key, String(a[2])); return "OK";
      case "ZADD": if (!z.has(key)) z.set(key, new Map()); z.get(key)!.set(String(a[3]), Number(a[2])); return 1;
      case "HSET": if (!h.has(key)) h.set(key, new Map()); h.get(key)!.set(String(a[2]), String(a[3])); return 1;
      case "EXPIRE": ttl.set(key, Number(a[2])); return 1;
      default: throw new Error(`unexpected ${op}`);
    }
  };
  return { cmd, dump: () => ({ str: [...str], z: [...z].map(([k, m]) => [k, [...m].sort()]), h: [...h].map(([k, m]) => [k, [...m].sort()]), ttl: [...ttl] }) };
}

describe("backup and restore", () => {
  it("copies strings, sorted sets and hashes with their expiry, and restores them exactly", async () => {
    const a = fakeRedis();
    await a.cmd("SET", "names:x", "Ada"); await a.cmd("EXPIRE", "names:x", 500);
    await a.cmd("ZADD", "lb:2026-10-28", 120, "p1"); await a.cmd("ZADD", "lb:2026-10-28", 80, "p2");
    await a.cmd("HSET", "names", "p1", "Ada"); await a.cmd("HSET", "names", "p2", "Bo");
    const file = await backup(a.cmd, new Date("2026-10-29T00:00:00Z"));
    expect(file.takenAt).toBe("2026-10-29T00:00:00.000Z");
    expect(file.entries.map((e) => e.type).sort()).toEqual(["hash", "string", "zset"]);

    const b = fakeRedis();
    const n = await restore(b.cmd, JSON.parse(JSON.stringify(file)));
    expect(n).toBe(3);
    expect(b.dump()).toEqual(a.dump());
  });

  it("keeps only the count of a distinct-count key and does not restore it", async () => {
    const a = fakeRedis();
    await a.cmd("SET", "an:dau:2026-10-28", "HYLL\u0000binary");
    const file = await backup(a.cmd);
    expect(file.entries).toEqual([{ key: "an:dau:2026-10-28", type: "hll", count: 42 }]);
    const b = fakeRedis();
    expect(await restore(b.cmd, file)).toBe(0);
  });

  it("refuses a file that is not a backup", async () => {
    await expect(restore(fakeRedis().cmd, { v: 2 } as never)).rejects.toThrow("not a backup");
  });
});
