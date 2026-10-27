// Each test here is one loophole from the security audit, tried against the server code to show it is
// closed: a cheat or abuse is attempted, and the server must refuse it.

import { describe, expect, it } from "vitest";
import { playBot } from "../solver";
import { RULES_VERSION, type MoveTuple } from "../verify";
import { claimName, entitlementsOf, isRetired, transferAccount } from "./accounts";
import { collect, getStats } from "./analytics";
import { claimCoins, coinKey, unclaimedCoins } from "./coins";
import { MIN_MS_PER_MOVE, getStreaks, renamePlayer, startDaily, submitScore } from "./handlers";
import { NEW_PLAYERS_PER_ADDRESS_PER_DAY, clientIp, overLimit, LIMITS } from "./limits";
import { FakePaystack, PaystackHttp, paystackFromEnv } from "./paystack";
import { confirmPurchase, getEntitlements, paystackWebhook, revokePurchase, startCheckout } from "./purchases";
import { cleanName, dateOpen, nameKey } from "./rules";
import { MemoryStore } from "./store";

const NOW = new Date("2026-10-19T12:00:00Z");
const DATE = "2026-10-19";
const HOUR = 3_600_000;
const id = (n: number): string => n.toString(16).padStart(24, "0");
const ORIGIN = "https://game.test";
const ENV = {} as Record<string, string | undefined>;

function game(date: string, maxMoves: number): MoveTuple[] {
  const moveLog: [number, number, number][] = [];
  playBot({ seed: date, maxMoves, moveLog });
  return moveLog;
}
const body = (n: number, name: string, moves: MoveTuple[], date = DATE) => ({ v: RULES_VERSION, player: id(n), name, date, moves });

async function buy(store: MemoryStore, ps: FakePaystack, player: string, sku: string): Promise<string> {
  const r = await startCheckout(store, ps, { player, sku }, ORIGIN, ENV);
  expect(r.status).toBe(200);
  return r.body.reference as string;
}

describe("leaderboard: games must be played, not computed", () => {
  it("refuses a game that was never started online", async () => {
    const store = new MemoryStore();
    const r = await submitScore(store, body(1, "Ada", game(DATE, 20)), NOW);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("not started");
  });

  it("refuses a game finished faster than a person can place pieces", async () => {
    const store = new MemoryStore();
    const moves = game(DATE, 40);
    await startDaily(store, { player: id(1), date: DATE }, new Date(NOW.getTime() - 2000)); // started 2s ago
    const r = await submitScore(store, body(1, "Ada", moves), NOW);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("too fast");
    // the same game at a human pace is fine
    const store2 = new MemoryStore();
    await startDaily(store2, { player: id(1), date: DATE }, new Date(NOW.getTime() - moves.length * MIN_MS_PER_MOVE - 1000));
    expect((await submitScore(store2, body(1, "Ada", moves), NOW)).status).toBe(200);
  });

  it("only the first start counts: starting again later does not reset the clock", async () => {
    const store = new MemoryStore();
    expect((await startDaily(store, { player: id(1), date: DATE }, new Date(NOW.getTime() - HOUR))).body.first).toBe(true);
    expect((await startDaily(store, { player: id(1), date: DATE }, NOW)).body.first).toBe(false);
    expect((await submitScore(store, body(1, "Ada", game(DATE, 30)), NOW)).status).toBe(200);
  });

  it("caps how many new players one network address can create in a day", async () => {
    const store = new MemoryStore();
    const moves = game(DATE, 10);
    let refused = 0;
    for (let n = 1; n <= NEW_PLAYERS_PER_ADDRESS_PER_DAY + 3; n++) {
      await startDaily(store, { player: id(n), date: DATE }, new Date(NOW.getTime() - HOUR));
      const r = await submitScore(store, body(n, `Bot ${n}`, moves), NOW, "203.0.113.9");
      if (r.status === 429) refused++;
    }
    expect(refused).toBe(3);
    // another address is unaffected
    await startDaily(store, { player: id(99), date: DATE }, new Date(NOW.getTime() - HOUR));
    expect((await submitScore(store, body(99, "Someone", moves), NOW, "198.51.100.1")).status).toBe(200);
  });

  it("opens a day's board only while that day exists somewhere on Earth", () => {
    // 12:00 UTC on the 19th: the 18th is still running in UTC-12, the 20th has begun in UTC+14
    expect(dateOpen("2026-10-18", NOW)).toBe(false); // UTC-12 is at 00:00 on the 19th
    expect(dateOpen("2026-10-19", NOW)).toBe(true);
    expect(dateOpen("2026-10-20", NOW)).toBe(true);
    expect(dateOpen("2026-10-21", NOW)).toBe(false);
    // at 05:00 UTC on the 19th, the 18th is still live in the Pacific; the 20th is not yet anywhere
    const early = new Date("2026-10-19T05:00:00Z");
    expect(dateOpen("2026-10-18", early)).toBe(true);
    expect(dateOpen("2026-10-20", early)).toBe(false);
  });
});

