# Bun Blocks

An original 8×8 drag-and-drop block puzzle. Drag pieces from the tray onto the board and clear
rows, columns and 2×4 regions. No rotating, no timer, no ads, no backend.

**Play it: https://bunblocks.app** (works offline and installs to your home screen)

<p>
  <img src="docs/screens/gameplay.png" width="220" alt="Gameplay">
  <img src="docs/screens/clear.png" width="220" alt="A double clear">
  <img src="docs/screens/modes.png" width="220" alt="Game modes">
</p>

## How it plays

- Drag one of three pieces onto the board. Fill a **row**, a **column** or one of the eight outlined
  **2×4 regions** to clear it. Clears that cross all fire together, and consecutive clears build a combo.
- The game ends when none of the pieces left in the tray fits.
- **The piece generator never reads your score or adapts to you.** Difficulty comes only from the
  board filling up. It looks at the board for one reason: to make sure at least one piece in a tray
  can be placed.

## Modes

| Mode | What it is |
| --- | --- |
| Classic | Endless. Every game is seeded, so a shared link replays the exact same pieces. |
| Daily | The same pieces for everyone each day. Your first attempt is the record; replays are practice. Shows a **par** score. |
| Weekly | One rule-twisted goal per week, the same for everyone (for example: clear 15 lines within 45 placements). |
| Journey | 150 numbered levels with a goal and a pre-filled board, scored in stars. Every level is checked by the bot, so each one is winnable. |
| Zen | No game over: when nothing fits, the fullest line is cleared. |
| Archive | Replay any of the last 14 dailies. Archive runs never touch your streak. |

Also: challenge links (beat a friend's score on the same pieces), a daily streak with a weekly
freeze, 23 badges that unlock themes, effects and extra undos, a collectible picture, stats with a
score distribution, an emoji result you can paste anywhere, and haptics on supported phones.

**Settings:** separate switches for sound and vibration, colour-blind patterns (a distinct mark on
every colour), a calmer-visuals option, and a theme picker that includes limited-time seasonal themes.

<p>
  <img src="docs/screens/badges.png" width="220" alt="Badges">
  <img src="docs/screens/collection.png" width="220" alt="Collection">
  <img src="docs/screens/settings.png" width="220" alt="Settings">
</p>

## Leaderboard

Post your first daily attempt to a global board, and see the longest live daily streaks. It is
optional, anonymous and verified: you pick a public nickname (no account, no personal data), and the
server never trusts a score. Your game sends its list of moves and the server replays them with the
same rules code, so only a legal game can score. Beyond that, the server times each official attempt from
its first move (the game tells it when you start, so a score posts only if the daily was started online),
refuses a game finished faster than a person can play, caps new players per network address per day, and
only opens a day's board while that date exists somewhere on Earth. A nickname belongs to one player at a
time (lookalike spellings count as the same name). Streaks are counted from the days you post.

Every API route is rate-limited per address, and the streak board is worked out at most every 30 seconds.

## Privacy, ads and purchases

Everything here is off until configured, and none of it can change the rules or the leaderboard.

- **Usage statistics**: the server's own collector (`/api/collect`, aggregate counts only, report at
  `/admin.html` with `ADMIN_TOKEN`). The game asks once, and sends nothing (and creates no id) until the
  player says yes. Settings can turn it off again, which also deletes the id. Build-time override:
  `VITE_ANALYTICS_ENDPOINT`.
- **Shop** (Paystack, NGN): shown only when `PAYSTACK_SECRET_KEY` is set. Prices are decided and payments
  verified on the server; set the webhook to `/api/paystack-webhook`. `PAYSTACK_USD=1` enables USD.
  A test key (`sk_test_`) is refused on the production deployment, because Paystack's test cards are
  public; use it on Preview, or set `PAYSTACK_ALLOW_TEST=1` to override on purpose.
  Items are cosmetic or remove ads: no-interruptions, two theme packs, clear effects, and a supporter
  bundle that adds a star beside your name on the boards. A restore code *moves* the account (purchases,
  uncollected coins, name, streak) to another device and stops working on the old one, so a code cannot
  be shared to unlock purchases. Refunds and chargebacks (`refund.processed`, `charge.dispute.create`
  webhooks) take the purchase back; a refunded coin pack is taken from future coins if already collected.
  Sales on the admin page are counted by the server when a payment is confirmed, not reported by browsers.
