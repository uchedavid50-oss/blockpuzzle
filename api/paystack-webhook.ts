import { paystackWebhook } from "../src/server/purchases.js";
import { paystackFromEnv, signatureOk } from "../src/server/paystack.js";
import { json, withStore } from "../src/server/route.js";

export async function POST(request: Request): Promise<Response> {
  const ps = paystackFromEnv();
  if (!ps) return json(503, { error: "shop not configured" });
  const raw = await request.text(); // the signature covers the exact bytes, so read the body untouched
  const valid = signatureOk(raw, request.headers.get("x-paystack-signature"), process.env.PAYSTACK_SECRET_KEY);
  return withStore((store) => paystackWebhook(store, ps, raw, valid));
}
