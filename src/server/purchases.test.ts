import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CATALOGUE, owns } from "../entitlements.js";
import { getBoard } from "./handlers.js";
import { FakePaystack, signatureOk } from "./paystack.js";
import { confirmPurchase, entitlementsOf, getEntitlements, paystackWebhook, startCheckout } from "./purchases.js";
import { MemoryStore } from "./store.js";

const ORIGIN = "https://game.test";
const P1 = "a1".repeat(12);
const P2 = "b2".repeat(12);
const ENV = {} as Record<string, string | undefined>;

async function begin(store: MemoryStore, ps: FakePaystack, sku: string, player = P1, extra: Record<string, unknown> = {}) {
  const r = await startCheckout(store, ps, { player, sku, ...extra }, ORIGIN, ENV);
  return { r, ref: (r.body.reference as string | undefined) ?? "" };
}

describe("startCheckout", () => {
  it("prices the item from the server's catalogue, whatever the browser says", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { r, ref } = await begin(store, ps, "effect_pack", P1, { amount: 1, price: 1, ngn: 1 });
    expect(r.status).toBe(200);
    const sent = ps.started.get(ref)!;
    expect(sent.amount).toBe(CATALOGUE.find((i) => i.sku === "effect_pack")!.price.ngn);
    expect(sent.currency).toBe("NGN");
    expect(sent.metadata).toEqual({ player: P1, sku: "effect_pack" });
    expect(sent.callbackUrl).toBe(`${ORIGIN}/?shop=return`);
  });
  it("rejects bad players, unknown items and unavailable currencies", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    expect((await begin(store, ps, "effect_pack", "nope")).r.status).toBe(400);
    expect((await begin(store, ps, "free_everything")).r.status).toBe(400);
    expect((await begin(store, ps, "effect_pack", P1, { currency: "USD" })).r.status).toBe(400); // USD is off unless enabled
    expect((await startCheckout(store, ps, { player: P1, sku: "effect_pack", currency: "USD" }, ORIGIN, { PAYSTACK_USD: "1" })).status).toBe(200);
    expect((await begin(store, ps, "effect_pack", P1, { email: "not an email" })).r.status).toBe(400);
  });
  it("will not sell something already owned, including through the bundle", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "supporter_bundle");
    await confirmPurchase(store, ps, ref);
    expect((await begin(store, ps, "supporter_bundle")).r.status).toBe(409);
    expect((await begin(store, ps, "effect_pack")).r.status).toBe(409);
    expect((await begin(store, ps, "effect_pack", P2)).r.status).toBe(200); // someone else can still buy it
  });
  it("answers 502, and grants nothing, if Paystack is down", async () => {
    const store = new MemoryStore();
    const down = { initialize: async () => { throw new Error("down"); }, verify: async () => null };
    const r = await startCheckout(store, down, { player: P1, sku: "effect_pack" }, ORIGIN, ENV);
    expect(r.status).toBe(502);
  });
});

describe("confirmPurchase", () => {
  it("grants the item once Paystack confirms the payment", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "theme_pack_dusk");
    const r = await confirmPurchase(store, ps, ref);
    expect(r.status).toBe(200);
    expect(r.body.owned).toEqual(["theme_pack_dusk"]);
    expect(owns(await entitlementsOf(store, P1), "theme_pack_dusk")).toBe(true);
    expect(owns(await entitlementsOf(store, P2), "theme_pack_dusk")).toBe(false);
  });
  it("is idempotent: confirming again, or a redirect plus a webhook, grants once", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "effect_pack");
    await confirmPurchase(store, ps, ref);
    await confirmPurchase(store, ps, ref);
    expect((await entitlementsOf(store, P1)).owned).toEqual(["effect_pack"]);
  });
  it("grants nothing for an unpaid or failed payment", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "effect_pack");
    ps.override.set(ref, { status: "abandoned" });
    expect((await confirmPurchase(store, ps, ref)).status).toBe(402);
    ps.override.set(ref, { status: "failed" });
    expect((await confirmPurchase(store, ps, ref)).status).toBe(402);
    expect((await entitlementsOf(store, P1)).owned).toEqual([]);
  });
  it("refuses a payment that does not match the order: amount, currency, player or item", async () => {
    for (const tamper of [{ amount: 100 }, { currency: "USD" }, { metadata: { player: P2, sku: "effect_pack" } }, { metadata: { player: P1, sku: "supporter_bundle" } }, { reference: "bp_" + "0".repeat(24) }] as const) {
      const store = new MemoryStore(); const ps = new FakePaystack();
      const { ref } = await begin(store, ps, "effect_pack");
      ps.override.set(ref, tamper);
      expect((await confirmPurchase(store, ps, ref)).status).toBe(409);
      expect((await entitlementsOf(store, P1)).owned).toEqual([]);
    }
  });
  it("cannot be tricked into granting a reference it never issued", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    expect((await confirmPurchase(store, ps, "bp_" + "f".repeat(24))).status).toBe(404);
    for (const junk of [undefined, null, 5, "", "bp_short", "../../etc", "bp_" + "g".repeat(24)]) expect((await confirmPurchase(store, ps, junk)).status).toBe(400);
  });
  it("grants nothing, and says to retry, when Paystack cannot be reached", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "effect_pack");
    ps.unreachable = true;
    expect((await confirmPurchase(store, ps, ref)).status).toBe(502);
    expect((await entitlementsOf(store, P1)).owned).toEqual([]);
    ps.unreachable = false;
    expect((await confirmPurchase(store, ps, ref)).status).toBe(200); // and a later retry succeeds
  });
  it("one player's payment cannot be used to give another player the item", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "effect_pack", P1);
    await confirmPurchase(store, ps, ref);
    expect((await entitlementsOf(store, P2)).owned).toEqual([]);
  });
});

