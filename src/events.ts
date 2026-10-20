// The closed list of analytics events, shared by the game (which sends them) and the server (which
// accepts only these). Pure: no DOM, no network.

import { COIN_ITEMS, COIN_PACKS, COIN_SOURCES } from "./economy.js";

export const EVENT_NAMES = [
  "session_start",
  "game_start",
  "game_end",
  "mode_entered",
  "journey_level",
  "daily_posted",
  "shop_viewed",
  "purchase_started",
  "purchase_completed",
  "ad_requested",
  "ad_completed",
  "ad_failed",
  "coins_earned",
  "coins_spent",
  "error",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Property values the server is willing to count by. Anything else is counted only as the bare event. */
export const COUNTED_PROPS: Readonly<Record<string, readonly string[]>> = {
  mode: ["classic", "daily", "weekly", "journey", "zen", "challenge", "archive", "leaderboard"],
  placement: ["classic_undo", "journey_retry", "between_runs", "coin_reward"],
  sku: ["no_interstitials", "theme_pack_dusk", "theme_pack_citrus", "effect_pack", "supporter_bundle", ...COIN_PACKS.map((p) => p.id)],
  source: [...COIN_SOURCES],
  item: COIN_ITEMS.map((i) => i.id),
};

/** Events whose numeric `coins` property the server adds up per day, so the admin page shows totals. */
export const SUMMED_EVENTS: readonly EventName[] = ["coins_earned", "coins_spent"];
