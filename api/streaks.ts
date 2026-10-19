import { getStreaks } from "../src/server/handlers";
import { withStore } from "../src/server/route";

export function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  return withStore((store) => getStreaks(store, { player: q.get("player") ?? undefined }), "public, s-maxage=30, stale-while-revalidate=60");
}
