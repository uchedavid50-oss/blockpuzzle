import { Capacitor } from "@capacitor/core";

export const PRODUCTION_ORIGIN = "https://bunblocks.app";
// The apex domain redirects. Use the canonical host directly: preflights must not redirect.
export const PRODUCTION_API_ORIGIN = "https://www.bunblocks.app";
export const isNative = (): boolean => import.meta.env.MODE === "native" || Capacitor.isNativePlatform();
export const publicOrigin = (): string => isNative() ? PRODUCTION_ORIGIN : location.origin;

/** Native builds may only call this application's HTTPS API. Web keeps its same-origin proxy. */
export function apiUrl(path: string): string {
  if (!isNative()) return path;
  const url = new URL(path, PRODUCTION_API_ORIGIN);
  if (url.origin !== PRODUCTION_API_ORIGIN || !url.pathname.startsWith("/api/"))
    throw new Error("Untrusted native API URL");
  return url.href;
}
