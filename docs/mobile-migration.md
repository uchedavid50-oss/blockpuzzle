# Capacitor migration: phase one

Base: latest fetched `origin/main`, `423276bdf9a04bd76d1b37bc75ba84896b5ee690`.
Branch: `mobile/capacitor-phase-one`. No deployment, merge, or store upload.
The pre-existing untracked `MOBILE.md`, `.DS_Store` and files in `video/` are not migration changes.

## Architecture and compatibility review

- The existing Canvas, pointer input, pure game rules, scoring, generator, game modes, coins,
  challenge parsing, and server replay verification are retained. `RULES_VERSION` is unchanged.
- Capacitor 8 packages the native Vite output in Android/iOS. No remote `server.url`, cleartext,
  mixed content, or arbitrary navigation allowlist. Android uses SDK 36/minimum 24 and the
  generated Gradle wrapper. `app.bunblocks.game` is a provisional identifier to confirm before release.
- Browser HTML and its AdSense verification tag are unchanged. Only the native Vite transform
  removes that script and the PWA manifest link. Native runtime guards reject AdSense initialization,
  return `nullProvider` through the existing `AdProvider` interface, and hide ad offers.
  A future AdMob adapter must return `completed` only after the native SDK completion callback;
  it must preserve existing reward restrictions, timeouts, and frequency rules. No AdMob SDK is installed.
- Native checkout and checkout returns are blocked before any request/navigation. Paid shop controls
  are hidden through the existing availability flag. Earned-coin features remain available.
  `NativePurchaseProvider` describes Apple/Google purchase and restore entry points but always
  returns unavailable. No SDK, product, receipt, entitlement, or currency grant is activated.
- `platform.ts` pins every native API URL to `https://www.bunblocks.app/api/`. Invalid origins and
  non-API paths are rejected; the browser keeps relative URLs and the existing dev proxy.
  A read-only production check found the apex API redirects (307) to `www`; native requests
  use that canonical host directly so preflight and redirect rejection remain compatible.
  Shared API calls and analytics fetches omit cookies and reject redirects in native builds.
  Native analytics avoids `sendBeacon`, which would otherwise use credentialed cross-origin behavior.
  Bundled `/par.json` stays local. Consent remains required for analytics.
- CORS wraps the single Vercel dispatcher, including errors and preflight. Only `https://localhost`
  (Android) and `capacitor://localhost` (iOS) are permitted cross-origin; methods and headers are
  restricted to GET/POST and Content-Type/X-Player. No wildcard or credential permission.
  Responses vary on Origin; native replies are not shared-cacheable. Native-origin Paystack routes
  are rejected server-side too. CORS is not authentication: existing player credentials, rate limits,
  and replay checks remain necessary and unchanged. Non-browser webhook requests have no Origin
  and continue through the existing handler and signature verification.
- Google Identity Services browser sign-in is hidden in native because embedded WebViews are not
  a supported OAuth solution. Email-code sign-in and optional cloud saves use the central API client.
  Native Google OAuth needs platform client IDs, OS auth flow, secure callback validation and
  backend audience verification before enabling. Never load GSI inside the WebView.
- Local storage keys and formats are unchanged, so existing game save and merge behavior continues.
  Native WebView storage belongs to the installed app and is separate from browser storage.
  It persists across ordinary relaunches but uninstall/data clearing removes it; users must use
  optional cloud sync to move progress. Android automatic backup is disabled to avoid copying
  player credentials across devices. Durable Preferences/SQLite migration, credentials in secure
  storage, and iOS privacy declarations require a versioned migration and further testing.
- Native lifecycle callbacks save synchronously and cancel gestures on background/back; Android
  back minimizes the activity. Foregrounding invokes the existing visibility-based refresh paths.
  Existing saves on moves, blur and document visibility are retained. OS termination is never a
  reliable opportunity for a network save; local state is the first line of persistence.
- Native sharing uses the OS share plugin. Shared links use the production website origin,
  retaining existing challenge seeds and targets. Browser sharing remains unchanged.
- Incoming universal/app links are intentionally not claimed yet: links continue opening the web
  game. Registering a custom scheme or intercepting every URL without validation is unsafe.
  Next phase needs website association files, signing fingerprints/team IDs, a strict parser for
  supported challenge parameters, cold/warm-start tests and a decision about in-progress games.
- Native builds skip service workers and the browser install nudge. All shell assets are bundled,
  so no prior online visit is necessary. Leaderboard/cloud/shop failure remains non-blocking offline.
  SystemBars uses native inset handling without viewport-fit=cover to keep the Canvas input
  coordinate system unchanged. Physical notches, keyboards and rotation still need the matrix below.

## Reproduce verification

```sh
npm ci
npm test
npm run validate
npm run build
npm run cap:sync
npm run check:mobile
cd android
# Supply JAVA_HOME (JDK 21+) and ANDROID_HOME (SDK installation) as needed.
./gradlew :app:assembleDebug :app:testDebugUnitTest
# Start a disposable emulator, turn Wi-Fi and mobile data off, then:
./gradlew :app:connectedDebugAndroidTest
```

The instrumentation test launches the real activity and checks the packaged game Canvas,
Capacitor native runtime, and absence of an AdSense script. Run it offline for the cold-start check.
The APK is `android/app/build/outputs/apk/debug/app-debug.apk` (debug only, not a store release).
`npm run check:mobile` compares generated web/native HTML and checks offline assets.

## Results and known limits

