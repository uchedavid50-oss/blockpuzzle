/** A box in the captured page's CSS pixels. */
export interface Box { x: number; y: number; w: number; h: number }
/** A box, or the name of one the capture measured (src/data/<video>.json "boxes"). */
export type Area = Box | { ref: string };

/**
 * One voiceover line and what is on screen while it plays. A beat lasts as long as its line
 * (plus a short breath), or `minSec` if that is longer.
 */
export interface Beat {
  id: string;
  /** The voiceover line, spoken exactly as written. */
  say: string;
  /** Recorded clip to show (public/clips/<video>/<clip>.mp4). Omitted on the end card. */
  clip?: string;
  /** Seconds into the clip to start; "continue" picks up where the previous beat left the same clip. */
  from?: number | "continue";
  /** "STEP 3" label above the caption. */
  step?: number;
  caption?: string;
  /** The button that is tapped in this beat, echoed as a chip under the caption. */
  chip?: string;
  /** Soft spotlights, each from `at` seconds into the beat (until the next one or the end). */
  spot?: (Area & { at: number })[];
  /** A slow push-in towards a point, `s` times larger, starting `at` seconds into the beat. */
  zoom?: { x: number; y: number; s: number; at?: number };
  minSec?: number;
  /** Clip marks (from capture) that get a soft success sound. */
  sfx?: string[];
  /** Areas to blur (tokens, ids). */
  blur?: Area[];
}

export interface VideoSpec {
  id: string;
  title: string;
  orientation: "portrait" | "landscape";
  /** The capture's viewport in CSS pixels. */
  viewport: { w: number; h: number };
  beats: Beat[];
  endCard: { title: string; subtitle: string };
}