describe("names", () => {
  it("blocks number swaps and lookalike letters", () => {
    for (const bad of ["f4ck you", "sh1t", "b1tch", "Fυck", "сunt", "n4z1", "d1ck"]) expect(cleanName(bad)).toBeNull();
    expect(cleanName("Ada 42")).toBe("Ada 42");
  });

  it("lets only one player hold a name, counting lookalikes as the same name", async () => {
    const store = new MemoryStore();
    expect(await claimName(store, id(1), "Ada")).toBe(true);
    expect(await claimName(store, id(2), "ada")).toBe(false);
    expect(await claimName(store, id(2), "Αda")).toBe(false); // Greek capital alpha
    expect(nameKey("Αda")).toBe(nameKey("ada"));
    // renaming frees the old name
    expect(await claimName(store, id(1), "Ada L")).toBe(true);
    expect(await claimName(store, id(2), "Ada")).toBe(true);
  });

  it("a rename cannot take someone else's name", async () => {
    const store = new MemoryStore();
    for (const [n, name] of [[1, "Champion"], [2, "Bobby"]] as const) {
      await startDaily(store, { player: id(n), date: DATE }, new Date(NOW.getTime() - HOUR));
      await submitScore(store, body(n, name, game(DATE, 10)), NOW);
    }
    const r = await renamePlayer(store, { player: id(2), name: "champion" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("name taken");
  });
});

describe("restore codes move an account, they do not copy it", () => {
  it("moves purchases, coins, name and streak to a new id and retires the old one", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const old = id(1);
    await confirmPurchase(store, ps, await buy(store, ps, old, "supporter_bundle"));
    await confirmPurchase(store, ps, await buy(store, ps, old, "coins_small"));
    await startDaily(store, { player: old, date: DATE }, new Date(NOW.getTime() - HOUR));
    await submitScore(store, body(1, "Ada", game(DATE, 10)), NOW);

    const t = await transferAccount(store, { player: old }, NOW);
    expect(t.status).toBe(200);
    const fresh = t.body.player as string;
    expect(fresh).not.toBe(old);

    expect((await entitlementsOf(store, fresh)).owned).toContain("supporter_bundle");
    expect(await unclaimedCoins(store, fresh)).toBe(300);
    expect(await isRetired(store, old)).toBe(true);
    expect((await getEntitlements(store, { player: old })).body).toMatchObject({ owned: [], moved: true });
    expect((await getStreaks(store, { player: fresh }, NOW)).body.me).toMatchObject({ streak: 1 });
    // the old code can do nothing any more
    expect((await claimCoins(store, { player: old, claim: "ab".repeat(10) })).status).toBe(410);
    expect((await startCheckout(store, ps, { player: old, sku: "effect_pack" }, ORIGIN, ENV)).status).toBe(410);
    expect((await renamePlayer(store, { player: old, name: "Thief" })).status).toBe(410);
    // and the new id cannot post today again just because it is new
    await startDaily(store, { player: fresh, date: DATE }, new Date(NOW.getTime() - HOUR));
    expect((await submitScore(store, { ...body(1, "Ada", game(DATE, 30)), player: fresh }, NOW)).status).toBe(409);
  });

  it("works once: a code passed around cannot be restored on a second device", async () => {
    const store = new MemoryStore();
    expect((await transferAccount(store, { player: id(1) }, NOW)).status).toBe(200);
    expect((await transferAccount(store, { player: id(1) }, NOW)).status).toBe(410);
  });

  it("a payment started before the move still lands on the account's new id", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const ref = await buy(store, ps, id(1), "effect_pack");
    const fresh = (await transferAccount(store, { player: id(1) }, NOW)).body.player as string;
    expect((await confirmPurchase(store, ps, ref)).status).toBe(200);
    expect((await entitlementsOf(store, fresh)).owned).toContain("effect_pack");
  });
});

