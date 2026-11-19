# Native payments

BunBlocks uses RevenueCat for StoreKit and Google Play Billing. The SDK submits store transactions to RevenueCat, which validates them and finishes Apple transactions or acknowledges/consumes Google purchases according to the product configuration. BunBlocks fulfills purchases from authenticated RevenueCat webhooks. Clients read ownership and claim paid coins through the same BunBlocks APIs as web customers. Paystack remains the web checkout.

## Store catalog

Create these exact product IDs for `app.bunblocks.game` in both stores and import them into the same RevenueCat project.

| Type | Product IDs |
| --- | --- |
| Consumable | `coins_small` (300 coins), `coins_large` (1,500 coins) |
| Non-consumable | `no_interstitials`, `theme_pack_dusk`, `theme_pack_citrus`, `effect_pack`, `supporter_bundle` |

Configure the two Play coin packs as consumables and the five permanent products as non-consumables in RevenueCat. Use one purchase option per Play product and leave multi-quantity purchases disabled. The game fetches localized store prices directly. Set prices and complete the paid agreements, product availability, and review details in the respective consoles. BunBlocks manages fulfillment, so the products require neither a RevenueCat offering nor a RevenueCat virtual currency.

## RevenueCat and deployment

1. Confirm the In-App Purchase capability on the Xcode target. Connect the iOS app and its In-App Purchase key. Enable App Store Server Notifications V2 for production and sandbox. Connect the Play app, its Play Developer API service account, and real-time developer notifications.
2. Set RevenueCat restore behavior to **Keep with original App User ID**. Players restoring on a new device should sign into the same BunBlocks account or use their BunBlocks restore code. Store restore can resync restorable purchases, while the BunBlocks account carries verified ownership and claimed coin progress. Retain `REVENUECAT_ID_SECRET` across deployments so account identifiers stay stable.
3. Add the environment variables below. Keep the store keys and service account credentials in RevenueCat. Use independent random values for the two BunBlocks server secrets.
4. Configure `https://www.bunblocks.app/api/revenuecat-webhook` as the production webhook, with the exact Authorization value in `REVENUECAT_WEBHOOK_AUTH`. Enable `NON_RENEWING_PURCHASE`, `CANCELLATION`, and `REFUND_REVERSED`. Check successful delivery and monitor failed delivery in RevenueCat. The backend deduplicates by store transaction and retains the recorded owner when processing a refund.
5. Run `npm run cap:sync` before producing the iOS and Android binaries.

| Variable | Value |
| --- | --- |
| `REVENUECAT_IOS_APP_ID` | RevenueCat iOS app ID from its dashboard, corresponding to webhook `app_id` |
| `REVENUECAT_IOS_PUBLIC_KEY` | RevenueCat Apple public SDK key starting with `appl_` |
| `REVENUECAT_ANDROID_APP_ID` | RevenueCat Android app ID from its dashboard, corresponding to webhook `app_id` |
| `REVENUECAT_ANDROID_PUBLIC_KEY` | RevenueCat Play public SDK key starting with `goog_` |
| `REVENUECAT_WEBHOOK_AUTH` | Full Authorization header value, such as `Bearer <random secret>` |
| `REVENUECAT_ID_SECRET` | Stable random server secret used to derive opaque App User IDs |
| `REVENUECAT_ALLOW_SANDBOX` | Set to `1` only on an isolated, non-production Vercel environment with its own datastore |

To test on physical devices, use an isolated HTTPS API deployment with test data and a dedicated sandbox webhook. Set `VITE_NATIVE_API_ORIGIN` to that origin when building test binaries. The test endpoint must be reachable by the app and RevenueCat. Leave that build variable unset for store release binaries. Use Apple sandbox or TestFlight and Google Play internal testing with licensed testers.

Test both stores for purchase, cancellation, delayed payment, a second coin-pack purchase, replayed webhook delivery, account restore and refund. Confirm a refunded item stays owned when another active source grants it and that the web game sees the same verified purchases after account sync. A refunded coin pack removes pending coins first. If those coins have already been claimed, the server carries the shortfall against future paid coin credits. Apple refund delivery requires both the purchase key and server notifications. RevenueCat documents Google refund cases that require manual reconciliation, including automatic refunds for unacknowledged purchases.

- [RevenueCat one-time purchases](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)
- [RevenueCat Google Play product setup](https://www.revenuecat.com/docs/getting-started/entitlements/android-products)
- [RevenueCat webhook setup](https://www.revenuecat.com/docs/integrations/webhooks)
- [RevenueCat refund handling](https://www.revenuecat.com/docs/subscription-guidance/refunds)
