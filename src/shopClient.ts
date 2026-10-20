// The game's side of buying: start a checkout, and confirm one when the player comes back. All prices
// and all verification live on the server; this only carries a sku out and an answer back.

import { track } from "./analytics.js";
import { isSku, type Sku } from "./entitlements.js";
import { call, getPlayer, lb, setPlayerId } from "./leaderboardClient.js";
import { setOwned } from "./ownership.js";

export type Outcome = { ok: true; sku?: string } | { ok: false; message: string };

async function postJson(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Ask the server what this player owns and adopt its answer. */
export async function syncEntitlements(): Promise<void> {
  if (!lb.shop) return;
  try {
    const r = await call(`/api/entitlements?player=${getPlayer().id}`);
    if (!r.ok) return;
    const d = (await r.json()) as { owned?: unknown };
    if (Array.isArray(d.owned)) setOwned(d.owned);
  } catch { /* offline: keep the cache */ }
}

/** Send the player to Paystack's checkout page for one item. */
export async function beginCheckout(sku: Sku, currency = "NGN"): Promise<Outcome> {
  if (!isSku(sku)) return { ok: false, message: "That item is not for sale." };
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

export async function restoreFromCode(code: string): Promise<Outcome> {
  if (!setPlayerId(code.trim().toLowerCase())) return { ok: false, message: "That code does not look right." };
  await syncEntitlements();
  return { ok: true };
}
