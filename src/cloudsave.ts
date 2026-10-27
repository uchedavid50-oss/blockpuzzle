// Cloud save: which stored values travel with a signed-in account, and how two copies are merged.
// Pure: no DOM, no storage, no clock (callers pass the date), so every rule is covered by tests.
// cloudClient.ts reads and writes localStorage and talks to the server.
//
// A save is a map of localStorage keys to their raw values. Merging is three-way: `base` is what this
// device and the server last agreed on, so only what changed on each side since then is combined.
// Progress made on two devices adds up instead of one overwriting the other:
//   - counters (games played, lines, coins) add both sides' changes;
//   - bests, journey stars and "seen" marks take the higher;
//   - sets (badges, coin items, reward ids, finished weeklies) are unions;
//   - device preferences (theme, sound, settings) stay as this device has them.
// A reward paid on both devices before they synced is paid once (see `grantAmount`).

import { ECONOMY, MAX_SAVED_UNDOS } from "./economy.js";
import { parseWallet, type Wallet } from "./wallet.js";

export type Snapshot = Record<string, string>;

const P = "blockpuzzle.";
/** Values compared by number, highest wins. */
const MAX_KEYS = new Set([`${P}best`, `${P}tilesSeen`, `${P}badgesSeen`]);
/** Set once, never unset: present on either side means present. */
const FLAG_KEYS = new Set([`${P}hintSeen`, `${P}mapHint`]);
/** This device's own choices. Taken from the save only if this device has none yet. */
const DEVICE_KEYS = new Set([`${P}theme`, `${P}settings`, `${P}muted`]);
const SPECIAL = new Set([`${P}wallet`, `${P}stats`, `${P}journey`, `${P}badges`, `${P}streak`]);
/** Per-day records: kept for this many days back, so the save does not grow without end. */
const DATED: { prefix: string; kind: "max" | "first" }[] = [
  { prefix: `${P}daily.`, kind: "max" },      // best score on a daily
  { prefix: `${P}official.`, kind: "first" }, // the first attempt is the record
  { prefix: `${P}posted.`, kind: "first" },   // what the leaderboard answered
];
const WEEKLY = `${P}weekly.`;
export const DATED_DAYS = 30;
/** Bigger than any real save; anything above it is refused by the server. */
export const MAX_SAVE_BYTES = 180_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for every key that is part of the cloud save. Ids, caches and the in-progress game are not. */
export function isSynced(key: string): boolean {
  if (MAX_KEYS.has(key) || FLAG_KEYS.has(key) || DEVICE_KEYS.has(key) || SPECIAL.has(key)) return true;
  if (key.startsWith(WEEKLY)) return key.length < 40;
  return DATED.some((d) => key.startsWith(d.prefix) && DATE_RE.test(key.slice(d.prefix.length)));
}

/** The synced part of what is stored, dropping per-day records older than DATED_DAYS. */
export function snapshotOf(all: Snapshot, today: string): Snapshot {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - DATED_DAYS * 86_400_000;
  const out: Snapshot = {};
  for (const [k, v] of Object.entries(all)) {
    if (!isSynced(k) || typeof v !== "string") continue;
    const d = DATED.find((x) => k.startsWith(x.prefix));
    if (d && !(Date.parse(`${k.slice(d.prefix.length)}T00:00:00Z`) >= cutoff)) continue;
    out[k] = v;
  }
  return out;
}

/** Checks a save that came from the network: only synced keys, only strings, not too big. */
export function cleanSnapshot(raw: unknown): Snapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: Snapshot = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string" || !isSynced(k)) return null;
    out[k] = v;
  }
  return JSON.stringify(out).length <= MAX_SAVE_BYTES ? out : null;
}

const json = (s: string | undefined): unknown => {
  if (s === undefined) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
};
const num = (s: string | undefined): number => Number(s) || 0;
const nat = (n: number, max = Number.MAX_SAFE_INTEGER): number => Math.max(0, Math.min(max, Math.floor(n)));

/**
 * What a reward id paid, when it is one every device would pay the same way. A reward found on both
 * sides that neither had at `base` was paid twice, once on each device; one payment is taken back.
 * Ad rewards (each a separate view) and bought-coin claims (unique per device) are not repeats.
 */
export function grantAmount(id: string): number {
  if (id === "starter") return ECONOMY.starter;
  const [kind, a] = id.split(":");
  switch (kind) {
    case "bonus": return ECONOMY.dailyBonus;
    case "daily": return ECONOMY.dailyChallenge;
    case "par": return ECONOMY.dailyBeatPar;
    case "weekly": return ECONOMY.weekly;
    case "journey": return ECONOMY.journeyStar;
    case "milestone": return ECONOMY.milestones.find(([at]) => String(at) === a)?.[1] ?? 0;
    default: return 0;
  }
}

