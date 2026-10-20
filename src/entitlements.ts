// What a player owns. Pure: no DOM, no storage, no network — so the rules are testable and the
// same code can run on the server when a purchase is verified.
//
// The client's copy is a cache for drawing the shop, never the authority. A grant is only real
// once the server has verified the transaction, exactly as a leaderboard score is only real once
// the server has replayed the moves.

export type Sku =
  | "no_interstitials"
  | "theme_pack_dusk"
  | "theme_pack_citrus"
  | "effect_pack"
  | "supporter_bundle";

export const ALL_SKUS: readonly Sku[] = [
  "no_interstitials",
  "theme_pack_dusk",
  "theme_pack_citrus",
  "effect_pack",
  "supporter_bundle",
] as const;

/** The bundle contains the other items; owning it implies owning them. */
const BUNDLE_CONTENTS: readonly Sku[] = [
  "no_interstitials",
  "theme_pack_dusk",
  "theme_pack_citrus",
  "effect_pack",
] as const;

export interface Entitlements {
  /** Verified one-time purchases. */
  readonly owned: readonly Sku[];
}

export const NOTHING: Entitlements = { owned: [] };

export function isSku(s: string): s is Sku {
  return (ALL_SKUS as readonly string[]).includes(s);
}

/** Owning the bundle counts as owning everything inside it. */
export function owns(e: Entitlements, sku: Sku): boolean {
  if (e.owned.includes(sku)) return true;
  if (e.owned.includes("supporter_bundle") && BUNDLE_CONTENTS.includes(sku)) return true;
  return false;
}

export function isAdFree(e: Entitlements): boolean {
  return owns(e, "no_interstitials");
}

/** Add a verified purchase. Idempotent, so a replayed webhook cannot double-grant. */
export function grant(e: Entitlements, sku: Sku): Entitlements {
  if (e.owned.includes(sku)) return e;
  return { owned: [...e.owned, sku] };
}

/**
 * Parse an entitlement record from storage or from the server. Unknown values are dropped rather
 * than trusted, so a tampered localStorage blob cannot invent a sku.
 */
export function parse(raw: unknown): Entitlements {
  if (typeof raw !== "object" || raw === null) return NOTHING;
  const owned = (raw as { owned?: unknown }).owned;
  if (!Array.isArray(owned)) return NOTHING;
  const clean = owned.filter((s): s is Sku => typeof s === "string" && isSku(s));
  return { owned: [...new Set(clean)] };
}

// --- catalogue --------------------------------------------------------------------------------

export interface Price {
  /** Minor units, so no floating point: kobo for NGN, cents for USD. */
  readonly ngn: number;
  readonly usd: number;
}

export interface Item {
  readonly sku: Sku;
  readonly name: string;
  readonly blurb: string;
  readonly price: Price;
}

/**
 * Starting prices, not validated ones. Nothing here alters the piece generator, the board or the
 * scoring — every item is cosmetic or removes an interruption.
 */
export const CATALOGUE: readonly Item[] = [
  {
    sku: "no_interstitials",
    name: "No interruptions",
    blurb: "Removes ads between games. Forever.",
    price: { ngn: 150_000, usd: 299 },
  },
  {
    sku: "theme_pack_dusk",
    name: "Dusk themes",
    blurb: "Four darker palettes.",
    price: { ngn: 80_000, usd: 149 },
  },
  {
    sku: "theme_pack_citrus",
    name: "Citrus themes",
    blurb: "Four brighter palettes.",
    price: { ngn: 80_000, usd: 149 },
  },
  {
    sku: "effect_pack",
    name: "Clear effects",
    blurb: "New animations when a line goes.",
    price: { ngn: 80_000, usd: 149 },
  },
  {
    sku: "supporter_bundle",
    name: "Supporter bundle",
    blurb: "Everything above, and a mark beside your name on the board.",
    price: { ngn: 350_000, usd: 699 },
  },
] as const;

export function item(sku: Sku): Item | undefined {
  return CATALOGUE.find((i) => i.sku === sku);
}

/** What is still worth showing in the shop for this player. */
export function forSale(e: Entitlements): readonly Item[] {
  return CATALOGUE.filter((i) => !owns(e, i.sku));
}

export function formatPrice(p: Price, currency: "NGN" | "USD"): string {
  return currency === "NGN"
    ? `₦${(p.ngn / 100).toLocaleString("en-NG")}`
    : `$${(p.usd / 100).toFixed(2)}`;
}
