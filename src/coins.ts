// The coin wallet on this device: loading and saving it, paying rewards and taking payments, and
// reporting both to analytics. The rules themselves are in wallet.ts (pure, tested); the numbers are
// in economy.ts.
//
// Earned coins live on the device, like stats and badges. Editing them locally only cheats the person
// doing it: nothing bought with coins is ranked, and coins cannot buy anything sold for money.
// Coins bought with money are credited on the server and arrive here through shopClient.claimCoins.

import { claimReward, type AdProvider } from "./ads.js";
import { track } from "./analytics.js";
import { ECONOMY, type CoinItemId, type CoinSource } from "./economy.js";
import { EMPTY_WALLET, adsLeft, buy, earn, earnFromAd, hasGrant, ownsItem, parseWallet, prune, useSavedUndo, type BuyResult, type Owed, type Wallet } from "./wallet.js";

export const WALLET_KEY = "blockpuzzle.wallet";

interface Loaded { w: Wallet; fresh: boolean; ok: boolean }

function load(): Loaded {
  try {
    const raw = localStorage.getItem(WALLET_KEY);
    if (raw === null) return { w: EMPTY_WALLET, fresh: true, ok: true };
    return { w: parseWallet(JSON.parse(raw)), fresh: false, ok: true };
  } catch {
    // Storage blocked (some private windows) or a corrupted record: carry on in memory for this session.
    return { w: EMPTY_WALLET, fresh: false, ok: false };
  }
}

const first = load();
/** The wallet as this tab knows it. `saved` is false while the device is refusing to store it. */
export const wallet: { w: Wallet; saved: boolean; isNew: boolean } = { w: first.w, saved: first.ok, isNew: first.fresh };

/** Test seam, and what a `storage` event from another tab calls: adopt whatever is stored now. */
export function reloadWallet(): void {
  const l = load();
  wallet.w = l.w; wallet.saved = l.ok; wallet.isNew = l.fresh;
}

try {
  // Another tab of the game changed the wallet: show its balance here too.
  addEventListener("storage", (e: StorageEvent) => { if (e.key === WALLET_KEY) { const l = load(); if (l.ok && !l.fresh) wallet.w = l.w; } });
} catch { /* not in a browser (tests) */ }

/**
 * The latest wallet, re-read from storage first so that two open tabs cannot overwrite each other's
 * purchases. If saving has been failing, memory is newer than storage, so memory wins.
 */
function latest(): Wallet {
  if (wallet.saved) {
    const l = load();
    if (l.ok && !l.fresh) wallet.w = l.w;
  }
  return wallet.w;
}

/** Stores a new wallet value as one write. In memory it always takes effect; `saved` says if it stuck. */
function commit(next: Wallet): boolean {
  wallet.w = next;
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(next));
    wallet.saved = true;
  } catch {
    wallet.saved = false;
  }
  return wallet.saved;
}

export const balance = (): number => wallet.w.coins;
export const savedUndos = (): number => wallet.w.undos;
export const ownsCoinItem = (id: CoinItemId): boolean => ownsItem(wallet.w, id);
export const adsLeftToday = (date: string): number => adsLeft(wallet.w, date);

/** Pays one reward under its grant id. Returns the coins paid: 0 if it was already paid (or invalid). */
export function award(source: CoinSource, grantId: string, amount: number): number {
  const r = earn(latest(), grantId, amount);
  if (!r.ok) return 0;
  commit(r.wallet);
  track("coins_earned", { source, coins: r.amount });
  return r.amount;
}

/**
 * Pays every reward in a list that has not been paid yet. Returns the total paid now. Ids this tab
 * already knows are paid are skipped without touching storage, so calling it on every move is cheap.
 */
export const awardAll = (source: CoinSource, owed: readonly Owed[]): number =>
  owed.reduce((n, [id, amount]) => n + (hasGrant(wallet.w, id) ? 0 : award(source, id, amount)), 0);

/** Pays for one rewarded ad. Call ONLY after ads.ts `claimReward` resolved true. 0 if today's cap is reached. */
export function awardAd(date: string): number {
  const r = earnFromAd(latest(), date);
  if (!r.ok) return 0;
  commit(r.wallet);
  track("coins_earned", { source: "ad", coins: r.amount });
  return r.amount;
}

export type AdCoins = { kind: "paid"; coins: number } | { kind: "busy" | "cap" | "not_completed" };
let adInFlight = false;

/**
 * The whole "watch an ad for coins" flow. At most one ad at a time (extra taps get "busy"), no ad at
 * all once today's cap is reached, and coins only when the network reports a completed view: a
 * dismissed, unavailable, failed or timed-out ad pays nothing.
 */
export async function watchAdForCoins(p: AdProvider, date: string): Promise<AdCoins> {
  if (adInFlight) return { kind: "busy" };
  if (adsLeft(latest(), date) <= 0) return { kind: "cap" };
  adInFlight = true;
  try {
    const ok = await claimReward(p, "coin_reward", (n, props) => track(n, props));
    if (!ok) return { kind: "not_completed" };
    const coins = awardAd(date);
    return coins > 0 ? { kind: "paid", coins } : { kind: "cap" };
  } finally {
    adInFlight = false;
  }
}

/** Buys one coin item. The coins and the item change together in one write. */
export function purchase(id: string, nowMs = Date.now()): BuyResult {
  const r = buy(latest(), id, nowMs);
  if (r.ok) {
    commit(r.wallet);
    track("coins_spent", { item: id, coins: r.cost });
  }
  return r;
}

/** Spends one saved undo. False if there are none. */
export function takeSavedUndo(): boolean {
  const next = useSavedUndo(latest());
  if (!next) return false;
  commit(next);
  return true;
}

/**
 * Once per app start: the starter balance for a brand-new wallet, today's daily bonus, and a tidy-up
 * of old grant ids. Returns what was paid, for the welcome toasts.
 */
export function startupRewards(today: string): { starter: number; daily: number } {
  const starter = wallet.isNew ? award("starter", "starter", ECONOMY.starter) : 0;
  wallet.isNew = false;
  const daily = award("daily_bonus", `bonus:${today}`, ECONOMY.dailyBonus);
  const w = latest();
  const tidy = prune(w, today);
  if (tidy !== w) commit(tidy);
  return { starter, daily };
}
