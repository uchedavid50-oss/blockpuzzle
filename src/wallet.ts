// The coin wallet's rules. Pure: no DOM, no storage, no clock (callers pass the date and time), so
// every rule here is covered by tests. coins.ts stores the result.
//
// Three guarantees:
//   1. The balance never goes negative, and never exceeds ECONOMY.maxBalance.
//   2. Every reward has a grant id, and an id is paid at most once. Asking twice is a no-op.
//   3. A purchase is one new wallet value: the coins leave and the item arrives together, so saving
//      it is all-or-nothing. A second tap on the same item a moment later is refused.

import { ECONOMY, MAX_SAVED_UNDOS, coinItem, isCoinItem, type CoinItemId } from "./economy.js";

export interface Wallet {
  readonly v: 1;
  readonly coins: number;
  /** Saved undos, bought with coins, used once a game's own undos are gone. */
  readonly undos: number;
  /** One-time coin items owned (themes). */
  readonly items: readonly CoinItemId[];
  /** Grant ids already paid out. Pruned of dated ids once they can no longer recur (see `prune`). */
  readonly grants: readonly string[];
  /** Lifetime totals, for the stats screen and sanity checks. */
  readonly earned: number;
  readonly spent: number;
  /** Rewarded ads watched for coins on `adDay`. */
  readonly adDay: string;
  readonly adCount: number;
  /** The last purchase, to refuse an accidental double tap. */
  readonly lastBuy: { readonly id: string; readonly t: number } | null;
}

export const EMPTY_WALLET: Wallet = { v: 1, coins: 0, undos: 0, items: [], grants: [], earned: 0, spent: 0, adDay: "", adCount: 0, lastBuy: null };

/** A second tap on the same item within this window is treated as the same tap. */
export const DOUBLE_TAP_MS = 1200;
/** Grant ids older than this many days are forgotten: none of them can be earned again by then. */
export const GRANT_MEMORY_DAYS = 45;
const MAX_GRANTS = 3000;

