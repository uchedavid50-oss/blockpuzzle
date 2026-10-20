import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as A from "./analytics.js";
import { isPublisherId } from "./adLoader.js";

function storage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k),
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("location", { search: "", pathname: "/", origin: "http://x" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  A.__reset();
});
afterEach(() => vi.unstubAllGlobals());

describe("consent", () => {
  it("sends and stores nothing until the player says yes", async () => {
    const C = await import("./consent.js");
    expect(C.getConsent()).toBeNull();
    C.applyConsent();
    A.track("game_start");
    expect(localStorage.getItem("blockpuzzle.anonId")).toBeNull();
  });

  it("forgets the id when the player says no", async () => {
    const C = await import("./consent.js");
    const { lb } = await import("./leaderboardClient.js");
    lb.analytics = true;
    C.setConsent("yes"); C.applyConsent();
    A.anonId();
    expect(localStorage.getItem("blockpuzzle.anonId")).not.toBeNull();
    C.setConsent("no"); C.applyConsent();
    expect(localStorage.getItem("blockpuzzle.anonId")).toBeNull();
  });
});

describe("ownership", () => {
  it("ignores unknown skus in a tampered cache", async () => {
    const O = await import("./ownership.js");
    O.setOwned(["effect_pack", "free_everything"]);
    expect(O.ownership.ent.owned).toEqual(["effect_pack"]);
    expect(O.ownsSku("theme_pack_dusk")).toBe(false);
  });
});

describe("handleReturn", () => {
  it("does nothing unless the page was opened from checkout", async () => {
    const S = await import("./shopClient.js");
    expect(await S.handleReturn("?reference=abc")).toBeNull();
    expect(await S.handleReturn("")).toBeNull();
  });

  it("adopts the server's answer after a verified payment", async () => {
    const S = await import("./shopClient.js");
    const O = await import("./ownership.js");
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ owned: ["effect_pack"], sku: "effect_pack" }), { status: 200 })));
    const r = await S.handleReturn("?shop=return&reference=r1");
    expect(r).toMatchObject({ ok: true });
    expect(O.ownsSku("effect_pack")).toBe(true);
  });

  it("grants nothing when the payment did not complete", async () => {
    const S = await import("./shopClient.js");
    const O = await import("./ownership.js");
    O.setOwned([]);
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 402 })));
    const r = await S.handleReturn("?shop=return&reference=r2");
    expect(r).toMatchObject({ ok: false });
    expect(O.ownsSku("effect_pack")).toBe(false);
  });
});

describe("ad loader", () => {
  it("accepts only a real publisher id", () => {
    expect(isPublisherId("ca-pub-1234567890123456")).toBe(true);
    for (const bad of [undefined, "", "pub-123", "ca-pub-12", "ca-pub-1234567890<script>"]) expect(isPublisherId(bad)).toBe(false);
  });
});
