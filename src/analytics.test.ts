import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as A from "./analytics.js";

/** A tiny localStorage stand-in, shared by the tests below. */
function storage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

let beacons: { url: string; body: string }[];
let fetches: { url: string; body: string }[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("document", { visibilityState: "visible" });
  beacons = [];
  fetches = [];
  vi.stubGlobal("navigator", {
    sendBeacon: (url: string, blob: Blob) => { beacons.push({ url, body: (blob as unknown as { _t?: string })._t ?? "" }); return true; },
  });
  // Blob bodies are opaque in Node; keep the text so tests can read it.
  const RealBlob = Blob;
  vi.stubGlobal("Blob", class extends RealBlob { _t: string; constructor(parts: BlobPart[], o?: BlobPropertyBag) { super(parts, o); this._t = String(parts[0]); } });
  vi.stubGlobal("fetch", (url: string, init: { body: string }) => { fetches.push({ url, body: init.body }); return Promise.resolve(new Response("ok")); });
  A.__reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the anonymous id", () => {
  it("is 22 opaque characters", () => {
    expect(A.anonId()).toMatch(/^[a-z0-9]{22}$/);
  });
  it("is minted once and then stable", () => {
    expect(A.anonId()).toBe(A.anonId());
  });
  it("differs between browsers", () => {
    const seen = new Set(Array.from({ length: 20 }, () => A.mintId()));
    expect(seen.size).toBe(20);
  });
  it("survives blocked storage without throwing", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => A.anonId()).not.toThrow();
    expect(A.anonId()).toMatch(/^[a-z0-9]{22}$/);
  });
  it("records the first-seen day once", () => {
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    expect(A.firstSeen()).toBe("2026-10-20");
    vi.setSystemTime(new Date(2026, 9, 25, 12));
    expect(A.firstSeen()).toBe("2026-10-20");
  });
});

describe("acquisition source", () => {
  it("is taken from ?src= on the first visit", () => {
    expect(A.captureSource("?src=tiktok")).toBe("tiktok");
    expect(A.source()).toBe("tiktok");
  });
  it("is never overwritten by a later visit", () => {
    A.captureSource("?src=tiktok");
    expect(A.captureSource("?src=twitter")).toBe("tiktok");
    expect(A.source()).toBe("tiktok");
  });
  it("is sanitised and length-limited", () => {
    expect(A.captureSource("?src=" + encodeURIComponent("<script>x</script>a b!"))).toBe("scriptxscriptab");
  });
  it("is null when absent, empty or all junk", () => {
    expect(A.captureSource("")).toBeNull();
    expect(A.captureSource("?src=")).toBeNull();
    expect(A.captureSource("?src=%21%21%21")).toBeNull();
    expect(A.source()).toBeNull();
  });
  it("caps a very long value at 32 characters", () => {
    expect(A.captureSource("?src=" + "a".repeat(80))).toHaveLength(32);
  });
});

describe("sending events", () => {
  it("does nothing until analytics is started, so development sends nothing", () => {
    A.track("game_start");
    vi.advanceTimersByTime(60_000);
    expect(beacons).toHaveLength(0);
    expect(fetches).toHaveLength(0);
  });
  it("stays silent when started without an endpoint", () => {
    A.startAnalytics({ endpoint: null });
    A.track("game_start");
    vi.advanceTimersByTime(60_000);
    expect(beacons).toHaveLength(0);
  });
  it("batches a burst of events into one request after a short delay", () => {
    A.startAnalytics({ endpoint: "/api/collect", search: "" });
    A.track("game_start");
    A.track("mode_entered", { mode: "journey" });
    A.track("game_end", { score: 120 });
    expect(beacons).toHaveLength(0);
    vi.advanceTimersByTime(5001);
    expect(beacons).toHaveLength(1);
    const sent = JSON.parse(beacons[0]!.body) as A.Envelope;
    expect(sent.events.map((e) => e.name)).toEqual(["game_start", "mode_entered", "game_end"]);
    expect(sent.events[1]!.props).toEqual({ mode: "journey" });
  });
  it("sends immediately once the queue is full", () => {
    A.startAnalytics({ endpoint: "/api/collect", search: "" });
    for (let i = 0; i < 50; i++) A.track("game_start");
    expect(beacons).toHaveLength(1);
    expect((JSON.parse(beacons[0]!.body) as A.Envelope).events).toHaveLength(50);
  });
  it("flush sends what is queued, and nothing when empty", () => {
    A.startAnalytics({ endpoint: "/api/collect", search: "" });
    A.flush();
    expect(beacons).toHaveLength(0);
    A.track("session_start");
    A.flush();
    expect(beacons).toHaveLength(1);
    A.flush();
    expect(beacons).toHaveLength(1);
  });
  it("falls back to fetch when sendBeacon is unavailable", () => {
    vi.stubGlobal("navigator", {});
    A.startAnalytics({ endpoint: "/api/collect", search: "" });
    A.track("session_start");
    A.flush();
    expect(fetches).toHaveLength(1);
    expect(fetches[0]!.url).toBe("/api/collect");
  });
  it("never throws, even if both transports fail", () => {
    vi.stubGlobal("navigator", { sendBeacon: () => { throw new Error("no"); } });
    vi.stubGlobal("fetch", () => { throw new Error("offline"); });
    A.startAnalytics({ endpoint: "/api/collect", search: "" });
    A.track("error");
    expect(() => A.flush()).not.toThrow();
  });
});

describe("what is in a payload", () => {
  it("carries only the anonymous id, the first-seen day, the source and the events", () => {
    A.captureSource("?src=ig");
    const e = A.envelope([{ name: "game_start", t: 1 }]);
    expect(Object.keys(e).sort()).toEqual(["events", "firstSeen", "id", "src"]);
    expect(e.src).toBe("ig");
    expect(e.id).toMatch(/^[a-z0-9]{22}$/);
  });
});
