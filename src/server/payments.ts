// The payments ledger, for the admin page. One record per confirmed payment (reference, player, item,
// amount, currency, time), marked when it is refunded or disputed. Records are indexed by player and by
// day. A player's index follows the account when it is restored on another device (accounts.ts calls
// `movePayments`), so their whole history stays under the id they use now.
//
// Nothing here grants or takes back anything: purchases.ts does that, and writes here as it goes.
// No email or other personal data is kept, only the anonymous player id.

import { currentId } from "./accounts.js";
import type { Reply } from "./handlers.js";
import { isPlayerId, utcToday } from "./rules.js";
import type { Store } from "./store.js";

const DAY = 86_400;
const KEEP = 3650 * DAY; // money records are kept for years, not the 400 days analytics keep
const REF_RE = /^bp_[a-f0-9]{24}$/;
const MAX_ROWS = 200;
const MAX_SCAN = 2000; // records read for one period's totals
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

export type PaymentStatus = "paid" | "refunded" | "disputed";

export interface PaymentRecord {
  reference: string;
  /** The id that paid. The account may have moved since; the index follows it. */
  player: string;
  sku: string;
  amount: number; // minor units: kobo for NGN, cents for USD
  currency: string;
  paidAt: string; // ISO time of the first confirmation
  status: PaymentStatus;
  /** Every change after payment, oldest first. */
  history: { status: PaymentStatus; at: string }[];
}

export const paymentKey = (reference: string): string => `pay:${reference}`;
export const playerPaymentsKey = (player: string): string => `pays:p:${player}`;
export const dayPaymentsKey = (date: string): string => `pays:d:${date}`;

async function readRecord(store: Store, reference: string): Promise<PaymentRecord | null> {
  try { return JSON.parse((await store.get(paymentKey(reference))) ?? "null") as PaymentRecord | null; } catch { return null; }
}

/**
 * Writes the record for a confirmed payment, once per reference, and (re)adds it to the indexes. Safe to
 * call on every confirmation: a repeat keeps the first record and its time.
 */
export async function recordPayment(store: Store, p: { reference: string; player: string; sku: string; amount: number; currency: string }, now = new Date()): Promise<void> {
  const fresh: PaymentRecord = { ...p, paidAt: now.toISOString(), status: "paid", history: [] };
  await store.setNx(paymentKey(p.reference), JSON.stringify(fresh), KEEP);
  const rec = (await readRecord(store, p.reference)) ?? fresh;
  const ms = Date.parse(rec.paidAt);
  // Indexed under the id the account lives on now, so a payment confirmed after a move is not stranded.
  await store.zadd(playerPaymentsKey(await currentId(store, rec.player)), ms, rec.reference);
  await store.zadd(dayPaymentsKey(utcToday(new Date(ms))), ms, rec.reference);
}

/** Marks a recorded payment refunded or disputed. A repeat of the same event (a webhook retry) changes nothing. */
export async function markPayment(store: Store, reference: string, status: "refunded" | "disputed", now = new Date()): Promise<boolean> {
  const rec = await readRecord(store, reference);
  if (!rec || rec.status === status) return false;
  rec.status = status;
  rec.history = [...(rec.history ?? []), { status, at: now.toISOString() }];
  await store.set(paymentKey(reference), JSON.stringify(rec));
  return true;
}

/** Moves a player's payment index to their new id when the account is restored elsewhere. */
export async function movePayments(store: Store, from: string, to: string): Promise<void> {
  const rows = await store.zrevrange(playerPaymentsKey(from), 0, 9999);
  for (const r of rows) await store.zadd(playerPaymentsKey(to), r.score, r.member);
  if (rows.length) await store.del(playerPaymentsKey(from));
}

export interface PaymentTotal { currency: string; count: number; gross: number; refunded: number; disputed: number; net: number }

/** Sums by currency (amounts in minor units never mix currencies). */
export function totalsOf(records: PaymentRecord[]): PaymentTotal[] {
  const by = new Map<string, PaymentTotal>();
  for (const r of records) {
    const t = by.get(r.currency) ?? { currency: r.currency, count: 0, gross: 0, refunded: 0, disputed: 0, net: 0 };
    t.count += 1;
    t.gross += r.amount;
    if (r.status === "refunded") t.refunded += r.amount;
    else if (r.status === "disputed") t.disputed += r.amount;
    else t.net += r.amount;
    by.set(r.currency, t);
  }
  return [...by.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1));
}

async function load(store: Store, refs: string[]): Promise<PaymentRecord[]> {
  const out: PaymentRecord[] = [];
  for (const ref of refs) {
    const r = await readRecord(store, ref);
    if (r) out.push(r);
  }
  return out.sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));
}

/**
 * The admin search. `ref` finds one payment; `player` (any id the account has had) lists that account's
 * payments; otherwise the last `days` days are listed. Totals are over everything matched; at most
 * MAX_ROWS rows are returned, newest first.
 */
export async function getPayments(store: Store, query: { ref?: unknown; player?: unknown; days?: unknown }, now = new Date()): Promise<Reply> {
  if (query.ref !== undefined && query.ref !== null && query.ref !== "") {
    if (typeof query.ref !== "string" || !REF_RE.test(query.ref)) return reply(400, { error: "bad reference" });
    const rec = await readRecord(store, query.ref);
    if (!rec) return reply(404, { error: "no payment with that reference" });
    return reply(200, { payments: [{ ...rec, account: await currentId(store, rec.player) }], totals: totalsOf([rec]) });
  }
  if (query.player !== undefined && query.player !== null && query.player !== "") {
    if (!isPlayerId(query.player)) return reply(400, { error: "bad player" });
    const account = await currentId(store, query.player);
    const refs = (await store.zrevrange(playerPaymentsKey(account), 0, MAX_SCAN - 1)).map((r) => r.member);
    const recs = await load(store, refs);
    return reply(200, { account, payments: recs.slice(0, MAX_ROWS).map((r) => ({ ...r, account })), totals: totalsOf(recs) });
  }
  const days = Math.min(90, Math.max(1, Math.floor(Number(query.days)) || 30));
  const refs: string[] = [];
  for (let i = 0; i < days && refs.length < MAX_SCAN; i++) {
    const date = utcToday(new Date(now.getTime() - i * DAY * 1000));
    for (const r of await store.zrevrange(dayPaymentsKey(date), 0, MAX_SCAN - 1)) refs.push(r.member);
  }
  const recs = await load(store, refs.slice(0, MAX_SCAN));
  const rows = [];
  for (const r of recs.slice(0, MAX_ROWS)) rows.push({ ...r, account: await currentId(store, r.player) });
  return reply(200, { days, payments: rows, totals: totalsOf(recs), truncated: refs.length >= MAX_SCAN });
}
