// Backup and restore of the Redis data, over a `cmd` function (one Redis command in, its answer out).
// Used by scripts/backup.ts and scripts/restore.ts, which run on your own machine: there is no public
// endpoint that can read everything.
//
// Strings, sorted sets and hashes are copied exactly, with their expiry. Distinct-count (HyperLogLog)
// keys are not recoverable from outside Redis; only their current count is kept, for reference, and
// they are not restored (they hold anonymous usage statistics, which start counting again).

export type Cmd = (...args: (string | number)[]) => Promise<unknown>;

export type Entry =
  | { key: string; type: "string"; value: string; ttl: number | null }
  | { key: string; type: "zset"; members: { member: string; score: number }[]; ttl: number | null }
  | { key: string; type: "hash"; fields: Record<string, string>; ttl: number | null }
  | { key: string; type: "hll"; count: number };

export interface Backup { v: 1; takenAt: string; entries: Entry[] }

const HLL_PREFIX = "HYLL";

export async function backup(cmd: Cmd, now = new Date()): Promise<Backup> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const r = (await cmd("SCAN", cursor, "COUNT", 500)) as [string, string[]];
    cursor = String(r[0]);
    keys.push(...r[1]);
  } while (cursor !== "0");

  const entries: Entry[] = [];
  for (const key of [...new Set(keys)].sort()) {
    const type = String(await cmd("TYPE", key));
    const ttlRaw = Number(await cmd("TTL", key));
    const ttl = ttlRaw > 0 ? ttlRaw : null;
    if (type === "string") {
      const value = (await cmd("GET", key)) as string | null;
      if (value === null) continue; // expired while reading
      if (value.startsWith(HLL_PREFIX)) entries.push({ key, type: "hll", count: Number(await cmd("PFCOUNT", key)) });
      else entries.push({ key, type: "string", value, ttl });
    } else if (type === "zset") {
      const flat = ((await cmd("ZRANGE", key, 0, -1, "WITHSCORES")) as string[]) ?? [];
      const members: { member: string; score: number }[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) members.push({ member: String(flat[i]), score: Number(flat[i + 1]) });
      entries.push({ key, type: "zset", members, ttl });
    } else if (type === "hash") {
      const flat = ((await cmd("HGETALL", key)) as string[]) ?? [];
      const fields: Record<string, string> = {};
      for (let i = 0; i + 1 < flat.length; i += 2) fields[String(flat[i])] = String(flat[i + 1]);
      entries.push({ key, type: "hash", fields, ttl });
    }
  }
  return { v: 1, takenAt: now.toISOString(), entries };
}

/** Puts a backup back. Existing keys with the same name are replaced. Returns how many keys were written. */
export async function restore(cmd: Cmd, b: Backup): Promise<number> {
  if (b?.v !== 1 || !Array.isArray(b.entries)) throw new Error("not a backup file");
  let n = 0;
  for (const e of b.entries) {
    if (e.type === "hll") continue;
    await cmd("DEL", e.key);
    if (e.type === "string") await cmd("SET", e.key, e.value);
    else if (e.type === "zset") for (const m of e.members) await cmd("ZADD", e.key, m.score, m.member);
    else if (e.type === "hash") for (const [f, v] of Object.entries(e.fields)) await cmd("HSET", e.key, f, v);
    if (e.ttl) await cmd("EXPIRE", e.key, e.ttl);
    n++;
  }
  return n;
}
