// One serverless function for the whole API. The route modules live in routes/ (one file per endpoint,
// each exporting GET and/or POST); this dispatches by path. A single function keeps the project inside
// Vercel's Hobby-plan limit of 12 functions, which separate files per route had exceeded.

import * as board from "../routes/board.js";
import * as checkout from "../routes/checkout.js";
import * as coins from "../routes/coins.js";
import * as collect from "../routes/collect.js";
import * as entitlements from "../routes/entitlements.js";
import * as health from "../routes/health.js";
import * as payments from "../routes/payments.js";
import * as paystackWebhook from "../routes/paystack-webhook.js";
import * as purchase from "../routes/purchase.js";
import * as rename from "../routes/rename.js";
import * as save from "../routes/save.js";
import * as signin from "../routes/signin.js";
import * as start from "../routes/start.js";
import * as stats from "../routes/stats.js";
import * as streaks from "../routes/streaks.js";
import * as submit from "../routes/submit.js";
import * as transfer from "../routes/transfer.js";

type Handler = (request: Request) => Response | Promise<Response>;
const routes: Record<string, { GET?: Handler; POST?: Handler }> = {
  "board": board,
  "checkout": checkout,
  "coins": coins,
  "collect": collect,
  "entitlements": entitlements,
  "health": health,
  "payments": payments,
  "paystack-webhook": paystackWebhook,
  "purchase": purchase,
  "rename": rename,
  "save": save,
  "signin": signin,
  "start": start,
  "stats": stats,
  "streaks": streaks,
  "submit": submit,
  "transfer": transfer,
};

async function dispatch(request: Request): Promise<Response> {
  const name = new URL(request.url).pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  const route = Object.hasOwn(routes, name) ? routes[name] : undefined;
  const handler = request.method === "POST" ? route?.POST : request.method === "GET" ? route?.GET : undefined;
  if (!handler) {
    const status = route ? 405 : 404;
    return new Response(JSON.stringify({ error: route ? "method not allowed" : "not found" }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  return handler(request);
}

export const GET = dispatch;
export const POST = dispatch;
