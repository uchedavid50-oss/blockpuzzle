// Buying things. Prices come from the server's own catalogue, never from the browser, and a purchase
// counts only after Paystack itself confirms it: status, amount, currency, player and item must all
// match what the server asked for. Granting is idempotent, so a repeated redirect or webhook is harmless.

import { CATALOGUE, NOTHING, grant, isSku, owns, parse, type Entitlements, type Sku } from "../entitlements.js";
import type { Reply } from "./handlers.js";
import { type Paystack, allowedCurrencies } from "./paystack.js";
import { isPlayerId } from "./rules.js";
import type { Store } from "./store.js";

const DAY = 86_400;
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
const REF_RE = /^bp_[a-f0-9]{24}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

interface Pending { player: string; sku: Sku; amount: number; currency: string }

export async function entitlementsOf(store: Store, player: string): Promise<Entitlements> {
  try { return parse(JSON.parse((await store.get(`ent:${player}`)) ?? "null")); } catch { return NOTHING; }
}

export async function getEntitlements(store: Store, query: { player?: unknown }): Promise<Reply> {
  if (!isPlayerId(query.player)) return reply(400, { error: "bad player" });
  return reply(200, { owned: (await entitlementsOf(store, query.player)).owned });
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
  if (typeof b.sku !== "string" || !isSku(b.sku)) return reply(400, { error: "bad item" });
  const currency = typeof b.currency === "string" ? b.currency : "NGN";
  if (!allowedCurrencies(env).includes(currency)) return reply(400, { error: "currency not available" });
  const catalogue = CATALOGUE.find((i) => i.sku === b.sku)!;
  if (owns(await entitlementsOf(store, b.player), b.sku)) return reply(409, { error: "already owned" });
  if (b.email !== undefined && (typeof b.email !== "string" || !EMAIL_RE.test(b.email))) return reply(400, { error: "bad email" });

  const amount = currency === "USD" ? catalogue.price.usd : catalogue.price.ngn; // the browser never names an amount
  const reference = randomRef();
  const email = typeof b.email === "string" ? b.email : `${b.player}@players.blockpuzzle.invalid`;
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
export async function confirmPurchase(store: Store, ps: Paystack, reference: unknown): Promise<Reply> {
  if (typeof reference !== "string" || !REF_RE.test(reference)) return reply(400, { error: "bad reference" });
  const pendingRaw = await store.get(`pending:${reference}`);
  if (!pendingRaw) {
    const done = await store.get(`done:${reference}`); // already granted earlier: answer the same way again
    if (done) return reply(200, { ok: true, owned: (await entitlementsOf(store, (JSON.parse(done) as { player: string }).player)).owned });
    return reply(404, { error: "unknown reference" });
  }
  const pending = JSON.parse(pendingRaw) as Pending;
  const v = await ps.verify(reference);
  if (!v) return reply(502, { error: "could not verify the payment yet" });
  if (v.status !== "success") return reply(402, { error: "not paid", status: v.status });
  if (v.reference !== reference || v.amount !== pending.amount || v.currency !== pending.currency || v.metadata?.player !== pending.player || v.metadata?.sku !== pending.sku)
    return reply(409, { error: "payment does not match the order" });

  const ent = grant(await entitlementsOf(store, pending.player), pending.sku);
  await store.set(`ent:${pending.player}`, JSON.stringify(ent));
  if (owns(ent, "supporter_bundle")) await store.hset("supporters", pending.player, "1");
  await store.set(`done:${reference}`, JSON.stringify({ player: pending.player, sku: pending.sku }));
  return reply(200, { ok: true, sku: pending.sku, owned: ent.owned });
}

/** Paystack's own notification, for when the player closes the page before coming back. */
export async function paystackWebhook(store: Store, ps: Paystack, rawBody: string, signatureValid: boolean): Promise<Reply> {
  if (!signatureValid) return reply(401, { error: "bad signature" });
  let event: { event?: string; data?: { reference?: string } };
  try { event = JSON.parse(rawBody) as typeof event; } catch { return reply(400, { error: "bad body" }); }
  if (event.event !== "charge.success") return reply(200, { ok: true, ignored: true });
  const r = await confirmPurchase(store, ps, event.data?.reference);
  // A temporary failure to verify should be retried by Paystack; anything else is settled.
  return reply(r.status === 502 ? 500 : 200, { ok: r.status === 200 });
}
