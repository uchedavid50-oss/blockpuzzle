// Ad placement, wrapped so the game never talks to an ad network directly.
//
// Two rules this module exists to enforce:
//   1. A reward is granted ONLY when the network confirms the ad was watched to the end.
//      A failed, blocked, skipped or unavailable ad grants nothing — and never blocks play.
//   2. Frequency is decided here, not at the call site, so limits cannot be bypassed by accident.
//
// With no publisher id configured, `nullProvider` is used: every request reports "unavailable",
// the game carries on exactly as it does today, and nothing is loaded from a third party. That is
// the correct state until an AdSense account is approved.

/** Where in the game an ad was asked for. Used for frequency rules and for analytics. */
export type Placement = "classic_undo" | "journey_retry" | "between_runs" | "coin_reward";

export type AdOutcome =
  | { kind: "completed" }
  | { kind: "dismissed" }
  | { kind: "unavailable" }
  | { kind: "error"; reason: string };

export interface AdProvider {
  /** Opt-in, full-screen, grants a reward only on completion. */
  rewarded(placement: Placement): Promise<AdOutcome>;
  /** Full-screen at a natural break. Never grants anything. */
  interstitial(placement: Placement): Promise<AdOutcome>;
}

/** No network configured. Every call resolves "unavailable" without touching the page. */
export const nullProvider: AdProvider = {
  rewarded: () => Promise.resolve<AdOutcome>({ kind: "unavailable" }),
  interstitial: () => Promise.resolve<AdOutcome>({ kind: "unavailable" }),
};

// --- frequency ----------------------------------------------------------------------------------

/** Interstitials: at most one per this many milliseconds, and never before this many runs. */
export const INTERSTITIAL_COOLDOWN_MS = 5 * 60 * 1000;
export const INTERSTITIAL_EVERY_N_RUNS = 3;

export interface FrequencyState {
  readonly runsSinceAd: number;
  readonly lastAdAt: number;
}

export const freshFrequency = (): FrequencyState => ({ runsSinceAd: 0, lastAdAt: 0 });

/**
 * Whether an interstitial may be shown now. Pure, so the policy is testable without a network.
 * Both conditions must hold: enough completed runs AND the cooldown elapsed.
 */
export function mayShowInterstitial(s: FrequencyState, now: number, adFree: boolean): boolean {
  if (adFree) return false;
  if (s.runsSinceAd < INTERSTITIAL_EVERY_N_RUNS) return false;
  return now - s.lastAdAt >= INTERSTITIAL_COOLDOWN_MS;
}

export function afterRun(s: FrequencyState): FrequencyState {
  return { ...s, runsSinceAd: s.runsSinceAd + 1 };
}

export function afterInterstitial(_s: FrequencyState, now: number): FrequencyState {
  return { runsSinceAd: 0, lastAdAt: now };
}

/**
 * Whether a rewarded ad may be offered. Rewarded ads stay available to ad-free players, because
 * removing ads is about not being interrupted, not about losing the option.
 *
 * Scored modes take no paid or watched advantage: the daily and the weekly are posted to a
 * leaderboard, and a challenge link pits two players on identical pieces, so an ad that buys an
 * extra undo in any of them would corrupt the comparison.
 */
export function mayOfferRewarded(mode: string): boolean {
  return mode !== "daily" && mode !== "weekly" && mode !== "challenge";
}

// --- reward gating --------------------------------------------------------------------------

/**
 * Run a rewarded ad and report whether the reward is earned. The ONLY path that returns true is
 * an outcome of `completed`; everything else, including an exception from the provider, is false.
 */
export async function claimReward(
  provider: AdProvider,
  placement: Placement,
  onEvent?: (name: "ad_requested" | "ad_completed" | "ad_failed", props?: Record<string, string>) => void,
): Promise<boolean> {
  onEvent?.("ad_requested", { placement });
  let outcome: AdOutcome;
  try {
    outcome = await provider.rewarded(placement);
  } catch {
    onEvent?.("ad_failed", { placement, reason: "threw" });
    return false;
  }
  if (outcome.kind === "completed") {
    onEvent?.("ad_completed", { placement });
    return true;
  }
  onEvent?.("ad_failed", { placement, reason: outcome.kind });
  return false;
}

/** If the network never reports back at all, give up rather than leaving the player waiting forever. */
export const AD_TIMEOUT_MS = 120_000;

// --- H5 Games Ads (AdSense Ad Placement API) --------------------------------------------------

/**
 * Google's Ad Placement API, the only Google product that serves ads in a browser game.
 * AdMob is a native SDK and does not work here.
 *
 * The script tag and publisher id belong in index.html, not in this bundle. This provider assumes
 * `window.adBreak` exists; if it does not, every call reports "unavailable".
 */
interface AdBreakOptions {
  type: string;
  name: string;
  beforeReward?: (show: () => void) => void;
  adDismissed?: () => void;
  adViewed?: () => void;
  adBreakDone?: (info: { breakStatus: string }) => void;
}

type AdBreakFn = (o: AdBreakOptions) => void;

export function h5Provider(): AdProvider {
  const adBreak = (globalThis as { adBreak?: AdBreakFn }).adBreak;
  if (typeof adBreak !== "function") return nullProvider;

  const rewarded = (placement: Placement): Promise<AdOutcome> =>
    new Promise<AdOutcome>((resolve) => {
      let viewed = false;
      let settled = false;
      const timer = setTimeout(() => settle({ kind: "unavailable" }), AD_TIMEOUT_MS);
      const settle = (o: AdOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(o);
      };
      try {
        adBreak({
          type: "reward",
          name: placement,
          // Policy: the player opts in to each ad individually, so the ad is shown here, from
          // inside a handler the game only reaches after an explicit tap.
          beforeReward: (show) => show(),
          adViewed: () => {
            viewed = true;
          },
          adDismissed: () => settle({ kind: "dismissed" }),
          adBreakDone: (info) =>
            settle(
              viewed
                ? { kind: "completed" }
                : info.breakStatus === "viewed"
                  ? { kind: "completed" }
                  : { kind: "unavailable" },
            ),
        });
      } catch (e) {
        settle({ kind: "error", reason: String(e) });
      }
    });

  const interstitial = (placement: Placement): Promise<AdOutcome> =>
    new Promise<AdOutcome>((resolve) => {
      try {
        adBreak({
          type: "next",
          name: placement,
          adBreakDone: (info) =>
            resolve(info.breakStatus === "viewed" ? { kind: "completed" } : { kind: "unavailable" }),
        });
      } catch (e) {
        resolve({ kind: "error", reason: String(e) });
      }
    });

  return { rewarded, interstitial };
}

/** Pick a provider. Returns `nullProvider` unless the Ad Placement API is actually present. */
export function provider(): AdProvider {
  try {
    return h5Provider();
  } catch {
    return nullProvider;
  }
}
