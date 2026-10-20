import { describe, expect, it } from "vitest";
import {
  INTERSTITIAL_COOLDOWN_MS,
  INTERSTITIAL_EVERY_N_RUNS,
  type AdOutcome,
  type AdProvider,
  afterInterstitial,
  afterRun,
  claimReward,
  freshFrequency,
  mayOfferRewarded,
  mayShowInterstitial,
  nullProvider,
} from "./ads.js";

const providerThat = (outcome: AdOutcome): AdProvider => ({
  rewarded: () => Promise.resolve(outcome),
  interstitial: () => Promise.resolve(outcome),
});

describe("claimReward", () => {
  it("grants only on a completed ad", async () => {
    expect(await claimReward(providerThat({ kind: "completed" }), "classic_undo")).toBe(true);
  });

  it("grants nothing when the ad is dismissed", async () => {
    expect(await claimReward(providerThat({ kind: "dismissed" }), "classic_undo")).toBe(false);
  });

  it("grants nothing when no ad is available", async () => {
    expect(await claimReward(providerThat({ kind: "unavailable" }), "classic_undo")).toBe(false);
  });

  it("grants nothing on an error outcome", async () => {
    expect(await claimReward(providerThat({ kind: "error", reason: "blocked" }), "classic_undo")).toBe(false);
  });

  it("grants nothing, and does not throw, when the provider throws", async () => {
    const broken: AdProvider = {
      rewarded: () => Promise.reject(new Error("network gone")),
      interstitial: () => Promise.reject(new Error("network gone")),
    };
    await expect(claimReward(broken, "classic_undo")).resolves.toBe(false);
  });

  it("grants nothing with no provider configured", async () => {
    expect(await claimReward(nullProvider, "classic_undo")).toBe(false);
  });

  it("reports request and completion", async () => {
    const seen: string[] = [];
    await claimReward(providerThat({ kind: "completed" }), "journey_retry", (n) => seen.push(n));
    expect(seen).toEqual(["ad_requested", "ad_completed"]);
  });

  it("reports a failure with its reason", async () => {
    const seen: Array<[string, Record<string, string> | undefined]> = [];
    await claimReward(providerThat({ kind: "dismissed" }), "journey_retry", (n, p) => seen.push([n, p]));
    expect(seen[1]?.[0]).toBe("ad_failed");
    expect(seen[1]?.[1]).toMatchObject({ reason: "dismissed" });
  });
});

describe("mayOfferRewarded", () => {
  it("allows rewarded ads in unranked modes", () => {
    for (const mode of ["classic", "journey", "zen", "archive"]) {
      expect(mayOfferRewarded(mode)).toBe(true);
    }
  });

  it("refuses them in scored modes that reach the leaderboard", () => {
    expect(mayOfferRewarded("daily")).toBe(false);
    expect(mayOfferRewarded("weekly")).toBe(false);
  });
});

describe("mayShowInterstitial", () => {
  const ready = { runsSinceAd: INTERSTITIAL_EVERY_N_RUNS, lastAdAt: 0 };
  const now = INTERSTITIAL_COOLDOWN_MS + 1;

  it("never shows one to an ad-free player", () => {
    expect(mayShowInterstitial(ready, now, true)).toBe(false);
  });

  it("waits for enough completed runs", () => {
    expect(mayShowInterstitial({ runsSinceAd: INTERSTITIAL_EVERY_N_RUNS - 1, lastAdAt: 0 }, now, false)).toBe(false);
  });

  it("waits for the cooldown even when runs qualify", () => {
    expect(mayShowInterstitial({ runsSinceAd: 99, lastAdAt: now }, now + 1000, false)).toBe(false);
  });

  it("shows one when both conditions hold", () => {
    expect(mayShowInterstitial(ready, now, false)).toBe(true);
  });

  it("resets the counter after showing one", () => {
    const after = afterInterstitial(ready, now);
    expect(after.runsSinceAd).toBe(0);
    expect(mayShowInterstitial(after, now, false)).toBe(false);
  });

  it("counts runs back up to the threshold", () => {
    let s = afterInterstitial(freshFrequency(), 0);
    for (let i = 0; i < INTERSTITIAL_EVERY_N_RUNS; i++) s = afterRun(s);
    expect(mayShowInterstitial(s, INTERSTITIAL_COOLDOWN_MS + 1, false)).toBe(true);
  });

  it("shows nothing on a fresh install until runs accumulate", () => {
    expect(mayShowInterstitial(freshFrequency(), Date.now(), false)).toBe(false);
  });
});

describe("nullProvider", () => {
  it("reports unavailable without touching the page", async () => {
    expect(await nullProvider.rewarded("classic_undo")).toEqual({ kind: "unavailable" });
    expect(await nullProvider.interstitial("between_runs")).toEqual({ kind: "unavailable" });
  });
});
