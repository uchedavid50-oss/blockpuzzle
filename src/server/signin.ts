// Optional sign-in, so a player who loses or changes their phone keeps their progress and purchases.
// Playing never needs it. An account is still the same random player id; signing in only links an
// email address or a Google account to it, and lets that id keep a cloud save (cloudsave.ts).
//
// What is kept: for email, a keyed hash of the address (to find the account again) and a masked label
// such as "ad***@gmail.com" to show the player; for Google, Google's account number and the same kind
// of label. The address itself is used only to send the code and is never stored.
//
// Signing in on a device that has played as a guest moves that guest's purchases and coins into the
// account (accounts.ts `mergeAccount`) and retires the guest id, the same way a restore does.

import { createHmac, createPublicKey, timingSafeEqual, verify as rsaVerify } from "node:crypto";
import { cleanSnapshot } from "../cloudsave.js";
import { currentId, isRetired, mergeAccount, movedKey, saveKey, signinKey } from "./accounts.js";
import type { Reply } from "./handlers.js";
import { isPlayerId } from "./rules.js";
import type { Store } from "./store.js";

const DAY = 86_400;
const LINK_HOLD = 3650 * DAY;
const CODE_TTL = 600;
const MAX_TRIES = 5;
const CODES_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

// ---- Configuration ---------------------------------------------------------------------------

export interface Mailer { sendCode(to: string, code: string): Promise<void> }

/** Sends the code with Resend's HTTP API (no client library). */
export class ResendMailer implements Mailer {
  constructor(private key: string, private from: string, private doFetch: typeof fetch = fetch) {}
  async sendCode(to: string, code: string): Promise<void> {
    const res = await this.doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from, to: [to], subject: `${code} is your Bun Blocks code`,
        text: `Your Bun Blocks sign-in code is ${code}. It works for 10 minutes.\n\nIf you did not ask for it, ignore this email.`,
      }),
    });
    if (!res.ok) throw new Error(`resend: HTTP ${res.status}`);
  }
}

/** For tests and `npm run dev:api`: prints the code instead of emailing it. Refused on Vercel. */
export class FakeMailer implements Mailer {
  last: { to: string; code: string } | null = null;
  constructor(private log = true) {}
  async sendCode(to: string, code: string): Promise<void> {
    this.last = { to, code };
    if (this.log) console.log(`[sign-in] code for ${to}: ${code}`);
  }
}

export interface SigninConfig { secret: string; mailer: Mailer | null; googleClientId: string | null }

/** The shortest AUTH_SECRET accepted: it keys the email hashes, so it must not be guessable. */
export const MIN_AUTH_SECRET = 24;
let fakeMailer: FakeMailer | null = null;

/** Sign-in as configured, or null while AUTH_SECRET is missing (the game then hides sign-in). */
export function signinFromEnv(env: Record<string, string | undefined> = process.env): SigninConfig | null {
  const secret = env.AUTH_SECRET ?? "";
  if (secret.length < MIN_AUTH_SECRET) return null;
  let mailer: Mailer | null = null;
  if (env.RESEND_API_KEY && env.EMAIL_FROM) mailer = new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  else if (env.EMAIL_FAKE === "1" && !env.VERCEL) mailer = fakeMailer ??= new FakeMailer();
  const googleClientId = env.GOOGLE_CLIENT_ID || null;
  return mailer || googleClientId ? { secret, mailer, googleClientId } : null;
}

// ---- Linking an identity to an account ---------------------------------------------------------

export const identityKey = (id: string): string => `idn:${id}`;

const randomId = (): string => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

