import { collect } from "../src/server/analytics.js";
import { json, readJson, withStore } from "../src/server/route.js";

/** Anonymous analytics intake. Answers 204-style quickly; the game never waits on it. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => collect(store, body), undefined, { request, bucket: "collect" });
}
