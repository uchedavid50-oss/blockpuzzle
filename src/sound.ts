// Synthesised sound effects: no audio files, so nothing to download and nothing to license.
// All tones are short Web Audio oscillators through a gain envelope.

const MUTE_KEY = "blockpuzzle.muted";

let ctxRef: AudioContext | null = null;
let muted = (() => {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
})();

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
  return muted;
}

/**
 * Browsers only allow audio after a user gesture. iOS is stricter than most: a context
 * created during a gesture still starts suspended, and resume() is async, so anything
 * scheduled in that same tick is lost. unlock() is called on pointerDOWN (a gesture),
 * one tick earlier than the first sound, and primes the context with a silent buffer —
 * the standard iOS unlock. Without it the first few effects are silently dropped.
 */
export function unlock(): void {
  if (muted || ctxRef) return;
  try {
    ctxRef = new AudioContext();
    const buf = ctxRef.createBuffer(1, 1, 22050);
    const src = ctxRef.createBufferSource();
    src.buffer = buf;
    src.connect(ctxRef.destination);
    src.start(0);
    void ctxRef.resume();
  } catch {
    ctxRef = null;
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctxRef ??= new AudioContext();
    if (ctxRef.state === "suspended") void ctxRef.resume();
    return ctxRef;
  } catch {
    return null;
  }
}

/** Diagnostics for "I hear nothing": call soundState() from the console. */
export function soundState(): { muted: boolean; context: string } {
  return { muted, context: ctxRef ? ctxRef.state : "not created" };
}

interface ToneOpts { freq: number; to?: number; dur: number; type?: OscillatorType; gain?: number; delay?: number }

function tone({ freq, to, dur, type = "sine", gain = 0.12, delay = 0 }: ToneOpts): void {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + 0.02 + delay;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  // Tiny attack avoids the click a hard start makes; exponential release sounds natural.
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/**
 * Frequencies live in the 240-1200 Hz band on purpose. Phone and laptop speakers roll off
 * hard below about 200 Hz, so the original 140-180 Hz tones measured at a 0.077 peak and
 * were effectively silent on anything but headphones. Keep new sounds in this band.
 */
export const sfx = {
  place: () => tone({ freq: 520, to: 390, dur: 0.11, type: "triangle", gain: 0.22 }),
  invalid: () => tone({ freq: 240, to: 160, dur: 0.12, type: "sawtooth", gain: 0.14 }),
  /** Pitch climbs with the combo, so a streak audibly escalates. */
  clear: (lines: number, combo: number) => {
    const base = 660 * Math.pow(1.09, Math.min(combo, 8));
    for (let i = 0; i < Math.min(lines, 4); i++) {
      const f = base * Math.pow(1.22, i);
      tone({ freq: f, to: f * 1.4, dur: 0.18, type: "sine", gain: 0.2, delay: i * 0.06 });
    }
  },
  gameOver: () => {
    tone({ freq: 520, to: 260, dur: 0.35, type: "triangle", gain: 0.2 });
    tone({ freq: 330, to: 165, dur: 0.5, type: "sine", gain: 0.16, delay: 0.14 });
  },
};
