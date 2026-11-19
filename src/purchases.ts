import { Capacitor } from "@capacitor/core";
import type { PurchasesStoreProduct } from "@revenuecat/purchases-capacitor";
import { COIN_PACKS } from "./economy";
import { ALL_SKUS } from "./entitlements";
import { call, getPlayer, lb } from "./leaderboardClient";
import { isNative } from "./platform";

export type PurchaseResult = { ok: true } | { ok: false; message: string; pending?: true };

const catalogue = [...ALL_SKUS, ...COIN_PACKS.map((pack) => pack.id)];
const products = new Map<string, PurchasesStoreProduct>();
let configuredPlayer: string | undefined;
let busy = false;

export const webCheckoutAllowed = (): boolean => !isNative();
export const nativePrice = (sku: string): string | undefined => products.get(sku)?.priceString;

async function withStoreSdk(action: (sdk: typeof import("@revenuecat/purchases-capacitor")) => Promise<PurchaseResult>): Promise<PurchaseResult> {
  if (!Capacitor.isNativePlatform() || !lb.nativeShopKey) return { ok: false, message: "The store is unavailable." };
  if (busy) return { ok: false, message: "The store is busy. Please try again." };
  busy = true;
  try {
    const sdk = await import("@revenuecat/purchases-capacitor");
    const player = getPlayer().id;
    if (player !== configuredPlayer) {
      const response = await call("/api/native-shop", { method: "POST", headers: { "X-Player": player } });
      if (!response.ok) return { ok: false, message: "Could not connect your BunBlocks account to the store." };
      const data = await response.json() as { id?: unknown };
      if (typeof data.id !== "string" || getPlayer().id !== player)
        return { ok: false, message: "Reopen the shop to use your current account." };
      if (configuredPlayer) await sdk.Purchases.logIn({ appUserID: data.id });
      else await sdk.Purchases.configure({ apiKey: lb.nativeShopKey, appUserID: data.id });
      configuredPlayer = player;
    }
    if (getPlayer().id !== player) return { ok: false, message: "Reopen the shop to use your current account." };
    try {
      return await action(sdk);
    } catch (error) {
      const storeError = error as { code?: string; userCancelled?: boolean } | null;
      if (storeError?.userCancelled || String(storeError?.code) === sdk.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR)
        return { ok: false, message: "Purchase canceled." };
      if (String(storeError?.code) === sdk.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR)
        return { ok: false, pending: true, message: "Payment is pending. Your purchase will appear after the store approves it." };
      throw error;
    }
  } catch {
    return { ok: false, message: "Could not complete the store request. Please try again." };
  } finally {
    busy = false;
  }
}

export function loadNativeProducts(): Promise<PurchaseResult> {
  return withStoreSdk(async ({ Purchases, PRODUCT_CATEGORY }) => {
    const result = await Purchases.getProducts({ productIdentifiers: catalogue, type: PRODUCT_CATEGORY.NON_SUBSCRIPTION });
    products.clear();
    for (const product of result.products) products.set(product.identifier, product);
    return { ok: true };
  });
}

export const nativePurchases = {
  purchase(sku: string): Promise<PurchaseResult> {
    return withStoreSdk(async ({ Purchases }) => {
      const product = products.get(sku);
      if (!product) return { ok: false, message: "This item is currently unavailable in the store." };
      await Purchases.purchaseStoreProduct({ product });
      return { ok: true };
    });
  },
  restore(): Promise<PurchaseResult> {
    return withStoreSdk(async ({ Purchases }) => {
      await Purchases.restorePurchases();
      return { ok: true };
    });
  },
};
