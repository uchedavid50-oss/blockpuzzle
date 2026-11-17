import { Capacitor } from "@capacitor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeGoogleAvailable, nativeGoogleCredential, parseNativeGoogleConfig, type NativeGoogleConfig } from "./nativeGoogle";
const sdk = vi.hoisted(() => ({ initialize: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock("@capgo/capacitor-social-login", () => ({ SocialLogin: sdk }));
let count = 0;
let config: NativeGoogleConfig;
const nonce = "a".repeat(64);
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  vi.spyOn(Capacitor, "isPluginAvailable").mockReturnValue(true);
  sdk.initialize.mockResolvedValue(undefined); sdk.logout.mockResolvedValue(undefined);
  config = { webClientId: `123-server${++count}.apps.googleusercontent.com`, android: true,
    iosClientId: "123-ios.apps.googleusercontent.com" };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("native Google bridge", () => {
  it("validates public configuration and requires a real native plugin", () => {
    expect(parseNativeGoogleConfig({ webClientId: "bad" })).toBeNull();
    expect(parseNativeGoogleConfig(config)).toEqual(config);
    expect(nativeGoogleAvailable(config)).toBe(true);
    vi.spyOn(Capacitor, "isPluginAvailable").mockReturnValue(false);
    expect(nativeGoogleAvailable(config)).toBe(false);
  });
  it("does not initialize the native SDK in a browser or with an invalid nonce", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    expect(nativeGoogleAvailable(config)).toBe(false);
    expect(await nativeGoogleCredential(config, nonce)).toHaveProperty("error");
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    expect(await nativeGoogleCredential(config, "unbound")).toHaveProperty("error");
    expect(sdk.login).not.toHaveBeenCalled();
  });
  it("requires iOS runtime configuration to match the callback compiled into the build", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
    expect(nativeGoogleAvailable(config)).toBe(false);
    vi.stubEnv("VITE_GOOGLE_IOS_CLIENT_ID", config.iosClientId!);
    expect(nativeGoogleAvailable(config)).toBe(true);
    vi.stubEnv("VITE_GOOGLE_IOS_CLIENT_ID", "123-other.apps.googleusercontent.com");
    expect(nativeGoogleAvailable(config)).toBe(false);
  });
  it("uses a fresh server nonce and only returns the ID token for backend verification", async () => {
    sdk.login.mockResolvedValue({ provider: "google", result: { responseType: "online", idToken: "signed-id-token", accessToken: "never-forward-this" } });
    expect(await nativeGoogleCredential(config, nonce)).toEqual({ credential: "signed-id-token" });
    expect(sdk.login).toHaveBeenCalledWith({ provider: "google", options: { nonce, scopes: ["openid", "email", "profile"], forcePrompt: true } });
    expect(sdk.initialize).toHaveBeenCalledWith({ google: expect.objectContaining({ webClientId: config.webClientId,
      iOSServerClientId: config.webClientId, mode: "online", skipAuthOnlyAuthorizationAfterSignIn: true }) });
    expect(sdk.logout).toHaveBeenCalledWith({ provider: "google" });
  });
  it("handles cancellation, missing tokens and SDK failures without inventing sign-in success", async () => {
    sdk.login.mockRejectedValueOnce({ code: "CANCELED" });
    expect(await nativeGoogleCredential(config, nonce)).toEqual({ cancelled: true });
    sdk.login.mockResolvedValueOnce({ provider: "google", result: { responseType: "online", idToken: null } });
    expect(await nativeGoogleCredential(config, nonce)).toHaveProperty("error");
    sdk.login.mockRejectedValueOnce(new Error("network down"));
    expect(await nativeGoogleCredential(config, nonce)).toHaveProperty("error");
    expect(sdk.logout).toHaveBeenCalledTimes(3);
  });
});
