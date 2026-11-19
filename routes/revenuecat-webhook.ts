import { nativePaymentEvent, revenueCatAuthorized } from "../src/server/nativePayments.js";
import { json, readJson, withStore } from "../src/server/route.js";

export async function POST(request: Request): Promise<Response> {
  if (!revenueCatAuthorized(request.headers.get("authorization"))) return json(401, { error: "unauthorized" });
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => nativePaymentEvent(store, body));
}
