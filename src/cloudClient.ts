// The game's side of sign-in and the cloud save. The merge rules are in cloudsave.ts (pure, tested);
// this reads and writes localStorage and talks to /api/signin and /api/save. Like the rest of the
// online features it fails soft: offline, the game plays on and syncs next time.

import { mergeSnapshots, snapshotOf, type Snapshot } from "./cloudsave.js";
import { reloadWallet } from "./coins.js";
import { BADGES_KEY, STATS_KEY, blankStats, stats, today, unlocked } from "./progress.js";
import { call, getPlayer, lb, resetPlayer, setPlayerId } from "./leaderboardClient.js";

const ACCOUNT_KEY = "blockpuzzle.account";
/** The save this device and the server last agreed on: the base of the next three-way merge. */
const BASE_KEY = "blockpuzzle.syncBase";
const MIN_GAP_MS = 60_000;

export interface Account { label: string; methods: Record<string, string>; needsSignIn?: boolean }

export function account(): Account | null {
  try {
    const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null") as Account | null;
    return a && typeof a.label === "string" ? a : null;
  } catch { return null; }
}
const setAccount = (a: Account | null): void => {
  try { if (a) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a)); else localStorage.removeItem(ACCOUNT_KEY); } catch { /* ignore */ }
};
export const signedIn = (): boolean => { const a = account(); return !!a && !a.needsSignIn; };
export const signinOffered = (): boolean => lb.available && (lb.signin.email || !!lb.signin.google);

function readAll(): Snapshot {
  const out: Snapshot = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out[k] = localStorage.getItem(k) ?? "";
    }
  } catch { /* storage blocked */ }
  return snapshotOf(out, today());
}
function readBase(): Snapshot {
  try { const b = JSON.parse(localStorage.getItem(BASE_KEY) ?? "{}") as unknown; return b && typeof b === "object" ? (b as Snapshot) : {}; } catch { return {}; }
}

/** Writes merged values to storage, and into the modules that keep them in memory. */
function apply(s: Snapshot, before: Snapshot): void {
  let changed = false;
  for (const [k, v] of Object.entries(s)) {
    if (before[k] === v) continue;
    try { localStorage.setItem(k, v); changed = true; } catch { /* ignore */ }
  }
  if (!changed) return;
  reloadWallet();
  try { Object.assign(stats, blankStats(), JSON.parse(localStorage.getItem(STATS_KEY) ?? "{}")); } catch { /* keep */ }
  try {
    const b = JSON.parse(localStorage.getItem(BADGES_KEY) ?? "[]") as unknown;
    if (Array.isArray(b)) unlocked.splice(0, unlocked.length, ...b.filter((x): x is string => typeof x === "string"));
  } catch { /* keep */ }
}

async function send(path: string, init?: RequestInit): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await call(path, init);
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}
const post = (path: string, body: unknown, keepalive = false) =>
  send(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive });

/** This account was moved to another device by a restore code: sign in again to rejoin it. */
export function lostAccount(): void {
  const a = account();
  if (a) setAccount({ ...a, needsSignIn: true });
  resetPlayer();
}

let syncing: Promise<boolean> | null = null;
let lastSync = 0;

/**
 * Merges this device's progress with the account's and saves the result to both. Returns true when
 * the two agree afterwards. `force` skips the once-a-minute limit.
 */
export function syncNow(force = false, keepalive = false): Promise<boolean> {
  if (!signedIn() || !lb.available) return Promise.resolve(false);
  if (syncing) return syncing;
  if (!force && Date.now() - lastSync < MIN_GAP_MS) return Promise.resolve(true);
  syncing = (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const player = getPlayer().id;
        const got = await send("/api/save", { headers: { "X-Player": player } });
        if (got.status === 410) { lostAccount(); return false; }
        if (got.status !== 200) return false;
        const local = readAll();
        const base = readBase();
        const cloud = (got.data.data && typeof got.data.data === "object" ? got.data.data : {}) as Snapshot;
        const merged = mergeSnapshots(base, local, cloud);
        const put = await post("/api/save", { player, version: got.data.version, data: merged }, keepalive);
        if (put.status === 409) continue; // another device saved first: merge with theirs and try again
        if (put.status === 410) { lostAccount(); return false; }
        if (put.status !== 200) return false;
        // Anything played while the request was out is kept, and goes up with the next sync.
        const now = readAll();
        apply(mergeSnapshots(local, now, merged), now);
        try { localStorage.setItem(BASE_KEY, JSON.stringify(merged)); } catch { /* next sync re-merges */ }
        lastSync = Date.now();
        return true;
      }
      return false;
    } catch { return false; } finally { syncing = null; }
  })();
  return syncing;
}

