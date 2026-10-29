// The screens drawn over the game: praise banners, toasts, stats, the modes sheet, the challenge
// invitation and the first-run hint. Rendering only. Their open/closed state lives in `ui`, which the
// input handlers in main.ts read and write.

import { ctx, W, H, dpr, cell, boardY, COLORS, ROUND, BRAND, reduceMotion, easeOutBack, setReduceMotion, star, paintScene, dim, sheet, candyButton, bubbleText, roundButton, coin } from "./gfx";
import { COIN_ITEMS, COIN_PACKS, ECONOMY, coinItem, isCoinItem } from "./economy";
import { adsLeftToday, balance, ownsCoinItem, purchase, savedUndos, wallet, watchAdForCoins } from "./coins";
import { provider } from "./ads";
import { adsReady } from "./adLoader";
import { isMuted, toggleMute } from "./sound";
import { lb, type BoardData, type StreakData } from "./leaderboardClient";
import { setSetting, settings } from "./settings";
import { haptics } from "./haptics";
import { forSale, formatPrice } from "./entitlements";
import { ownership } from "./ownership";
import { beginCheckout, restoreFromCode, syncEntitlements, transferCode } from "./shopClient";
import { openAccount } from "./accountUI";
import { account, signedIn, signinOffered } from "./cloudClient";
import { adChoicesAvailable, showAdChoices } from "./adLoader";
import { applyConsent, getConsent, setConsent } from "./consent";
import { track } from "./analytics";
import { PALETTE, BADGES, COLLECTION_SIZE, THEMES, TILE_ORDER, applyTheme, collectionTiles, perkUndos, rankName, readStreak, stats, streakNow, themeIdx, themeUnlocked, today, unlocked, type Toast } from "./progress";
import { officialResult, parFor, postedResult, readJourney, weeklyCompleted } from "./records";
import { BUCKET_LABELS } from "./meta";
import { parseChallenge, type Challenge } from "./challenge";
import { addDays, freezeAvailable, weekId } from "./streak";
import { weeklyFor } from "./weekly";

export const HINT_KEY = "blockpuzzle.hintSeen";
export const PRAISE = ["Nice!", "Great!", "Awesome!", "Fantastic!", "Unreal!", "Perfect!"];
export const PRAISE_COLORS = ["#7fe3a8", "#5ec8ff", "#ffc555", "#ff8a5c", "#ff5fa8", "#ffe27a"];
export interface Praise { text: string; t: number; level: number }

/** Which overlay is open, and its animation clock. Main's pointer handlers toggle these. */
export const ui = {
  // Opened from a friend's link: offer the challenge before touching the current game.
  chIntro: (() => {
    try {
      const c = parseChallenge(location.search);
      if (c) history.replaceState(null, "", location.pathname);
      return c;
    } catch { return null; }
  })() as Challenge | null,
  chPress: null as "play" | "skip" | null,
  chT: 0,
  modesOn: false,
  modesView: "main" as "main" | "archive",
  modesT: 0,
  modesPress: null as { x: number; y: number } | null,
  statsOn: false,
  statsT: 0,
  statsPress: null as { x: number; y: number } | null,
  statsTab: 0,
  badgeSel: -1,
  hintOn: (() => {
    try { return localStorage.getItem(HINT_KEY) !== "1"; } catch { return false; }
  })(),
  hintT: 0,
  hintPress: false,
  settingsOn: false,
  settingsT: 0,
  settingsPress: null as { x: number; y: number } | null,
  settingsNote: "",
  consentOn: false,
  consentT: 0,
  consentPress: null as { x: number; y: number } | null,
  themePage: 0,
  settingsPage: "main" as "main" | "themes" | "shop" | "coins",
  shopNote: "",
  shopBusy: false,
  coinNote: "",
  coinBusy: false, // a rewarded ad is in flight: further taps on it are ignored
  // leaderboard
  lbOn: false,
  lbT: 0,
  lbTab: 0,
  lbPress: null as { x: number; y: number } | null,
  lbBoard: null as BoardData | null,
  lbStreaks: null as StreakData | null,
  lbCup: null as BoardData | null,
  lbCupId: "",
  lbCupCanPost: false,
  lbCupPosted: null as { rank: number; total: number; score: number } | null,
  lbLoading: false,
  lbMsg: "",
  lbCanPost: false, // today's first attempt is finished, verifiable and not yet posted
  lbPosted: null as { rank: number; total: number; score: number } | null,
};

export const chHit = (x: number, y: number): "play" | "skip" | null =>
  Math.abs(x - W / 2) <= 100 && y >= H / 2 + 66 && y <= H / 2 + 126 ? "play"
  : Math.abs(x - W / 2) <= 100 && y >= H / 2 + 132 && y <= H / 2 + 176 ? "skip" : null;

