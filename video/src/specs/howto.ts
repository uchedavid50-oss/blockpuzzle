import type { VideoSpec } from "./types";

// Areas of the 390x844 capture (see scripts/capture-game.ts for the layout maths).
const BOARD = { x: 195, y: 280 };
const row = (y: number) => ({ x: 36, y, w: 318, h: 62 });

export const howto: VideoSpec = {
  id: "howto",
  title: "How to play Bunblocks",
  orientation: "portrait",
  viewport: { w: 390, h: 844 },
  beats: [
    { id: "hook", clip: "hook", from: 0, say: "Fill a row, a column, or a block of eight, and it clears.", caption: "Bunblocks", zoom: { ...BOARD, s: 1.12, at: 0.8 }, sfx: ["clear"] },
    { id: "intro", clip: "drag", from: 0, say: "Here's how to play." },
    { id: "drag", clip: "drag", from: "continue", step: 1, caption: "Drag a piece onto the board", say: "Drag a piece from the tray onto the board. A shadow shows where it will land." },
    { id: "fit", clip: "fit", from: 0, step: 2, caption: "Find where each piece fits", say: "Pieces don't rotate, so find the spot where each one fits. Use all three, and you get three more." },
    { id: "row", clip: "row", from: 0, step: 3, caption: "Fill a row or column", say: "Complete any row or column to clear it.", sfx: ["clear"] },
    { id: "region", clip: "region", from: 0, caption: "Blocks of 2 × 4 clear too", say: "The board is also split into eight blocks of two by four. Fill one, and it clears too.",
      spot: [{ at: 0, x: 23, y: 194, w: 172, h: 86 }], zoom: { x: 109, y: 237, s: 1.15, at: 0.3 }, sfx: ["clear"] },
    { id: "combo", clip: "combo", from: 0, step: 4, caption: "Clear more at once for combos", say: "Clear several at once for a combo, and a bigger score.", sfx: ["clear"] },
    { id: "over", clip: "over", from: 0, caption: "No moves left", say: "When none of your pieces fit, the game is over.", minSec: 4.6 },
    { id: "share", clip: "share", from: 0, caption: "Share a game", chip: "Share score", say: "Share any game, and your friends get the exact same pieces." },
    { id: "modes", clip: "modes", from: 0, step: 5, caption: "Choose how you play", chip: "Modes", say: "Tap Modes to choose how you play." },
    { id: "daily", clip: "modes", from: "continue", caption: "Daily", say: "The Daily gives everyone the same pieces. Your first try is your score.", spot: [{ at: 0, ...row(292) }] },
    { id: "weekly", clip: "modes", from: "continue", caption: "Weekly and Zen", say: "Weekly adds a special rule, and Zen has no game over at all.",
      spot: [{ at: 0, ...row(362) }, { at: 1.9, ...row(502) }] },
    { id: "journey", clip: "journey", from: 0, caption: "Journey", chip: "Journey", say: "Journey takes you through levels, each with its own goal." },
    { id: "coins", clip: "coins", from: 0, step: 6, caption: "Earn and spend coins", chip: "Coins", say: "Earn coins as you play, and spend them in the coin shop." },
    { id: "stats", clip: "stats", from: 0, step: 7, caption: "See your stats and badges", chip: "Trophy", say: "Tap the trophy to see your stats and badges." },
    { id: "end", say: "Bunblocks. Have fun.", minSec: 5 },
  ],
  endCard: { title: "Bunblocks", subtitle: "Fill it. Clear it. Again." },
};
