// Coins bought with money. The server holds them until the player's device claims them, so the only
// way coins enter this ledger is a payment Paystack has confirmed (purchases.ts calls `creditPack`).
//
// Two things must never happen, and each has a guard:
//   - One payment credited twice (the player returns from checkout AND the webhook fires):
//     `creditPack` takes a one-time marker per payment reference before adding anything.
//   - One balance claimed twice (two devices sharing a restore code, or a retried request):
//     the claim takes the whole balance with a single atomic decrement, and each claim id is
//     answered from a record afterwards, so a retry gets the same answer and nothing new.

import { isRetired } from "./accounts.js";
import type { Reply } from "./handlers.js";
import { isPlayerId } from "./rules.js";
import type { Store } from "./store.js";

const DAY = 86_400;
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
const CLAIM_RE = /^[a-f0-9]{16,40}$/;

export const coinKey = (player: string): string => `coins:${player}`;

/** Coins waiting on the server for this player (bought, not yet claimed by a device). */
export async function unclaimedCoins(store: Store, player: string): Promise<number> {
  const [n] = await store.mcount([coinKey(player)]);
  return Math.max(0, n ?? 0);
}

/** Credits a confirmed coin-pack payment, once per payment reference. Returns false if already credited. */
export async function creditPack(store: Store, player: string, reference: string, coins: number): Promise<boolean> {
  if (!(await store.setNx(`credited:${reference}`, String(coins), 400 * DAY))) return false;
  await store.incr(coinKey(player), coins);
  return true;
}

/**
 * Moves the player's whole server balance to the device asking. The device sends a random claim id
 * and keeps it until it has added the coins, so a lost response can be retried safely.
 */
export async function claimCoins(store: Store, body: unknown): Promise<Reply> {
  const b = (body ?? {}) as { player?: unknown; claim?: unknown };
  if (!isPlayerId(b.player)) return reply(400, { error: "bad player" });
  if (typeof b.claim !== "string" || !CLAIM_RE.test(b.claim)) return reply(400, { error: "bad claim" });
  if (await isRetired(store, b.player)) return reply(410, { error: "moved" });
  const record = `claim:${b.player}:${b.claim}`;

  if (!(await store.setNx(record, "pending", 30 * DAY))) {
    const done = await store.get(record);
    if (done === "pending" || done === null) return reply(409, { error: "claim in progress" });
    return reply(200, { claimed: Number(done) || 0 }); // a retry: same answer, nothing taken again
  }

  const have = await unclaimedCoins(store, b.player);
  let claimed = 0;
  if (have > 0) {
    // Take it all in one atomic step. If another claim got there first the result goes negative:
    // put back exactly what was taken and claim nothing.
    const left = await store.incr(coinKey(b.player), -have);
    if (left < 0) await store.incr(coinKey(b.player), have);
    else claimed = have;
  }
  await store.set(record, String(claimed));
  await store.expire(record, 30 * DAY);
  return reply(200, { claimed });
}
