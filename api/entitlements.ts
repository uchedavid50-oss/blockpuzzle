import { getEntitlements } from "../src/server/purchases.js";
import { json, playerFrom, readJson, withStore } from "../src/server/route.js";

/** Older games ask with GET; the player id is better kept out of the URL, so the game now POSTs it. */
export function GET(request: Request): Promise<Response> {
  const player = playerFrom(request);
  return withStore((store) => getEntitlements(store, { player }), undefined, { request, bucket: "entitlements" });
}

export async function POST(request: Request): Promise<Response> {
  let body: { player?: unknown };
  try { body = (await readJson(request)) as { player?: unknown }; } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => getEntitlements(store, { player: body?.player }), undefined, { request, bucket: "entitlements" });
}
