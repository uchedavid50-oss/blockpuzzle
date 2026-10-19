import { json } from "../src/server/route.js";
import { storeFromEnv } from "../src/server/redis.js";

/** Tells the game whether the leaderboard is set up, so it can hide the buttons when it is not. */
export function GET(): Response {
  return json(200, { ok: true, leaderboard: storeFromEnv() !== null }, "public, s-maxage=60");
}
