// What this device believes the player owns. A cache only: the server is the authority, and the game
// replaces this with the server's answer whenever it can ask. Editing it locally can unlock at most
// cosmetics on that one device; it cannot buy the leaderboard star, which the server decides.

import { NOTHING, owns, parse, type Entitlements, type Sku } from "./entitlements.js";

const KEY = "blockpuzzle.entitlements";

function load(): Entitlements {
  try { return parse(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return NOTHING; }
}

export const ownership: { ent: Entitlements } = { ent: load() };

export const ownsSku = (sku: Sku): boolean => owns(ownership.ent, sku);

/** Replace the cache with what the server says is owned. Unknown values are dropped by `parse`. */
export function setOwned(owned: unknown): void {
  ownership.ent = parse({ owned });
  try { localStorage.setItem(KEY, JSON.stringify(ownership.ent)); } catch { /* ignore */ }
}
