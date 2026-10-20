import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AD_TIMEOUT_MS, claimReward, mayOfferRewarded, nullProvider, provider } from "./ads.js";

type Opts = { type: string; name: string; beforeReward?: (show: () => void) => void; adViewed?: () => void; adDismissed?: () => void; adBreakDone?: (i: { breakStatus: string }) => void };
const g = globalThis as { adBreak?: (o: Opts) => void };

afterEach(() => {
  delete g.adBreak;
  vi.useRealTimers();
});

describe("provider()", () => {
  it("is the null provider when the ad API is not on the page", () => {
    expect(provider()).toBe(nullProvider);
  });
  it("uses the ad API when it is present", () => {
    g.adBreak = () => {};
    expect(provider()).not.toBe(nullProvider);
  });
});

describe("rewarded ads through the Ad Placement API", () => {
  beforeEach(() => vi.useFakeTimers());

  it("completes only after the ad was viewed", async () => {
    g.adBreak = (o) => { o.beforeReward?.(() => {}); o.adViewed?.(); o.adBreakDone?.({ breakStatus: "viewed" }); };
    expect(await claimReward(provider(), "classic_undo")).toBe(true);
  });

  it("grants nothing when the player dismisses it", async () => {
    g.adBreak = (o) => { o.adDismissed?.(); o.adBreakDone?.({ breakStatus: "dismissed" }); };
    expect(await claimReward(provider(), "classic_undo")).toBe(false);
  });

  it("grants nothing when no ad could be shown", async () => {
    g.adBreak = (o) => o.adBreakDone?.({ breakStatus: "noAdPreloaded" });
    expect(await claimReward(provider(), "classic_undo")).toBe(false);
  });

  it("does not hang if the network never answers", async () => {
    g.adBreak = () => {}; // never calls back
    const pending = claimReward(provider(), "classic_undo");
    await vi.advanceTimersByTimeAsync(AD_TIMEOUT_MS + 1);
    expect(await pending).toBe(false);
  });

  it("a late completion after the timeout cannot grant a reward", async () => {
    let late: (() => void) | undefined;
    g.adBreak = (o) => { late = () => { o.adViewed?.(); o.adBreakDone?.({ breakStatus: "viewed" }); }; };
    const pending = claimReward(provider(), "classic_undo");
    await vi.advanceTimersByTimeAsync(AD_TIMEOUT_MS + 1);
    late?.();
    expect(await pending).toBe(false);
  });

  it("treats a throwing ad API as a failure, not a crash", async () => {
    g.adBreak = () => { throw new Error("blocked"); };
    await expect(claimReward(provider(), "classic_undo")).resolves.toBe(false);
  });

  it("asks for a reward-type break, named for the placement", async () => {
    let seen: Opts | undefined;
    g.adBreak = (o) => { seen = o; o.adBreakDone?.({ breakStatus: "noAdPreloaded" }); };
    await claimReward(provider(), "journey_retry");
    expect(seen).toMatchObject({ type: "reward", name: "journey_retry" });
  });
});

describe("interstitials through the Ad Placement API", () => {
  it("reports a viewed break as completed and anything else as unavailable", async () => {
    g.adBreak = (o) => o.adBreakDone?.({ breakStatus: "viewed" });
    expect(await provider().interstitial("between_runs")).toEqual({ kind: "completed" });
    g.adBreak = (o) => o.adBreakDone?.({ breakStatus: "frequencyCapped" });
    expect(await provider().interstitial("between_runs")).toEqual({ kind: "unavailable" });
  });
  it("uses a next-type break", async () => {
    let seen: Opts | undefined;
    g.adBreak = (o) => { seen = o; o.adBreakDone?.({ breakStatus: "viewed" }); };
    await provider().interstitial("between_runs");
    expect(seen?.type).toBe("next");
  });
});

describe("mayOfferRewarded and challenges", () => {
  it("refuses a challenge game, where an extra undo would be unfair to the friend", () => {
    expect(mayOfferRewarded("challenge")).toBe(false);
  });
});