export type SigninResult = { ok: true } | { ok: false; message: string };

async function finishSignIn(status: number, data: Record<string, unknown>): Promise<SigninResult> {
  if (status !== 200 || typeof data.player !== "string") return { ok: false, message: typeof data.message === "string" ? data.message : "Could not sign in right now. Try again later." };
  if (!setPlayerId(data.player)) return { ok: false, message: "This device cannot save your sign-in (storage is blocked)." };
  const methods = (data.methods && typeof data.methods === "object" ? data.methods : {}) as Record<string, string>;
  setAccount({ label: typeof data.label === "string" ? data.label : "your account", methods });
  await syncNow(true);
  return { ok: true };
}

/** After a restore code brought an account here: if it is a signed-in account, this device is signed in too. */
export async function adoptAccount(): Promise<void> {
  try {
    const { status, data } = await send("/api/save", { headers: { "X-Player": getPlayer().id } });
    const methods = (data.methods && typeof data.methods === "object" ? data.methods : null) as Record<string, string> | null;
    if (status !== 200 || !methods) return;
    setAccount({ label: Object.values(methods)[0] ?? "your account", methods });
    await syncNow(true);
  } catch { /* stays a guest until signed in */ }
}

export async function sendEmailCode(email: string): Promise<SigninResult> {
  try {
    const { status, data } = await post("/api/signin", { step: "email-start", email });
    return status === 200 ? { ok: true } : { ok: false, message: typeof data.message === "string" ? data.message : "Could not send the code right now." };
  } catch { return { ok: false, message: "Could not connect. Check your internet and try again." }; }
}

export async function verifyEmailCode(email: string, code: string): Promise<SigninResult> {
  try {
    const { status, data } = await post("/api/signin", { step: "email-verify", email, code, player: getPlayer().id });
    return await finishSignIn(status, data);
  } catch { return { ok: false, message: "Could not connect. Check your internet and try again." }; }
}

export async function signInWithGoogle(credential: string): Promise<SigninResult> {
  try {
    const { status, data } = await post("/api/signin", { step: "google", credential, player: getPlayer().id });
    return await finishSignIn(status, data);
  } catch { return { ok: false, message: "Could not connect. Check your internet and try again." }; }
}

/**
 * Signs this device out. Progress is saved to the account first; if that fails the player stays
 * signed in, so nothing is lost. Afterwards the device starts fresh as a guest.
 */
export async function signOut(): Promise<SigninResult> {
  if (!(await syncNow(true))) return { ok: false, message: "Could not save your progress first. Check your internet and try again." };
  // The account's progress leaves with it; this device's own preferences (theme, sound, settings) stay.
  const keep = new Set(["blockpuzzle.theme", "blockpuzzle.settings", "blockpuzzle.muted"]);
  const drop = [...Object.keys(readAll()).filter((k) => !keep.has(k)), BASE_KEY, ACCOUNT_KEY, "blockpuzzle.entitlements", "blockpuzzle.save", "blockpuzzle.coinClaim"];
  try { for (const k of drop) localStorage.removeItem(k); } catch { /* ignore */ }
  resetPlayer();
  return { ok: true };
}

// ---- When to sync and when to suggest signing in -------------------------------------------

/** Starts background syncing: now, every few minutes while open, and whenever the game is hidden. */
export function startCloudSync(): void {
  void syncNow(true);
  setInterval(() => { if (!document.hidden) void syncNow(); }, 3 * MIN_GAP_MS);
  document.addEventListener("visibilitychange", () => { if (document.hidden) void syncNow(true, true); });
}

const ASKED_KEY = (why: string): string => `blockpuzzle.signinAsked.${why}`;
/** True the first time a prompt for `why` should be shown (once each, and never when signed in). */
export function shouldPrompt(why: string): boolean {
  if (!signinOffered() || signedIn()) return false;
  try {
    if (localStorage.getItem(ASKED_KEY(why))) return false;
    localStorage.setItem(ASKED_KEY(why), "1");
    return true;
  } catch { return false; }
}
