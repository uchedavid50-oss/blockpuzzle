import { getStats, tokenOk } from "../src/server/analytics.js";
import { withStore } from "../src/server/route.js";

/**
 * The numbers behind /admin.html. Needs `Authorization: Bearer <ADMIN_TOKEN>`; closed if no token (or too
 * short a token) is set. Wrong guesses are rate-limited like everything else.
 */
export function GET(request: Request): Promise<Response> {
  const days = Math.min(60, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 14));
  return withStore(async (store) => {
    if (!tokenOk(request.headers.get("authorization"), process.env.ADMIN_TOKEN)) return { status: 401, body: { error: "unauthorised" } };
    return getStats(store, new Date(), days);
  }, undefined, { request, bucket: "stats" });
}
