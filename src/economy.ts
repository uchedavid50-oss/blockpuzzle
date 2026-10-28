// Every number in the coin economy, in one place. Change a value here and rebuild; nothing else in
// the game hard-codes a reward or a price. Pure: no DOM, no storage, so the server can import the
// coin-pack prices from here too (the browser never names an amount).
//
// These are starting values, not tuned ones. Watch `coins_earned` and `coins_spent` on the admin
// page for a couple of weeks before changing them. The aim: a player who opens the game most days
// can afford a pack of undos every day or two, and a coin theme in about a week.

import type { Price } from "./entitlements.js";

export const ECONOMY = {
  /** Given once, the first time the game is opened. */
  starter: 50,
  /** Once per calendar day, for opening the game. */
  dailyBonus: 10,
  /**
   * Extra coins on top of the daily bonus for opening the game on consecutive days: the n-th day in a
   * row (counting 1 to 7, then starting over) pays entry n-1. Miss a day and the count restarts.
   */
  loginStreak: [0, 0, 10, 0, 15, 0, 50],
  /** Once per day, for finishing today's daily on the first attempt. */
  dailyChallenge: 20,
  /** Once per day, extra, when that first attempt beats par. */
  dailyBeatPar: 15,
  /** Once per weekly challenge, for completing it. */
  weekly: 40,
  /** Per journey star, the first time each star on each level is earned (so at most 3 per level). */
  journeyStar: 5,
  /** One-time payouts the first time your best score in classic or the weekly reaches each threshold. */
  milestones: [
    [500, 20],
    [1000, 30],
    [2500, 50],
    [5000, 100],
  ] as const,
  /** Weekly Cup prizes by finishing rank (1st, 2nd, 3rd), then a smaller one down to `cup.top`. */
  cup: { prizes: [300, 200, 100], top: 10, restPrize: 40 },
  /** Rewarded ads for coins: only on a confirmed completion, and at most this many a day. */
  ad: { coins: 15, perDay: 5 },
  /** Guard rails, not tuning: no single grant above this, and no balance above `maxBalance`. */
  maxGrant: 100_000,
  maxBalance: 10_000_000,
} as const;

// ---- Things coins buy ---------------------------------------------------------------------
// Cosmetic, or a convenience the game already hands out for free (an undo). Nothing here touches the
// piece generator, the board, the scoring or a ranked mode.

export type CoinItemId = "undo3" | "theme_mint" | "theme_coral";

export interface CoinItem {
  readonly id: CoinItemId;
  readonly name: string;
  readonly blurb: string;
  readonly cost: number;
  /** `stack` can be bought again and again; `once` is owned forever after one purchase. */
  readonly kind: "stack" | "once";
  /** For undo packs: how many saved undos one purchase adds. */
  readonly undos?: number;
}

export const COIN_ITEMS: readonly CoinItem[] = [
  { id: "undo3", name: "3 saved undos", blurb: "Use when you run out. Not in daily or weekly.", cost: 60, kind: "stack", undos: 3 },
  { id: "theme_mint", name: "Mint theme", blurb: "Cool greens and blues.", cost: 250, kind: "once" },
  { id: "theme_coral", name: "Coral theme", blurb: "Warm reef colours.", cost: 250, kind: "once" },
] as const;

/** Saved undos never pile up past this. */
export const MAX_SAVED_UNDOS = 99;

export const isCoinItem = (s: unknown): s is CoinItemId => typeof s === "string" && COIN_ITEMS.some((i) => i.id === s);
export const coinItem = (id: CoinItemId): CoinItem => COIN_ITEMS.find((i) => i.id === id)!;

// ---- Coin packs (real money, optional) ----------------------------------------------------
// Sold through the same Paystack checkout as the other shop items, priced here and read by the
// server. Coins from a pack reach the player only after Paystack confirms the payment.

export type PackId = "coins_small" | "coins_large";

export interface CoinPack {
  readonly id: PackId;
  readonly name: string;
  readonly coins: number;
  readonly price: Price;
}

export const COIN_PACKS: readonly CoinPack[] = [
  { id: "coins_small", name: "300 coins", coins: 300, price: { ngn: 60_000, usd: 99 } },
  { id: "coins_large", name: "1,500 coins", coins: 1_500, price: { ngn: 250_000, usd: 399 } },
] as const;

export const isPack = (s: unknown): s is PackId => typeof s === "string" && COIN_PACKS.some((p) => p.id === s);
export const packFor = (s: unknown): CoinPack | undefined => COIN_PACKS.find((p) => p.id === s);

// ---- Where coins come from (for analytics) -------------------------------------------------

export const COIN_SOURCES = ["starter", "daily_bonus", "login_streak", "daily_challenge", "daily_par", "weekly", "journey", "milestone", "ad", "purchase"] as const;
export type CoinSource = (typeof COIN_SOURCES)[number];
