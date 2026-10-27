import { json } from "../src/server/route.js";
import { allowedCurrencies, paystackFromEnv } from "../src/server/paystack.js";
import { storeFromEnv } from "../src/server/redis.js";
import { signinFromEnv } from "../src/server/signin.js";

/** Tells the game which optional features this deployment has, so it hides controls for the rest. */
export function GET(): Response {
  const store = storeFromEnv() !== null;
  const auth = store ? signinFromEnv() : null;
  // Sign-in is optional too: `signin` lists the ways this deployment offers (the Google client id is public).
  const signin = { email: !!auth?.mailer, google: auth?.googleClientId ?? null };
  return json(200, { ok: true, leaderboard: store, analytics: store, shop: store && paystackFromEnv() !== null, currencies: allowedCurrencies(), signin }, "public, s-maxage=60");
}
