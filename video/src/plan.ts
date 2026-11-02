// Turns a spec, the voice lengths and the capture data into a frame-exact timeline. Pure: no React.
import type { Area, Beat, Box, VideoSpec } from "./specs/types";
import { FPS, beatSeconds } from "./timing";

export interface CaptureEv { frame: number; type: "tap" | "down" | "up"; x: number; y: number }
export interface CaptureClip { name: string; frames: number; events: CaptureEv[]; marks: Record<string, number> }
export interface Capture { clips: CaptureClip[]; boxes?: Record<string, Box> }

export interface PlannedBeat { beat: Beat; start: number; frames: number; /** clip frame showing at the beat's first frame */ clipAt: number }
export interface Segment { clip: CaptureClip | null; start: number; frames: number; clipAt: number; beats: PlannedBeat[] }
export interface Plan { beats: PlannedBeat[]; segments: Segment[]; total: number }

/** Frames a clip change takes to dissolve. */
export const DISSOLVE = 10;

export function plan(spec: VideoSpec, durations: Record<string, number>, capture: Capture): Plan {
  const beats: PlannedBeat[] = [];
  const segments: Segment[] = [];
  let t = 0;
  for (const beat of spec.beats) {
    const frames = Math.round(beatSeconds(beat, durations) * FPS);
    const prev = beats[beats.length - 1];
    const cont = beat.from === "continue";
    if (cont && prev?.beat.clip !== beat.clip) throw new Error(`beat "${beat.id}" continues a different clip`);
    const clipAt = cont ? prev!.clipAt + prev!.frames : Math.round(((beat.from as number | undefined) ?? 0) * FPS);
    const pb = { beat, start: t, frames, clipAt };
    beats.push(pb);
    const seg = segments[segments.length - 1];
    if (cont && seg) { seg.frames += frames; seg.beats.push(pb); }
    else {
      const clip = beat.clip ? capture.clips.find((c) => c.name === beat.clip) ?? null : null;
      if (beat.clip && !clip) throw new Error(`no captured clip "${beat.clip}": run the capture`);
      segments.push({ clip, start: t, frames, clipAt, beats: [pb] });
    }
    t += frames;
  }
  return { beats, segments, total: t };
}

export function resolve(a: Area, capture: Capture): Box {
  if ("ref" in a) {
    const b = capture.boxes?.[a.ref];
    if (!b) throw new Error(`no measured box "${a.ref}"`);
    return b;
  }
  return a;
}

/** The camera (zoom inside the screen) at a frame: eased moves between per-beat targets. */
export function camera(p: Plan, spec: VideoSpec, frame: number): { s: number; x: number; y: number } {
  const rest = { s: 1, x: spec.viewport.w / 2, y: spec.viewport.h / 2 };
  const keys: { f: number; s: number; x: number; y: number }[] = [{ f: 0, ...rest }];
  for (const b of p.beats) {
    const z = b.beat.zoom;
    if (z) keys.push({ f: b.start + Math.round((z.at ?? 0) * FPS), s: z.s, x: z.x, y: z.y });
    else if (keys[keys.length - 1]!.s !== 1) keys.push({ f: b.start, ...rest, x: keys[keys.length - 1]!.x, y: keys[keys.length - 1]!.y });
  }
  const MOVE = 30;
  let cur = { s: 1, x: rest.x, y: rest.y };
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i]!;
    if (frame < k.f) break;
    const prev = cur;
    const t = Math.min(1, (frame - k.f) / MOVE);
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    cur = { s: prev.s + (k.s - prev.s) * e, x: k.s === 1 ? prev.x : prev.x + (k.x - prev.x) * e, y: k.s === 1 ? prev.y : prev.y + (k.y - prev.y) * e };
    if (t < 1) return cur;
    cur = { s: k.s, x: k.s === 1 ? prev.x : k.x, y: k.s === 1 ? prev.y : k.y };
  }
  return cur;
}
