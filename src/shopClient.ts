// The game's side of buying: start a checkout, and confirm one when the player comes back. All prices
// and all verification live on the server; this only carries a sku out and an answer back.

import { track } from "./analytics.js";
import { award } from "./coins.js";
import { isPack, type PackId } from "./economy.js";
import { isSku, type Sku } from "./entitlements.js";
import { account, adoptAccount, lostAccount } from "./cloudClient.js";
import { call, getPlayer, lb, resetPlayer, setPlayerId } from "./leaderboardClient.js";
import { setOwned } from "./ownership.js";

export type Outcome = { ok: true; sku?: string } | { ok: false; message: string };

async function postJson(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

/**
 * Ask the server what this player owns and adopt its answer. If they have bought coins that no device
 * has collected yet, collect them now. Returns the coins collected (0 almost always).
 */
export async function syncEntitlements(): Promise<number> {
  if (!lb.shop) return 0;
  try {
    const { status, data: d } = await postJson("/api/entitlements", { player: getPlayer().id });
    if (status !== 200) return 0;
    if (d.moved === true) {
      // This device's code was used to move the account to another device: it owns nothing now.
      setOwned([]);
      if (account()) lostAccount(); else resetPlayer(); // a signed-in player can sign in again to rejoin it
      return 0;
    }
    if (Array.isArray(d.owned)) setOwned(d.owned);
    if ((typeof d.coins === "number" && d.coins > 0) || pendingClaim()) return await claimCoins();
  } catch { /* offline: keep the cache */ }
  return 0;
}

// ---- Collecting bought coins ----------------------------------------------------------------
// The claim id is saved before asking and cleared only after the coins are in the wallet, so a lost
// response is retried with the same id and the server answers it again without taking anything new.

const CLAIM_KEY = "blockpuzzle.coinClaim";
const pendingClaim = (): string | null => {
  try { const v = localStorage.getItem(CLAIM_KEY); return v && /^[a-f0-9]{16,40}$/.test(v) ? v : null; } catch { return null; }
};
function newClaimId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

let claiming = false;
/** Moves coins bought with money from the server into this device's wallet. Returns how many arrived. */
export async function claimCoins(): Promise<number> {
  if (claiming) return 0;
  claiming = true;
  try {
    let id = pendingClaim();
    if (!id) {
      id = newClaimId();
      try { localStorage.setItem(CLAIM_KEY, id); } catch { return 0; } // cannot remember the claim: do not risk losing coins
    }
    const r = await call("/api/coins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player: getPlayer().id, claim: id }) });
    if (!r.ok) return 0; // keep the id and try again next time
    const d = (await r.json().catch(() => ({}))) as { claimed?: unknown };
    const n = typeof d.claimed === "number" && Number.isInteger(d.claimed) && d.claimed > 0 ? d.claimed : 0;
    const paid = n > 0 ? award("purchase", `claim:${id}`, n) : 0; // grant id = claim id: never added twice
    try { localStorage.removeItem(CLAIM_KEY); } catch { /* ignore */ }
    return paid;
  } catch {
    return 0;
  } finally {
    claiming = false;
  }
}

/** Send the player to Paystack's checkout page for one item or coin pack. */
export async function beginCheckout(sku: Sku | PackId, currency = "NGN"): Promise<Outcome> {
  if (!isSku(sku) && !isPack(sku)) return { ok: false, message: "That item is not for sale." };
  try {
    const { status, data } = await postJson("/api/checkout", { player: getPlayer().id, sku, currency });
    if (status === 409) { await syncEntitlements(); return { ok: false, message: "You already own that." }; }
    if (status !== 200 || typeof data.url !== "string") return { ok: false, message: "Payments are unavailable right now. Please try again later." };
    track("purchase_started", { sku });
    location.assign(data.url);
    return { ok: true, sku };
  } catch { return { ok: false, message: "Could not reach the shop. Check your connection." }; }
}

/** If the page was opened by returning from checkout, confirm the payment. Null otherwise. */
export async function handleReturn(search: string, replaceUrl = true): Promise<Outcome | null> {
  const q = new URLSearchParams(search);
  const ref = q.get("reference") ?? q.get("trxref");
  if (q.get("shop") !== "return" || !ref) return null;
  if (replaceUrl) { try { history.replaceState(null, "", location.pathname); } catch { /* ignore */ } }
  try {
    const r = await call(`/api/purchase?ref=${encodeURIComponent(ref)}`);
    const d = (await r.json().catch(() => ({}))) as { owned?: unknown; sku?: string; error?: string };
    if (r.ok && Array.isArray(d.owned)) {
      setOwned(d.owned);
      track("purchase_completed", { sku: typeof d.sku === "string" ? d.sku : "unknown" });
      return { ok: true, ...(typeof d.sku === "string" ? { sku: d.sku } : {}) };
    }
    if (r.status === 402) return { ok: false, message: "The payment was not completed, so you have not been charged." };
    return { ok: false, message: "We could not confirm that payment yet. If you were charged, reopen the game in a minute and it will appear." };
  } catch { return { ok: false, message: "Could not reach the shop to confirm your payment. Reopen the game in a minute." }; }
}

/** The code that moves purchases and leaderboard history to another device. Treat it like a password. */
export const transferCode = (): string => getPlayer().id;

/**
 * Moves an account here from another device. The server gives this device a new code and retires the
 * old one, so a code works on one device at a time and cannot be passed around to unlock purchases.
 */
export async function restoreFromCode(code: string): Promise<Outcome> {
  const old = code.trim().toLowerCase();
  if (!/^[a-f0-9]{24,32}$/.test(old)) return { ok: false, message: "That code does not look right." };
  if (old === getPlayer().id) return { ok: false, message: "That is this device's own code." };
  try {
    const { status, data } = await postJson("/api/transfer", { player: old });
    if (status === 200 && typeof data.player === "string" && setPlayerId(data.player)) {
      await adoptAccount();
      await syncEntitlements();
      return { ok: true };
    }
    return { ok: false, message: typeof data.message === "string" ? data.message : "Could not restore right now. Try again later." };
  } catch { return { ok: false, message: "Could not reach the shop. Check your connection." }; }
}
