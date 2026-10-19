import { submitScore } from "../src/server/handlers";
import { json, readJson, withStore } from "../src/server/route";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => submitScore(store, body));
}
