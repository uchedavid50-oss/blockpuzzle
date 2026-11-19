import { nativeIdentity } from "../src/server/nativePayments.js";
import { playerFrom, withStore } from "../src/server/route.js";

export function POST(request: Request): Promise<Response> {
  return withStore((store) => nativeIdentity(store, playerFrom(request)), undefined, { request, bucket: "checkout" });
}
