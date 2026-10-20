import { describe, expect, it } from "vitest";
import { PaystackHttp, allowedCurrencies, paystackFromEnv } from "./paystack.js";

type Call = { url: string; init: RequestInit };
function mock(response: unknown, ok = true): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(response), { status: ok ? 200 : 400 }); }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const args = { email: "a@b.co", amount: 80_000, currency: "NGN", reference: "bp_" + "a".repeat(24), callbackUrl: "https://g.test/?shop=return", metadata: { player: "p", sku: "effect_pack" } };

describe("PaystackHttp.initialize", () => {
  it("posts the order with the secret key and returns the checkout address", async () => {
    const m = mock({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } });
    const r = await new PaystackHttp("sk_test_123", m.fetch).initialize(args);
    expect(r.url).toBe("https://checkout.paystack.com/abc");
    expect(m.calls[0]!.url).toBe("https://api.paystack.co/transaction/initialize");
    expect((m.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_123");
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({ email: "a@b.co", amount: 80_000, currency: "NGN", reference: args.reference, callback_url: args.callbackUrl, metadata: args.metadata });
  });
  it("throws when Paystack refuses", async () => {
    await expect(new PaystackHttp("k", mock({ status: false, message: "Invalid key" }, false).fetch).initialize(args)).rejects.toThrow(/Invalid key/);
    await expect(new PaystackHttp("k", mock({ status: true, data: {} }).fetch).initialize(args)).rejects.toThrow();
  });
});

describe("PaystackHttp.verify", () => {
  it("reads the transaction's status, amount, currency and metadata", async () => {
    const m = mock({ status: true, data: { status: "success", amount: 80_000, currency: "NGN", reference: args.reference, metadata: { player: "p", sku: "effect_pack" }, extra: "ignored" } });
    const v = await new PaystackHttp("k", m.fetch).verify(args.reference);
    expect(v).toEqual({ status: "success", amount: 80_000, currency: "NGN", reference: args.reference, metadata: { player: "p", sku: "effect_pack" } });
    expect(m.calls[0]!.url).toBe(`https://api.paystack.co/transaction/verify/${args.reference}`);
  });
  it("is null when Paystack does not know it, errors, or the network fails", async () => {
    expect(await new PaystackHttp("k", mock({ status: false }, false).fetch).verify("x")).toBeNull();
    expect(await new PaystackHttp("k", mock({ status: true }).fetch).verify("x")).toBeNull();
    expect(await new PaystackHttp("k", (async () => { throw new Error("offline"); }) as unknown as typeof fetch).verify("x")).toBeNull();
  });
  it("escapes the reference it puts in the address", async () => {
    const m = mock({ status: false }, false);
    await new PaystackHttp("k", m.fetch).verify("a/../b?x=1");
    expect(m.calls[0]!.url).toBe("https://api.paystack.co/transaction/verify/a%2F..%2Fb%3Fx%3D1");
  });
});

describe("configuration", () => {
  it("has no provider without a key, so the shop stays hidden", () => {
    expect(paystackFromEnv({})).toBeNull();
    expect(paystackFromEnv({ PAYSTACK_SECRET_KEY: "sk_live_x" })).toBeInstanceOf(PaystackHttp);
  });
  it("allows the fake provider locally but never on Vercel", () => {
    expect(paystackFromEnv({ PAYSTACK_FAKE: "1" })).not.toBeNull();
    expect(paystackFromEnv({ PAYSTACK_FAKE: "1", VERCEL: "1" })).toBeNull();
  });
  it("offers naira, and dollars only when switched on", () => {
    expect(allowedCurrencies({})).toEqual(["NGN"]);
    expect(allowedCurrencies({ PAYSTACK_USD: "1" })).toEqual(["NGN", "USD"]);
  });
});