/** "adaeze@gmail.com" -> "ad***@gmail.com". Enough for the player to recognise, not to contact them. */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, Math.min(2, Math.max(1, user.length - 1)))}***@${domain}`;
}

/**
 * Signs `device` in as the account behind `identity`. A new identity becomes this device's account.
 * A known one brings this device into that account: anything bought as a guest here moves into it,
 * and the device switches to the account's id (returned as `player`).
 */
export async function linkIdentity(store: Store, identity: string, method: "email" | "google", label: string, device: unknown, now = new Date()): Promise<Reply> {
  if (!isPlayerId(device)) return reply(400, { error: "bad player" });
  // A retired id belongs to whoever restored it elsewhere: never link it, start this device afresh.
  const retired = await isRetired(store, device);
  const candidate = retired ? randomId() : device;
  if (await store.setNx(identityKey(identity), candidate, LINK_HOLD)) {
    await store.hset(signinKey(candidate), method, label);
    return reply(200, { player: candidate, label, created: true, methods: await methodsOf(store, candidate) });
  }
  const linked = await store.get(identityKey(identity));
  if (!linked) return reply(503, { error: "try again" });
  const account = await currentId(store, linked);
  if (account !== device && !retired && (await store.setNx(movedKey(device), account, LINK_HOLD))) await mergeAccount(store, device, account, now);
  await store.hset(signinKey(account), method, label);
  return reply(200, { player: account, label, created: false, methods: await methodsOf(store, account) });
}

async function methodsOf(store: Store, player: string): Promise<Record<string, string>> {
  const methods = await store.hkeys(signinKey(player));
  const labels = await store.hmget(signinKey(player), methods);
  return Object.fromEntries(methods.map((m, i) => [m, labels[i] ?? ""]));
}

export const isSignedIn = async (store: Store, player: string): Promise<boolean> => (await store.hkeys(signinKey(player))).length > 0;

// ---- Email: a six-digit code ------------------------------------------------------------------

const hmac = (secret: string, s: string): string => createHmac("sha256", secret).update(s).digest("hex");
const cleanEmail = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
};
const sixDigits = (): string => {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(b[0]! % 1_000_000).padStart(6, "0");
};
const otpKey = (h: string): string => `otp:${h}`;
async function readOtp(store: Store, h: string): Promise<{ code: string; tries: number } | null> {
  try { return JSON.parse((await store.get(otpKey(h))) ?? "null") as { code: string; tries: number } | null; } catch { return null; }
}

/** Emails a sign-in code. A new code replaces the last one; a few per address per hour. */
export async function startEmail(store: Store, cfg: SigninConfig, body: unknown, now = new Date()): Promise<Reply> {
  if (!cfg.mailer) return reply(503, { error: "email sign-in is not available" });
  const email = cleanEmail((body as { email?: unknown } | null)?.email);
  if (!email) return reply(400, { error: "bad email", message: "That email address does not look right." });
  const h = hmac(cfg.secret, email);
  const hourKey = `otpn:${h}:${Math.floor(now.getTime() / 3_600_000)}`;
  const n = await store.incr(hourKey);
  if (n === 1) await store.expire(hourKey, 7200);
  if (n > CODES_PER_HOUR) return reply(429, { error: "too many codes", message: "Too many codes for that address. Try again in an hour." });
  const code = sixDigits();
  await store.set(otpKey(h), JSON.stringify({ code: hmac(cfg.secret, `code:${h}:${code}`), tries: 0 }));
  await store.expire(otpKey(h), CODE_TTL);
  try { await cfg.mailer.sendCode(email, code); } catch (err) {
    console.error("sign-in email error", err);
    return reply(502, { error: "could not send", message: "Could not send the email right now. Try again in a minute." });
  }
  return reply(200, { ok: true });
}

/** Checks the code and signs the device in. Each code allows a few wrong guesses, then must be resent. */
export async function verifyEmail(store: Store, cfg: SigninConfig, body: unknown, now = new Date()): Promise<Reply> {
  const b = (body ?? {}) as { email?: unknown; code?: unknown; player?: unknown };
  const email = cleanEmail(b.email);
  if (!email || typeof b.code !== "string" || !/^\d{6}$/.test(b.code.trim())) return reply(400, { error: "bad code", message: "Enter the 6-digit code from the email." });
  const h = hmac(cfg.secret, email);
  const otp = await readOtp(store, h);
  if (!otp) return reply(400, { error: "expired", message: "That code has expired. Send a new one." });
  if (otp.tries >= MAX_TRIES) { await store.del(otpKey(h)); return reply(429, { error: "too many tries", message: "Too many wrong codes. Send a new one." }); }
  const given = Buffer.from(hmac(cfg.secret, `code:${h}:${b.code.trim()}`));
  if (!timingSafeEqual(given, Buffer.from(otp.code))) {
    await store.set(otpKey(h), JSON.stringify({ ...otp, tries: otp.tries + 1 }));
    await store.expire(otpKey(h), CODE_TTL);
    return reply(400, { error: "wrong code", message: "That code is not right. Check the email and try again." });
  }
  await store.del(otpKey(h)); // a code works once
  return linkIdentity(store, `e:${h}`, "email", maskEmail(email), b.player, now);
}

// ---- Google: an ID token from Google's sign-in button -------------------------------------------

type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string };
type Jwks = { keys: Jwk[] };
let jwksCache: { at: number; jwks: Jwks } | null = null;

async function googleKeys(doFetch: typeof fetch, nowMs: number): Promise<Jwks> {
  if (jwksCache && nowMs - jwksCache.at < 3_600_000) return jwksCache.jwks;
  const res = await doFetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!res.ok) throw new Error(`google certs: HTTP ${res.status}`);
  const jwks = (await res.json()) as Jwks;
  jwksCache = { at: nowMs, jwks };
  return jwks;
}

const b64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Checks a Google ID token's signature and claims. Returns its account number and email, or null. */
export async function verifyGoogleToken(token: unknown, clientId: string, now = new Date(), getKeys: (nowMs: number) => Promise<Jwks> = (ms) => googleKeys(fetch, ms)): Promise<{ sub: string; email: string | null } | null> {
  if (typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64url(parts[0]!).toString("utf8")) as { alg?: string; kid?: string };
    const claims = JSON.parse(b64url(parts[1]!).toString("utf8")) as { iss?: string; aud?: string; exp?: number; sub?: string; email?: string; email_verified?: boolean };
    if (header.alg !== "RS256") return null;
    const jwk = (await getKeys(now.getTime())).keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const ok = rsaVerify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), b64url(parts[2]!));
    if (!ok) return null;
    if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") return null;
    if (claims.aud !== clientId || typeof claims.exp !== "number" || claims.exp * 1000 < now.getTime()) return null;
    if (typeof claims.sub !== "string" || !/^\d{1,40}$/.test(claims.sub)) return null;
    return { sub: claims.sub, email: claims.email_verified && typeof claims.email === "string" ? claims.email.toLowerCase() : null };
  } catch { return null; }
}

export async function signInGoogle(store: Store, cfg: SigninConfig, body: unknown, now = new Date(), getKeys?: (nowMs: number) => Promise<Jwks>): Promise<Reply> {
  if (!cfg.googleClientId) return reply(503, { error: "google sign-in is not available" });
  const b = (body ?? {}) as { credential?: unknown; player?: unknown };
  const g = await verifyGoogleToken(b.credential, cfg.googleClientId, now, getKeys);
  if (!g) return reply(401, { error: "bad token", message: "Google sign-in did not work. Try again." });
  return linkIdentity(store, `g:${g.sub}`, "google", g.email ? maskEmail(g.email) : "Google account", b.player, now);
}

/** One route for every sign-in step, so they share one rate limit. */
export function signin(store: Store, cfg: SigninConfig, body: unknown, now = new Date()): Promise<Reply> {
  const step = (body as { step?: unknown } | null)?.step;
  if (step === "email-start") return startEmail(store, cfg, body, now);
  if (step === "email-verify") return verifyEmail(store, cfg, body, now);
  if (step === "google") return signInGoogle(store, cfg, body, now);
  return Promise.resolve(reply(400, { error: "bad step" }));
}

// ---- The cloud save ---------------------------------------------------------------------------
// Kept only for signed-in accounts. Written with a version number: a write based on an older version
// is refused (409), and the device merges the newer save and tries again, so no device's progress is lost.

interface Saved { v: number; data: Record<string, string>; at: string }

async function readSave(store: Store, player: string): Promise<Saved | null> {
  try { return JSON.parse((await store.get(saveKey(player))) ?? "null") as Saved | null; } catch { return null; }
}

export async function getSave(store: Store, player: unknown): Promise<Reply> {
  if (!isPlayerId(player)) return reply(400, { error: "bad player" });
  if (await isRetired(store, player)) return reply(410, { error: "moved" });
  if (!(await isSignedIn(store, player))) return reply(403, { error: "not signed in" });
  const s = await readSave(store, player);
  return reply(200, { version: s?.v ?? 0, data: s?.data ?? null, methods: await methodsOf(store, player) });
}

export async function putSave(store: Store, body: unknown, now = new Date()): Promise<Reply> {
  const b = (body ?? {}) as { player?: unknown; version?: unknown; data?: unknown };
  if (!isPlayerId(b.player)) return reply(400, { error: "bad player" });
  if (typeof b.version !== "number" || !Number.isInteger(b.version) || b.version < 0) return reply(400, { error: "bad version" });
  const data = cleanSnapshot(b.data);
  if (!data) return reply(400, { error: "bad save" });
  if (await isRetired(store, b.player)) return reply(410, { error: "moved" });
  if (!(await isSignedIn(store, b.player))) return reply(403, { error: "not signed in" });
  const cur = (await readSave(store, b.player))?.v ?? 0;
  // Of two writes based on the same version, only the first claims the next one.
  if (b.version !== cur || !(await store.setNx(`savelock:${b.player}:${cur + 1}`, "1", 600))) return reply(409, { error: "stale", version: cur });
  await store.set(saveKey(b.player), JSON.stringify({ v: cur + 1, data, at: now.toISOString() } satisfies Saved));
  return reply(200, { ok: true, version: cur + 1 });
}
