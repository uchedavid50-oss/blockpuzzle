import { afterEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { apiUrl, publicOrigin } from "./platform";
import { provider, nullProvider } from "./ads";
import { beginCheckout, handleReturn } from "./shopClient";
import { loadAds, adsState } from "./adLoader";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("native boundaries", () => {
  it("keeps web API requests relative", () => { expect(apiUrl("/api/health")).toBe("/api/health"); });
  it("pins native API and share URLs and rejects external origins", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    expect(apiUrl("/api/save")).toBe("https://www.bunblocks.app/api/save");
    expect(publicOrigin()).toBe("https://bunblocks.app");
    for (const path of ["https://evil.test/api/save", "//evil.test/api/save", "/par.json", "http://bunblocks.app/api/save"])
      expect(() => apiUrl(path)).toThrow();
  });
  it("never initializes ads or starts Paystack in native", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    loadAds("ca-pub-9801433726858336", false);
    expect(adsState.requested).toBe(false);
    expect(provider()).toBe(nullProvider);
    expect((await beginCheckout("no_interstitials")).ok).toBe(false);
    expect(await handleReturn("?shop=return&reference=test")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
