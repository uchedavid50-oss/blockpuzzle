import { getStats, tokenOk } from "../src/server/analytics.js";
import { json, withStore } from "../src/server/route.js";

/** The numbers behind /admin.html. Needs `Authorization: Bearer <ADMIN_TOKEN>`; closed if no token is set. */
export function GET(request: Request): Promise<Response> | Response {
  if (!tokenOk(request.headers.get("authorization"), process.env.ADMIN_TOKEN)) return json(401, { error: "unauthorised" });
  const days = Math.min(60, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 14));
  return withStore((store) => getStats(store, new Date(), days));
}
