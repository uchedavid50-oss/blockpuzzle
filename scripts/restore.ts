// Puts a backup file back into Redis. This REPLACES keys with the same names, so use it on an empty
// or damaged database, not to "merge" two. Needs the same env as backup.ts, and the file as an argument:
//   npx vite-node scripts/restore.ts backups/redis-2026-10-29.json --yes

import { readFileSync } from "node:fs";
import { restore, type Backup, type Cmd } from "../src/server/backup";

const file = process.argv[2];
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
if (!file || !url || !token) { console.error("Usage: restore.ts <backup file> --yes (with KV_REST_API_URL and KV_REST_API_TOKEN set)."); process.exit(1); }
if (!process.argv.includes("--yes")) { console.error("This replaces keys in the database that the environment points at. Add --yes to go ahead."); process.exit(1); }

const cmd: Cmd = async (...args) => {
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const d = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok || d.error) throw new Error(`redis ${args[0]}: ${d.error ?? res.status}`);
  return d.result ?? null;
};

const n = await restore(cmd, JSON.parse(readFileSync(file, "utf8")) as Backup);
console.log(`restored ${n} keys from ${file}`);
