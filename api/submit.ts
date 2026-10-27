import { submitScore } from "../src/server/handlers.js";
import { clientIp } from "../src/server/limits.js";
import { json, readJson, withStore } from "../src/server/route.js";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => submitScore(store, body, new Date(), clientIp(request.headers)), undefined, { request, bucket: "submit" });
}
