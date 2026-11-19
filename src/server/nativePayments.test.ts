import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../routes/revenuecat-webhook.js";
import { entitlementsOf, transferAccount } from "./accounts.js";
import { claimCoins, unclaimedCoins } from "./coins.js";
import { nativeIdentity, nativePaymentEvent } from "./nativePayments.js";
import { MemoryStore } from "./store.js";

const player = "a".repeat(24);
const other = "b".repeat(24);

beforeEach(() => {
  vi.stubEnv("REVENUECAT_WEBHOOK_AUTH", "Bearer test-secret");
  vi.stubEnv("REVENUECAT_ID_SECRET", "identity-secret");
  vi.stubEnv("REVENUECAT_IOS_APP_ID", "app_ios");
  vi.stubEnv("REVENUECAT_IOS_PUBLIC_KEY", "appl_example");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("REVENUECAT_ALLOW_SANDBOX", "1");
});
afterEach(() => vi.unstubAllEnvs());

async function fixture(sku: string, store = new MemoryStore()) {
  const identity = await nativeIdentity(store, player);
  expect(identity.body.id).not.toContain(player);
  const event = {
    app_id: "app_ios", store: "APP_STORE", environment: "PRODUCTION",
    product_id: sku, transaction_id: "1234", app_user_id: identity.body.id,
    type: "NON_RENEWING_PURCHASE", event_timestamp_ms: 1000,
  };
  return { store, send: (updates = {} as Record<string, unknown>) => nativePaymentEvent(store, { event: { ...event, ...updates } }) };
}

describe("RevenueCat fulfillment", () => {
  it("rejects unsigned webhooks and ignores sandbox, wrong app and unknown user events", async () => {
    const { store, send } = await fixture("coins_small");
    expect((await POST(new Request("https://bunblocks.app/api/revenuecat-webhook", { method: "POST" }))).status).toBe(401);
    await send({ environment: "SANDBOX" });
    await send({ app_id: "unrelated" });
    await send({ app_user_id: "$RCAnonymousID:abc" });
    expect(await unclaimedCoins(store, player)).toBe(0);
  });

  it("credits concurrent retries once and reverses a refund once after collection", async () => {
    const { store, send } = await fixture("coins_small");
    await Promise.all([send(), send()]);
    expect(await unclaimedCoins(store, player)).toBe(300);
    const claim = await claimCoins(store, { player, claim: "a".repeat(24) });
    expect(claim.body.claimed).toBe(300);
    const refund = { type: "CANCELLATION", event_timestamp_ms: 2000 };
    await Promise.all([send(refund), send(refund)]);
    await send({ event_timestamp_ms: 3000 });
    expect(await store.mcount([`coins:${player}`])).toEqual([-300]);
    await send({ type: "REFUND_REVERSED", event_timestamp_ms: 4000 });
    expect(await store.mcount([`coins:${player}`])).toEqual([0]);
  });

  it("preserves the original owner through a move and other purchases through a refund", async () => {
    const { store, send } = await fixture("theme_pack_dusk");
    await send();
    const second = await nativeIdentity(store, other);
    await send({ app_user_id: second.body.id, event_timestamp_ms: 1500 });
    expect((await entitlementsOf(store, other)).owned).toEqual([]);
    const moved = (await transferAccount(store, { player })).body.player as string;
    expect((await entitlementsOf(store, moved)).owned).toEqual(["theme_pack_dusk"]);
    await send({ transaction_id: "5678" });
    await send({ type: "CANCELLATION", event_timestamp_ms: 2000 });
    expect((await entitlementsOf(store, moved)).owned).toEqual(["theme_pack_dusk"]);
    await send({ transaction_id: "5678", type: "CANCELLATION", event_timestamp_ms: 2000 });
    expect((await entitlementsOf(store, moved)).owned).toEqual([]);
  });

  it("forwards a coin credit that lands while the account moves", async () => {
    let moved = "";
    class MovingStore extends MemoryStore {
      override async applyNativePayment(...args: Parameters<MemoryStore["applyNativePayment"]>): Promise<void> {
        moved ||= (await transferAccount(this, { player })).body.player as string;
        await super.applyNativePayment(...args);
      }
    }
    const { store, send } = await fixture("coins_small", new MovingStore());
    await send();
    await send();
    expect(await unclaimedCoins(store, moved)).toBe(300);
    expect(await unclaimedCoins(store, player)).toBe(0);
  });

  it("keeps a refund that arrives before the purchase", async () => {
    const { store, send } = await fixture("coins_small");
    await send({ type: "CANCELLATION", event_timestamp_ms: 2000 });
    await send();
    expect(await unclaimedCoins(store, player)).toBe(0);
  });
});
