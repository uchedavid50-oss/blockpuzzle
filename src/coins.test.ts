import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdOutcome, AdProvider } from "./ads.js";
import * as A from "./analytics.js";
import * as C from "./coins.js";
import { ECONOMY, coinItem } from "./economy.js";
import { parseWallet } from "./wallet.js";

const D = "2026-10-21";

function storage(opts: { failWrites?: boolean; failReads?: boolean } = {}): Storage & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k) => { if (opts.failReads) throw new Error("blocked"); return m.get(k) ?? null; },
    setItem: (k, v) => { if (opts.failWrites) throw new Error("QuotaExceededError"); m.set(k, String(v)); },
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
}

const stored = (): ReturnType<typeof parseWallet> => parseWallet(JSON.parse(localStorage.getItem(C.WALLET_KEY) ?? "null"));
const provider = (outcome: AdOutcome | Error, delayMs = 0): AdProvider & { calls: number } => {
  const p = {
    calls: 0,
    rewarded: () => {
      p.calls++;
      return new Promise<AdOutcome>((res, rej) => setTimeout(() => (outcome instanceof Error ? rej(outcome) : res(outcome)), delayMs));
    },
    interstitial: () => Promise.resolve<AdOutcome>({ kind: "unavailable" }),
  };
  return p;
};

