import { claimCupPrize } from "../src/server/cup.js";
import { json, readJson, withStore } from "../src/server/route.js";

/** A player collects the Weekly Cup prize for a finished week; coins arrive through the usual coin claim. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => claimCupPrize(store, body), undefined, { request, bucket: "coins" });
}
