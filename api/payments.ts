import { tokenOk } from "../src/server/analytics.js";
import { getPayments } from "../src/server/payments.js";
import { withStore } from "../src/server/route.js";

/**
 * The payments ledger behind /admin.html: `?ref=` finds one payment, `?player=` an account's history,
 * otherwise `?days=` lists recent ones with totals. Same `Authorization: Bearer <ADMIN_TOKEN>` as /api/stats.
 */
export function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  return withStore(async (store) => {
    if (!tokenOk(request.headers.get("authorization"), process.env.ADMIN_TOKEN)) return { status: 401, body: { error: "unauthorised" } };
    return getPayments(store, { ref: q.get("ref"), player: q.get("player"), days: q.get("days") });
  }, undefined, { request, bucket: "payments" });
}
