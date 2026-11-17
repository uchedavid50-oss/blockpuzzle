import { Capacitor } from "@capacitor/core";
import { isNative } from "./platform";

export interface NativeGoogleConfig { webClientId: string; android: boolean; iosClientId: string | null }
const isClient = (v: unknown): v is string => typeof v === "string" && /^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(v);

export function parseNativeGoogleConfig(value: unknown): NativeGoogleConfig | null {
  const v = value as Partial<NativeGoogleConfig> | null;
  return v && isClient(v.webClientId) ? { webClientId: v.webClientId, android: v.android === true,
    iosClientId: isClient(v.iosClientId) ? v.iosClientId : null } : null;
}

export function nativeGoogleAvailable(config: NativeGoogleConfig | null): boolean {
  if (!config || !isNative() || !Capacitor.isPluginAvailable("SocialLogin")) return false;
  if (Capacitor.getPlatform() === "android") return config.android;
  return Capacitor.getPlatform() === "ios" && !!config.iosClientId && config.iosClientId === import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID;
}

let initialized: string | null = null;
export type NativeCredential = { credential: string } | { cancelled: true } | { error: string };

/** The SDK owns the OS account picker and OAuth callbacks. Trust only backend verification. */
export async function nativeGoogleCredential(config: NativeGoogleConfig, nonce: string): Promise<NativeCredential> {
  if (!nativeGoogleAvailable(config) || !/^[a-f0-9]{64}$/.test(nonce)) return { error: "Google sign-in is not configured for this build." };
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  try {
    const key = `${config.webClientId}:${config.iosClientId}`;
    if (initialized !== key) {
      await SocialLogin.initialize({ google: { webClientId: config.webClientId,
        ...(config.iosClientId ? { iOSClientId: config.iosClientId, iOSServerClientId: config.webClientId } : {}),
        mode: "online", skipAuthOnlyAuthorizationAfterSignIn: true } });
      initialized = key;
    }
    const response = await SocialLogin.login({ provider: "google", options: { nonce, scopes: ["openid", "email", "profile"], forcePrompt: true } });
    if (response.result.responseType !== "online" || typeof response.result.idToken !== "string" || !response.result.idToken)
      return { error: "Google did not return a sign-in token. Please try again." };
    return { credential: response.result.idToken };
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown };
    if (/cancel/i.test(String(e.code ?? "")) || /cancel/i.test(String(e.message ?? "")) || e.code === "12501") return { cancelled: true };
    return { error: "Google sign-in could not complete. Please check your connection and try again." };
  } finally {
    // Our verified account session is separate; clear temporary SDK tokens when possible.
    await SocialLogin.logout({ provider: "google" }).catch(() => {});
  }
}
