import { describe, expect, it } from "vitest";
import { transferAccount } from "./accounts";
import { FakePaystack } from "./paystack";
import { getPayments, paymentKey, type PaymentRecord } from "./payments";
import { confirmPurchase, paystackWebhook, revokePurchase, startCheckout } from "./purchases";
import { MemoryStore } from "./store";

const NOW = new Date("2026-10-19T12:00:00Z");
const DAY_MS = 86_400_000;
const id = (n: number): string => n.toString(16).padStart(24, "0");

async function buy(store: MemoryStore, ps: FakePaystack, player: string, sku: string, at = NOW, currency = "NGN"): Promise<string> {
  const r = await startCheckout(store, ps, { player, sku, currency }, "https://game.test", { PAYSTACK_USD: "1" });
  expect(r.status).toBe(200);
  const ref = r.body.reference as string;
  expect((await confirmPurchase(store, ps, ref, at)).status).toBe(200);
  return ref;
}
const record = async (store: MemoryStore, ref: string): Promise<PaymentRecord> => JSON.parse((await store.get(paymentKey(ref)))!) as PaymentRecord;

describe("payments ledger", () => {
  it("records a confirmed payment once, however often it is confirmed", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const ref = await buy(store, ps, id(1), "effect_pack");
    await confirmPurchase(store, ps, ref, new Date(NOW.getTime() + DAY_MS)); // the webhook, a day late
    const rec = await record(store, ref);
    expect(rec).toMatchObject({ reference: ref, player: id(1), sku: "effect_pack", amount: 80_000, currency: "NGN", paidAt: NOW.toISOString(), status: "paid" });
    const r = await getPayments(store, {}, NOW);
    expect((r.body.payments as unknown[]).length).toBe(1);
  });

  it("records nothing for a payment that is not confirmed", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const r = await startCheckout(store, ps, { player: id(1), sku: "effect_pack" }, "https://game.test", {});
    expect(await store.get(paymentKey(r.body.reference as string))).toBeNull();
  });

  it("marks refunds and disputes from the webhook, and a retry changes nothing", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const a = await buy(store, ps, id(1), "effect_pack");
    const b = await buy(store, ps, id(2), "coins_small");
    const refund = JSON.stringify({ event: "refund.processed", data: { transaction_reference: a } });
    await paystackWebhook(store, ps, refund, true);
    await paystackWebhook(store, ps, refund, true);
    await paystackWebhook(store, ps, JSON.stringify({ event: "charge.dispute.create", data: { transaction: { reference: b } } }), true);
    expect((await record(store, a)).status).toBe("refunded");
    expect((await record(store, a)).history).toHaveLength(1);
    expect((await record(store, b)).status).toBe("disputed");
    // a dispute that ends in a refund shows both
    await revokePurchase(store, b, "refunded");
    expect((await record(store, b)).history.map((h) => h.status)).toEqual(["disputed", "refunded"]);
  });

  it("finds a payment by reference, and a player's history by any id the account has had", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const before = await buy(store, ps, id(1), "effect_pack");
    const fresh = (await transferAccount(store, { player: id(1) }, NOW)).body.player as string;
    const after = await buy(store, ps, fresh, "coins_small");
    await buy(store, ps, id(2), "coins_large");

    const byRef = await getPayments(store, { ref: before });
    expect(byRef.body.payments).toEqual([expect.objectContaining({ reference: before, player: id(1), account: fresh })]);
    for (const who of [id(1), fresh]) {
      const r = await getPayments(store, { player: who });
      expect(r.body.account).toBe(fresh);
      expect((r.body.payments as PaymentRecord[]).map((p) => p.reference).sort()).toEqual([before, after].sort());
    }
    expect((await getPayments(store, { ref: "bp_" + "0".repeat(24) })).status).toBe(404);
    expect((await getPayments(store, { ref: "nope" })).status).toBe(400);
    expect((await getPayments(store, { player: "nope" })).status).toBe(400);
  });

  it("a payment started before a move but confirmed after it joins the new id's history", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const r = await startCheckout(store, ps, { player: id(1), sku: "effect_pack" }, "https://game.test", {});
    const fresh = (await transferAccount(store, { player: id(1) }, NOW)).body.player as string;
    await confirmPurchase(store, ps, r.body.reference as string, NOW);
    expect((await getPayments(store, { player: fresh })).body.payments).toHaveLength(1);
  });

  it("lists recent payments by day, with totals per currency net of refunds and disputes", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    await buy(store, ps, id(1), "effect_pack", NOW);                                         // 80,000 kobo
    const refunded = await buy(store, ps, id(2), "coins_small", new Date(NOW.getTime() - 3 * DAY_MS)); // 60,000 kobo
    await buy(store, ps, id(3), "coins_small", new Date(NOW.getTime() - 3 * DAY_MS), "USD"); // 99 cents
    await buy(store, ps, id(4), "effect_pack", new Date(NOW.getTime() - 40 * DAY_MS));      // outside 30 days
    await revokePurchase(store, refunded, "refunded");

    const r = await getPayments(store, {}, NOW);
    expect(r.body.days).toBe(30);
    const rows = r.body.payments as PaymentRecord[];
    expect(rows).toHaveLength(3);
    expect(rows[0]!.player).toBe(id(1)); // newest first
    expect(r.body.totals).toEqual([
      { currency: "NGN", count: 2, gross: 140_000, refunded: 60_000, disputed: 0, net: 80_000 },
      { currency: "USD", count: 1, gross: 99, refunded: 0, disputed: 0, net: 99 },
    ]);
    expect((await getPayments(store, { days: "60" }, NOW)).body.payments).toHaveLength(4);
  });
});
