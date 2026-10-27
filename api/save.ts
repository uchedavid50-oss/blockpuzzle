import { getSave, putSave } from "../src/server/signin.js";
import { json, playerFrom, readJson, withStore } from "../src/server/route.js";

/** A signed-in account's cloud save: GET reads it, POST writes a new version (409 if another device wrote first). */
export function GET(request: Request): Promise<Response> {
  return withStore((store) => getSave(store, playerFrom(request)), undefined, { request, bucket: "save" });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad body" }); }
  return withStore((store) => putSave(store, body), undefined, { request, bucket: "save" });
}
