# Native Google sign-in

Implemented on `mobile/capacitor-phase-one`. Production activation and real-account Android/iPhone
testing are still required. Offline gameplay does not require Google or an account. Native ads
and purchases remain disabled. The existing website Google client is unchanged.

## Public client configuration

Package/bundle ID: `app.bunblocks.game`. These are public identifiers, not secrets:

| Purpose | Client ID |
| --- | --- |
| Android | `729399375431-ueqdfspp37qo6upfpg9l34s82cugttjb.apps.googleusercontent.com` |
| iOS | `729399375431-80kil6evdqdno4ig8jtbt3o1h5v04aj5.apps.googleusercontent.com` |
| Native server / Web application | `729399375431-q5e7k1rnci73rdpgf9n5k0vejq5dgese.apps.googleusercontent.com` |

GitHub repository variables `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_NATIVE_WEB_CLIENT_ID` and
`GOOGLE_ANDROID_CLIENT_IDS` contain these values. Only the iOS ID is compiled into the app through
`VITE_GOOGLE_IOS_CLIENT_ID`; the backend advertises enabled platforms and its audience through health.
For local native builds export `VITE_GOOGLE_IOS_CLIENT_ID` to the iOS ID above before running
`npm run cap:sync`. The build script generates the matching `GIDClientID` and reversed callback
scheme in Info.plist. Without that setting, iOS Google sign-in stays unavailable.

## Server activation (requires production deployment approval)

Set these on the production Vercel `blockpuzzle` project, then deploy the reviewed backend and
native CORS changes. Do not replace `GOOGLE_CLIENT_ID` or rotate `AUTH_SECRET`.

```dotenv
GOOGLE_NATIVE_ENABLED=1
GOOGLE_NATIVE_WEB_CLIENT_ID=729399375431-q5e7k1rnci73rdpgf9n5k0vejq5dgese.apps.googleusercontent.com
GOOGLE_ANDROID_CLIENT_IDS=729399375431-ueqdfspp37qo6upfpg9l34s82cugttjb.apps.googleusercontent.com
GOOGLE_IOS_CLIENT_ID=729399375431-80kil6evdqdno4ig8jtbt3o1h5v04aj5.apps.googleusercontent.com
```

Existing Redis and account secret configuration is reused. Disabling `GOOGLE_NATIVE_ENABLED`
hides native Google without disabling website Google or email sign-in. The client also requires
the native plugin, and iOS requires the server/client callback IDs to match.

The app obtains a five-minute, player/platform-bound random nonce from `/api/signin`. The OS
Google SDK receives this nonce. The backend verifies Google's RS256 signature, issuer, expiry,
platform audience, authorized presenter when supplied, and exact nonce, then atomically prevents
reuse before linking the same verified Google subject through the existing account/cloud-save flow.
Native nonce-bearing tokens cannot use the older web sign-in step. The client never treats the
SDK's profile or access token as account proof. SDK logout attempts to clear temporary tokens;
the game's verified account session is separate. Cancellation leaves the game playable.

## Stable Android development signing

The certificate fingerprints are public in [android-ci-signing.json](android-ci-signing.json).
Android OAuth must register this package and SHA-1:
`01:68:70:1B:3C:C8:3D:05:DC:26:6A:8E:FB:F0:6A:BE:69:F0:6A:ED`.

Four GitHub secrets hold the key: `ANDROID_SIGNING_KEYSTORE_BASE64`,
`ANDROID_SIGNING_STORE_PASSWORD`, `ANDROID_SIGNING_KEY_ALIAS`, `ANDROID_SIGNING_KEY_PASSWORD`.
`ANDROID_SIGNING_CERT_SHA256` pins the expected public certificate. Push/manual workflows fail
if the key is absent or the resulting APK certificate differs. PR workflows never receive this key.

The ignored `.mobile-signing/` directory contains the private local backup. Back up that entire
directory to secure owner-controlled storage; never commit or share it. Restore the same directory
on another development machine. With JAVA_HOME set, use:

```sh
npm run android:signing          # public fingerprints only
npm run android:build:signed     # rebuild/sync and sign with the existing private key
node scripts/android-signing.mjs upload # restore the existing key to GitHub secrets if needed
```

`setup` creates a key only on a fresh checkout without an existing local identity; do not use it
to replace the established identity. The upload command refuses a different pinned GitHub identity.
Ordinary `android:build` uses the local Android debug key and needs its own OAuth registration.
PR artifacts likewise are not the registered Google test build.

Old CI APKs had temporary keys. Android cannot update them using the new key. Sync/backup saves
before a one-time uninstall, or retain the existing installation. Uninstalling deletes local saves.
Subsequent stable CI APKs support normal updates with `adb install -r`.
This development certificate is not the eventual Play signing identity: register the Play App
Signing SHA-1 and any distinct upload/test certificate before store distribution.

## Verification and remaining work

- Automated suite: 407 tests, including forged/wrong-audience/expired tokens, nonce mismatch,
  cross-player binding, replay/concurrency, Android/iOS identity and cloud-save continuity,
  disabled configuration, SDK cancellation and missing tokens.
- Browser and native production builds, mobile asset/ad boundaries, Android signed APK and
  unsigned arm64 iOS Simulator build pass. Browser AdSense markup stays present.
- Signed APK instrumentation passes on the Android 17 emulator with Wi-Fi and mobile data
  disabled: packaged Canvas renders, Capacitor is native and no AdSense script is loaded.
- Before activation: review/deploy the backend and exact native-origin CORS support with approval;
  check live health and allowed/disallowed OPTIONS responses. No production deployment is included.
- Test on the Redmi Note 14: account picker, cancellation, returning from background, first login,
  repeat login, existing web-account restoration, save merge, offline restart and reconnect.
- Test the same on a signed physical iPhone. The simulator build does not prove device OAuth.
- Check Google consent screen publishing/test-user restrictions and OAuth branding. The packaged
  button is Google's [official preapproved asset](https://developers.google.com/identity/branding-guidelines).
- For App Store submission, assess Apple's sign-in requirements and implement Sign in with Apple
  where required; configure Apple signing, provisioning, privacy disclosures and account deletion.
- Keep ads and purchases disabled until their separate verification and device tests are complete.

The native SDK is `@capgo/capacitor-social-login` with only its Google provider enabled.
Android uses the SDK activity callback; iOS handles only this build's registered Google scheme
and preserves other Capacitor URL handling. This callback is separate from unfinished general
app/universal-link association work in the [migration checklist](mobile-migration.md).
