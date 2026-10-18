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

## Scope
Phase 1 is the playable core only. No sound, no menus, no ads, no analytics,
no backend. Do not add them unless I ask.
