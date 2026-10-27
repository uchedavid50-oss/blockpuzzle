import { startCheckout } from "../src/server/purchases.js";
import { paystackFromEnv } from "../src/server/paystack.js";
import { json, readJson, withStore } from "../src/server/route.js";

export async function POST(request: Request): Promise<Response> {
  const ps = paystackFromEnv();
  if (!ps) return json(503, { error: "shop not configured" });
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => startCheckout(store, ps, body, new URL(request.url).origin), undefined, { request, bucket: "checkout" });
}
