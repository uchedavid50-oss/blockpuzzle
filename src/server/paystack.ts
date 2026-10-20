// Paystack, behind a small interface so the purchase rules can be tested without the network.
// The real client talks to api.paystack.co with the secret key; the fake one is for tests and for
// `npm run dev:api`, and is refused on Vercel.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface InitArgs {
  email: string;
  amount: number; // minor units: kobo for NGN, cents for USD
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: { player: string; sku: string };
}

export interface Verified {
  status: string; // "success" when paid
  amount: number;
  currency: string;
  reference: string;
  metadata?: { player?: string; sku?: string };
}

export interface Paystack {
  initialize(a: InitArgs): Promise<{ url: string }>;
  /** null if Paystack could not be asked, or does not know the reference. */
  verify(reference: string): Promise<Verified | null>;
}

type Fetch = typeof fetch;

export class PaystackHttp implements Paystack {
  constructor(private secret: string, private doFetch: Fetch = fetch) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" };
  }

  async initialize(a: InitArgs): Promise<{ url: string }> {
    const res = await this.doFetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        email: a.email, amount: a.amount, currency: a.currency, reference: a.reference,
        callback_url: a.callbackUrl, metadata: a.metadata,
      }),
    });
    const d = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: { authorization_url?: string } } | null;
    if (!res.ok || !d?.status || !d.data?.authorization_url) throw new Error(`paystack initialize: ${d?.message ?? res.status}`);
    return { url: d.data.authorization_url };
  }

  async verify(reference: string): Promise<Verified | null> {
    try {
      const res = await this.doFetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: this.headers() });
      const d = (await res.json().catch(() => null)) as { status?: boolean; data?: Verified } | null;
      if (!res.ok || !d?.status || !d.data) return null;
      const { status, amount, currency, reference: ref, metadata } = d.data;
      return { status, amount, currency, reference: ref, metadata };
    } catch { return null; }
  }
}

/** In-memory stand-in: "paying" simply succeeds. Tests can tamper with what it reports. */
export class FakePaystack implements Paystack {
  readonly started = new Map<string, InitArgs>();
  /** Test hooks: change what verify reports for a reference. */
  override = new Map<string, Partial<Verified>>();
  unreachable = false;

  async initialize(a: InitArgs): Promise<{ url: string }> {
    this.started.set(a.reference, a);
    const sep = a.callbackUrl.includes("?") ? "&" : "?";
    return { url: `${a.callbackUrl}${sep}reference=${a.reference}&trxref=${a.reference}` }; // "the player paid" and came straight back
  }

  async verify(reference: string): Promise<Verified | null> {
    if (this.unreachable) return null;
    const a = this.started.get(reference);
    if (!a) return null;
    return { status: "success", amount: a.amount, currency: a.currency, reference, metadata: a.metadata, ...this.override.get(reference) };
  }
}

export const allowedCurrencies = (env: Record<string, string | undefined> = process.env): readonly string[] =>
  env.PAYSTACK_USD === "1" ? ["NGN", "USD"] : ["NGN"];

let fake: FakePaystack | null = null;
/** The configured provider, or null when payments are not set up (so the shop stays hidden). */
export function paystackFromEnv(env: Record<string, string | undefined> = process.env): Paystack | null {
  if (env.PAYSTACK_FAKE === "1" && !env.VERCEL) return (fake ??= new FakePaystack());
  return env.PAYSTACK_SECRET_KEY ? new PaystackHttp(env.PAYSTACK_SECRET_KEY) : null;
}

/** Paystack signs each webhook with an HMAC-SHA512 of the raw body, keyed by the secret key. */
export function signatureOk(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