describe("purchases", () => {
  it("two different purchases confirmed at the same moment both arrive", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const a = await buy(store, ps, id(1), "theme_pack_dusk");
    const b = await buy(store, ps, id(1), "theme_pack_citrus");
    await Promise.all([confirmPurchase(store, ps, a), confirmPurchase(store, ps, b)]);
    expect((await entitlementsOf(store, id(1))).owned).toEqual(expect.arrayContaining(["theme_pack_dusk", "theme_pack_citrus"]));
  });

  it("a refund takes the item back, the supporter star too, and it cannot be re-confirmed", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const ref = await buy(store, ps, id(1), "supporter_bundle");
    await confirmPurchase(store, ps, ref);
    expect((await store.hmget("supporters", [id(1)]))[0]).toBe("1");
    expect((await revokePurchase(store, ref)).body.revoked).toBe(true);
    expect((await entitlementsOf(store, id(1))).owned).not.toContain("supporter_bundle");
    expect((await store.hmget("supporters", [id(1)]))[0]).toBeNull();
    expect((await confirmPurchase(store, ps, ref)).status).toBe(409);
    expect((await revokePurchase(store, ref)).body.revoked).toBe(false); // only once
  });

  it("a refunded coin pack is taken back, even after the coins were collected (as a debt)", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const ref = await buy(store, ps, id(1), "coins_small");
    await confirmPurchase(store, ps, ref);
    expect((await claimCoins(store, { player: id(1), claim: "cd".repeat(10) })).body.claimed).toBe(300);
    await revokePurchase(store, ref);
    expect((await store.mcount([coinKey(id(1))]))[0]).toBe(-300);
    // the next pack bought pays the debt off first
    await confirmPurchase(store, ps, await buy(store, ps, id(1), "coins_large"));
    expect(await unclaimedCoins(store, id(1))).toBe(1200);
  });

  it("a signed refund or dispute webhook revokes; an unsigned one does nothing", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const ref = await buy(store, ps, id(1), "effect_pack");
    await confirmPurchase(store, ps, ref);
    const raw = JSON.stringify({ event: "refund.processed", data: { transaction_reference: ref } });
    expect((await paystackWebhook(store, ps, raw, false)).status).toBe(401);
    expect((await entitlementsOf(store, id(1))).owned).toContain("effect_pack");
    await paystackWebhook(store, ps, raw, true);
    expect((await entitlementsOf(store, id(1))).owned).not.toContain("effect_pack");

    const ref2 = await buy(store, ps, id(2), "effect_pack");
    await confirmPurchase(store, ps, ref2);
    await paystackWebhook(store, ps, JSON.stringify({ event: "charge.dispute.create", data: { transaction: { reference: ref2 } } }), true);
    expect((await entitlementsOf(store, id(2))).owned).not.toContain("effect_pack");
  });

  it("the admin page counts sales the server confirmed, not ones browsers claim", async () => {
    const store = new MemoryStore(); const ps = new FakePaystack();
    const ref = await buy(store, ps, id(1), "effect_pack");
    await confirmPurchase(store, ps, ref, NOW);
    await confirmPurchase(store, ps, ref, NOW); // a repeat does not count twice
    // a script claiming purchases from a made-up analytics id is accepted but not counted
    const fake = { id: "a".repeat(22), firstSeen: DATE, events: Array.from({ length: 20 }, () => ({ name: "purchase_completed", t: NOW.getTime(), props: { sku: "supporter_bundle" } })) };
    expect((await collect(store, fake, NOW)).status).toBe(200);
    const stats = await getStats(store, NOW, 1);
    const day = (stats.body.days as { events: Record<string, number>; byProp: Record<string, number> }[])[0]!;
    expect(day.events.purchase_completed).toBe(1);
    expect(day.byProp["purchase_completed.sku.effect_pack"]).toBe(1);
    expect(day.byProp["purchase_completed.sku.supporter_bundle"]).toBeUndefined();
  });

  it("a Paystack test key is refused on the live site, unless deliberately allowed", () => {
    expect(paystackFromEnv({ PAYSTACK_SECRET_KEY: "sk_test_x", VERCEL: "1", VERCEL_ENV: "production" })).toBeNull();
    expect(paystackFromEnv({ PAYSTACK_SECRET_KEY: "sk_test_x", VERCEL: "1", VERCEL_ENV: "preview" })).toBeInstanceOf(PaystackHttp);
    expect(paystackFromEnv({ PAYSTACK_SECRET_KEY: "sk_test_x", VERCEL: "1", VERCEL_ENV: "production", PAYSTACK_ALLOW_TEST: "1" })).toBeInstanceOf(PaystackHttp);
    expect(paystackFromEnv({ PAYSTACK_SECRET_KEY: "sk_live_x", VERCEL: "1", VERCEL_ENV: "production" })).toBeInstanceOf(PaystackHttp);
  });
});

describe("rate limits and load", () => {
  it("limits each address per route, per minute", async () => {
    const store = new MemoryStore();
    let blocked = 0;
    for (let i = 0; i < LIMITS.submit + 5; i++) if (await overLimit(store, "submit", "203.0.113.9", NOW)) blocked++;
    expect(blocked).toBe(5);
    expect(await overLimit(store, "submit", "198.51.100.1", NOW)).toBe(false);
    expect(await overLimit(store, "submit", "203.0.113.9", new Date(NOW.getTime() + 61_000))).toBe(false); // a new minute
  });

  it("reads the caller's address from Vercel's header, and lumps anything odd together", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "<script>" }))).toBe("unknown");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("works out the streak board at most every 30 seconds, not on every request", async () => {
    const store = new MemoryStore();
    for (let n = 1; n <= 5; n++) {
      await startDaily(store, { player: id(n), date: DATE }, new Date(NOW.getTime() - HOUR));
      await submitScore(store, body(n, `Player ${n}`, game(DATE, 8)), NOW);
    }
    let reads = 0;
    const get = store.get.bind(store);
    store.get = async (k: string) => { if (k.startsWith("streak:")) reads++; return get(k); };
    await getStreaks(store, {}, NOW);
    const first = reads;
    for (let i = 0; i < 10; i++) await getStreaks(store, { player: id(i) }, NOW);
    expect(first).toBe(5);
    expect(reads).toBe(5); // ten more requests, no more per-player reads
  });
});
