// Runs the real api/ routes locally against an in-memory store, seeded with a few players, so the
// leaderboard can be tried without Redis. Run with: npm run dev:api  (and npm run dev in another tab).

import { createServer } from "node:http";
import { MemoryStore, type Store } from "../src/server/store";
import { postgresStore } from "../src/server/postgres";
import { startDaily, submitScore } from "../src/server/handlers";
import { RULES_VERSION } from "../src/verify";
import { playBot } from "../src/solver";
import * as health from "../routes/health";
import * as submit from "../routes/submit";
import * as rename from "../routes/rename";
import * as board from "../routes/board";
import * as streaks from "../routes/streaks";
import * as collectApi from "../routes/collect";
import * as statsApi from "../routes/stats";
import * as checkout from "../routes/checkout";
import * as purchase from "../routes/purchase";
import * as entitlements from "../routes/entitlements";
import * as webhook from "../routes/paystack-webhook";
import * as coinsApi from "../routes/coins";
import * as startApi from "../routes/start";
import * as transferApi from "../routes/transfer";
import * as paymentsApi from "../routes/payments";
import * as signinApi from "../routes/signin";
import * as saveApi from "../routes/save";

// Local secrets (Paystack test keys and the like) live in .env.local, which is never committed.
try { process.loadEnvFile(".env.local"); } catch { /* no local secrets: fine */ }
// Local development: use Paystack's test mode when a test key is set, otherwise pretend to be Paystack
// (the fake is refused on Vercel). A live key is never used locally. And a known admin token.
const key = process.env.PAYSTACK_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_")) {
  delete process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_FAKE = "1";
}
// The server refuses admin tokens shorter than 24 characters, so the local one is long too.
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-dev-admin-token-0000";
// Sign-in locally: email codes are printed here instead of sent, unless a Resend key is in .env.local.
// Google sign-in works locally only with a GOOGLE_CLIENT_ID that lists http://localhost:5173 as an origin.
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "local-dev-auth-secret-00000000";
if (!process.env.RESEND_API_KEY) process.env.EMAIL_FAKE = "1";

// STORE=postgres runs the same routes against Neon (DATABASE_URL) instead of memory, and skips seeding.
const usePg = process.env.STORE === "postgres" && !!process.env.DATABASE_URL;
const store: Store = usePg ? postgresStore(process.env.DATABASE_URL!) : new MemoryStore();
(globalThis as { __blockpuzzleStore?: Store }).__blockpuzzleStore = store;

type Route = { GET?: (r: Request) => Response | Promise<Response>; POST?: (r: Request) => Response | Promise<Response> };
const routes: Record<string, Route> = { "/api/health": health, "/api/submit": submit, "/api/rename": rename, "/api/board": board, "/api/streaks": streaks, "/api/collect": collectApi, "/api/stats": statsApi, "/api/checkout": checkout, "/api/purchase": purchase, "/api/entitlements": entitlements, "/api/paystack-webhook": webhook, "/api/coins": coinsApi, "/api/start": startApi, "/api/transfer": transferApi, "/api/payments": paymentsApi, "/api/signin": signinApi, "/api/save": saveApi };

// A few fake players with real, verified games, so the board has something on it.
const today = new Date().toISOString().slice(0, 10);
const day = (offset: number): string => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const seedPlayers: [string, string, number][] = [["Ada", "a1", 70], ["Bo Strong", "b2", 55], ["Cleo", "c3", 40], ["Dev", "d4", 30], ["Eve", "e5", 22], ["Fay", "f6", 14]];
for (const [name, tag, maxMoves] of usePg ? [] : seedPlayers) {
  const id = tag.repeat(12);
  const days = tag === "a1" ? [2, 1, 0] : tag === "b2" ? [1, 0] : [0];
  for (const off of days) {
    const date = day(off);
    const moveLog: [number, number, number][] = [];
    playBot({ seed: date, maxMoves, moveLog });
    // Each seeded game is played as if at noon on its own day, started an hour before it was posted.
    await startDaily(store, { player: id, date }, new Date(`${date}T11:00:00Z`));
    await submitScore(store, { v: RULES_VERSION, player: id, name, date, moves: moveLog }, new Date(`${date}T12:00:00Z`));
  }
}
console.log(usePg ? "using Neon Postgres, no seed data" : `seeded ${seedPlayers.length} players for ${today}`);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost"}`);
  const route = routes[url.pathname];
  const handler = route?.[req.method as "GET" | "POST"];
  if (!handler) { res.writeHead(404).end("not found"); return; }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const response = await handler(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "POST" ? body : undefined }));
  if (process.env.DEV_API_LOG) console.log(`${new Date().toISOString().slice(11, 23)} ${req.method} ${url.pathname}${url.search.slice(0, 50)} -> ${response.status}`);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(8787, () => console.log("dev API on http://localhost:8787"));
