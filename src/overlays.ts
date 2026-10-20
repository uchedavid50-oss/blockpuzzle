// The screens drawn over the game: praise banners, toasts, stats, the modes sheet, the challenge
// invitation and the first-run hint. Rendering only. Their open/closed state lives in `ui`, which the
// input handlers in main.ts read and write.

import { ctx, W, H, dpr, cell, boardY, COLORS, ROUND, BRAND, reduceMotion, easeOutBack, setReduceMotion, star, paintScene, dim, sheet, candyButton, bubbleText, roundButton } from "./gfx";
import { isMuted, toggleMute } from "./sound";
import { lb, type BoardData, type StreakData } from "./leaderboardClient";
import { setSetting, settings } from "./settings";
import { haptics } from "./haptics";
import { forSale, formatPrice } from "./entitlements";
import { ownership } from "./ownership";
import { beginCheckout, restoreFromCode, syncEntitlements, transferCode } from "./shopClient";
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
  settingsPage: "main" as "main" | "themes" | "shop",
  shopNote: "",
  shopBusy: false,
  // leaderboard
  lbOn: false,
  lbT: 0,
  lbTab: 0,
  lbPress: null as { x: number; y: number } | null,
  lbBoard: null as BoardData | null,
  lbStreaks: null as StreakData | null,
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
      { icon: "\u26A1", name: `Weekly: ${wk.title}`, sub: wk.rule, tag: weeklyCompleted(weekId(t)) ? "\u2713 done" : undefined, hot: !weeklyCompleted(weekId(t)) },
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
const btnY = 62; // the Themes / Shop buttons on the main page
const shopRowY = (i: number): number => -236 + i * 74;
const toggleY = (i: number): number => -250 + i * 56;
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
  sheet(cw, SET_H, page === "themes" ? "Themes" : page === "shop" ? "Shop" : "Settings");

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

    candyButton(lb.shop ? -88 : 0, btnY, 160, 40, "Themes", "violet", 0, 16);
    if (lb.shop) candyButton(88, btnY, 160, 40, "Shop", "gold", 0, 16);
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 12px ${ROUND}`;
    ctx.fillText(ui.settingsNote, 0, 262, cw - 40);
  } else if (page === "themes") {
    THEMES.forEach((t, i) => {
      const c = themeCell(i, cw);
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
  } else {
    drawShop(cw);
  }

  candyButton(0, 296, 168, 40, page === "main" ? "Done" : "Back", "violet", 0, 16);
  ctx.restore();
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
  ctx.fillText("Restore code (tap to copy):", 0, 216, cw - 40);
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
    ui.settingsPage = "main"; ui.settingsNote = ""; ui.shopNote = ""; return false;
  }
  if (page === "main") {
    if (ly >= btnY - 20 && ly <= btnY + 20) {
      if (lb.shop && lx > 8) { ui.settingsPage = "shop"; track("shop_viewed"); void syncEntitlements(); haptics.tick(); }
      else if (lx < (lb.shop ? -8 : 80) && lx > (lb.shop ? -168 : -80)) { ui.settingsPage = "themes"; haptics.tick(); }
      return false;
    }
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
    for (let i = 0; i < THEMES.length; i++) {
      const c = themeCell(i, cw);
      if (lx >= c.x && lx <= c.x + c.w && ly >= c.y && ly <= c.y + c.h) {
        if (themeUnlocked(i)) { applyTheme(i); ui.settingsNote = `Theme: ${THEMES[i]!.name}`; haptics.tick(); }
        else ui.settingsNote = THEMES[i]!.season ? `${THEMES[i]!.name} is available ${THEMES[i]!.season!.label}.` : `${requirement(i)} to unlock ${THEMES[i]!.name}.`;
        return false;
      }
    }
  } else {
    const items = forSale(ownership.ent);
    for (let i = 0; i < items.length; i++) {
      const y = shopRowY(i);
      if (ly >= y && ly <= y + 66 && lx > cw / 2 - 118 && !ui.shopBusy) {
        ui.shopBusy = true; ui.shopNote = "Opening checkout…";
        void beginCheckout(items[i]!.sku, currency()).then((r) => { ui.shopBusy = false; ui.shopNote = r.ok ? "Opening checkout…" : r.message; });
        return false;
      }
    }
    if (ly >= 204 && ly <= 244) { void navigator.clipboard?.writeText(transferCode()).then(() => { ui.shopNote = "Code copied."; }, () => {}); return false; }
    if (ly >= 248 && ly <= 270) {
      const code = window.prompt("Paste your restore code");
      if (code) void restoreFromCode(code).then((r) => { ui.shopNote = r.ok ? "Restored." : r.message; });
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
const LB_TABS = ["Today", "Streaks"] as const;
const lbTabRect = (i: number, cw: number): { x: number; y: number; w: number; h: number } => {
  const w = (cw - 48) / 2;
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
    rows = ui.lbBoard.top.map((t) => ({ rank: t.rank, name: t.name, value: t.score.toLocaleString("en-US"), you: t.you }));
    header = `${today()} \u00B7 ${ui.lbBoard.total.toLocaleString("en-US")} player${ui.lbBoard.total === 1 ? "" : "s"}`;
    if (ui.lbBoard.me && !rows.some((r) => r.you)) pinned = { rank: ui.lbBoard.me.rank, name: "You", value: ui.lbBoard.me.score.toLocaleString("en-US"), you: true };
  } else if (ui.lbTab === 1 && ui.lbStreaks) {
    rows = ui.lbStreaks.top.map((t) => ({ rank: t.rank, name: t.name, value: `${t.streak} day${t.streak === 1 ? "" : "s"}`, you: t.you }));
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
    ctx.fillText(ui.lbTab === 0 ? "No scores yet. Be the first!" : "No live streaks yet.", 0, -110);
  }

  // footer: posting, or where you stand
  ctx.textAlign = "center";
  if (ui.lbTab === 0 && ui.lbCanPost) {
    candyButton(0, LB_POST.y + LB_POST.h / 2, 230, LB_POST.h, "Post my daily score", "gold", 0, 16);
  } else {
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 12px ${ROUND}`;
    const note = ui.lbTab === 1 ? "Streaks count the days you post a daily score."
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

export type LbAction = "close" | "tab0" | "tab1" | "post" | null;
/** Maps a tap (card-local coordinates) to what it means. */
export function lbTap(lx: number, ly: number): LbAction {
  const { cw } = lbLayout();
  if (Math.abs(lx) > cw / 2 || Math.abs(ly) > LB_H / 2) return "close";
  if (ly >= 250 && ly <= 296 && Math.abs(lx) <= 90) return "close";
  for (let i = 0; i < LB_TABS.length; i++) {
    const r = lbTabRect(i, cw);
    if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return i === 0 ? "tab0" : "tab1";
  }
  if (ui.lbTab === 0 && ui.lbCanPost && ly >= LB_POST.y - 4 && ly <= LB_POST.y + LB_POST.h + 4 && Math.abs(lx) <= 116) return "post";
  return null;
}
