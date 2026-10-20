// The player's choice about anonymous usage data. Nothing is sent, and no id is even created, until
// they say yes; saying no (or changing their mind) stops it and removes the id from this device.

import { startAnalytics, stopAnalytics } from "./analytics.js";
import { lb } from "./leaderboardClient.js";

const KEY = "blockpuzzle.analyticsConsent";
export type Consent = "yes" | "no" | null;

export function getConsent(): Consent {
  try {
    const v = localStorage.getItem(KEY);
    return v === "yes" || v === "no" ? v : null;
  } catch { return null; }
}

export function setConsent(c: "yes" | "no"): void {
  try { localStorage.setItem(KEY, c); } catch { /* ignore */ }
}

/** Where events go: an explicit build-time address, or this deployment's own collector if it has one. */
export function analyticsEndpoint(): string | null {
  const explicit = import.meta.env.VITE_ANALYTICS_ENDPOINT;
  return explicit ? explicit : lb.analytics ? "/api/collect" : null;
}

/** Brings analytics in line with the stored choice. Safe to call repeatedly. */
export function applyConsent(): void {
  const endpoint = analyticsEndpoint();
  if (getConsent() === "yes" && endpoint) startAnalytics({ endpoint });
  else stopAnalytics({ forget: getConsent() === "no" });
}
