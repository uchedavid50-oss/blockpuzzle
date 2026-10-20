import { describe, expect, it } from "vitest";
import { COIN_PACKS, packFor } from "../economy.js";
import { collect, getStats } from "./analytics.js";
import { claimCoins, coinKey, creditPack, unclaimedCoins } from "./coins.js";
import { FakePaystack } from "./paystack.js";
import { confirmPurchase, getEntitlements, paystackWebhook, startCheckout } from "./purchases.js";
import { MemoryStore } from "./store.js";

const ORIGIN = "https://game.test";
const P1 = "a1".repeat(12);
const P2 = "b2".repeat(12);
const ENV = {} as Record<string, string | undefined>;
const SMALL = packFor("coins_small")!;
const claimId = (n: number): string => n.toString(16).padStart(24, "0");

async function buyPack(store: MemoryStore, ps: FakePaystack, sku = "coins_small", player = P1) {
  const r = await startCheckout(store, ps, { player, sku }, ORIGIN, ENV);
  return { r, ref: (r.body.reference as string | undefined) ?? "" };
}

describe("coin pack checkout", () => {
  it("prices a pack from the server's own table, whatever the browser sends", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const r = await startCheckout(store, ps, { player: P1, sku: "coins_large", amount: 1, coins: 999999 }, ORIGIN, ENV);
    expect(r.status).toBe(200);
    expect(ps.started.get(r.body.reference as string)!.amount).toBe(packFor("coins_large")!.price.ngn);
  });

  it("lets a pack be bought again and again", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await buyPack(store, ps);
    await confirmPurchase(store, ps, ref);
    expect((await buyPack(store, ps)).r.status).toBe(200);
  });

  it("credits a paid pack, and reports it as waiting to be collected", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await buyPack(store, ps);
    const r = await confirmPurchase(store, ps, ref);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sku: "coins_small", coins: SMALL.coins });
    expect(await unclaimedCoins(store, P1)).toBe(SMALL.coins);
    expect((await getEntitlements(store, { player: P1 })).body).toMatchObject({ coins: SMALL.coins });
  });

  it("credits once when both the return page and the webhook confirm the same payment", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await buyPack(store, ps);
    await confirmPurchase(store, ps, ref);
    await confirmPurchase(store, ps, ref);
    await paystackWebhook(store, ps, JSON.stringify({ event: "charge.success", data: { reference: ref } }), true);
    expect(await unclaimedCoins(store, P1)).toBe(SMALL.coins);
  });

  it("credits nothing for an unpaid or mismatched payment", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const unpaid = await buyPack(store, ps);
    ps.override.set(unpaid.ref, { status: "abandoned" });
    expect((await confirmPurchase(store, ps, unpaid.ref)).status).toBe(402);
    const cheap = await buyPack(store, ps);
    ps.override.set(cheap.ref, { amount: 1 });
    expect((await confirmPurchase(store, ps, cheap.ref)).status).toBe(409);
    expect(await unclaimedCoins(store, P1)).toBe(0);
  });

  it("does not turn a pack into an owned item", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await buyPack(store, ps);
    const r = await confirmPurchase(store, ps, ref);
    expect(r.body.owned).toEqual([]);
  });
});

describe("creditPack", () => {
  it("adds coins once per payment reference", async () => {
    const store = new MemoryStore();
    expect(await creditPack(store, P1, "bp_ref1", 300)).toBe(true);
    expect(await creditPack(store, P1, "bp_ref1", 300)).toBe(false);
    expect(await creditPack(store, P1, "bp_ref2", 300)).toBe(true);
    expect(await unclaimedCoins(store, P1)).toBe(600);
  });
});

