import { confirmPurchase } from "../src/server/purchases.js";
import { paystackFromEnv } from "../src/server/paystack.js";
import { json, withStore } from "../src/server/route.js";

/** Called when the player comes back from checkout: confirms the payment and returns what they own. */
export function GET(request: Request): Promise<Response> | Response {
  const ps = paystackFromEnv();
  if (!ps) return json(503, { error: "shop not configured" });
  const ref = new URL(request.url).searchParams.get("ref");
  return withStore((store) => confirmPurchase(store, ps, ref), undefined, { request, bucket: "purchase" });
}
