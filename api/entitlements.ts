import { getEntitlements } from "../src/server/purchases.js";
import { withStore } from "../src/server/route.js";

export function GET(request: Request): Promise<Response> {
  const player = new URL(request.url).searchParams.get("player");
  return withStore((store) => getEntitlements(store, { player }));
}
