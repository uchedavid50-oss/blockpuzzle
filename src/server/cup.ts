// Weekly Cup prizes. The cup is an ordinary board named by the week (see rules.ts); scores reach it
// through submitScore like a daily's do. This pays the top finishers once the week is over.
//
// Prizes go into the same server-held coin balance that bought coins use, so the device collects
// them through the existing claim (coins.ts) and a prize can never be paid twice: each (week,
// player) takes a one-time marker before anything is added.

import { ECONOMY } from "../economy.js";
import { coinKey } from "./coins.js";
import { isRetired } from "./accounts.js";
import type { Reply } from "./handlers.js";
import { isPlayerId, isWeekId, weekOver } from "./rules.js";
import type { Store } from "./store.js";

const DAY = 86_400;
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

/** Coins for a finishing place (1-based), or 0 outside the prizes. */
export function prizeFor(rank: number): number {
  const { prizes, top, restPrize } = ECONOMY.cup;
  if (rank < 1) return 0;
  if (rank <= prizes.length) return prizes[rank - 1]!;
  return rank <= top ? restPrize : 0;
}

export async function claimCupPrize(store: Store, body: unknown, now = new Date()): Promise<Reply> {
  const b = (body ?? {}) as { player?: unknown; week?: unknown };
  if (!isPlayerId(b.player)) return reply(400, { error: "bad player" });
  if (!isWeekId(b.week)) return reply(400, { error: "bad week" });
  if (!weekOver(b.week, now)) return reply(409, { error: "not finished", message: "The cup is still open." });
  if (await isRetired(store, b.player)) return reply(410, { error: "moved" });

  const rank0 = await store.zrevrank(`lb:${b.week}`, b.player);
  if (rank0 === null) return reply(200, { rank: 0, prize: 0 });
  const rank = rank0 + 1;
  const prize = prizeFor(rank);
  if (prize === 0) return reply(200, { rank, prize: 0 });
  // The marker lasts long enough to outlive the board (45 days), so a late retry cannot pay twice.
  if (!(await store.setNx(`prize:${b.week}:${b.player}`, String(prize), 60 * DAY))) return reply(200, { rank, prize: 0, already: true });
  await store.incr(coinKey(b.player), prize);
  return reply(200, { rank, prize });
}