- **Sign-in and cloud save** (optional for players, off until configured): `AUTH_SECRET` (at least 24
  characters; it keys the email hashes, so never change it once players have signed in) plus either or
  both of: email codes via Resend (`RESEND_API_KEY`, `EMAIL_FROM` such as `Bun Blocks <play@yourdomain>`
  on a domain verified in Resend), and Google (`GOOGLE_CLIENT_ID`, a Web OAuth client whose authorised
  JavaScript origins list the site). A signed-in device keeps a cloud save that merges with the account's
  (counters add up, bests take the higher), so two phones never overwrite each other. Signing in on a phone
  that played as a guest brings its purchases and coins into the account. Only a keyed hash of the email and
  a masked label (`ad***@gmail.com`) are stored. The game offers sign-in in Settings, before a checkout and
  after journey levels 3 and 10. Locally, `npm run dev:api` prints email codes to its terminal.
- **Admin page**: `ADMIN_TOKEN` must be at least 24 characters (shorter tokens keep the page closed);
  wrong guesses are rate-limited.
- **Ads**: loaded only when `VITE_ADSENSE_CLIENT` (a `ca-pub-` id) is set at build time; `VITE_ADSENSE_TEST=1`
  uses Google's test mode. A rewarded "watch an ad to undo" appears on game over (never in the daily, weekly
  or a challenge) and an interstitial may precede "Play again" (every 3 runs, 5 minute cooldown, never for
  owners of "No interruptions"). If the script is blocked, nothing is shown.
- **Coins**: earned by playing (a starter gift, a daily bonus, today's daily, beating par, the weekly,
  journey stars and best-score milestones), each paid once. With ads on, a rewarded ad gives coins, at most
  five a day, only after a completed view. Coins buy saved undos (never usable in the daily, weekly or a
  challenge) and two coin-only themes, from the coin counter under the trophy or Settings > Coins. With the
  shop configured, coin packs are sold through the same verified Paystack checkout: the server credits them
  once per payment and the device collects them with a retry-safe claim. Every reward and price is in
  `src/economy.ts`.

Test the shop locally with `npm run dev:api` (a fake Paystack that is refused on Vercel).

## Run it

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests for the game logic
npm run build      # type-check and build to dist/
npm run dev:api    # local leaderboard API (in-memory), for use with npm run dev
```

TypeScript (strict), Vite and Canvas 2D. No game engine. The only runtime dependency is the Neon driver, used by the optional Postgres store.

## How it is built

- `src/board.ts` is the pure rules engine: no DOM, no imports. It is where bugs would hide, so it is
  heavily tested.
- Other pure, tested modules: `rng`, `streak`, `share`, `meta`, `challenge`, `journey`, `weekly`, `solver`.
- `src/main.ts` runs the game loop, the board rendering and input with Pointer Events (one code path
  for mouse and touch). The rest is split by job: `gfx` (drawing primitives and layout), `overlays`
  (the stats, modes, settings and challenge screens), `progress` (stats, badges, collection, themes,
  streak) and `records` (official dailies, par, journey progress).

### Offline tools

A greedy look-ahead bot (`src/solver.ts`) plays the real rules and the real piece generator. It is
used to calibrate the game, never to change it for a player:

```bash
npm run par        # writes public/par.json: each day's par score
npm run levels     # calibrates journey levels so every one is provably winnable
npm run validate   # checks journey, weekly goals and region shapes against the bot
```

Re-run `par` and `levels` whenever the rules or the piece set change, because both depend on them.

## License

MIT. See [LICENSE](LICENSE).

### Optional: Postgres on Neon

The server storage is Redis by default. Set `STORE=postgres` and `DATABASE_URL` (Neon) to run the same
routes on Postgres instead; tables are created on first use. `neon.ts` holds the Neon project config
(`neon deploy`). Switching does not move existing Redis data. To test: `DATABASE_URL=… npx vitest run src/server/postgres.test.ts`
runs the storage contract against the real database, and `STORE=postgres npm run dev:api` serves the app on it.

### Weekly Cup, login streak, seasonal themes, challenges

- **Weekly Cup**: the weekly mode's pieces are the same for everyone for a week (Monday to Sunday, UTC). Your first
  finished run counts and can be posted to the Cup tab of the leaderboard; the server replays the moves like it
  does for the daily. When the week ends, the top 10 get coins (`ECONOMY.cup` in `src/economy.ts`), paid once into
  the same server-held balance that bought coins use, and the device collects it on its next visit.
- **Login streak**: opening the game on consecutive days adds bonus coins on some days (`ECONOMY.loginStreak`); a
  missed day restarts it. It is on top of the daily bonus.
- **Seasonal themes**: limited-window themes (`season` in `src/progress.ts`) are wearable only inside their dates.
- **Challenge a friend**: the game-over button on a random game shares a link with the seed and your score.
