// Buying things. Prices come from the server's own catalogue, never from the browser, and a purchase
// counts only after Paystack itself confirms it: status, amount, currency, player and item must all
// match what the server asked for. Granting is idempotent, so a repeated redirect or webhook is harmless.

import { CATALOGUE, isSku, owns, type Sku } from "../entitlements.js";
import { packFor } from "../economy.js";
import { currentId, entSetKey, entitlementsOf, isRetired } from "./accounts.js";
import { countServerEvent } from "./analytics.js";
import { coinKey, creditPack, unclaimedCoins } from "./coins.js";
import type { Reply } from "./handlers.js";
import { markPayment, recordPayment } from "./payments.js";
import { type Paystack, allowedCurrencies } from "./paystack.js";
import { isPlayerId } from "./rules.js";
import type { Store } from "./store.js";

const DAY = 86_400;
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
const REF_RE = /^bp_[a-f0-9]{24}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** `sku` is an entitlement (owned forever) or a coin pack (credited as coins, can be bought again). */
interface Pending { player: string; sku: string; amount: number; currency: string }

export { entitlementsOf };

export async function getEntitlements(store: Store, query: { player?: unknown }): Promise<Reply> {
  if (!isPlayerId(query.player)) return reply(400, { error: "bad player" });
  // A retired code owns nothing any more: its account now lives on another device.
  if (await isRetired(store, query.player)) return reply(200, { owned: [], coins: 0, moved: true });
  return reply(200, { owned: (await entitlementsOf(store, query.player)).owned, coins: await unclaimedCoins(store, query.player) });
}

const randomRef = (): string => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return "bp_" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

/** Starts a purchase: works out the price itself and asks Paystack for a checkout page. */
export async function startCheckout(store: Store, ps: Paystack, body: unknown, origin: string, env: Record<string, string | undefined> = process.env): Promise<Reply> {
  const b = (body ?? {}) as { player?: unknown; sku?: unknown; currency?: unknown; email?: unknown };
  if (!isPlayerId(b.player)) return reply(400, { error: "bad player" });
  if (await isRetired(store, b.player)) return reply(410, { error: "moved" });
  const pack = packFor(b.sku);
  if (typeof b.sku !== "string" || (!isSku(b.sku) && !pack)) return reply(400, { error: "bad item" });
  const currency = typeof b.currency === "string" ? b.currency : "NGN";
  if (!allowedCurrencies(env).includes(currency)) return reply(400, { error: "currency not available" });
  const price = pack ? pack.price : CATALOGUE.find((i) => i.sku === b.sku)!.price;
  // Coin packs can be bought again and again; everything else only once.
  if (!pack && owns(await entitlementsOf(store, b.player), b.sku as Sku)) return reply(409, { error: "already owned" });
  if (b.email !== undefined && (typeof b.email !== "string" || !EMAIL_RE.test(b.email))) return reply(400, { error: "bad email" });

  const amount = currency === "USD" ? price.usd : price.ngn; // the browser never names an amount
  const reference = randomRef();
  const email = typeof b.email === "string" ? b.email : `${b.player}@example.com`;
  const pending: Pending = { player: b.player, sku: b.sku, amount, currency };
  await store.setNx(`pending:${reference}`, JSON.stringify(pending), 3 * DAY);
  try {
    const { url } = await ps.initialize({ email, amount, currency, reference, callbackUrl: `${origin}/?shop=return`, metadata: { player: b.player, sku: b.sku } });
    return reply(200, { url, reference });
  } catch (err) {
    console.error("checkout error", err);
    return reply(502, { error: "payments are unavailable right now" });
  }
}

