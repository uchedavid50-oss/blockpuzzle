import { readJson, json, withStore } from "../src/server/route.js";
import { signin, signinFromEnv } from "../src/server/signin.js";

/** Optional sign-in: `step` is "email-start", "email-verify" or "google" (see src/server/signin.ts). */
export async function POST(request: Request): Promise<Response> {
  const cfg = signinFromEnv();
  if (!cfg) return json(503, { error: "sign-in not configured" });
  let body: unknown;
  try { body = await readJson(request); } catch { return json(400, { error: "bad body" }); }
  return withStore((store) => signin(store, cfg, body), undefined, { request, bucket: "signin" });
}
