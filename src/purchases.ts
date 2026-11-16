import { Capacitor } from "@capacitor/core";
import { isNative } from "./platform";

export type PurchaseResult = { ok: false; message: string };
/** Future adapters must verify receipts server-side before granting any entitlement or coins. */
export interface NativePurchaseProvider {
  store: "apple" | "google";
  available: false;
  purchase(productId: string): Promise<PurchaseResult>;
  restore(): Promise<PurchaseResult>;
}
const unavailable = async (): Promise<PurchaseResult> => ({ ok: false, message: "Purchases are not available in this app yet." });
export const nativePurchases: NativePurchaseProvider = {
  store: Capacitor.getPlatform() === "ios" ? "apple" : "google",
  available: false, purchase: unavailable, restore: unavailable,
};
export const webCheckoutAllowed = (): boolean => !isNative();