/** Big bouncy banner in the middle of the board: pops in with overshoot, holds, then floats off. */
export function drawPraise(pr: Praise): void {
  const t = pr.t;
  const pop = t < 0.18 ? easeOutBack(t / 0.18) : 1;
  const fade = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
  const rise = t > 0.72 ? ((t - 0.72) / 0.28) * cell * 0.9 : 0;
  const size = Math.round(cell * (1.05 + pr.level * 0.12));
  const color = PRAISE_COLORS[pr.level - 1]!;
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.translate(W / 2, boardY + cell * 3.4 - rise);
  ctx.rotate(-0.07 + (reduceMotion ? 0 : Math.sin(t * 14) * 0.02));
  ctx.scale(pop, pop);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${size}px ${ROUND}`;
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.strokeStyle = "#3b1291";
  ctx.lineWidth = size * 0.22;
  ctx.strokeText(pr.text, 0, 0);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * 0.1;
  ctx.strokeText(pr.text, 0, 0);
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillText(pr.text, 0, 0);
  ctx.restore();
}

/** Slides a "badge unlocked" card down from the top, holds, then tucks it away. */
export function drawToast(t: Toast): void {
  const inT = Math.min(1, t.t / 0.1);
  const outT = t.t > 0.88 ? (t.t - 0.88) / 0.12 : 0;
  const slide = easeOutBack(inT) * (1 - outT);
  const w = Math.min(W - 32, 320);
  const y = -70 + slide * 190;
  ctx.save();
  ctx.translate(W / 2, y);
  ctx.shadowColor = "rgba(60,10,90,0.35)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(-w / 2 - 4, -4, w + 8, 68, 22);
  ctx.fill();
  ctx.shadowColor = "transparent";
  const tg = ctx.createLinearGradient(0, 0, 0, 60);
  tg.addColorStop(0, "#fffbe6");
  tg.addColorStop(1, "#ffe9b0");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.roundRect(-w / 2, 0, w, 60, 18);
  ctx.fill();
  const g = ctx.createLinearGradient(0, 14, 0, 46);
  g.addColorStop(0, "#fff0b3");
  g.addColorStop(1, "#ffb42e");
  ctx.fillStyle = g;
  star(-w / 2 + 34, 30, 17);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.combo;
  ctx.font = `800 11px ${ROUND}`;
  ctx.fillText(t.label ?? "BADGE UNLOCKED", -w / 2 + 62, 17);
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 16px ${ROUND}`;
  ctx.fillText(t.title, -w / 2 + 62, 35);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 12px ${ROUND}`;
  ctx.fillText(t.desc, -w / 2 + 62, 51, w - 76);
  ctx.restore();
}

// ---- Stats screen ------------------------------------------------------------------

export const CARD_H = 600;
export const TABS = ["Stats", "Badges", "Collection"] as const;
/** Card is laid out in a 600-unit-tall box and scaled down to fit short screens. */
export function statsLayout(): { k: number; cw: number } {
  const k = Math.min(1, (H - 24) / CARD_H);
  return { k, cw: Math.min((W - 24) / k, 360) };
}
export function badgeCell(i: number, l: { cw: number }): { x: number; y: number; w: number } {
  const w = (l.cw - 32) / 4;
  return { x: -l.cw / 2 + 16 + w * (i % 4) + w / 2, y: -170 + Math.floor(i / 4) * 56, w };
}
export const tabRect = (i: number, cw: number): { x: number; y: number; w: number; h: number } => {
  const w = (cw - 48) / 3;
  return { x: -cw / 2 + 24 + i * w, y: -250, w, h: 32 };
};

export function drawStats(): void {
  const l = statsLayout();
  const e = 1 - Math.pow(1 - ui.statsT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dim(e);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  const cw = l.cw;
  sheet(cw, CARD_H, "Your progress");

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  TABS.forEach((name, i) => {
    const r = tabRect(i, cw);
    const on = ui.statsTab === i;
    ctx.fillStyle = on ? "rgba(138,77,255,0.2)" : "rgba(138,77,255,0.07)";
    ctx.beginPath();
    ctx.roundRect(r.x + 2, r.y, r.w - 4, r.h, 16);
    ctx.fill();
    ctx.fillStyle = on ? COLORS.text : COLORS.dim;
    ctx.font = `700 13px ${ROUND}`;
    ctx.fillText(name, r.x + r.w / 2, r.y + r.h / 2 + 1);
  });

  if (ui.statsTab === 0) drawStatsTab(cw);
  else if (ui.statsTab === 1) drawBadgesTab(l);
  else drawCollectionTab(cw);

  candyButton(0, 268, 168, 42, "Close", "violet", 0, 17);
  ctx.restore();
}

export function drawStatsTab(cw: number): void {
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.combo;
  ctx.font = `700 13px ${ROUND}`;
  const perk = perkUndos();
  ctx.fillText(`Rank: ${rankName()}${perk ? `  \u00B7  +${perk} undo${perk > 1 ? "s" : ""} in random games` : ""}`, 0, -196, cw - 40);

  const avg = stats.finished ? Math.round(stats.total / stats.finished) : 0;
  const tiles: [string, string][] = [
    ["Games", stats.games.toLocaleString()], ["Best score", stats.bestScore.toLocaleString()], ["Average", avg.toLocaleString()],
    ["Best combo", `${stats.bestCombo}x`], ["Lines cleared", stats.lines.toLocaleString()], ["Perfect clears", String(stats.perfects)],
  ];
  const tw = (cw - 48 - 20) / 3;
  tiles.forEach(([name, value], i) => {
    const x = -cw / 2 + 24 + (i % 3) * (tw + 10);
    const y = -172 + Math.floor(i / 3) * 70;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.roundRect(x, y, tw, 62, 14);
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.font = `800 ${value.length > 9 ? 13 : 20}px ${ROUND}`;
    ctx.fillText(value, x + tw / 2, y + 25, tw - 8);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 11px ${ROUND}`;
    ctx.fillText(name, x + tw / 2, y + 46, tw - 8);
  });

  // Score distribution: where your finished games land.
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 14px ${ROUND}`;
  ctx.fillText("Score distribution", -cw / 2 + 24, -16);
  const peak = Math.max(1, ...stats.hist);
  stats.hist.forEach((count, i) => {
    const y = 4 + i * 23;
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 11px ${ROUND}`;
    ctx.textAlign = "left";
    ctx.fillText(BUCKET_LABELS[i]!, -cw / 2 + 24, y + 9);
    const maxW = cw - 48 - 64;
    ctx.fillStyle = "rgba(138,77,255,0.1)";
    ctx.beginPath();
    ctx.roundRect(-cw / 2 + 64, y, maxW, 18, 6);
    ctx.fill();
    if (count > 0) {
      const g = ctx.createLinearGradient(-cw / 2 + 64, 0, -cw / 2 + 64 + maxW, 0);
      g.addColorStop(0, "#6cb4ff");
      g.addColorStop(1, "#9a7bff");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(-cw / 2 + 64, y, Math.max(8, (maxW * count) / peak), 18, 6);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "right";
    ctx.font = `700 11px ${ROUND}`;
    ctx.fillText(String(count), -cw / 2 + 64 + maxW - 6, y + 10);
  });

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 12px ${ROUND}`;
  const rec = readStreak();
  const freeze = freezeAvailable(rec, today()) ? "freeze ready" : "freeze used this week";
  ctx.fillText(`Daily streak ${streakNow()} \u00B7 best ${stats.bestStreak} \u00B7 ${freeze}`, 0, 168, cw - 40);
  ctx.fillText(`Weekly wins ${stats.weeklyWins} \u00B7 Journey levels ${stats.levels} \u00B7 Zen lines ${stats.zenLines}`, 0, 192, cw - 40);
}

export function drawBadgesTab(l: { cw: number }): void {
  const cw = l.cw;
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 15px ${ROUND}`;
  ctx.fillText("Badges", -cw / 2 + 24, -196);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `700 13px ${ROUND}`;
  ctx.fillText(`${unlocked.length} / ${BADGES.length}`, cw / 2 - 24, -196);

  ctx.textAlign = "center";
  BADGES.forEach((b, i) => {
    const c = badgeCell(i, l);
    const got = unlocked.includes(b.id);
    if (ui.badgeSel === i) {
      ctx.fillStyle = "rgba(138,77,255,0.12)";
      ctx.beginPath();
      ctx.roundRect(c.x - c.w / 2 + 2, c.y - 3, c.w - 4, 54, 12);
      ctx.fill();
    }
    if (got) {
      const g = ctx.createLinearGradient(0, c.y, 0, c.y + 30);
      g.addColorStop(0, "#fff0b3");
      g.addColorStop(1, "#ffb42e");
      ctx.fillStyle = g;
      ctx.shadowColor = "rgba(255,180,46,0.6)";
      ctx.shadowBlur = 10;
      star(c.x, c.y + 14, 14);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = "rgba(90,40,140,0.3)";
      ctx.lineWidth = 1.5;
      star(c.x, c.y + 14, 13);
      ctx.stroke();
      const pr = b.progress?.();
      if (pr) {
        const bw = c.w - 22;
        ctx.fillStyle = "rgba(138,77,255,0.15)";
        ctx.beginPath();
        ctx.roundRect(c.x - bw / 2, c.y + 44, bw, 4, 2);
        ctx.fill();
        ctx.fillStyle = COLORS.combo;
        ctx.beginPath();
        ctx.roundRect(c.x - bw / 2, c.y + 44, Math.max(3, bw * Math.min(1, pr[0] / pr[1])), 4, 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = got ? COLORS.text : "#b49cc8";
    ctx.font = `600 11px ${ROUND}`;
    ctx.fillText(b.name, c.x, c.y + 35, c.w - 4);
  });

  const sel = ui.badgeSel >= 0 ? BADGES[ui.badgeSel] : undefined;
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 13px ${ROUND}`;
  ctx.fillText(sel ? `${sel.name}: ${sel.desc}` : "Tap a badge to see how to earn it.", 0, 178, cw - 40);
  if (sel) {
    const pr = sel.progress?.();
    const got = unlocked.includes(sel.id);
    ctx.fillStyle = COLORS.combo;
    ctx.font = `700 12px ${ROUND}`;
    const bits = [
      got ? "Earned" : pr ? `Progress ${Math.min(pr[0], pr[1]).toLocaleString()} / ${pr[1].toLocaleString()}` : "",
      sel.reward ? `Reward: ${sel.reward}` : "",
    ].filter(Boolean);
    ctx.fillText(bits.join("  \u00B7  "), 0, 200, cw - 40);
  } else {
    ctx.font = `500 12px ${ROUND}`;
    ctx.fillText("Every 5 badges: +1 undo in random games.", 0, 200, cw - 40);
  }
}

export function drawCollectionTab(cw: number): void {
  const n = collectionTiles();
  const size = Math.min(264, cw - 64);
  const tile = size / 4;
  const x0 = -size / 2;
  const y0 = -196;
  const shown = new Set(TILE_ORDER.slice(0, n));
  for (let i = 0; i < COLLECTION_SIZE; i++) {
    const tx = x0 + (i % 4) * tile;
    const ty = y0 + Math.floor(i / 4) * tile;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(tx + 1.5, ty + 1.5, tile - 3, tile - 3, 8);
    ctx.clip();
    if (shown.has(i)) {
      paintScene(x0, y0, size);
    } else {
      ctx.fillStyle = "#eadff7";
      ctx.fillRect(tx, ty, tile, tile);
      ctx.fillStyle = "rgba(138,77,255,0.2)";
      ctx.font = `700 ${Math.round(tile * 0.4)}px ${ROUND}`;
      ctx.textAlign = "center";
      ctx.fillText("?", tx + tile / 2, ty + tile / 2 + 1);
    }
    ctx.restore();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 15px ${ROUND}`;
  ctx.fillText(`${n} / ${COLLECTION_SIZE} tiles`, 0, y0 + size + 24);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 12px ${ROUND}`;
  const toNext = 40 - (stats.lines % 40);
  ctx.fillText(n >= COLLECTION_SIZE ? "Complete! The Prism theme is yours." : `Next tile in ${toNext} lines, or a weekly win or 5 journey levels.`, 0, y0 + size + 46, cw - 40);
  ctx.fillStyle = COLORS.combo;
  ctx.font = `700 12px ${ROUND}`;
  ctx.fillText(n >= COLLECTION_SIZE ? "Unlocked: Prism theme" : "Reward: Prism theme when complete", 0, y0 + size + 68, cw - 40);
}

// ---- Modes sheet ------------------------------------------------------------------

export const MODES_H = 580;
/** Rows are slightly tighter when the leaderboard row is present, so everything still fits. */
export const modesRow = (i: number): { y: number; h: number } => (lb.available ? { y: -200 + i * 60, h: 54 } : { y: -200 + i * 70, h: 62 });
export function modesLayout(): { k: number; cw: number } {
  const k = Math.min(1, (H - 24) / MODES_H);
  return { k, cw: Math.min((W - 24) / k, 350) };
}

/** The last fortnight of dailies, newest first, for the archive. */
export const archiveDates = (): string[] => Array.from({ length: 14 }, (_, i) => addDays(today(), -(i + 1)));

export function drawModes(dt: number): void {
  ui.modesT = Math.min(1, ui.modesT + dt * 3);
  const l = modesLayout();
  const e = 1 - Math.pow(1 - ui.modesT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dim(e);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  const cw = l.cw;
  sheet(cw, MODES_H, ui.modesView === "main" ? "Choose a mode" : "Daily archive");

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  if (ui.modesView === "main") roundButton(cw / 2 - 38, -251, 15, "\u2699", "violet");

  if (ui.modesView === "main") {
    const t = today();
    const off = officialResult(t);
    const par = parFor(t);
    const wk = weeklyFor(weekId(t));
    const j = readJourney();
    const stars = Object.values(j.stars).reduce((a, b) => a + b, 0);
    const rows: { icon: string; name: string; sub: string; tag?: string; hot?: boolean }[] = [
      { icon: "\u{1F3B2}", name: "Classic", sub: "Endless. Chase your best score." },
      {
        icon: "\u{1F4C5}", name: "Daily",
        sub: off ? `Your result: ${off.score.toLocaleString("en-US")}${par ? ` \u00B7 par ${par}` : ""}. Replays are practice.` : `Same pieces for everyone${par ? ` \u00B7 par ${par}` : ""}.`,
        tag: streakNow() > 0 ? `\u{1F525} ${streakNow()}` : undefined, hot: !off,
      },
      { icon: "\u26A1", name: `Weekly: ${wk.title}`, sub: wk.rule, tag: weeklyCompleted(weekId(t)) ? "\u2713 done" : lb.available ? "\u{1F3C6} Cup" : undefined, hot: !weeklyCompleted(weekId(t)) },
      { icon: "\u{1F9ED}", name: "Journey", sub: `Level ${j.next} next \u00B7 ${stars} \u2605 earned` },
      { icon: "\u{1F33F}", name: "Zen", sub: "No game over. Relax and clear lines." },
      { icon: "\u{1F5C2}", name: "Daily archive", sub: "Replay the last two weeks of dailies." },
    ];
    if (lb.available) rows.push({ icon: "\u{1F3C6}", name: "Leaderboard", sub: "Today\u2019s top scores and longest streaks.", hot: !!off && !postedResult(t) && !!off.moves });
    rows.forEach((r, i) => {
      const { y, h } = modesRow(i);
      ctx.fillStyle = r.hot ? "rgba(255,184,31,0.18)" : "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.roundRect(-cw / 2 + 16, y, cw - 32, h, 16);
      ctx.fill();
      if (r.hot) {
        ctx.strokeStyle = "rgba(255,197,85,0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.textAlign = "left";
      ctx.font = `600 24px ${ROUND}`;
      ctx.fillStyle = COLORS.text;
      ctx.fillText(r.icon, -cw / 2 + 30, y + h / 2);
      ctx.font = `700 15px ${ROUND}`;
      ctx.fillText(r.name, -cw / 2 + 68, y + h * 0.34, cw - 150);
      ctx.fillStyle = COLORS.dim;
      ctx.font = `500 12px ${ROUND}`;
      ctx.fillText(r.sub, -cw / 2 + 68, y + h * 0.7, cw - 110);
      if (r.tag) {
        ctx.textAlign = "right";
        ctx.fillStyle = COLORS.combo;
        ctx.font = `800 12px ${ROUND}`;
        ctx.fillText(r.tag, cw / 2 - 28, y + h * 0.34);
      }
    });
  } else {
    const dates = archiveDates();
    const cw2 = (cw - 48 - 10) / 2;
    dates.forEach((d, i) => {
      const x = -cw / 2 + 24 + (i % 2) * (cw2 + 10);
      const y = -200 + Math.floor(i / 2) * 58;
      const off = officialResult(d);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.roundRect(x, y, cw2, 50, 14);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.text;
      ctx.font = `700 14px ${ROUND}`;
      const [yy, mm, dd] = d.split("-").map(Number);
      ctx.fillText(new Date(yy!, mm! - 1, dd!).toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" }), x + 14, y + 19);
      ctx.fillStyle = off ? COLORS.combo : COLORS.dim;
      ctx.font = `600 12px ${ROUND}`;
      ctx.fillText(off ? `${off.score.toLocaleString("en-US")}${parFor(d) ? ` / par ${parFor(d)}` : ""}` : "Not played", x + 14, y + 38, cw2 - 24);
    });
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 12px ${ROUND}`;
    ctx.fillText("Archive runs never count toward your streak.", 0, 218);
  }

  candyButton(0, 256, 168, 42, ui.modesView === "archive" ? "Back" : "Close", "violet", 0, 17);
  ctx.restore();
}

export function drawChallengeIntro(dt: number, replacing: boolean): void {
  ui.chT = Math.min(1, ui.chT + dt * 2.2);
  const e = 1 - Math.pow(1 - ui.chT, 3);
  const ch = ui.chIntro!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dim(e);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  const cw = Math.min(W - 40, 330);
  ctx.save();
  ctx.translate(0, 10);
  sheet(cw, 360, "Challenge!", "gold");
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.combo;
  ctx.font = `800 13px ${ROUND}`;
  ctx.fillText("A FRIEND CHALLENGED YOU", 0, -128);
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 16px ${ROUND}`;
  ctx.fillText("Beat this score", 0, -92);
  bubbleText(ch.target.toLocaleString(), 0, -40, 64, ["#fff3a0", "#ffa800"], { rim: "#7a3200", maxW: cw - 40 });
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 14px ${ROUND}`;
  ctx.fillText("on the exact same pieces they got.", 0, 8);
  if (replacing) {
    ctx.font = `500 12px ${ROUND}`;
    ctx.fillText("This replaces your current game.", 0, 34);
  }

  candyButton(0, 92, 210, 56, "Accept challenge", "gold", ui.chPress === "play" ? 1 : 0, 19);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 15px ${ROUND}`;
  ctx.fillText("Not now", 0, 154);
  ctx.restore();
}

export function drawHint(dt: number): void {
  ui.hintT = Math.min(1, ui.hintT + dt * 2.2);
  const e = 1 - Math.pow(1 - ui.hintT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dim(e);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  const cw = Math.min(W - 40, 340);
  sheet(cw, 380, "How to play", "pink");

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const steps = [
    ["Drag", "a piece from the tray onto the board."],
    ["Fill", "a row, column or outlined 2\u00D74 block."],
    ["Chain", "clears for combo bonuses. No timer, no rotating."],
  ];
  steps.forEach(([head, body], i) => {
    const y = -82 + i * 62;
    ctx.fillStyle = PALETTE[i]!;
    ctx.beginPath();
    ctx.arc(-cw / 2 + 36, y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `800 15px ${ROUND}`;
    ctx.fillText(String(i + 1), -cw / 2 + 36, y + 1);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 15px ${ROUND}`;
    ctx.fillText(head!, -cw / 2 + 62, y - 10);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 13px ${ROUND}`;
    ctx.fillText(body!, -cw / 2 + 62, y + 10, cw - 84);
    ctx.textAlign = "center";
  });
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 13px ${ROUND}`;
  ctx.fillText("The game ends when no piece fits.", 0, 106);

  candyButton(0, 156, 168, 46, "Got it", "green", 0, 18);
  ctx.restore();
}


// ---- Consent card (asked once, only where a usage collector exists) -----------------

const CONSENT_H = 280;
export function consentLayout(): { k: number; cw: number } {
  const k = Math.min(1, (H - 24) / CONSENT_H);
  return { k, cw: Math.min((W - 24) / k, 330) };
}

export function drawConsent(dt: number): void {
  ui.consentT = Math.min(1, ui.consentT + dt * 3);
  const l = consentLayout();
  const e = 1 - Math.pow(1 - ui.consentT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dim(e);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  sheet(l.cw, CONSENT_H, "Help us improve?");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 13px ${ROUND}`;
  ["Share anonymous play statistics, such as", "which modes get played. No name, no", "account, no ads tracking. Change it any", "time in Settings."].forEach((t, i) => ctx.fillText(t, 0, -52 + i * 20, l.cw - 32));
  candyButton(0, 70, 200, 46, "Yes, share", "green", 0, 17);
  candyButton(0, 136, 200, 40, "No thanks", "violet", 0, 15);
  ctx.restore();
}

/** Returns true once the player has chosen and the card should close. */
export function consentTap(lx: number, ly: number): boolean {
  if (Math.abs(lx) > 100) return false;
  const choice = ly >= 44 && ly <= 96 ? "yes" : ly >= 112 && ly <= 160 ? "no" : null;
  if (!choice) return false;
  setConsent(choice);
  applyConsent();
  if (choice === "yes") track("session_start");
  return true;
}

// ---- Settings sheet ----------------------------------------------------------------

const SET_H = 640;
export function settingsLayout(): { k: number; cw: number } {
  const k = Math.min(1, (H - 24) / SET_H);
  return { k, cw: Math.min((W - 24) / k, 360) };
}

type ToggleKey = "sound" | "haptics" | "patterns" | "reduce" | "usage";
const TOGGLES: { key: ToggleKey; name: string; sub: string }[] = [
  { key: "sound", name: "Sound", sub: "Effects and fanfares" },
  { key: "haptics", name: "Vibration", sub: "Taps and buzzes (Android phones)" },
  { key: "patterns", name: "Colour-blind patterns", sub: "A distinct mark on every colour" },
  { key: "reduce", name: "Calmer visuals", sub: "Less shaking, flashing and particles" },
  { key: "usage", name: "Share anonymous usage", sub: "Helps us improve. No name, no account." },
];
const toggles = (): typeof TOGGLES => TOGGLES.filter((t) => t.key !== "usage" || lb.analytics);
const toggleOn = (k: ToggleKey): boolean => (k === "sound" ? !isMuted() : k === "usage" ? getConsent() === "yes" : settings[k]);
const currency = (): "NGN" | "USD" => (lb.currencies.includes("NGN") ? "NGN" : "USD");
const btnY = 62; // the Themes / Coins / Shop buttons on the main page
/** The page buttons on the main settings page, spread evenly across the card. The paid shop only when payments are set up. */
function navButtons(cw: number): { page: "themes" | "coins" | "shop"; label: string; kind: "violet" | "gold" | "pink"; x: number; w: number }[] {
  const list = [
    { page: "themes" as const, label: "Themes", kind: "violet" as const },
    { page: "coins" as const, label: "Coins", kind: "gold" as const },
    ...(lb.shop ? [{ page: "shop" as const, label: "Shop", kind: "pink" as const }] : []),
  ];
  const step = (cw - 32) / list.length;
  return list.map((b, i) => ({ ...b, x: -cw / 2 + 16 + step * (i + 0.5), w: Math.min(160, step - 10) }));
}
const AD_CHOICES_Y = 232; // a text link on the main page, only where Google's consent tool is present
const ACCT_Y = 104; // the account row on the main page: 68 tall
function drawAccountRow(cw: number): void {
  const a = account();
  ctx.fillStyle = signedIn() ? "rgba(31,214,180,0.12)" : "rgba(255,194,31,0.16)";
  ctx.beginPath();
  ctx.roundRect(-cw / 2 + 16, ACCT_Y, cw - 32, 68, 14);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 15px ${ROUND}`;
  ctx.fillText(signedIn() ? "Progress saved" : a?.needsSignIn ? "Sign in again" : "Save your progress", -cw / 2 + 28, ACCT_Y + 24, cw - 150);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 11.5px ${ROUND}`;
  ctx.fillText(signedIn() ? `Signed in as ${a!.label}` : "Keep it if you lose your phone", -cw / 2 + 28, ACCT_Y + 46, cw - 150);
  candyButton(cw / 2 - 66, ACCT_Y + 34, 92, 36, signedIn() ? "Account" : "Sign in", signedIn() ? "violet" : "gold", 0, 14);
}

/** Checkout, offering sign-in first to a guest so a purchase is never tied to one phone. */
function checkout(sku: Parameters<typeof beginCheckout>[0], note: (s: string) => void): void {
  const go = (): void => {
    ui.shopBusy = true; note("Opening checkout…");
    void beginCheckout(sku, currency()).then((r) => { ui.shopBusy = false; note(r.ok ? "Opening checkout…" : r.message); });
  };
  if (signinOffered() && !signedIn()) openAccount("purchase", go); else go();
}

const coinRowY = (i: number): number => -240 + i * 64; // rows on the coin page: 58 tall
const shopRowY = (i: number): number => -236 + i * 74;
const toggleY = (i: number): number => -250 + i * 56;
const THEMES_PER_PAGE = 20;
const themePages = (): number => Math.ceil(THEMES.length / THEMES_PER_PAGE);
const themeCell = (i: number, cw: number): { x: number; y: number; w: number; h: number } => {
  const w = (cw - 32) / 4;
  return { x: -cw / 2 + 16 + (i % 4) * w, y: -240 + Math.floor(i / 4) * 84, w, h: 78 };
};

function requirement(i: number): string {
  const t = THEMES[i]!;
  if (t.season) return t.season.label;
  if (t.req === "collection") return "Finish the collection";
  if (t.req === "pack:dusk") return "Dusk pack (Shop)";
  if (t.req === "pack:citrus") return "Citrus pack (Shop)";
  if (t.req?.startsWith("coin:")) { const id = t.req.slice(5); return isCoinItem(id) ? `${coinItem(id).cost} coins` : "Coin shop"; }
  const b = BADGES.find((x) => x.id === t.req);
  return b ? `Earn ${b.name}` : "Locked";
}

export function drawSettings(dt: number): void {
  ui.settingsT = Math.min(1, ui.settingsT + dt * 3);
  const l = settingsLayout();
  const e = 1 - Math.pow(1 - ui.settingsT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dim(e);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  const cw = l.cw;
  const page = ui.settingsPage;
  sheet(cw, SET_H, page === "themes" ? "Themes" : page === "shop" ? "Shop" : page === "coins" ? "Coins" : "Settings");

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  if (page === "main") {
    toggles().forEach((t, i) => {
      const y = toggleY(i);
      const on = toggleOn(t.key);
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.text;
      ctx.font = `700 15px ${ROUND}`;
      ctx.fillText(t.name, -cw / 2 + 28, y + 14, cw - 120);
      ctx.fillStyle = COLORS.dim;
      ctx.font = `500 12px ${ROUND}`;
      ctx.fillText(t.sub, -cw / 2 + 28, y + 34, cw - 120);
      // the switch
      const sx = cw / 2 - 28 - 50;
      ctx.fillStyle = on ? BRAND.violet : "#d9cbea";
      ctx.beginPath();
      ctx.roundRect(sx, y + 10, 50, 28, 14);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx + (on ? 36 : 14), y + 24, 10, 0, Math.PI * 2);
      ctx.fill();
    });

    for (const b of navButtons(cw)) candyButton(b.x, btnY, b.w, 40, b.label, b.kind, 0, 16);
    if (signinOffered()) drawAccountRow(cw);
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 12px ${ROUND}`;
    ctx.fillText(ui.settingsNote, 0, 262, cw - 40);
    if (adChoicesAvailable()) {
      ctx.fillStyle = BRAND.violet;
      ctx.font = `700 13px ${ROUND}`;
      ctx.fillText("Ad privacy choices", 0, AD_CHOICES_Y, cw - 40);
    }
  } else if (page === "themes") {
    const first = ui.themePage * THEMES_PER_PAGE;
    THEMES.slice(first, first + THEMES_PER_PAGE).forEach((t, k) => {
      const i = first + k;
      const c = themeCell(k, cw);
      const ok = themeUnlocked(i);
      const sel = themeIdx === i;
      ctx.fillStyle = sel ? "rgba(255,184,31,0.2)" : "rgba(138,77,255,0.07)";
      ctx.beginPath();
      ctx.roundRect(c.x + 3, c.y, c.w - 6, c.h - 4, 14);
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = "rgba(255,197,85,0.6)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = ok ? 1 : 0.4;
      for (let d = 0; d < 4; d++) {
        ctx.fillStyle = t.colors[d]!;
        ctx.beginPath();
        ctx.arc(c.x + c.w / 2 + (d % 2 ? 7 : -7), c.y + 17 + (d < 2 ? -0 : 14), 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.textAlign = "center";
      ctx.fillStyle = COLORS.text;
      ctx.font = `700 11px ${ROUND}`;
      ctx.fillText(t.name, c.x + c.w / 2, c.y + 50, c.w - 8);
      ctx.fillStyle = sel ? COLORS.combo : COLORS.dim;
      ctx.font = `600 9.5px ${ROUND}`;
      ctx.fillText(sel ? "Selected" : ok ? (t.season ? "Limited time" : "Unlocked") : requirement(i), c.x + c.w / 2, c.y + 65, c.w - 6);
      ctx.globalAlpha = 1;
    });

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 12px ${ROUND}`;
    ctx.fillText(ui.settingsNote || "Tap a theme to wear it. Locked ones show how to earn them.", 0, 262, cw - 40);
    if (themePages() > 1) {
      ctx.fillStyle = BRAND.violet;
      ctx.font = `800 20px ${ROUND}`;
      ctx.fillText("\u2039", -70, 210);
      ctx.fillText("\u203A", 70, 210);
      ctx.fillStyle = COLORS.dim;
      ctx.font = `700 12px ${ROUND}`;
      ctx.fillText(`Page ${ui.themePage + 1} of ${themePages()}`, 0, 210);
    }
  } else if (page === "coins") {
    drawCoinShop(cw);
  } else {
    drawShop(cw);
  }

  candyButton(0, 296, 168, 40, page === "main" ? "Done" : "Back", "violet", 0, 16);
  ctx.restore();
}

/** Opens the settings sheet straight onto the coin shop (from the coin counter in the game's header). */
export function openCoinShop(): void {
  ui.settingsOn = true; ui.settingsT = 0; ui.settingsPage = "coins"; ui.coinNote = ""; ui.settingsNote = ""; ui.shopNote = "";
}

/** Coin packs for money appear only when this deployment can take payments. */
const coinPacksShown = (): boolean => lb.shop;

function drawCoinShop(cw: number): void {
  ctx.textBaseline = "middle";
  const left = -cw / 2 + 16;
  const rowW = cw - 32;
  const row = (y: number, tint = "rgba(138,77,255,0.07)"): void => {
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.roundRect(left, y, rowW, 58, 14);
    ctx.fill();
  };
  const text = (s: string, y: number, size: number, weight: number, color: string, maxW = cw - 150): void => {
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${ROUND}`;
    ctx.fillText(s, left + 14, y, maxW);
  };

  // Row 0: the balance, and a rewarded ad for coins when an ad network is on the page.
  let y = coinRowY(0);
  row(y, "rgba(255,184,31,0.16)");
  coin(left + 26, y + 29, 14);
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `900 24px ${ROUND}`;
  ctx.fillText(balance().toLocaleString("en-US"), left + 48, y + 24, cw - 190);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 11px ${ROUND}`;
  const undos = savedUndos();
  ctx.fillText(undos > 0 ? `coins · ${undos} saved undo${undos === 1 ? "" : "s"}` : "coins", left + 48, y + 45, cw - 190);
  if (adsReady()) {
    const leftToday = adsLeftToday(today());
    if (ui.coinBusy) candyButton(cw / 2 - 66, y + 29, 92, 36, "…", "green", 0, 14);
    else if (leftToday > 0) candyButton(cw / 2 - 66, y + 29, 92, 36, `▶ +${ECONOMY.ad.coins}`, "green", 0, 14);
    else {
      ctx.textAlign = "right";
      ctx.fillStyle = COLORS.dim;
      ctx.font = `600 11px ${ROUND}`;
      ctx.fillText("More ads tomorrow", cw / 2 - 26, y + 29, 110);
    }
  }

  // Items bought with coins.
  COIN_ITEMS.forEach((it, i) => {
    y = coinRowY(1 + i);
    row(y);
    text(it.name, y + 20, 15, 800, COLORS.text);
    text(it.blurb, y + 40, 11, 500, COLORS.dim);
    const owned = it.kind === "once" && ownsCoinItem(it.id);
    if (owned) candyButton(cw / 2 - 66, y + 29, 92, 36, "Owned", "green", 0, 14);
    else candyButton(cw / 2 - 66, y + 29, 92, 36, `${it.cost} coins`, balance() >= it.cost ? "gold" : "violet", 0, 13);
  });

  // Coin packs for money, through the same verified Paystack checkout as the rest of the shop.
  if (coinPacksShown()) {
    COIN_PACKS.forEach((p, i) => {
      y = coinRowY(1 + COIN_ITEMS.length + i);
      row(y, "rgba(255,79,160,0.08)");
      coin(left + 24, y + 29, 11);
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.text;
      ctx.font = `800 15px ${ROUND}`;
      ctx.fillText(p.name, left + 42, y + 20, cw - 170);
      ctx.fillStyle = COLORS.dim;
      ctx.font = `500 11px ${ROUND}`;
      ctx.fillText("Added once your payment clears.", left + 42, y + 40, cw - 170);
      candyButton(cw / 2 - 66, y + 29, 92, 36, formatPrice(p.price, currency()), "pink", 0, 14);
    });
  }

  ctx.textAlign = "center";
  ctx.fillStyle = ui.coinNote ? COLORS.text : COLORS.dim;
  ctx.font = `${ui.coinNote ? 700 : 500} 12px ${ROUND}`;
  ctx.fillText(ui.coinNote || "Tap a price to buy. Coins never buy an edge in ranked modes.", 0, 166, cw - 32);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 11px ${ROUND}`;
  ctx.fillText("Earn coins with the daily bonus, today’s daily, the weekly,", 0, 196, cw - 32);
  ctx.fillText("journey stars and score milestones.", 0, 213, cw - 32);
  if (!wallet.saved) {
    ctx.fillStyle = COLORS.combo;
    ctx.font = `700 11px ${ROUND}`;
    ctx.fillText("This browser is not saving data, so coins last until you close it.", 0, 240, cw - 24);
  }
}

/** A tap on the coin page, in card coordinates. Every outcome leaves a message in `ui.coinNote`. */
function coinTap(lx: number, ly: number, cw: number): void {
  const onButton = lx > cw / 2 - 118;
  const inRow = (i: number): boolean => ly >= coinRowY(i) && ly <= coinRowY(i) + 58;

  if (inRow(0) && onButton && adsReady()) {
    if (ui.coinBusy) return; // one ad at a time, however many taps
    if (adsLeftToday(today()) <= 0) { ui.coinNote = "That’s all the ad rewards for today."; return; }
    ui.coinBusy = true;
    ui.coinNote = "Loading the ad…";
    haptics.tick();
    // Coins only on a confirmed, completed view (see coins.ts). Anything else pays nothing.
    void watchAdForCoins(provider(), today()).then((r) => {
      ui.coinBusy = false;
      ui.coinNote = r.kind === "paid" ? `+${r.coins} coins!`
        : r.kind === "cap" ? "That’s all the ad rewards for today."
        : r.kind === "busy" ? "Loading the ad…"
        : "The ad didn’t finish, so no coins this time.";
    });
    return;
  }

  for (let i = 0; i < COIN_ITEMS.length; i++) {
    if (!inRow(1 + i) || !onButton) continue;
    const it = COIN_ITEMS[i]!;
    const r = purchase(it.id);
    if (r.ok) {
      haptics.tick();
      if (it.kind === "once") {
        const ti = THEMES.findIndex((t) => t.req === `coin:${it.id}`);
        if (ti >= 0) applyTheme(ti);
        ui.coinNote = `${it.name} unlocked and applied.`;
      } else ui.coinNote = `+${it.undos ?? 0} saved undos. You have ${savedUndos()}.`;
      if (!wallet.saved) ui.coinNote += " (Not saved on this browser.)";
    } else if (r.reason === "insufficient") ui.coinNote = `You need ${r.need ?? it.cost} more coins for that.`;
    else if (r.reason === "owned") ui.coinNote = "You already own that.";
    else if (r.reason === "full") ui.coinNote = "You’re holding as many saved undos as you can.";
    else if (r.reason === "unknown") ui.coinNote = "That item isn’t available.";
    // "repeat": a second tap on the same item a moment later is the same tap, so nothing changes.
    return;
  }

  if (coinPacksShown()) {
    for (let i = 0; i < COIN_PACKS.length; i++) {
      if (!inRow(1 + COIN_ITEMS.length + i) || !onButton || ui.shopBusy) continue;
      checkout(COIN_PACKS[i]!.id, (n) => { ui.coinNote = n; });
      return;
    }
  }
}

function drawShop(cw: number): void {
  const items = forSale(ownership.ent);
  ctx.textBaseline = "middle";
  if (items.length === 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.text;
    ctx.font = `800 16px ${ROUND}`;
    ctx.fillText("You own everything. Thank you!", 0, -150, cw - 40);
  }
  items.forEach((it, i) => {
    const y = shopRowY(i);
    ctx.fillStyle = "rgba(138,77,255,0.07)";
    ctx.beginPath();
    ctx.roundRect(-cw / 2 + 16, y, cw - 32, 66, 14);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = `800 15px ${ROUND}`;
    ctx.fillText(it.name, -cw / 2 + 28, y + 22, cw - 150);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 11.5px ${ROUND}`;
    ctx.fillText(it.blurb, -cw / 2 + 28, y + 44, cw - 150);
    candyButton(cw / 2 - 66, y + 33, 92, 36, formatPrice(it.price, currency()), "gold", 0, 14);
  });
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 11.5px ${ROUND}`;
  ctx.fillText(ui.shopNote || "Cosmetic only. Nothing here changes how the game plays.", 0, 190, cw - 40);
  ctx.font = `600 11px ${ROUND}`;
  ctx.fillText("Restore code (moves everything to a new device; tap to copy):", 0, 216, cw - 30);
  ctx.fillText(transferCode(), 0, 234, cw - 20);
  ctx.fillStyle = BRAND.violet;
  ctx.font = `700 12px ${ROUND}`;
  ctx.fillText("Restore on this device", 0, 258, cw - 40);
}

/** Handles a tap on the settings sheet at card-local coordinates. Returns true if the sheet should close. */
export function settingsTap(lx: number, ly: number): boolean {
  const l = settingsLayout();
  const cw = l.cw;
  if (Math.abs(lx) > cw / 2 || Math.abs(ly) > SET_H / 2) return true; // tapped outside the card
  const page = ui.settingsPage;
  if (ly >= 274 && ly <= 320 && Math.abs(lx) <= 90) {
    if (page === "main") return true;
    ui.settingsPage = "main"; ui.settingsNote = ""; ui.shopNote = ""; ui.coinNote = ""; return false;
  }
  if (page === "main") {
    if (ly >= btnY - 20 && ly <= btnY + 20) {
      const b = navButtons(cw).find((n) => Math.abs(lx - n.x) <= n.w / 2);
      if (b) {
        ui.settingsPage = b.page;
        ui.coinNote = "";
        if (b.page === "shop") { track("shop_viewed"); void syncEntitlements(); }
        haptics.tick();
      }
      return false;
    }
    if (adChoicesAvailable() && ly >= AD_CHOICES_Y - 14 && ly <= AD_CHOICES_Y + 14 && Math.abs(lx) <= 90) { showAdChoices(); haptics.tick(); return false; }
    if (signinOffered() && ly >= ACCT_Y && ly <= ACCT_Y + 68) { openAccount("settings"); haptics.tick(); return false; }
    const list = toggles();
    for (let i = 0; i < list.length; i++) {
      const y = toggleY(i);
      if (ly >= y && ly <= y + 48) {
        const key = list[i]!.key;
        if (key === "sound") toggleMute();
        else if (key === "usage") { setConsent(getConsent() === "yes" ? "no" : "yes"); applyConsent(); }
        else {
          setSetting(key, !settings[key]);
          if (key === "reduce") setReduceMotion(settings.reduce);
        }
        haptics.tick();
        return false;
      }
    }
  } else if (page === "themes") {
    if (themePages() > 1 && ly >= 190 && ly <= 232 && Math.abs(lx) <= 100) {
      ui.themePage = (ui.themePage + (lx < 0 ? -1 : 1) + themePages()) % themePages();
      haptics.tick();
      return false;
    }
    const first = ui.themePage * THEMES_PER_PAGE;
    for (let i = first; i < Math.min(THEMES.length, first + THEMES_PER_PAGE); i++) {
      const c = themeCell(i - first, cw);
      if (lx >= c.x && lx <= c.x + c.w && ly >= c.y && ly <= c.y + c.h) {
        if (themeUnlocked(i)) { applyTheme(i); ui.settingsNote = `Theme: ${THEMES[i]!.name}`; haptics.tick(); }
        else ui.settingsNote = THEMES[i]!.season ? `${THEMES[i]!.name} is available ${THEMES[i]!.season!.label}.` : `${requirement(i)} to unlock ${THEMES[i]!.name}.`;
        return false;
      }
    }
  } else if (page === "coins") {
    coinTap(lx, ly, cw);
  } else {
    const items = forSale(ownership.ent);
    for (let i = 0; i < items.length; i++) {
      const y = shopRowY(i);
      if (ly >= y && ly <= y + 66 && lx > cw / 2 - 118 && !ui.shopBusy) {
        checkout(items[i]!.sku, (n) => { ui.shopNote = n; });
        return false;
      }
    }
    if (ly >= 204 && ly <= 244) { void navigator.clipboard?.writeText(transferCode()).then(() => { ui.shopNote = "Code copied."; }, () => {}); return false; }
    if (ly >= 248 && ly <= 270) {
      const code = window.prompt("Paste your restore code");
      if (code) void restoreFromCode(code).then((r) => { ui.shopNote = r.ok ? "Restored. The old code no longer works." : r.message; });
      return false;
    }
  }
  return false;
}

// ---- Leaderboard -------------------------------------------------------------------

const LB_H = 600;
export function lbLayout(): { k: number; cw: number } {
  const k = Math.min(1, (H - 24) / LB_H);
  return { k, cw: Math.min((W - 24) / k, 360) };
}
const LB_TABS = ["Today", "Cup", "Streaks"] as const;
const lbTabRect = (i: number, cw: number): { x: number; y: number; w: number; h: number } => {
  const w = (cw - 48) / 3;
  return { x: -cw / 2 + 24 + i * w, y: -250, w, h: 32 };
};
const LB_POST = { y: 172, h: 44 };

export function drawLeaderboard(dt: number): void {
  ui.lbT = Math.min(1, ui.lbT + dt * 3);
  const l = lbLayout();
  const e = 1 - Math.pow(1 - ui.lbT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dim(e);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  const cw = l.cw;
  sheet(cw, LB_H, "Leaderboard");

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  LB_TABS.forEach((name, i) => {
    const r = lbTabRect(i, cw);
    const on = ui.lbTab === i;
    ctx.fillStyle = on ? "rgba(138,77,255,0.2)" : "rgba(138,77,255,0.07)";
    ctx.beginPath();
    ctx.roundRect(r.x + 2, r.y, r.w - 4, r.h, 16);
    ctx.fill();
    ctx.fillStyle = on ? COLORS.text : COLORS.dim;
    ctx.font = `700 13px ${ROUND}`;
    ctx.fillText(name, r.x + r.w / 2, r.y + r.h / 2 + 1);
  });

  type Row = { rank: number; name: string; value: string; you: boolean };
  let rows: Row[] = [];
  let pinned: Row | null = null;
  let header = "";
  if (ui.lbTab === 0 && ui.lbBoard) {
    rows = ui.lbBoard.top.map((t) => ({ rank: t.rank, name: t.supporter ? `\u2605 ${t.name}` : t.name, value: t.score.toLocaleString("en-US"), you: t.you }));
    header = `${today()} \u00B7 ${ui.lbBoard.total.toLocaleString("en-US")} player${ui.lbBoard.total === 1 ? "" : "s"}`;
    if (ui.lbBoard.me && !rows.some((r) => r.you)) pinned = { rank: ui.lbBoard.me.rank, name: "You", value: ui.lbBoard.me.score.toLocaleString("en-US"), you: true };
  } else if (ui.lbTab === 1 && ui.lbCup) {
    rows = ui.lbCup.top.map((t) => ({ rank: t.rank, name: t.supporter ? `\u2605 ${t.name}` : t.name, value: t.score.toLocaleString("en-US"), you: t.you }));
    const left = Math.max(0, Math.ceil((new Date(`${addDays(ui.lbCupId.slice(2), 7)}T00:00:00Z`).getTime() - Date.now()) / 86_400_000));
    header = `Weekly Cup \u00B7 ${ui.lbCup.total.toLocaleString("en-US")} player${ui.lbCup.total === 1 ? "" : "s"} \u00B7 ${left} day${left === 1 ? "" : "s"} left`;
    if (ui.lbCup.me && !rows.some((r) => r.you)) pinned = { rank: ui.lbCup.me.rank, name: "You", value: ui.lbCup.me.score.toLocaleString("en-US"), you: true };
  } else if (ui.lbTab === 2 && ui.lbStreaks) {
    rows = ui.lbStreaks.top.map((t) => ({ rank: t.rank, name: t.supporter ? `\u2605 ${t.name}` : t.name, value: `${t.streak} day${t.streak === 1 ? "" : "s"}`, you: t.you }));
    header = "Longest live daily streaks";
    if (ui.lbStreaks.me && !rows.some((r) => r.you)) pinned = { rank: ui.lbStreaks.me.rank, name: "You", value: `${ui.lbStreaks.me.streak} days`, you: true };
  }

  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 12px ${ROUND}`;
  ctx.fillText(ui.lbLoading ? "Loading\u2026" : header, 0, -212, cw - 40);

  const drawRow = (r: Row, y: number): void => {
    if (r.you) {
      ctx.fillStyle = "rgba(255,184,31,0.3)";
      ctx.beginPath();
      ctx.roundRect(-cw / 2 + 16, y - 14, cw - 32, 28, 10);
      ctx.fill();
    }
    ctx.textAlign = "left";
    const medal = r.rank <= 3 ? ["#ffc21f", "#c9c3dd", "#d99a5b"][r.rank - 1]! : null;
    if (medal) {
      ctx.fillStyle = medal;
      ctx.beginPath();
      ctx.arc(-cw / 2 + 36, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2a1a00";
      ctx.font = `800 12px ${ROUND}`;
      ctx.textAlign = "center";
      ctx.fillText(String(r.rank), -cw / 2 + 36, y + 1);
      ctx.textAlign = "left";
    } else {
      ctx.fillStyle = COLORS.dim;
      ctx.font = `700 12px ${ROUND}`;
      ctx.fillText(String(r.rank), -cw / 2 + 28, y + 1);
    }
    ctx.fillStyle = r.you ? COLORS.combo : COLORS.text;
    ctx.font = `700 14px ${ROUND}`;
    ctx.fillText(r.name, -cw / 2 + 58, y + 1, cw - 170);
    ctx.textAlign = "right";
    ctx.fillStyle = r.you ? COLORS.combo : COLORS.text;
    ctx.fillText(r.value, cw / 2 - 28, y + 1);
  };
  rows.slice(0, 10).forEach((r, i) => drawRow(r, -186 + i * 31));
  if (pinned) {
    ctx.strokeStyle = "rgba(138,77,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(-cw / 2 + 24, 138);
    ctx.lineTo(cw / 2 - 24, 138);
    ctx.stroke();
    drawRow(pinned, 154);
  }
  if (!ui.lbLoading && rows.length === 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 13px ${ROUND}`;
    ctx.fillText(ui.lbTab === 0 ? "No scores yet. Be the first!" : ui.lbTab === 1 ? "No cup scores yet. Be the first!" : "No live streaks yet.", 0, -110);
  }

  // footer: posting, or where you stand
  ctx.textAlign = "center";
  if ((ui.lbTab === 0 && ui.lbCanPost) || (ui.lbTab === 1 && ui.lbCupCanPost)) {
    candyButton(0, LB_POST.y + LB_POST.h / 2, 230, LB_POST.h, ui.lbTab === 1 ? "Post my Cup score" : "Post my daily score", "gold", 0, 16);
  } else {
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 12px ${ROUND}`;
    const note = ui.lbTab === 2 ? "Streaks count the days you post a daily score."
      : ui.lbTab === 1 ? (ui.lbCupPosted ? `You posted ${ui.lbCupPosted.score.toLocaleString("en-US")} \u00B7 #${ui.lbCupPosted.rank}` : `Play the Weekly: your first finished run counts. Top ${ECONOMY.cup.top} win coins.`)
      : ui.lbPosted ? `You posted ${ui.lbPosted.score.toLocaleString("en-US")} \u00B7 #${ui.lbPosted.rank}`
      : "Finish today\u2019s daily to join the board.";
    ctx.fillText(note, 0, LB_POST.y + 22, cw - 40);
  }
  ctx.fillStyle = ui.lbMsg.startsWith("Posted") ? "#1f7a2c" : COLORS.dim;
  ctx.font = `600 12px ${ROUND}`;
  ctx.fillText(ui.lbMsg, 0, 232, cw - 40);

  candyButton(0, 274, 168, 40, "Close", "violet", 0, 16);
  ctx.restore();
}

export type LbAction = "close" | "tab0" | "tab1" | "tab2" | "post" | null;
/** Maps a tap (card-local coordinates) to what it means. */
export function lbTap(lx: number, ly: number): LbAction {
  const { cw } = lbLayout();
  if (Math.abs(lx) > cw / 2 || Math.abs(ly) > LB_H / 2) return "close";
  if (ly >= 250 && ly <= 296 && Math.abs(lx) <= 90) return "close";
  for (let i = 0; i < LB_TABS.length; i++) {
    const r = lbTabRect(i, cw);
    if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return i === 0 ? "tab0" : i === 1 ? "tab1" : "tab2";
  }
  if (((ui.lbTab === 0 && ui.lbCanPost) || (ui.lbTab === 1 && ui.lbCupCanPost)) && ly >= LB_POST.y - 4 && ly <= LB_POST.y + LB_POST.h + 4 && Math.abs(lx) <= 116) return "post";
  return null;
}