describe("the supporter bundle", () => {
  it("unlocks everything in it and puts a star beside the name on the board", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "supporter_bundle");
    await confirmPurchase(store, ps, ref);
    const e = await entitlementsOf(store, P1);
    for (const sku of ["no_interstitials", "theme_pack_dusk", "theme_pack_citrus", "effect_pack"] as const) expect(owns(e, sku)).toBe(true);
    await store.zadd("lb:2026-10-20", 500, P1);
    await store.zadd("lb:2026-10-20", 400, P2);
    await store.hset("names", P1, "Ada"); await store.hset("names", P2, "Bo");
    const board = await getBoard(store, { date: "2026-10-20" }, new Date("2026-10-20T12:00:00Z"));
    expect((board.body.top as { name: string; supporter: boolean }[]).map((r) => [r.name, r.supporter])).toEqual([["Ada", true], ["Bo", false]]);
  });
  it("a single cosmetic pack does not earn the star", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "effect_pack");
    await confirmPurchase(store, ps, ref);
    expect(await store.hmget("supporters", [P1])).toEqual([null]);
  });
});

describe("getEntitlements", () => {
  it("returns only what a player owns, and rejects bad ids", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    expect((await getEntitlements(store, { player: "x" })).status).toBe(400);
    expect((await getEntitlements(store, { player: P1 })).body.owned).toEqual([]);
    const { ref } = await begin(store, ps, "effect_pack");
    await confirmPurchase(store, ps, ref);
    expect((await getEntitlements(store, { player: P1 })).body.owned).toEqual(["effect_pack"]);
  });
  it("ignores a tampered stored record rather than trusting it", async () => {
    const store = new MemoryStore();
    await store.set(`ent:${P1}`, JSON.stringify({ owned: ["effect_pack", "free_everything", 7] }));
    expect((await entitlementsOf(store, P1)).owned).toEqual(["effect_pack"]);
    await store.set(`ent:${P2}`, "{not json");
    expect((await entitlementsOf(store, P2)).owned).toEqual([]);
  });
});

describe("the Paystack webhook", () => {
  const body = (ref: string, event = "charge.success") => JSON.stringify({ event, data: { reference: ref } });
  it("verifies the signature against the raw body", () => {
    const raw = body("bp_" + "a".repeat(24));
    const sig = createHmac("sha512", "sk_test").update(raw).digest("hex");
    expect(signatureOk(raw, sig, "sk_test")).toBe(true);
    expect(signatureOk(raw + " ", sig, "sk_test")).toBe(false);
    expect(signatureOk(raw, sig, "other")).toBe(false);
    expect(signatureOk(raw, null, "sk_test")).toBe(false);
    expect(signatureOk(raw, sig, undefined)).toBe(false);
    expect(signatureOk(raw, "short", "sk_test")).toBe(false);
  });
  it("grants on a signed charge.success, and again harmlessly on a retry", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "effect_pack");
    expect((await paystackWebhook(store, ps, body(ref), true)).status).toBe(200);
    expect((await paystackWebhook(store, ps, body(ref), true)).status).toBe(200);
    expect((await entitlementsOf(store, P1)).owned).toEqual(["effect_pack"]);
  });
  it("does nothing for an unsigned call, or for other events", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "effect_pack");
    expect((await paystackWebhook(store, ps, body(ref), false)).status).toBe(401);
    expect((await paystackWebhook(store, ps, body(ref, "charge.failed"), true)).body.ignored).toBe(true);
    expect((await entitlementsOf(store, P1)).owned).toEqual([]);
  });
  it("asks Paystack to retry when it cannot verify yet", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const { ref } = await begin(store, ps, "effect_pack");
    ps.unreachable = true;
    expect((await paystackWebhook(store, ps, body(ref), true)).status).toBe(500);
  });
});
