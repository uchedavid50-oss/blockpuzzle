import type { Beat } from "./specs/types";

export const FPS = 30;
/** A breath after each line before the next one starts. */
export const PAD = 0.6;

/** How long a beat lasts on screen, in seconds: its line plus a breath, or longer if the beat asks. */
export function beatSeconds(beat: Beat, durations: Record<string, number>): number {
  const said = durations[beat.id];
  if (said === undefined) throw new Error(`no voice for beat "${beat.id}": run npm run voice`);
  return Math.max(said + PAD, beat.minSec ?? 0);
}
