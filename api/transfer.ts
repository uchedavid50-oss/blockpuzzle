import { transferAccount } from "../src/server/accounts.js";
import { json, readJson, withStore } from "../src/server/route.js";

/** Restoring on a new device: the account moves here and the old code stops working. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad request" }); }
  return withStore((store) => transferAccount(store, body), undefined, { request, bucket: "transfer" });
}
