# Project

Original 8x8 drag-and-drop block puzzle. NOT Tetris — no falling pieces,
no rotation, no timer. Never reference Tetris in code, assets or naming.

## Rules
- TypeScript strict. Vite + Canvas 2D. No game engine, no runtime deps.
- board.ts stays pure: no DOM, no rendering, no imports from other modules.
  It is the only thing with tests and the only place real bugs hide.
- The piece generator never reads the score or adapts to the player.
  Difficulty comes from the board filling up. This is non-negotiable.
- Pointer Events only — one code path for mouse and touch.

## Rules of play
- A row, a column or a 2x4 region (the board is eight such regions) clears when full. Crossing
  clears all fire in one pass. The region rule lives in board.ts and is covered by tests.
- Modes: classic, daily (date-seeded, first attempt is the record, replays are practice), weekly
  challenge, journey (pre-filled levels with goals), zen (no game over), and a 14-day daily archive.
- Every random game is seeded, so a shared link replays the exact same pieces.

## Structure
- Pure, tested modules (no DOM): board, rng, streak, share, meta, challenge, journey, weekly, solver.
- main.ts holds the game loop, rendering and input. Keep new logic in a pure module where it can be tested.
- public/par.json is each day's par, played offline by a greedy bot (src/solver.ts).
  Regenerate it with `npm run par` whenever the rules or the piece set change, because par depends on both.

## Scope
No ads, analytics or backend. No coin or booster economies, no obstacle or gem cells, and no
adaptive difficulty. Do not add them unless I ask.
