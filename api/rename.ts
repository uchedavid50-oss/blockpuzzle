import { renamePlayer } from "../src/server/handlers.js";
import { json, readJson, withStore } from "../src/server/route.js";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => renamePlayer(store, body));
}
