import { startDaily } from "../src/server/handlers.js";
import { json, readJson, withStore } from "../src/server/route.js";

/** The game says "I am starting today's official attempt", so the server can time it. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => startDaily(store, body), undefined, { request, bucket: "start" });
}
