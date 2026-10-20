import { claimCoins } from "../src/server/coins.js";
import { json, readJson, withStore } from "../src/server/route.js";

/** A device collects coins its player bought (credited only after Paystack confirmed the payment). */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => claimCoins(store, body));
}