const nat = (v: unknown, max: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads a stored wallet. Anything malformed is repaired rather than trusted: negative or fractional
 * numbers are clamped, unknown items are dropped. A wallet that cannot be read at all becomes empty
 * (but the starter grant id is kept, so a broken record never pays the starter bonus twice).
 */
export function parseWallet(raw: unknown): Wallet {
  if (typeof raw !== "object" || raw === null) return EMPTY_WALLET;
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? [...new Set(r.items.filter(isCoinItem))] : [];
  const grants = Array.isArray(r.grants) ? [...new Set(r.grants.filter((g): g is string => typeof g === "string" && g.length <= 80))].slice(-MAX_GRANTS) : [];
  const lb = r.lastBuy as { id?: unknown; t?: unknown } | null | undefined;
  return {
    v: 1,
    coins: nat(r.coins, ECONOMY.maxBalance),
    undos: nat(r.undos, MAX_SAVED_UNDOS),
    items,
    grants,
    earned: nat(r.earned, Number.MAX_SAFE_INTEGER),
    spent: nat(r.spent, Number.MAX_SAFE_INTEGER),
    adDay: typeof r.adDay === "string" && DATE_RE.test(r.adDay) ? r.adDay : "",
    adCount: nat(r.adCount, 1000),
    lastBuy: lb && typeof lb.id === "string" && typeof lb.t === "number" && Number.isFinite(lb.t) ? { id: lb.id, t: lb.t } : null,
  };
}

export const hasGrant = (w: Wallet, id: string): boolean => w.grants.includes(id);

export type EarnResult =
  | { readonly ok: true; readonly wallet: Wallet; readonly amount: number }
  | { readonly ok: false; readonly reason: "duplicate" | "invalid" | "cap" };

/** Pays `amount` coins under `grantId`, once. Asking again with the same id changes nothing. */
export function earn(w: Wallet, grantId: string, amount: number): EarnResult {
  if (!grantId || grantId.length > 80 || !Number.isInteger(amount) || amount <= 0 || amount > ECONOMY.maxGrant) return { ok: false, reason: "invalid" };
  if (hasGrant(w, grantId)) return { ok: false, reason: "duplicate" };
  const paid = Math.min(amount, ECONOMY.maxBalance - w.coins);
  return {
    ok: true,
    amount: paid,
    wallet: { ...w, coins: w.coins + paid, earned: w.earned + paid, grants: [...w.grants, grantId].slice(-MAX_GRANTS) },
  };
}

/** Rewarded ads left today. Resets at local midnight, like the daily. */
export const adsLeft = (w: Wallet, date: string): number =>
  Math.max(0, ECONOMY.ad.perDay - (w.adDay === date ? w.adCount : 0));

/**
 * Pays for one rewarded ad. Call ONLY after the ad network has confirmed a completed view
 * (ads.ts `claimReward` returning true). Refuses once today's cap is reached.
 */
export function earnFromAd(w: Wallet, date: string): EarnResult {
  if (!DATE_RE.test(date)) return { ok: false, reason: "invalid" };
  if (adsLeft(w, date) <= 0) return { ok: false, reason: "cap" };
  const n = (w.adDay === date ? w.adCount : 0) + 1;
  const r = earn(w, `ad:${date}:${n}`, ECONOMY.ad.coins);
  if (!r.ok) return r;
  return { ...r, wallet: { ...r.wallet, adDay: date, adCount: n } };
}

export type BuyResult =
  | { readonly ok: true; readonly wallet: Wallet; readonly cost: number }
  | { readonly ok: false; readonly reason: "unknown" | "owned" | "insufficient" | "full" | "repeat"; readonly need?: number };

export const ownsItem = (w: Wallet, id: CoinItemId): boolean => w.items.includes(id);

/**
 * Buys one item with coins. Returns the whole new wallet, with the coins taken and the item given in
 * the same value, or a reason it was refused. Never produces a negative balance.
 */
export function buy(w: Wallet, id: string, nowMs: number): BuyResult {
  if (!isCoinItem(id)) return { ok: false, reason: "unknown" };
  const item = coinItem(id);
  if (w.lastBuy && w.lastBuy.id === id && nowMs - w.lastBuy.t >= 0 && nowMs - w.lastBuy.t < DOUBLE_TAP_MS) return { ok: false, reason: "repeat" };
  if (item.kind === "once" && ownsItem(w, id)) return { ok: false, reason: "owned" };
  if (item.undos && w.undos + item.undos > MAX_SAVED_UNDOS) return { ok: false, reason: "full" };
  if (w.coins < item.cost) return { ok: false, reason: "insufficient", need: item.cost - w.coins };
  return {
    ok: true,
    cost: item.cost,
    wallet: {
      ...w,
      coins: w.coins - item.cost,
      spent: w.spent + item.cost,
      undos: w.undos + (item.undos ?? 0),
      items: item.kind === "once" ? [...w.items, id] : w.items,
      lastBuy: { id, t: nowMs },
    },
  };
}

/** Uses one saved undo. Returns null if there are none. */
export function useSavedUndo(w: Wallet): Wallet | null {
  return w.undos > 0 ? { ...w, undos: w.undos - 1 } : null;
}

/**
 * Forgets dated grant ids older than GRANT_MEMORY_DAYS. They can never be earned again (rewards are
 * only offered for today), so remembering them forever would just grow the record.
 */
export function prune(w: Wallet, today: string): Wallet {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - GRANT_MEMORY_DAYS * 86_400_000;
  if (!Number.isFinite(cutoff)) return w;
  const keep = w.grants.filter((g) => {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(g);
    if (!m) return true;
    const t = Date.parse(`${m[1]}T00:00:00Z`);
    return !Number.isFinite(t) || t >= cutoff;
  });
  return keep.length === w.grants.length ? w : { ...w, grants: keep };
}

// ---- Which rewards a piece of progress is owed ------------------------------------------------
// Each returns [grantId, amount] pairs; `earn` makes paying them idempotent.

export type Owed = readonly [id: string, amount: number];

export const milestonesFor = (best: number): Owed[] =>
  ECONOMY.milestones.filter(([at]) => best >= at).map(([at, coins]) => [`milestone:${at}`, coins] as const);

/** One payout per star newly earned on a journey level, never for a star earned before. */
export const journeyStarsOwed = (level: number, stars: number): Owed[] =>
  Array.from({ length: Math.max(0, Math.min(3, stars)) }, (_, i) => [`journey:${level}:${i + 1}`, ECONOMY.journeyStar] as const);
