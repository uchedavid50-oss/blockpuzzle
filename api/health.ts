import { json } from "../src/server/route.js";
import { allowedCurrencies, paystackFromEnv } from "../src/server/paystack.js";
import { storeFromEnv } from "../src/server/redis.js";

/** Tells the game which optional features this deployment has, so it hides controls for the rest. */
export function GET(): Response {
  const store = storeFromEnv() !== null;
  return json(200, { ok: true, leaderboard: store, analytics: store, shop: store && paystackFromEnv() !== null, currencies: allowedCurrencies() }, "public, s-maxage=60");
}