beforeEach(() => {
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("location", { search: "", pathname: "/", origin: "http://x" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  A.__reset();
  C.reloadWallet();
});
afterEach(() => vi.unstubAllGlobals());

describe("starting balance and the daily bonus", () => {
  it("gives a new player the starter balance and today's bonus, once", () => {
    expect(C.startupRewards(D)).toEqual({ starter: ECONOMY.starter, daily: ECONOMY.dailyBonus });
    expect(C.balance()).toBe(ECONOMY.starter + ECONOMY.dailyBonus);
    expect(C.startupRewards(D)).toEqual({ starter: 0, daily: 0 }); // reopening the same day
    C.reloadWallet(); // and after a reload
    expect(C.startupRewards(D)).toEqual({ starter: 0, daily: 0 });
    expect(C.balance()).toBe(ECONOMY.starter + ECONOMY.dailyBonus);
  });

  it("pays the bonus again the next day, but never the starter", () => {
    C.startupRewards(D);
    C.reloadWallet();
    expect(C.startupRewards("2026-10-22")).toEqual({ starter: 0, daily: ECONOMY.dailyBonus });
  });

  it("does not re-pay the starter if the record exists but is damaged", () => {
    localStorage.setItem(C.WALLET_KEY, "{not json");
    C.reloadWallet();
    expect(C.startupRewards(D).starter).toBe(0);
  });
});

describe("persistence", () => {
  it("keeps the balance, items and saved undos across a reload", () => {
    C.award("weekly", "weekly:2026-10-19", 500);
    expect(C.purchase("theme_mint", 0).ok).toBe(true);
    expect(C.purchase("undo3", 0).ok).toBe(true);
    C.reloadWallet();
    expect(C.balance()).toBe(500 - coinItem("theme_mint").cost - coinItem("undo3").cost);
    expect(C.ownsCoinItem("theme_mint")).toBe(true);
    expect(C.savedUndos()).toBe(3);
  });

  it("does not lose a purchase made in another tab", () => {
    C.award("weekly", "w1", 1000);
    // Another tab buys a theme and saves, behind this tab's back.
    const other = { ...stored(), coins: 1000 - 250, items: ["theme_coral" as const] };
    localStorage.setItem(C.WALLET_KEY, JSON.stringify(other));
    // This tab now buys undos: it must build on the other tab's wallet, not its own stale copy.
    expect(C.purchase("undo3", 0).ok).toBe(true);
    expect(stored().items).toEqual(["theme_coral"]);
    expect(stored().coins).toBe(1000 - 250 - coinItem("undo3").cost);
  });
});

describe("when storage fails", () => {
  it("keeps working in memory and says it could not save", () => {
    vi.stubGlobal("localStorage", storage({ failWrites: true }));
    C.reloadWallet();
    expect(C.award("weekly", "w1", 100)).toBe(100);
    expect(C.wallet.saved).toBe(false);
    expect(C.balance()).toBe(100);
    // A purchase still moves coins and item together in memory.
    expect(C.purchase("undo3", 0).ok).toBe(true);
    expect(C.balance()).toBe(100 - coinItem("undo3").cost);
    expect(C.savedUndos()).toBe(3);
  });

  it("starts empty, without crashing, when storage cannot even be read", () => {
    vi.stubGlobal("localStorage", storage({ failReads: true, failWrites: true }));
    C.reloadWallet();
    expect(C.balance()).toBe(0);
    expect(C.startupRewards(D).starter).toBe(0);
    expect(C.award("weekly", "w1", 20)).toBe(20);
  });
});

describe("rewards", () => {
  it("never pays a grant id twice", () => {
    expect(C.award("daily_challenge", `daily:${D}`, 20)).toBe(20);
    expect(C.award("daily_challenge", `daily:${D}`, 20)).toBe(0);
    expect(C.balance()).toBe(20);
  });

  it("pays a list of rewards, skipping the ones already paid", () => {
    expect(C.awardAll("milestone", [["milestone:500", 20], ["milestone:1000", 30]])).toBe(50);
    expect(C.awardAll("milestone", [["milestone:500", 20], ["milestone:1000", 30], ["milestone:2500", 50]])).toBe(50);
    expect(C.balance()).toBe(100);
  });
});

describe("purchases", () => {
  it("refuses when the player cannot afford it, and changes nothing", () => {
    C.award("weekly", "w1", 10);
    const r = C.purchase("theme_mint", 0);
    expect(r).toMatchObject({ ok: false, reason: "insufficient" });
    expect(C.balance()).toBe(10);
    expect(C.ownsCoinItem("theme_mint")).toBe(false);
  });

  it("charges once for a burst of taps", () => {
    C.award("weekly", "w1", 1000);
    const results = [0, 50, 100, 300].map((t) => C.purchase("undo3", 10_000 + t));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(C.balance()).toBe(1000 - coinItem("undo3").cost);
    expect(C.savedUndos()).toBe(3);
  });

  it("uses saved undos one at a time", () => {
    C.award("weekly", "w1", 1000);
    C.purchase("undo3", 0);
    expect(C.takeSavedUndo()).toBe(true);
    expect(C.savedUndos()).toBe(2);
    C.reloadWallet();
    expect(C.savedUndos()).toBe(2);
  });
});

describe("rewarded ads for coins", () => {
  it("pays only for a completed ad", async () => {
    expect(await C.watchAdForCoins(provider({ kind: "completed" }), D)).toEqual({ kind: "paid", coins: ECONOMY.ad.coins });
    expect(C.balance()).toBe(ECONOMY.ad.coins);
  });

  it("pays nothing for a dismissed, unavailable, failed or thrown ad", async () => {
    for (const o of [{ kind: "dismissed" }, { kind: "unavailable" }, { kind: "error", reason: "blocked" }, new Error("network")] as const) {
      expect(await C.watchAdForCoins(provider(o as AdOutcome | Error), D)).toEqual({ kind: "not_completed" });
    }
    expect(C.balance()).toBe(0);
    expect(C.adsLeftToday(D)).toBe(ECONOMY.ad.perDay); // failed ads do not use up the day's allowance
  });

  it("shows one ad at a time, however many taps", async () => {
    const p = provider({ kind: "completed" }, 20);
    const [a, b, c] = await Promise.all([C.watchAdForCoins(p, D), C.watchAdForCoins(p, D), C.watchAdForCoins(p, D)]);
    expect([a, b, c].filter((r) => r.kind === "paid")).toHaveLength(1);
    expect([a, b, c].filter((r) => r.kind === "busy")).toHaveLength(2);
    expect(p.calls).toBe(1);
    expect(C.balance()).toBe(ECONOMY.ad.coins);
  });

  it("stops at the daily cap without even requesting another ad", async () => {
    const p = provider({ kind: "completed" });
    for (let i = 0; i < ECONOMY.ad.perDay; i++) await C.watchAdForCoins(p, D);
    expect(await C.watchAdForCoins(p, D)).toEqual({ kind: "cap" });
    expect(p.calls).toBe(ECONOMY.ad.perDay);
    expect(C.balance()).toBe(ECONOMY.ad.perDay * ECONOMY.ad.coins);
  });
});

describe("analytics", () => {
  it("reports coins earned with their source and coins spent with the item", async () => {
    const sent: string[] = [];
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", (_u: string, init: { body: string }) => { sent.push(init.body); return Promise.resolve(new Response("{}")); });
    A.startAnalytics({ endpoint: "/api/collect" });
    C.award("weekly", "w1", 100);
    C.purchase("undo3", 0);
    await C.watchAdForCoins(provider({ kind: "dismissed" }), D);
    A.flush();
    const events = sent.flatMap((b) => (JSON.parse(b) as { events: { name: string; props?: Record<string, unknown> }[] }).events);
    expect(events).toContainEqual(expect.objectContaining({ name: "coins_earned", props: { source: "weekly", coins: 100 } }));
    expect(events).toContainEqual(expect.objectContaining({ name: "coins_spent", props: { item: "undo3", coins: coinItem("undo3").cost } }));
    expect(events).toContainEqual(expect.objectContaining({ name: "ad_requested", props: { placement: "coin_reward" } }));
    expect(events).toContainEqual(expect.objectContaining({ name: "ad_failed", props: { placement: "coin_reward", reason: "dismissed" } }));
    expect(events.some((e) => e.name === "coins_earned" && e.props?.source === "ad")).toBe(false);
  });
});

describe("collecting coins bought with money", () => {
  async function shop() {
    const S = await import("./shopClient.js");
    const { lb } = await import("./leaderboardClient.js");
    lb.shop = true;
    return S;
  }

  it("adds the claimed coins once and forgets the claim", async () => {
    const S = await shop();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ claimed: 300 }), { status: 200 })));
    expect(await S.claimCoins()).toBe(300);
    expect(C.balance()).toBe(300);
    expect(localStorage.getItem("blockpuzzle.coinClaim")).toBeNull();
  });

  it("keeps the claim id when the server cannot be reached, and retries with the same id", async () => {
    const S = await shop();
    const ids: string[] = [];
    vi.stubGlobal("fetch", (_u: string, init: { body: string }) => { ids.push((JSON.parse(init.body) as { claim: string }).claim); return Promise.reject(new Error("offline")); });
    expect(await S.claimCoins()).toBe(0);
    const kept = localStorage.getItem("blockpuzzle.coinClaim");
    expect(kept).toMatch(/^[a-f0-9]{24}$/);
    vi.stubGlobal("fetch", (_u: string, init: { body: string }) => { ids.push((JSON.parse(init.body) as { claim: string }).claim); return Promise.resolve(new Response(JSON.stringify({ claimed: 300 }))); });
    expect(await S.claimCoins()).toBe(300);
    expect(new Set(ids).size).toBe(1); // the retry used the same claim id
  });

  it("never adds the same claim twice, even if the server answers it twice", async () => {
    const S = await shop();
    localStorage.setItem("blockpuzzle.coinClaim", "ab".repeat(12));
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ claimed: 300 }))));
    await S.claimCoins();
    localStorage.setItem("blockpuzzle.coinClaim", "ab".repeat(12)); // as if clearing it had failed
    await S.claimCoins();
    expect(C.balance()).toBe(300);
  });

  it("asks the server for coins only when it says some are waiting", async () => {
    const S = await shop();
    const calls: string[] = [];
    vi.stubGlobal("fetch", (u: string) => { calls.push(u); return Promise.resolve(new Response(JSON.stringify({ owned: [], coins: 0 }))); });
    expect(await S.syncEntitlements()).toBe(0);
    expect(calls.some((u) => u.startsWith("/api/coins"))).toBe(false);
  });

  it("ignores a junk answer", async () => {
    const S = await shop();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ claimed: -5 }))));
    expect(await S.claimCoins()).toBe(0);
    expect(C.balance()).toBe(0);
  });
});