- Baseline: all 382 existing tests passed; the full existing validation script completed
  (90/90 journey levels bot-winnable, weekly goal sampling and all four region variants).
  A separate clean export of `origin/main` also passed the production build with the installed toolchain.
- Final: 389 tests in 34 files passed (all 382 retained plus seven native boundary/CORS tests).
  TypeScript, browser production build, native production build, HTML/offline-asset checks and
  `git diff --check` passed. Game-rule/source integrity checks show the board, piece generator,
  RNG, scoring/replay verifier, journey/weekly rules, server verification, browser HTML,
  AdSense ads.txt and service worker unchanged from the fetched main.
- Android: debug APK built using Android Studio's JDK and SDK 36. The application instrumentation
  test passed on the disposable Android 17/API 37 emulator with Wi-Fi and mobile data disabled.
  It requires painted Canvas pixels and native Capacitor runtime, and rejects the AdSense script.
  Real pointer placement increased score and wrote the existing local save format while offline.
  Background → force-stop → offline cold relaunch preserved the exact board, tray, score (5),
  seed and move log (2 moves). The test used a disposable app install, not production account data.
- iOS: project generated and synced after Android verification. Xcode 26.4 simulator Debug build
  passed with `CODE_SIGNING_ALLOWED=NO` and Swift Package Manager dependencies resolved.
  iOS runtime/device QA, signing, archive and store submission are not verified by that build.
- The initial Pixel emulator lacked install space; a separate 12 GB test emulator avoided changing
  its data. Running unscoped `connectedDebugAndroidTest` also invokes third-party Capacitor plugin
  instrumentation and hit duplicate Kotlin standard-library classes. The documented app-specific
  `:app:connectedDebugAndroidTest` passes; this does not assert plugin-library instrumentation passes.
- Read-only production checks: apex API OPTIONS redirects 307 to `www`; canonical host OPTIONS
  returns 405 without CORS. The new server support is local to this branch until approved deployment.
  Online native auth/cloud/leaderboard flows cannot be claimed as end-to-end verified against the
  running API yet. Offline gameplay works independently.
- No native ad or purchase SDK is active. Google native auth, incoming app links, durable storage
  migration, physical-device sharing and comprehensive device QA remain next-phase work.
- Generated launcher icons/splashes are placeholders. App identifiers and release configuration
  need owner confirmation. The six toolchain audit findings are unresolved (see checklist).

Exact source/project files are listed in [mobile-files.txt](mobile-files.txt). Bundled web assets,
Gradle/Xcode output and device-local configuration are ignored and rebuilt, not source changes.

## Production and store checklist / next phase

- [ ] Approve and deploy the reviewed CORS changes before expecting native online features to work.
      This branch cannot change the already-running production API. Recheck every endpoint and
      error/preflight response against the live HTTPS origin after deployment, including email-code
      auth, cloud conflict/merge, leaderboard submit/replay, entitlement reads and offline recovery.
- [ ] Run physical Android and iPhone/iPad QA: every game mode, daily archive, seeded challenges,
      undo, earned coins, themes, sound, haptics, settings, accessibility, 60 Hz performance, small
      screens, notches, gesture navigation, landscape/rotation, keyboard and app switching.
- [ ] Verify background/kill/relaunch and upgrades retain saves, identity, daily first attempts,
      unclaimed coin IDs and cloud merge baselines. Add versioned durable storage migration and
      secure credential handling without silently resetting any existing save.
- [ ] Implement native Google OAuth and validated app/universal links as described above; test
      cancellation, expired tokens, cold/warm callbacks, invalid links and account switching.
- [ ] Test native sharing on physical Android/iOS, including cancellation and unavailable targets.
- [ ] Implement Apple StoreKit / Google Play Billing adapters only alongside server receipt/token
      verification, product mapping, idempotent grants, restore, refunds/revocations and notifications.
      Test sandbox purchases, pending/cancelled transactions, retries and duplicate callbacks.
      Keep native purchases disabled until all pass. Cross-platform ownership needs policy review.
- [ ] Implement AdMob behind AdProvider with native consent/CMP, child-directed settings as applicable,
      test IDs, reward callbacks, failure/timeout tests and no leaderboard/rule effects. Keep native
      ads disabled until tested and approved; preserve browser AdSense verification/application.
- [ ] Upgrade and audit the existing Vite/Vitest toolchain in a dedicated compatibility change:
      npm audit currently reports 6 development-tool findings (3 moderate, 1 high, 2 critical).
      Do not expose dev/test servers publicly. No automatic major upgrade was applied here.
- [ ] Confirm bundle/application IDs, app name, versioning, minimum OS support and ownership accounts.
      Replace generated Capacitor icons/splash screens with Bunblocks assets in all required sizes.
- [ ] Configure Android release signing outside source control, create/test AAB, Play internal track,
      prelaunch report, target API compliance, content rating, Data Safety and account deletion flow.
- [ ] Configure iOS team/signing, archive/TestFlight, device orientations, App Privacy answers,
      required-reason privacy manifests (including persistent WebView storage), export compliance,
      age rating, account deletion and review access/instructions.
- [ ] Update mobile privacy/help/contact disclosures, screenshots, store listings, support URLs,
      licensed assets and consent text. Confirm AdSense web policy remains satisfied.
- [ ] Release only after device QA, store checks and explicit merge/deployment approval.

Official references: [Capacitor setup](https://capacitorjs.com/docs/getting-started/environment-setup),
[configuration](https://capacitorjs.com/docs/config), [App lifecycle](https://capacitorjs.com/docs/apis/app).
