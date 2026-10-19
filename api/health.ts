import { json } from "../src/server/route";
import { storeFromEnv } from "../src/server/redis";

/** Tells the game whether the leaderboard is set up, so it can hide the buttons when it is not. */
export function GET(): Response {
  return json(200, { ok: true, leaderboard: storeFromEnv() !== null }, "public, s-maxage=60");
}
