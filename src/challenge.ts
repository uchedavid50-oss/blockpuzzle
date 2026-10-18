// Challenge links: a seed (so a friend gets the same pieces) and a target score to beat.
// Pure functions: no DOM, so the parsing of untrusted URL input can be tested.

export interface Challenge { seed: string; target: number }

const SEED_RE = /^[a-z0-9-]{3,24}$/i;
const MAX_TARGET = 10_000_000;

/** Reads ?c=<seed>&t=<score> from a query string. Anything malformed is rejected, not repaired. */
export function parseChallenge(search: string): Challenge | null {
  const q = new URLSearchParams(search);
  const seed = q.get("c");
  const raw = q.get("t");
  if (!seed || !SEED_RE.test(seed) || raw === null || !/^\d{1,8}$/.test(raw)) return null;
  const target = Number(raw);
  return target <= MAX_TARGET ? { seed, target } : null;
}

export function challengeUrl(origin: string, seed: string, score: number): string {
  return `${origin}/?c=${encodeURIComponent(seed)}&t=${Math.max(0, Math.floor(score))}`;
}

export function randomSeed(rng: () => number = Math.random): string {
  let s = "";
  while (s.length < 6) s += Math.floor(rng() * 36).toString(36);
  return s;
}
