import { describe, expect, it } from "vitest";
import { COIN_ITEMS, ECONOMY, MAX_SAVED_UNDOS, coinItem } from "./economy.js";
import {
  DOUBLE_TAP_MS, EMPTY_WALLET, GRANT_MEMORY_DAYS, adsLeft, buy, earn, earnFromAd, journeyStarsOwed, milestonesFor,
  ownsItem, parseWallet, prune, useSavedUndo, type Wallet,
} from "./wallet.js";

const D = "2026-10-21";
const rich = (coins: number, more: Partial<Wallet> = {}): Wallet => ({ ...EMPTY_WALLET, coins, ...more });

describe("earn", () => {
  it("pays a reward and remembers it", () => {
    const r = earn(EMPTY_WALLET, "starter", 50);
    expect(r).toMatchObject({ ok: true, amount: 50 });
    if (!r.ok) return;
    expect(r.wallet.coins).toBe(50);
    expect(r.wallet.earned).toBe(50);
    expect(r.wallet.grants).toContain("starter");
  });

  it("never pays the same grant id twice", () => {
    const once = earn(EMPTY_WALLET, `bonus:${D}`, 10);
    if (!once.ok) throw new Error("first grant failed");
    expect(earn(once.wallet, `bonus:${D}`, 10)).toEqual({ ok: false, reason: "duplicate" });
    expect(earn(once.wallet, `bonus:${D}`, 999)).toEqual({ ok: false, reason: "duplicate" }); // a different amount does not slip through
  });

  it("refuses zero, negative, fractional, oversized and nameless grants", () => {
    for (const [id, amount] of [["a", 0], ["a", -5], ["a", 1.5], ["a", NaN], ["a", ECONOMY.maxGrant + 1], ["", 10], ["x".repeat(81), 10]] as const)
      expect(earn(EMPTY_WALLET, id, amount)).toEqual({ ok: false, reason: "invalid" });
  });

  it("never pushes the balance past the cap", () => {
    const r = earn(rich(ECONOMY.maxBalance - 3), "g", 50);
    expect(r).toMatchObject({ ok: true, amount: 3 });
    if (r.ok) expect(r.wallet.coins).toBe(ECONOMY.maxBalance);
  });

  it("does not change the wallet it was given", () => {
    const w = rich(10);
    earn(w, "g", 5);
    expect(w.coins).toBe(10);
    expect(w.grants).toEqual([]);
  });
});

