import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSave, signInGoogle, signInNativeGoogle, signinFromEnv, startNativeGoogle, type SigninConfig } from "./signin";
import { MemoryStore } from "./store";

const NOW = new Date("2026-11-17T12:00:00Z");
const WEB = "100-website.apps.googleusercontent.com", NATIVE_WEB = "200-server.apps.googleusercontent.com";
const ANDROID = "200-android.apps.googleusercontent.com", IOS = "200-ios.apps.googleusercontent.com";
const PLAYER = "a".repeat(24), OTHER = "b".repeat(24);
const cfg: SigninConfig = { secret: "s".repeat(32), mailer: null, googleClientId: WEB,
  googleNative: { webClientId: NATIVE_WEB, androidClientIds: [ANDROID], iosClientId: IOS } };
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "native-key", alg: "RS256" };
const keys = async () => ({ keys: [jwk] });
const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");
function token(nonce: string, claims: Record<string, unknown> = {}, key = privateKey): string {
  const h = b64({ alg: "RS256", kid: "native-key" });
  const b = b64({ iss: "https://accounts.google.com", aud: NATIVE_WEB, azp: ANDROID, nonce,
    exp: NOW.getTime() / 1000 + 600, sub: "123456789", email: "ada@example.com", email_verified: true, ...claims });
  return `${h}.${b}.${sign("RSA-SHA256", Buffer.from(`${h}.${b}`), key).toString("base64url")}`;
}
async function challenge(store: MemoryStore, platform = "android"): Promise<string> {
  const response = await startNativeGoogle(store, cfg, { player: PLAYER, platform }, NOW);
  expect(response.status).toBe(200);
  expect(response.body.nonce).toMatch(/^[a-f0-9]{64}$/);
  return response.body.nonce as string;
}
const finish = (store: MemoryStore, nonce: string, claims = {}, now = NOW, player = PLAYER) =>
  signInNativeGoogle(store, cfg, { player, nonce, credential: token(nonce, claims) }, now, keys);

describe("native Google authentication", () => {
  it("stays disabled until explicitly configured and preserves the separate website client", () => {
    const env = { AUTH_SECRET: cfg.secret, GOOGLE_CLIENT_ID: WEB, GOOGLE_NATIVE_WEB_CLIENT_ID: NATIVE_WEB,
      GOOGLE_ANDROID_CLIENT_IDS: `${ANDROID},not-a-client`, GOOGLE_IOS_CLIENT_ID: IOS };
    expect(signinFromEnv(env)?.googleNative).toBeUndefined();
    expect(signinFromEnv({ ...env, GOOGLE_NATIVE_ENABLED: "1" })).toMatchObject({ googleClientId: WEB,
      googleNative: { webClientId: NATIVE_WEB, androidClientIds: [ANDROID], iosClientId: IOS } });
    expect(signinFromEnv({ ...env, GOOGLE_NATIVE_WEB_CLIENT_ID: "", GOOGLE_NATIVE_ENABLED: "1" })?.googleNative).toBeUndefined();
  });
  it("requires a configured platform and valid player before issuing a nonce", async () => {
    const store = new MemoryStore();
    expect((await startNativeGoogle(store, { ...cfg, googleNative: undefined }, { player: PLAYER, platform: "android" }, NOW)).status).toBe(503);
    expect((await startNativeGoogle(store, cfg, { player: "bad", platform: "android" }, NOW)).status).toBe(400);
    expect((await startNativeGoogle(store, cfg, { player: PLAYER, platform: "web" }, NOW)).status).toBe(400);
    expect((await startNativeGoogle(store, { ...cfg, googleNative: { ...cfg.googleNative!, androidClientIds: [] } },
      { player: PLAYER, platform: "android" }, NOW)).status).toBe(503);
  });
  it("links Android to the existing verified Google identity and cloud-save path", async () => {
    const store = new MemoryStore(), nonce = await challenge(store);
    const response = await finish(store, nonce);
    expect(response.status).toBe(200);
    expect(response.body.methods).toEqual({ google: "ad***@example.com" });
    expect((await getSave(store, response.body.player)).status).toBe(200);
    const iosNonce = await challenge(store, "ios");
    const ios = await finish(store, iosNonce, { aud: IOS, azp: IOS });
    expect(ios.body.player).toBe(response.body.player);
  });
  it("rejects unauthorized audiences, presenters, issuers, missing nonces and expired tokens", async () => {
    const store = new MemoryStore(), nonce = await challenge(store);
    for (const claims of [{ aud: "evil" }, { aud: IOS }, { azp: "other-app" }, { iss: "evil" }, { nonce: undefined },
      { exp: NOW.getTime() / 1000 }, { exp: "never" }, { sub: "not-a-google-sub" }])
      expect((await finish(store, nonce, claims)).status).toBe(401);
    const forged = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect((await signInNativeGoogle(store, cfg, { player: PLAYER, nonce, credential: token(nonce, {}, forged) }, NOW, keys)).status).toBe(401);
    expect((await finish(store, nonce)).status).toBe(200);
  });
  it("binds nonce to player and expires it after five minutes", async () => {
    const store = new MemoryStore(), nonce = await challenge(store);
    expect((await finish(store, nonce, {}, NOW, OTHER)).status).toBe(401);
    expect((await finish(store, nonce, {}, new Date(NOW.getTime() + 300_000))).status).toBe(401);
  });
  it("consumes a nonce once, including simultaneous completion attempts", async () => {
    const store = new MemoryStore(), nonce = await challenge(store);
    const results = await Promise.all([finish(store, nonce), finish(store, nonce)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    expect((await finish(store, nonce)).status).toBe(401);
    const values = await Promise.all(store.allKeys().map(key => store.get(key)));
    expect(JSON.stringify(values)).not.toContain(token(nonce));
    expect(JSON.stringify(values)).not.toContain(nonce);
  });
  it("does not let a nonce-bearing native credential bypass verification through the web login step", async () => {
    const store = new MemoryStore(), nonce = await challenge(store);
    const sameProject = { ...cfg, googleClientId: NATIVE_WEB };
    expect((await signInGoogle(store, sameProject, { player: PLAYER, credential: token(nonce) }, NOW, keys)).status).toBe(401);
    expect((await signInGoogle(store, cfg, { player: PLAYER, credential: token(nonce, { aud: WEB, nonce: undefined }) }, NOW, keys)).status).toBe(200);
  });
  it("does not treat a string email_verified claim as verified", async () => {
    const store = new MemoryStore(), nonce = await challenge(store);
    const result = await finish(store, nonce, { email_verified: "false" });
    expect(result.status).toBe(200);
    expect(result.body.methods).toEqual({ google: "Google account" });
  });
});
