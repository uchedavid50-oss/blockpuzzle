// Anonymous, self-hosted analytics. No third-party SDK, no runtime dependency, no cross-site id.
//
// Design rules, matching the leaderboard client:
// - Never block gameplay. Every call is fire-and-forget and swallows its own errors.
// - Never throw if storage is unavailable (private windows, blocked site data).
// - Degrade silently when offline or when no collector is configured.
//
// What is recorded is an opaque random id, a first-seen date and the events below. No accounts,
// no personal data, no advertising identifier. Retention is derived server-side from the id and
// first-seen date, so no per-player profile is ever assembled here.

const ID_KEY = "blockpuzzle.anonId";
const FIRST_KEY = "blockpuzzle.firstSeen";
const SRC_KEY = "blockpuzzle.src";

import { type EventName } from "./events.js";
export type { EventName };

export interface GameEvent {
  readonly name: EventName;
  /** Milliseconds since epoch, set when the event is queued. */
  readonly t: number;
  readonly props?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface Envelope {
  readonly id: string;
  readonly firstSeen: string;
  readonly src: string | null;
  readonly events: readonly GameEvent[];
}

/** A 22-character opaque id. Not derived from anything about the device or the player. */
export function mintId(): string {
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += (b % 36).toString(36);
  return s;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore: private window or blocked site data */
  }
}

function today(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Stable per-browser id. Minted on first run; never leaves this origin except in an envelope. */
export function anonId(): string {
  const existing = read(ID_KEY);
  if (existing) return existing;
  const fresh = mintId();
  write(ID_KEY, fresh);
  return fresh;
}

/** The day this browser first opened the game, used server-side to bucket retention cohorts. */
export function firstSeen(): string {
  const existing = read(FIRST_KEY);
  if (existing) return existing;
  const d = today();
  write(FIRST_KEY, d);
  return d;
}

/**
 * Acquisition source from `?src=` on the first visit only. Later visits never overwrite it, so a
 * player who arrives from TikTok and returns directly still counts against TikTok.
 */
export function captureSource(search: string): string | null {
  const existing = read(SRC_KEY);
  if (existing) return existing;
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get("src");
  } catch {
    return null;
  }
  if (!value) return null;
  const clean = value.slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!clean) return null;
  write(SRC_KEY, clean);
  return clean;
}

export function source(): string | null {
  return read(SRC_KEY);
}

// --- queue ------------------------------------------------------------------------------------

const MAX_QUEUE = 50;
let queue: GameEvent[] = [];
let endpoint: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Build the payload without sending it. Exported so the batching logic can be tested. */
export function envelope(events: readonly GameEvent[]): Envelope {
  return { id: anonId(), firstSeen: firstSeen(), src: source(), events };
}

/**
 * Queue an event. Flushes on a short delay so a burst of events becomes one request, and
 * immediately once the queue is full. Does nothing until `startAnalytics` has run.
 */
export function track(name: EventName, props?: GameEvent["props"]): void {
  if (!endpoint) return;
  queue.push({ name, t: Date.now(), props });
  if (queue.length >= MAX_QUEUE) {
    flush();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, 5000);
  }
}

/** Send whatever is queued. Safe to call at any time, including with an empty queue. */
export function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!endpoint || queue.length === 0) return;
  const batch = queue;
  queue = [];
  const body = JSON.stringify(envelope(batch));
  try {
    // sendBeacon survives the page being closed, which keeps the last session_end honest.
    if (navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }))) return;
  } catch {
    /* fall through to fetch */
  }
  try {
    void fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* offline: the batch is dropped on purpose rather than retried forever */
    });
  } catch {
    /* ignore */
  }
}

/**
 * Turn analytics on. Call once at startup. Passing no endpoint leaves every `track` call a no-op,
 * which is how the game behaves in development and if the collector is ever removed.
 */
export function startAnalytics(opts: { endpoint?: string | null; search?: string } = {}): void {
  endpoint = opts.endpoint ?? null;
  if (!endpoint) return;
  captureSource(opts.search ?? location.search);
  addEventListener("pagehide", flush);
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Test seam: clears module state between tests. Not used by the game. */
export function __reset(): void {
  queue = [];
  endpoint = null;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
