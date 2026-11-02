# How-to videos

Two Apple-style how-to videos, made from the real game and admin page:

- `out/how-to-play-v1.mp4`: for players, 1080x1920 portrait.
- `out/admin-dashboard-v1.mp4`: for whoever runs the game, 1920x1080 landscape.

Everything here is separate from the game: its own `package.json`, nothing imported by the game, and
the game keeps zero runtime dependencies. Read `BRIEF.md` first for the look and sound rules.

## What lives where

| Path | What |
|------|------|
| `src/specs/howto.ts`, `src/specs/admin.ts` | The source of truth: every voiceover line, the clip it plays over, captions, spotlights, zooms, blurs. Edit these to change a video. |
| `scripts/voice.ts` | ElevenLabs: one mp3 per line (`public/voice/`), music beds and effects (`public/audio/`). Unchanged lines are cached, so re-running costs nothing. |
| `scripts/capture-game.ts` | Records the game clips with Playwright from prepared boards (`public/clips/game/`, `src/data/game.json`). |
| `scripts/capture-admin.ts` | Records `public/admin.html` with made-up demo data (`public/clips/admin/`, `src/data/admin.json`). Its scrolls are timed to the voice. |
| `src/Explainer.tsx`, `src/plan.ts` | The Remotion edit: phone or browser frame, captions, taps, spotlights, camera, end card, audio mix. |
| `scripts/render.ts` | Renders, checks the music has no gaps, and normalises loudness to -16 LUFS. |

## Making them again

The ElevenLabs key goes in `video/.env` as `ELEVENLABS_API_KEY=sk_...` (gitignored). It needs the
Text to Speech, Sound Effects and Music permissions.

```sh
cd video && npm install && npx playwright install chromium
# in the game folder, another terminal: npx vite --port 5199 --strictPort

npm run voice -- howto        # and: admin, music, sfx
npm run capture:game          # ONLY=over,modes re-records just those scenes
npm run capture:admin         # after the admin voice: its scrolls follow the line lengths
npm run studio                # preview and scrub in the browser
npm run render                # or: npm run render -- howto
```

Bump `VERSION=v2 npm run render` for a new delivery rather than overwriting v1.

### When the game changes

- A different layout or new HUD position: re-run `capture:game`. The tap positions in
  `capture-game.ts` (Modes chip, coin counter, trophy, the mode rows, Share) and the spotlight boxes
  in `src/specs/howto.ts` are in the game's 390x844 CSS pixels.
- New wording in a line: edit the spec, `npm run voice -- howto`, render. Only that line is regenerated.
- A new admin section: add a beat to `src/specs/admin.ts`, a scroll step to `capture-admin.ts`.

## Things that were not obvious

- Playwright's installed clock also runs while each screenshot is taken. The recorder pauses it
  (`pauseClock`), or the clips play about four times too fast.
- Prepared boards are written before the game's scripts run, in a fresh browser context per scene;
  reusing a page lets the game save over them as it unloads.
- Scripts passed into the page are plain text: tsx wraps named functions in a helper the page lacks.
- Headless Chrome has a share sheet but no focus for the clipboard, so the capture removes the first
  and stubs the second; the game then shows its own "Copied!".
- Remotion's bundled ffmpeg is a small build (no `freezedetect` or `tile`); `scripts/sheet.ts` makes
  contact sheets of captured frames instead.
