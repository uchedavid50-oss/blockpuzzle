import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { entitlementsOf, isRetired, transferAccount } from "./accounts";
import { coinKey } from "./coins";
import { FakePaystack } from "./paystack";
import { getPayments } from "./payments";
import { confirmPurchase, startCheckout } from "./purchases";
import { FakeMailer, getSave, maskEmail, putSave, signin, signinFromEnv, verifyGoogleToken, type SigninConfig } from "./signin";
import { MemoryStore } from "./store";

const NOW = new Date("2026-10-27T12:00:00Z");
const id = (n: number): string => n.toString(16).padStart(24, "0");
const setup = () => {
  const store = new MemoryStore();
  const mailer = new FakeMailer(false);
  const cfg: SigninConfig = { secret: "s".repeat(32), mailer, googleClientId: null };
  return { store, mailer, cfg };
};
async function emailSignIn(s: ReturnType<typeof setup>, email: string, player: string): Promise<{ player: string; created: boolean }> {
  expect((await signin(s.store, s.cfg, { step: "email-start", email }, NOW)).status).toBe(200);
  const r = await signin(s.store, s.cfg, { step: "email-verify", email, code: s.mailer.last!.code, player }, NOW);
  expect(r.status).toBe(200);
  return r.body as { player: string; created: boolean };
}
async function buy(store: MemoryStore, player: string, sku: string): Promise<string> {
  const ps = new FakePaystack();
  const ref = (await startCheckout(store, ps, { player, sku }, "https://game.test", {})).body.reference as string;
  await confirmPurchase(store, ps, ref, NOW);
  return ref;
}

describe("email sign-in", () => {
  it("the first sign-in makes this device's id the account; another device joins it", async () => {
    const s = setup();
    expect(await emailSignIn(s, "Ada@Example.com ", id(1))).toMatchObject({ player: id(1), created: true });
    expect(await emailSignIn(s, "ada@example.com", id(2))).toMatchObject({ player: id(1), created: false });
  });

  it("never stores the address, only a keyed hash and a masked label", async () => {
    const s = setup();
    await emailSignIn(s, "adaeze@gmail.com", id(1));
    const dump = s.store.allKeys().join(" ") + JSON.stringify(await s.store.hmget(`signin:${id(1)}`, ["email"]));
    expect(dump).not.toContain("adaeze@");
    expect(maskEmail("adaeze@gmail.com")).toBe("ad***@gmail.com");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
  });

  it("a wrong code is refused, a code works once, and guessing is capped", async () => {
    const s = setup();
    await signin(s.store, s.cfg, { step: "email-start", email: "a@b.co" }, NOW);
    const code = s.mailer.last!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await signin(s.store, s.cfg, { step: "email-verify", email: "a@b.co", code: wrong, player: id(1) })).status).toBe(400);
    // the right code no longer helps once the tries are used up
    expect((await signin(s.store, s.cfg, { step: "email-verify", email: "a@b.co", code, player: id(1) })).status).toBe(429);
    await signin(s.store, s.cfg, { step: "email-start", email: "a@b.co" }, NOW);
    const fresh = s.mailer.last!.code;
    expect((await signin(s.store, s.cfg, { step: "email-verify", email: "a@b.co", code: fresh, player: id(1) })).status).toBe(200);
    expect((await signin(s.store, s.cfg, { step: "email-verify", email: "a@b.co", code: fresh, player: id(1) })).status).toBe(400);
  });

  it("limits how many codes one address can be sent in an hour", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) expect((await signin(s.store, s.cfg, { step: "email-start", email: "a@b.co" }, NOW)).status).toBe(200);
    expect((await signin(s.store, s.cfg, { step: "email-start", email: "a@b.co" }, NOW)).status).toBe(429);
  });

  it("joining an account brings the guest's purchases, coins and payments along, and retires the guest id", async () => {
    const s = setup();
    await emailSignIn(s, "a@b.co", id(1));
    const ref = await buy(s.store, id(2), "effect_pack");
    await buy(s.store, id(2), "coins_small");
    await emailSignIn(s, "a@b.co", id(2));
    expect((await entitlementsOf(s.store, id(1))).owned).toContain("effect_pack");
    expect((await s.store.mcount([coinKey(id(1))]))[0]).toBe(300);
    expect(await isRetired(s.store, id(2))).toBe(true);
    expect((await getPayments(s.store, { player: id(1) })).body.payments).toEqual(expect.arrayContaining([expect.objectContaining({ reference: ref })]));
  });

  it("a retired id is never linked: that device gets a fresh account", async () => {
    const s = setup();
    await transferAccount(s.store, { player: id(1) }, NOW);
    const r = await emailSignIn(s, "a@b.co", id(1));
    expect(r.player).not.toBe(id(1));
    expect(r.created).toBe(true);
  });

  it("an account moved by a restore code is still found by signing in", async () => {
    const s = setup();
    await emailSignIn(s, "a@b.co", id(1));
    const fresh = (await transferAccount(s.store, { player: id(1) }, NOW)).body.player as string;
    expect((await emailSignIn(s, "a@b.co", id(3))).player).toBe(fresh);
  });

  it("stays off without a long enough AUTH_SECRET, and the fake mailer is refused on Vercel", () => {
    expect(signinFromEnv({ AUTH_SECRET: "short", EMAIL_FAKE: "1" })).toBeNull();
    expect(signinFromEnv({ AUTH_SECRET: "x".repeat(24), EMAIL_FAKE: "1", VERCEL: "1" })).toBeNull();
    expect(signinFromEnv({ AUTH_SECRET: "x".repeat(24), EMAIL_FAKE: "1" })?.mailer).toBeTruthy();
    expect(signinFromEnv({ AUTH_SECRET: "x".repeat(24), GOOGLE_CLIENT_ID: "abc", VERCEL: "1" })?.googleClientId).toBe("abc");
  });
});

