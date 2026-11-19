import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { packFor } from "../economy.js";
import { isSku } from "../entitlements.js";
import { currentId, isRetired, movedKey } from "./accounts.js";
import type { Reply } from "./handlers.js";
import { isPlayerId } from "./rules.js";
import type { Store } from "./store.js";

export interface NativePayment {
  player: string;
  sku: string;
  active: boolean;
  version: number;
  reversal?: boolean;
  coins?: number;
  transactionId?: string;
  platform?: "APP_STORE" | "PLAY_STORE";
}

export const nativeRefs = (player: string): string => `native-purchases:${player}`;

const stores = {
  APP_STORE: ["REVENUECAT_IOS_APP_ID", "REVENUECAT_IOS_PUBLIC_KEY", "appl_"],
  PLAY_STORE: ["REVENUECAT_ANDROID_APP_ID", "REVENUECAT_ANDROID_PUBLIC_KEY", "goog_"],
} as const;

function appConfig(store: keyof typeof stores) {
  const [idVar, keyVar, keyPrefix] = stores[store];
  const id = process.env[idVar];
  const key = process.env[keyVar];
  return id && key?.startsWith(keyPrefix) ? { id, key } : null;
}

export function nativeShop() {
  if (!process.env.REVENUECAT_WEBHOOK_AUTH || !process.env.REVENUECAT_ID_SECRET) return null;
  return { ios: appConfig("APP_STORE")?.key, android: appConfig("PLAY_STORE")?.key };
}

export function revenueCatAuthorized(header: string | null): boolean {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected || !header) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(expected));
}

export async function nativeIdentity(store: Store, player: unknown): Promise<Reply> {
  const secret = process.env.REVENUECAT_ID_SECRET;
  if (!secret || !nativeShop()) return { status: 503, body: { error: "native shop unavailable" } };
  if (!isPlayerId(player)) return { status: 400, body: { error: "bad player" } };
  if (await isRetired(store, player)) return { status: 410, body: { error: "moved" } };
  const id = "bun_" + createHmac("sha256", secret).update(player).digest("hex");
  await store.set(`native-user:${id}`, player);
  return { status: 200, body: { id } };
}

export async function nativePaymentEvent(store: Store, body: unknown): Promise<Reply> {
  const event = (body as { event?: Record<string, unknown> } | null)?.event;
  const ok = { status: 200, body: { ok: true } };
  if (!event || typeof event !== "object") return { status: 400, body: { error: "bad event" } };
  const { type, store: platform, app_id, environment, transaction_id, app_user_id, product_id, event_timestamp_ms } = event;
  if (type !== "NON_RENEWING_PURCHASE" && type !== "CANCELLATION" && type !== "REFUND_REVERSED") return ok;
  if (!nativeShop() || (platform !== "APP_STORE" && platform !== "PLAY_STORE")) return ok;
  const config = appConfig(platform);
  if (!config || config.id !== app_id) return ok;
  if (environment !== "PRODUCTION" && !(environment === "SANDBOX" && process.env.REVENUECAT_ALLOW_SANDBOX === "1" && process.env.VERCEL_ENV !== "production")) return ok;
  if (typeof product_id !== "string" || typeof transaction_id !== "string" || !transaction_id || transaction_id.length > 512
    || typeof event_timestamp_ms !== "number" || !Number.isSafeInteger(event_timestamp_ms) || event_timestamp_ms <= 0 || event_timestamp_ms >= Number.MAX_SAFE_INTEGER / 2) return ok;
  const pack = packFor(product_id);
  if (!pack && !isSku(product_id)) return ok;

  const key = `native-payment:${createHash("sha256").update(JSON.stringify([platform, environment, app_id, transaction_id])).digest("hex")}`;
  const previous = await store.get(key);
  const bound = previous ? JSON.parse(previous) as NativePayment : null;
  const mapped = typeof app_user_id === "string" && /^bun_[a-f0-9]{64}$/.test(app_user_id)
    ? await store.get(`native-user:${app_user_id}`) : null;
  // Refunds follow the recorded owner even if RevenueCat reports a different alias.
  const original = bound?.player ?? mapped;
  if (!isPlayerId(original) || (bound && bound.sku !== product_id)) return ok;
  const owner = await currentId(store, original);
  if (type === "NON_RENEWING_PURCHASE" && (!mapped || await currentId(store, mapped) !== owner)) return ok;

  if (!pack) await store.sadd(nativeRefs(original), key);
  const active = type !== "CANCELLATION";
  const coins = bound?.coins ?? pack?.coins ?? 0;
  // At the same provider timestamp, a revocation takes precedence.
  await store.applyNativePayment(key, `coins:${owner}`, {
    player: original, sku: product_id, active, coins, transactionId: transaction_id, platform, reversal: type === "REFUND_REVERSED", version: event_timestamp_ms * 2 + (active ? 0 : 1),
  }, coins);
  // Account transfer may have happened while the webhook was in flight. Forward the source once,
  // safely even if the account merge or a retried webhook has already forwarded it.
  let source = original;
  for (let hop = 0; hop < 8; hop++) {
    const next = await store.get(movedKey(source));
    if (!next) break;
    if (pack) await store.moveCoinBalance(`coins:${source}`, `coins:${next}`);
    else await store.sadd(nativeRefs(next), key);
    source = next;
  }
  return ok;
}
