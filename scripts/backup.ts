// Saves every Redis key to backups/redis-<date>.json on this machine (the folder is not committed).
//   vercel env pull .env.local        # fetches KV_REST_API_URL and KV_REST_API_TOKEN
//   npx vite-node scripts/backup.ts
// The file holds player ids, names and purchase records: keep it private.

import { mkdirSync, writeFileSync } from "node:fs";
import { backup, type Cmd } from "../src/server/backup";

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) { console.error("Set KV_REST_API_URL and KV_REST_API_TOKEN (see the header of this file)."); process.exit(1); }

const cmd: Cmd = async (...args) => {
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const d = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok || d.error) throw new Error(`redis ${args[0]}: ${d.error ?? res.status}`);
  return d.result ?? null;
};

const b = await backup(cmd);
mkdirSync("backups", { recursive: true });
const file = `backups/redis-${b.takenAt.slice(0, 10)}.json`;
writeFileSync(file, JSON.stringify(b), { mode: 0o600 });
const by = (t: string): number => b.entries.filter((e) => e.type === t).length;
console.log(`saved ${b.entries.length} keys to ${file} (strings ${by("string")}, sorted sets ${by("zset")}, hashes ${by("hash")}, counters skipped ${by("hll")})`);