describe("google sign-in", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
  const keys = async () => ({ keys: [jwk] });
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = (claims: Record<string, unknown>, key = privateKey): string => {
    const head = b64({ alg: "RS256", kid: "k1" });
    const body = b64({ iss: "https://accounts.google.com", aud: "client-1", exp: NOW.getTime() / 1000 + 600, sub: "1234567890", email: "Ada@Gmail.com", email_verified: true, ...claims });
    return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
  };

  it("accepts a token Google signed for this app", async () => {
    expect(await verifyGoogleToken(token({}), "client-1", NOW, keys)).toEqual({ sub: "1234567890", email: "ada@gmail.com" });
  });

  it("refuses another app's token, an expired one, a wrong issuer, or a forged signature", async () => {
    expect(await verifyGoogleToken(token({ aud: "client-2" }), "client-1", NOW, keys)).toBeNull();
    expect(await verifyGoogleToken(token({ exp: NOW.getTime() / 1000 - 1 }), "client-1", NOW, keys)).toBeNull();
    expect(await verifyGoogleToken(token({ iss: "evil.example" }), "client-1", NOW, keys)).toBeNull();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(await verifyGoogleToken(token({}, other), "client-1", NOW, keys)).toBeNull();
    expect(await verifyGoogleToken("not.a.token", "client-1", NOW, keys)).toBeNull();
  });
});

describe("cloud save", () => {
  const data = { "blockpuzzle.best": "900" };

  it("is only for signed-in accounts", async () => {
    const s = setup();
    expect((await putSave(s.store, { player: id(1), version: 0, data })).status).toBe(403);
    await emailSignIn(s, "a@b.co", id(1));
    expect((await putSave(s.store, { player: id(1), version: 0, data })).status).toBe(200);
    expect((await getSave(s.store, id(1))).body).toMatchObject({ version: 1, data });
  });

  it("refuses a write based on an old version, so a device merges before overwriting", async () => {
    const s = setup();
    await emailSignIn(s, "a@b.co", id(1));
    expect((await putSave(s.store, { player: id(1), version: 0, data })).status).toBe(200);
    const stale = await putSave(s.store, { player: id(1), version: 0, data: { "blockpuzzle.best": "5" } });
    expect(stale.status).toBe(409);
    expect(stale.body.version).toBe(1);
  });

  it("refuses keys that are not part of a save (ids, caches) and oversized saves", async () => {
    const s = setup();
    await emailSignIn(s, "a@b.co", id(1));
    expect((await putSave(s.store, { player: id(1), version: 0, data: { "blockpuzzle.player": "{}" } })).status).toBe(400);
    expect((await putSave(s.store, { player: id(1), version: 0, data: { "blockpuzzle.best": "x".repeat(200_000) } })).status).toBe(400);
  });

  it("moves with a restore, and a retired id can no longer read or write it", async () => {
    const s = setup();
    await emailSignIn(s, "a@b.co", id(1));
    await putSave(s.store, { player: id(1), version: 0, data });
    const fresh = (await transferAccount(s.store, { player: id(1) }, NOW)).body.player as string;
    expect((await getSave(s.store, fresh)).body.data).toEqual(data);
    expect((await getSave(s.store, id(1))).status).toBe(410);
  });
});
