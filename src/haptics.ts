// Vibration feedback. Android browsers support it; iOS Safari (and iOS home-screen apps) do not,
// so every call is a harmless no-op there. Vibration has its own switch in the settings.

import { settings } from "./settings";

const supported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

export function haptic(pattern: number | number[]): void {
  if (!supported || !settings.haptics) return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

export const haptics = {
  tick: () => haptic(6),
  pick: () => haptic(9),
  drop: () => haptic(16),
  undo: () => haptic([10, 20, 10]),
  invalid: () => haptic([18, 45, 18]),
  gameOver: () => haptic([70, 50, 120]),
  /** Grows with the size of the clear, so a big one is felt as well as seen. */
  clear: (lines: number, combo: number) => {
    const base =
      lines >= 4 ? [30, 30, 30, 30, 30, 30, 70]
      : lines === 3 ? [26, 30, 26, 30, 40]
      : lines === 2 ? [22, 35, 22]
      : [20];
    haptic(combo >= 3 ? [...base, 30, 20] : base);
  },
};
