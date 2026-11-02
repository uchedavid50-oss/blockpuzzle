# Video brief

Two short how-to videos in the style of Apple Support: calm, one task per step, the real product on
screen, captions beside it. Everything here is read by the capture, voice and Remotion steps.

## Brand (from the game itself: src/gfx.ts, index.html)
- Violet `#8a4dff` (primary, theme-color), deep violet `#5a22c8`, magenta `#ff4fa0`, gold `#ffc21f`,
  teal `#1fd6b4`, sky `#4fb8ff`.
- Ink `#3d1a5c`, dim `#8d6aa8`, combo orange `#f28c00`.
- Background: the candy wash `#ffd9ef` → `#d9c8ff` (the game's own backdrop), softened for video.
- Type: rounded for titles ('Arial Rounded MT Bold' / Nunito), system sans for captions.
- Name on screen: "Block Puzzle". Never mention Tetris.

## Video 1: How to play (players)
- Portrait 1080x1920, 30 fps, about 70 s.
- Captured from the real game (`npm run dev`) in a 390x844 phone viewport with Playwright, from
  prepared boards so every take is identical and every clear on screen is a real one.
- Phone frame about 70% of the height, so the caption band above it (70–300 px) never overlaps the
  screen; the bottom ~260 px stays clear for platform UI.

## Video 2: Admin dashboard (operators)
- Landscape 1920x1080, 30 fps, about 62 s.
- Captured from the real public/admin.html, with its two API calls answered by made-up demo data
  (no real players, payments or token). Browser frame instead of a phone. Captions on the left.
- Blur the token field, player ids and payment references softly. Never show a real token.

## Sound
- Voice: ElevenLabs, one calm, warm voice for both videos, one file per line.
- Music: a light instrumental bed generated with ElevenLabs, ducked about 18 dB under the voice,
  crossfaded into the end card.
- Effects: soft, success-only (a line clear, the end card). No sound on taps.

## Checks before delivery
- Stills reviewed before the full render.
- `silencedetect` on the music bed prints nothing for the length of the video.
- Final mix normalised to -16 LUFS, true peak under -1.5 dBTP.
- H.264 MP4, versioned: `out/how-to-play-v1.mp4`, `out/admin-dashboard-v1.mp4`.