describe("claimCoins", () => {
  it("moves the whole balance to the device and leaves nothing behind", async () => {
    const store = new MemoryStore();
    await creditPack(store, P1, "bp_r", 300);
    expect((await claimCoins(store, { player: P1, claim: claimId(1) })).body).toEqual({ claimed: 300 });
    expect(await unclaimedCoins(store, P1)).toBe(0);
    expect((await claimCoins(store, { player: P1, claim: claimId(2) })).body).toEqual({ claimed: 0 });
  });

  it("answers a retried claim the same way without taking anything new", async () => {
    const store = new MemoryStore();
    await creditPack(store, P1, "bp_r1", 300);
    await claimCoins(store, { player: P1, claim: claimId(1) });
    await creditPack(store, P1, "bp_r2", 1500); // a new purchase lands afterwards
    expect((await claimCoins(store, { player: P1, claim: claimId(1) })).body).toEqual({ claimed: 300 }); // the retry
    expect(await unclaimedCoins(store, P1)).toBe(1500); // still waiting for a fresh claim
  });

  it("lets only one of two simultaneous claims take the coins", async () => {
    const store = new MemoryStore();
    await creditPack(store, P1, "bp_r", 300);
    const [a, b] = await Promise.all([claimCoins(store, { player: P1, claim: claimId(1) }), claimCoins(store, { player: P1, claim: claimId(2) })]);
    const got = [a.body.claimed, b.body.claimed] as number[];
    expect(got.reduce((s, n) => s + n, 0)).toBe(300);
    expect(await unclaimedCoins(store, P1)).toBe(0);
  });

  it("never claims another player's coins", async () => {
    const store = new MemoryStore();
    await creditPack(store, P1, "bp_r", 300);
    expect((await claimCoins(store, { player: P2, claim: claimId(1) })).body).toEqual({ claimed: 0 });
    expect(await unclaimedCoins(store, P1)).toBe(300);
  });

  it("rejects bad players and bad claim ids", async () => {
    const store = new MemoryStore();
    for (const bad of [{ player: "x", claim: claimId(1) }, { player: P1, claim: "short" }, { player: P1, claim: "Z".repeat(24) }, { player: P1 }, null])
      expect((await claimCoins(store, bad)).status).toBe(400);
  });

  it("refuses a claim id already in flight", async () => {
    const store = new MemoryStore();
    await store.setNx(`claim:${P1}:${claimId(9)}`, "pending", 60);
    expect((await claimCoins(store, { player: P1, claim: claimId(9) })).status).toBe(409);
  });

  it("keeps the ledger as a counter so the claim decrement is atomic in Redis", async () => {
    const store = new MemoryStore();
    await creditPack(store, P1, "bp_r", 300);
    expect(await store.mcount([coinKey(P1)])).toEqual([300]);
  });
});

describe("coin analytics", () => {
  const NOW = new Date("2026-10-21T12:00:00Z");
  const ev = (name: string, props?: Record<string, unknown>) => ({ name, t: NOW.getTime(), ...(props ? { props } : {}) });
  const batch = (events: unknown[]) => ({ id: "a".repeat(22), firstSeen: "2026-10-21", src: null, events });

  it("adds up coins earned and spent per day, and counts them by source and item", async () => {
    const s = new MemoryStore();
    const r = await collect(s, batch([
      ev("session_start"),
      ev("coins_earned", { source: "ad", coins: 15 }),
      ev("coins_earned", { source: "weekly", coins: 40 }),
      ev("coins_spent", { item: "undo3", coins: 60 }),
    ]), NOW);
    expect(r.status).toBe(200);
    const day = ((await getStats(s, NOW, 1)).body.days as { sums: Record<string, number>; byProp: Record<string, number> }[])[0]!;
    expect(day.sums).toEqual({ coins_earned: 55, coins_spent: 60 });
    expect(day.byProp["coins_earned.source.ad"]).toBe(1);
    expect(day.byProp["coins_spent.item.undo3"]).toBe(1);
  });

  it("does not add up absurd or non-coin amounts", async () => {
    const s = new MemoryStore();
    await collect(s, batch([ev("coins_earned", { source: "ad", coins: 10_000_000 }), ev("coins_earned", { coins: -5 }), ev("game_end", { coins: 99 })]), NOW);
    const day = ((await getStats(s, NOW, 1)).body.days as { sums: Record<string, number> }[])[0]!;
    expect(day.sums).toEqual({});
  });

  it("counts every coin pack as a known sku", () => {
    for (const p of COIN_PACKS) expect(packFor(p.id)).toBe(p);
  });
});
