import { getStreaks } from "../src/server/handlers.js";
import { playerFrom, withStore } from "../src/server/route.js";

export function GET(request: Request): Promise<Response> {
  const player = playerFrom(request);
  const cache = player ? undefined : "public, s-maxage=30, stale-while-revalidate=60";
  return withStore((store) => getStreaks(store, { player: player ?? undefined }), cache, { request, bucket: "streaks" });
}
