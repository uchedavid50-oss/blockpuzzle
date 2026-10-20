// Runs the real api/ routes locally against an in-memory store, seeded with a few players, so the
// leaderboard can be tried without Redis. Run with: npm run dev:api  (and npm run dev in another tab).

import { createServer } from "node:http";
import { MemoryStore } from "../src/server/store";
import { submitScore } from "../src/server/handlers";
import { RULES_VERSION } from "../src/verify";
import { playBot } from "../src/solver";
import * as health from "../api/health";
import * as submit from "../api/submit";
import * as rename from "../api/rename";
import * as board from "../api/board";
import * as streaks from "../api/streaks";
import * as collectApi from "../api/collect";
import * as statsApi from "../api/stats";
import * as checkout from "../api/checkout";
import * as purchase from "../api/purchase";
import * as entitlements from "../api/entitlements";
import * as webhook from "../api/paystack-webhook";

// Local development: pretend to be Paystack (the fake is refused on Vercel) and use a known admin token.
process.env.PAYSTACK_FAKE = "1";
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev";

const store = new MemoryStore();
(globalThis as { __blockpuzzleStore?: MemoryStore }).__blockpuzzleStore = store;

type Route = { GET?: (r: Request) => Response | Promise<Response>; POST?: (r: Request) => Response | Promise<Response> };
const routes: Record<string, Route> = { "/api/health": health, "/api/submit": submit, "/api/rename": rename, "/api/board": board, "/api/streaks": streaks, "/api/collect": collectApi, "/api/stats": statsApi, "/api/checkout": checkout, "/api/purchase": purchase, "/api/entitlements": entitlements, "/api/paystack-webhook": webhook };

// A few fake players with real, verified games, so the board has something on it.
const today = new Date().toISOString().slice(0, 10);
const day = (offset: number): string => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const seedPlayers: [string, string, number][] = [["Ada", "a1", 70], ["Bo Strong", "b2", 55], ["Cleo", "c3", 40], ["Dev", "d4", 30], ["Eve", "e5", 22], ["Fay", "f6", 14]];
for (const [name, tag, maxMoves] of seedPlayers) {
  const id = tag.repeat(12);
  const days = tag === "a1" ? [2, 1, 0] : tag === "b2" ? [1, 0] : [0];
  for (const off of days) {
    const date = day(off);
    const moveLog: [number, number, number][] = [];
    playBot({ seed: date, maxMoves, moveLog });
    await submitScore(store, { v: RULES_VERSION, player: id, name, date, moves: moveLog });
  }
}
console.log(`seeded ${seedPlayers.length} players for ${today}`);

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