function mergeWallet(base: Wallet, local: Wallet, cloud: Wallet): Wallet {
  const baseGrants = new Set(base.grants);
  const cloudGrants = new Set(cloud.grants);
  const twice = local.grants.filter((g) => !baseGrants.has(g) && cloudGrants.has(g)).reduce((n, g) => n + grantAmount(g), 0);
  const delta = (pick: (w: Wallet) => number): number => pick(local) - pick(base);
  const sameDay = local.adDay === cloud.adDay;
  return parseWallet({
    v: 1,
    coins: nat(cloud.coins + delta((w) => w.coins) - twice, ECONOMY.maxBalance),
    undos: nat(cloud.undos + delta((w) => w.undos), MAX_SAVED_UNDOS),
    items: [...new Set([...cloud.items, ...local.items])],
    grants: [...new Set([...cloud.grants, ...local.grants])],
    earned: nat(cloud.earned + delta((w) => w.earned) - twice),
    spent: nat(cloud.spent + delta((w) => w.spent)),
    adDay: sameDay || local.adDay > cloud.adDay ? local.adDay : cloud.adDay,
    adCount: sameDay ? Math.max(local.adCount, cloud.adCount) : local.adDay > cloud.adDay ? local.adCount : cloud.adCount,
    lastBuy: local.lastBuy,
  });
}

const STAT_MAX = new Set(["bestScore", "bestCombo", "bestStreak"]);
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

function mergeStats(base: Obj, local: Obj, cloud: Obj): Obj {
  const out: Obj = { ...cloud };
  for (const k of new Set([...Object.keys(local), ...Object.keys(cloud)])) {
    const l = local[k], c = cloud[k], b = base[k];
    if (Array.isArray(l) || Array.isArray(c)) {
      const la = Array.isArray(l) ? l : [], ca = Array.isArray(c) ? c : [], ba = Array.isArray(b) ? b : [];
      out[k] = Array.from({ length: Math.max(la.length, ca.length) }, (_, i) => nat((Number(ca[i]) || 0) + (Number(la[i]) || 0) - (Number(ba[i]) || 0)));
    } else if (STAT_MAX.has(k)) {
      out[k] = Math.max(Number(l) || 0, Number(c) || 0);
    } else {
      out[k] = nat((Number(c) || 0) + (Number(l) || 0) - (Number(b) || 0));
    }
  }
  return out;
}

function mergeJourney(local: Obj, cloud: Obj): { next: number; stars: Record<string, number> } {
  const stars: Record<string, number> = {};
  for (const side of [obj(cloud.stars), obj(local.stars)])
    for (const [lvl, s] of Object.entries(side)) stars[lvl] = Math.max(stars[lvl] ?? 0, Math.min(3, Number(s) || 0));
  return { next: Math.max(1, Number(local.next) || 1, Number(cloud.next) || 1), stars };
}

function mergeStreak(local: Obj, cloud: Obj): Obj {
  const ll = typeof local.last === "string" ? local.last : "", cl = typeof cloud.last === "string" ? cloud.last : "";
  if (ll === cl) return (Number(local.n) || 0) >= (Number(cloud.n) || 0) ? local : cloud;
  return ll > cl ? local : cloud;
}

/**
 * Combines this device's save with the server's, given the save both last agreed on (`{}` the first
 * time this device signs in, which adds a guest's progress to the account).
 */
export function mergeSnapshots(base: Snapshot, local: Snapshot, cloud: Snapshot): Snapshot {
  const out: Snapshot = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(cloud)])) {
    const l = local[k], c = cloud[k];
    if (l === undefined || c === undefined) { out[k] = (l ?? c)!; continue; }
    if (l === c) { out[k] = l; continue; }
    if (DEVICE_KEYS.has(k) || FLAG_KEYS.has(k) || DATED.some((d) => d.kind === "first" && k.startsWith(d.prefix)) || k.startsWith(WEEKLY)) out[k] = l;
    else if (MAX_KEYS.has(k) || k.startsWith(`${P}daily.`)) out[k] = String(Math.max(num(l), num(c)));
    else if (k === `${P}wallet`) out[k] = JSON.stringify(mergeWallet(parseWallet(json(base[k])), parseWallet(json(l)), parseWallet(json(c))));
    else if (k === `${P}stats`) out[k] = JSON.stringify(mergeStats(obj(json(base[k])), obj(json(l)), obj(json(c))));
    else if (k === `${P}journey`) out[k] = JSON.stringify(mergeJourney(obj(json(l)), obj(json(c))));
    else if (k === `${P}badges`) {
      const arr = (s: string): string[] => { const v = json(s); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; };
      out[k] = JSON.stringify([...new Set([...arr(c), ...arr(l)])]);
    } else if (k === `${P}streak`) out[k] = JSON.stringify(mergeStreak(obj(json(l)), obj(json(c))));
    else out[k] = l;
  }
  // Journey levels cleared is a count of levels with stars, not a sum of two devices' counts.
  const j = obj(json(out[`${P}journey`]));
  const st = json(out[`${P}stats`]);
  if (st && typeof st === "object" && out[`${P}journey`] !== undefined) {
    out[`${P}stats`] = JSON.stringify({ ...(st as Obj), levels: Object.keys(obj(j.stars)).length });
  }
  return out;
}