describe("rewarded ads for coins", () => {
  it("pays the configured amount, up to the daily cap, then refuses", () => {
    let w = EMPTY_WALLET;
    for (let i = 0; i < ECONOMY.ad.perDay; i++) {
      const r = earnFromAd(w, D);
      expect(r.ok).toBe(true);
      if (r.ok) w = r.wallet;
    }
    expect(w.coins).toBe(ECONOMY.ad.coins * ECONOMY.ad.perDay);
    expect(adsLeft(w, D)).toBe(0);
    expect(earnFromAd(w, D)).toEqual({ ok: false, reason: "cap" });
  });

  it("resets the cap on a new day", () => {
    const w = rich(0, { adDay: D, adCount: ECONOMY.ad.perDay });
    expect(adsLeft(w, D)).toBe(0);
    expect(adsLeft(w, "2026-10-22")).toBe(ECONOMY.ad.perDay);
    expect(earnFromAd(w, "2026-10-22").ok).toBe(true);
  });

  it("rejects a malformed date rather than opening a fresh cap", () => {
    expect(earnFromAd(EMPTY_WALLET, "today")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("buy", () => {
  const undo = coinItem("undo3");
  const mint = coinItem("theme_mint");

  it("takes the coins and gives the item in one new wallet", () => {
    const r = buy(rich(100), "undo3", 0);
    expect(r).toMatchObject({ ok: true, cost: undo.cost });
    if (!r.ok) return;
    expect(r.wallet.coins).toBe(100 - undo.cost);
    expect(r.wallet.undos).toBe(undo.undos);
    expect(r.wallet.spent).toBe(undo.cost);
  });

  it("refuses when the player cannot afford it, and says how much more they need", () => {
    const r = buy(rich(mint.cost - 1), "theme_mint", 0);
    expect(r).toEqual({ ok: false, reason: "insufficient", need: 1 });
  });

  it("allows spending down to exactly zero, never below", () => {
    const r = buy(rich(mint.cost), "theme_mint", 0);
    expect(r.ok && r.wallet.coins).toBe(0);
    if (r.ok) expect(buy(r.wallet, "undo3", 10_000)).toMatchObject({ ok: false, reason: "insufficient" });
  });

  it("sells a one-time item only once", () => {
    const r = buy(rich(1000), "theme_mint", 0);
    if (!r.ok) throw new Error("purchase failed");
    expect(ownsItem(r.wallet, "theme_mint")).toBe(true);
    expect(buy(r.wallet, "theme_mint", 10_000)).toEqual({ ok: false, reason: "owned" });
  });

  it("treats a second tap on the same item a moment later as the same tap", () => {
    const first = buy(rich(1000), "undo3", 5_000);
    if (!first.ok) throw new Error("purchase failed");
    expect(buy(first.wallet, "undo3", 5_000 + DOUBLE_TAP_MS - 1)).toEqual({ ok: false, reason: "repeat" });
    const later = buy(first.wallet, "undo3", 5_000 + DOUBLE_TAP_MS);
    expect(later.ok).toBe(true);
    if (later.ok) expect(later.wallet.coins).toBe(1000 - 2 * undo.cost); // exactly two charged, not three
  });

  it("does not block a different item tapped straight after", () => {
    const first = buy(rich(1000), "undo3", 5_000);
    if (!first.ok) throw new Error("purchase failed");
    expect(buy(first.wallet, "theme_coral", 5_001).ok).toBe(true);
  });

  it("will not overfill saved undos", () => {
    expect(buy(rich(1000, { undos: MAX_SAVED_UNDOS - 1 }), "undo3", 0)).toEqual({ ok: false, reason: "full" });
  });

  it("refuses unknown items", () => {
    expect(buy(rich(1000), "free_everything", 0)).toEqual({ ok: false, reason: "unknown" });
  });

  it("leaves the original wallet untouched when a purchase is refused", () => {
    const w = rich(5);
    buy(w, "theme_mint", 0);
    expect(w).toEqual(rich(5));
  });
});

describe("saved undos", () => {
  it("are used one at a time and never go below zero", () => {
    const w = useSavedUndo(rich(0, { undos: 1 }));
    expect(w?.undos).toBe(0);
    expect(useSavedUndo(w!)).toBeNull();
  });
});

describe("parseWallet", () => {
  it("reads back what it was given", () => {
    const r = buy(rich(500, { grants: ["starter"] }), "theme_coral", 7);
    if (!r.ok) throw new Error("purchase failed");
    expect(parseWallet(JSON.parse(JSON.stringify(r.wallet)))).toEqual(r.wallet);
  });

  it("repairs a tampered or damaged record instead of trusting it", () => {
    const w = parseWallet({ coins: -50, undos: 1e9, items: ["theme_mint", "free_everything", "theme_mint"], grants: ["a", 7, "a"], earned: 2.7, adDay: "soon", adCount: -1 });
    expect(w.coins).toBe(0);
    expect(w.undos).toBe(MAX_SAVED_UNDOS);
    expect(w.items).toEqual(["theme_mint"]);
    expect(w.grants).toEqual(["a"]);
    expect(w.earned).toBe(2);
    expect(w.adDay).toBe("");
    expect(w.adCount).toBe(0);
  });

  it("caps an inflated balance", () => {
    expect(parseWallet({ coins: 1e15 }).coins).toBe(ECONOMY.maxBalance);
  });

  it("turns junk into an empty wallet", () => {
    for (const junk of [null, undefined, 3, "coins", []]) expect(parseWallet(junk).coins).toBe(0);
  });
});

describe("prune", () => {
  it("forgets dated grants once they are too old to matter, and keeps the rest", () => {
    const old = `bonus:2026-08-01`;
    const recent = `bonus:${D}`;
    const w = rich(0, { grants: ["starter", "milestone:500", "journey:3:2", old, recent, "claim:abc123"] });
    const p = prune(w, D);
    expect(p.grants).toEqual(["starter", "milestone:500", "journey:3:2", recent, "claim:abc123"]);
  });

  it("keeps a grant from exactly the edge of its memory", () => {
    const edge = new Date(Date.parse(`${D}T00:00:00Z`) - GRANT_MEMORY_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(prune(rich(0, { grants: [`bonus:${edge}`] }), D).grants).toHaveLength(1);
  });

  it("returns the same wallet when there is nothing to forget", () => {
    const w = rich(0, { grants: ["starter"] });
    expect(prune(w, D)).toBe(w);
  });
});

describe("what progress is owed", () => {
  it("pays each score milestone reached, and none above the best", () => {
    expect(milestonesFor(0)).toEqual([]);
    expect(milestonesFor(1200).map(([id]) => id)).toEqual(["milestone:500", "milestone:1000"]);
  });

  it("pays one grant per star, with ids that cannot repeat on a replay", () => {
    expect(journeyStarsOwed(7, 2)).toEqual([["journey:7:1", ECONOMY.journeyStar], ["journey:7:2", ECONOMY.journeyStar]]);
    expect(journeyStarsOwed(7, 9)).toHaveLength(3);
    expect(journeyStarsOwed(7, -1)).toEqual([]);
  });

  it("cannot be farmed: replaying a level pays only the stars not yet paid", () => {
    let w = EMPTY_WALLET;
    const pay = (stars: number): number => {
      let n = 0;
      for (const [id, amount] of journeyStarsOwed(1, stars)) { const r = earn(w, id, amount); if (r.ok) { w = r.wallet; n += r.amount; } }
      return n;
    };
    expect(pay(2)).toBe(2 * ECONOMY.journeyStar);
    expect(pay(2)).toBe(0);
    expect(pay(3)).toBe(ECONOMY.journeyStar);
    expect(pay(3)).toBe(0);
  });
});

describe("economy config", () => {
  it("prices every item above zero, and no item is free to farm", () => {
    for (const i of COIN_ITEMS) expect(i.cost).toBeGreaterThan(0);
  });
});
