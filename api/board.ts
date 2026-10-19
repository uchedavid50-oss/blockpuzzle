import { getBoard } from "../src/server/handlers.js";
import { withStore } from "../src/server/route.js";

export function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  return withStore((store) => getBoard(store, { date: q.get("date") ?? undefined, player: q.get("player") ?? undefined }), "public, s-maxage=10, stale-while-revalidate=30");
}