/** Confirms a payment with Paystack and grants the item. Safe to call many times for one reference. */
export async function confirmPurchase(store: Store, ps: Paystack, reference: unknown, now = new Date()): Promise<Reply> {
  if (typeof reference !== "string" || !REF_RE.test(reference)) return reply(400, { error: "bad reference" });
  const pendingRaw = await store.get(`pending:${reference}`);
  if (!pendingRaw) {
    const done = await store.get(`done:${reference}`); // already granted earlier: answer the same way again
    if (done) return reply(200, { ok: true, owned: (await entitlementsOf(store, await currentId(store, (JSON.parse(done) as { player: string }).player))).owned });
    return reply(404, { error: "unknown reference" });
  }
  const pending = JSON.parse(pendingRaw) as Pending;
  if (await store.get(`revoked:${reference}`)) return reply(409, { error: "refunded" });
  const v = await ps.verify(reference);
  if (!v) return reply(502, { error: "could not verify the payment yet" });
  if (v.status !== "success") return reply(402, { error: "not paid", status: v.status });
  if (v.reference !== reference || v.amount !== pending.amount || v.currency !== pending.currency || v.metadata?.player !== pending.player || v.metadata?.sku !== pending.sku)
    return reply(409, { error: "payment does not match the order" });

  // If the account moved to another device after paying, the purchase follows it there.
  const player = await currentId(store, pending.player);
  const pack = packFor(pending.sku);
  if (!pack && !isSku(pending.sku)) return reply(409, { error: "unknown item" });
  if (pack) {
    // Credited once per payment, however many times the return page and the webhook confirm it.
    await creditPack(store, player, reference, pack.coins);
  } else {
    // One atomic add to a set: two different purchases confirmed at the same moment both land.
    await store.sadd(entSetKey(player), pending.sku);
    if (pending.sku === "supporter_bundle") await store.hset("supporters", player, "1");
  }
  // The ledger for the admin page: one record per payment, kept however often it is confirmed.
  await recordPayment(store, { reference, player: pending.player, sku: pending.sku, amount: pending.amount, currency: pending.currency }, now);
  // The first confirmation counts the sale for the admin page (browsers' own reports are not trusted).
  if (await store.setNx(`done:${reference}`, JSON.stringify({ player: pending.player, sku: pending.sku }), 400 * DAY))
    await countServerEvent(store, "purchase_completed", { sku: pending.sku }, now);
  const owned = (await entitlementsOf(store, player)).owned;
  return reply(200, pack ? { ok: true, sku: pending.sku, coins: pack.coins, owned } : { ok: true, sku: pending.sku, owned });
}

/**
 * Takes back what a refunded or disputed payment bought. An item is removed; a coin pack's coins are
 * taken from the coins waiting on the server, and if they were already collected the balance goes
 * below zero, so the next coins bought pay that back first. Happens once per payment.
 */
export async function revokePurchase(store: Store, reference: unknown, kind: "refunded" | "disputed" = "refunded", now = new Date()): Promise<Reply> {
  if (typeof reference !== "string" || !REF_RE.test(reference)) return reply(400, { error: "bad reference" });
  // The ledger shows every refund and dispute, even one that follows an earlier one.
  await markPayment(store, reference, kind, now);
  const done = await store.get(`done:${reference}`);
  if (!done) {
    // Not granted yet: make sure it never is.
    await store.setNx(`revoked:${reference}`, "1", 400 * DAY);
    return reply(200, { ok: true, revoked: false });
  }
  if (!(await store.setNx(`revoked:${reference}`, "1", 400 * DAY))) return reply(200, { ok: true, revoked: false });
  const { player: original, sku } = JSON.parse(done) as { player: string; sku: string };
  const player = await currentId(store, original);
  const pack = packFor(sku);
  if (pack) {
    if (await store.get(`credited:${reference}`)) await store.incr(coinKey(player), -pack.coins);
  } else if (isSku(sku)) {
    await store.srem(entSetKey(player), sku);
    // Older records kept items in one JSON value: take it out of there too.
    try {
      const legacy = JSON.parse((await store.get(`ent:${player}`)) ?? "null") as { owned?: unknown } | null;
      if (legacy && Array.isArray(legacy.owned) && legacy.owned.includes(sku))
        await store.set(`ent:${player}`, JSON.stringify({ owned: legacy.owned.filter((s) => s !== sku) }));
    } catch { /* nothing to fix */ }
    if (!owns(await entitlementsOf(store, player), "supporter_bundle" as Sku)) await store.hdel("supporters", player);
  }
  return reply(200, { ok: true, revoked: true });
}

/** Paystack's own notification, for when the player closes the page before coming back. */
export async function paystackWebhook(store: Store, ps: Paystack, rawBody: string, signatureValid: boolean): Promise<Reply> {
  if (!signatureValid) return reply(401, { error: "bad signature" });
  let event: { event?: string; data?: { reference?: string } };
  try { event = JSON.parse(rawBody) as typeof event; } catch { return reply(400, { error: "bad body" }); }
  // A refund, or a chargeback being opened, takes the purchase back.
  if (event.event === "refund.processed" || event.event === "charge.dispute.create") {
    const d = event.data as { reference?: string; transaction_reference?: string; transaction?: { reference?: string } } | undefined;
    await revokePurchase(store, d?.transaction_reference ?? d?.transaction?.reference ?? d?.reference, event.event === "refund.processed" ? "refunded" : "disputed");
    return reply(200, { ok: true });
  }
  if (event.event !== "charge.success") return reply(200, { ok: true, ignored: true });
  const r = await confirmPurchase(store, ps, event.data?.reference);
  // A temporary failure to verify should be retried by Paystack; anything else is settled.
  return reply(r.status === 502 ? 500 : 200, { ok: r.status === 200 });
}
