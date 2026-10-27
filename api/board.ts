import { getBoard } from "../src/server/handlers.js";
import { playerFrom, withStore } from "../src/server/route.js";

export function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const player = playerFrom(request);
  // Shared caches may keep the plain board; a reply that includes "your rank" is private.
  const cache = player ? undefined : "public, s-maxage=10, stale-while-revalidate=30";
  return withStore((store) => getBoard(store, { date: q.get("date") ?? undefined, player: player ?? undefined }), cache, { request, bucket: "board" });
}
