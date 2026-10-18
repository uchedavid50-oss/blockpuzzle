// The screens drawn over the game: praise banners, toasts, stats, the modes sheet, the challenge
// invitation and the first-run hint. Rendering only. Their open/closed state lives in `ui`, which the
// input handlers in main.ts read and write.

import { ctx, W, H, dpr, cell, boardY, COLORS, FONT, reduceMotion, easeOutBack, setReduceMotion, star, paintScene } from "./gfx";
import { isMuted, toggleMute } from "./sound";
import { setSetting, settings } from "./settings";
import { haptics } from "./haptics";
import { PALETTE, BADGES, COLLECTION_SIZE, THEMES, TILE_ORDER, applyTheme, collectionTiles, perkUndos, rankName, readStreak, stats, streakNow, themeIdx, themeUnlocked, today, unlocked, type Toast } from "./progress";
import { officialResult, parFor, readJourney, weeklyCompleted } from "./records";
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
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.strokeStyle = "rgba(10,12,20,0.9)";
  ctx.lineWidth = size * 0.22;
  ctx.strokeText(pr.text, 0, 0);
  ctx.shadowBlur = 0;
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
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#1e2438";
  ctx.beginPath();
  ctx.roundRect(-w / 2, 0, w, 60, 18);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,197,85,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const g = ctx.createLinearGradient(0, 14, 0, 46);
  g.addColorStop(0, "#fff0b3");
  g.addColorStop(1, "#ffb42e");
  ctx.fillStyle = g;
  star(-w / 2 + 34, 30, 17);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.combo;
  ctx.font = `800 11px ${FONT}`;
  ctx.fillText(t.label ?? "BADGE UNLOCKED", -w / 2 + 62, 17);
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 16px ${FONT}`;
  ctx.fillText(t.title, -w / 2 + 62, 35);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 12px ${FONT}`;
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
  ctx.fillStyle = `rgba(7,9,14,${0.86 * e})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  const cw = l.cw;
  const card = ctx.createLinearGradient(0, -CARD_H / 2, 0, CARD_H / 2);
  card.addColorStop(0, "#222840");
  card.addColorStop(1, "#151a2a");
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(-cw / 2, -CARD_H / 2, cw, CARD_H, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText("Your progress", 0, -276);
  TABS.forEach((name, i) => {
    const r = tabRect(i, cw);
    const on = ui.statsTab === i;
    ctx.fillStyle = on ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
    ctx.beginPath();
    ctx.roundRect(r.x + 2, r.y, r.w - 4, r.h, 16);
    ctx.fill();
    ctx.fillStyle = on ? COLORS.text : COLORS.dim;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(name, r.x + r.w / 2, r.y + r.h / 2 + 1);
  });

  if (ui.statsTab === 0) drawStatsTab(cw);
  else if (ui.statsTab === 1) drawBadgesTab(l);
  else drawCollectionTab(cw);

  const bg = ctx.createLinearGradient(0, 246, 0, 290);
  bg.addColorStop(0, "#6cb4ff");
  bg.addColorStop(1, "#3a82e6");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-84, 248, 168, 42, 21);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 16px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("Close", 0, 270);
  ctx.restore();
}

export function drawStatsTab(cw: number): void {
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.combo;
  ctx.font = `700 13px ${FONT}`;
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
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.roundRect(x, y, tw, 62, 14);
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.font = `800 ${value.length > 9 ? 13 : 20}px ${FONT}`;
    ctx.fillText(value, x + tw / 2, y + 25, tw - 8);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(name, x + tw / 2, y + 46, tw - 8);
  });

  // Score distribution: where your finished games land.
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 14px ${FONT}`;
  ctx.fillText("Score distribution", -cw / 2 + 24, -16);
  const peak = Math.max(1, ...stats.hist);
  stats.hist.forEach((count, i) => {
    const y = 4 + i * 23;
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(BUCKET_LABELS[i]!, -cw / 2 + 24, y + 9);
    const maxW = cw - 48 - 64;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
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
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText(String(count), -cw / 2 + 64 + maxW - 6, y + 10);
  });

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 12px ${FONT}`;
  const rec = readStreak();
  const freeze = freezeAvailable(rec, today()) ? "freeze ready" : "freeze used this week";
  ctx.fillText(`Daily streak ${streakNow()} \u00B7 best ${stats.bestStreak} \u00B7 ${freeze}`, 0, 168, cw - 40);
  ctx.fillText(`Weekly wins ${stats.weeklyWins} \u00B7 Journey levels ${stats.levels} \u00B7 Zen lines ${stats.zenLines}`, 0, 192, cw - 40);
}

export function drawBadgesTab(l: { cw: number }): void {
  const cw = l.cw;
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 15px ${FONT}`;
  ctx.fillText("Badges", -cw / 2 + 24, -196);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `700 13px ${FONT}`;
  ctx.fillText(`${unlocked.length} / ${BADGES.length}`, cw / 2 - 24, -196);

  ctx.textAlign = "center";
  BADGES.forEach((b, i) => {
    const c = badgeCell(i, l);
    const got = unlocked.includes(b.id);
    if (ui.badgeSel === i) {
      ctx.fillStyle = "rgba(255,255,255,0.07)";
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
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1.5;
      star(c.x, c.y + 14, 13);
      ctx.stroke();
      const pr = b.progress?.();
      if (pr) {
        const bw = c.w - 22;
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.beginPath();
        ctx.roundRect(c.x - bw / 2, c.y + 44, bw, 4, 2);
        ctx.fill();
        ctx.fillStyle = COLORS.combo;
        ctx.beginPath();
        ctx.roundRect(c.x - bw / 2, c.y + 44, Math.max(3, bw * Math.min(1, pr[0] / pr[1])), 4, 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = got ? COLORS.text : "#586079";
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(b.name, c.x, c.y + 35, c.w - 4);
  });

  const sel = ui.badgeSel >= 0 ? BADGES[ui.badgeSel] : undefined;
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText(sel ? `${sel.name}: ${sel.desc}` : "Tap a badge to see how to earn it.", 0, 178, cw - 40);
  if (sel) {
    const pr = sel.progress?.();
    const got = unlocked.includes(sel.id);
    ctx.fillStyle = COLORS.combo;
    ctx.font = `700 12px ${FONT}`;
    const bits = [
      got ? "Earned" : pr ? `Progress ${Math.min(pr[0], pr[1]).toLocaleString()} / ${pr[1].toLocaleString()}` : "",
      sel.reward ? `Reward: ${sel.reward}` : "",
    ].filter(Boolean);
    ctx.fillText(bits.join("  \u00B7  "), 0, 200, cw - 40);
  } else {
    ctx.font = `500 12px ${FONT}`;
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
      ctx.fillStyle = "#12162a";
      ctx.fillRect(tx, ty, tile, tile);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.font = `700 ${Math.round(tile * 0.4)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("?", tx + tile / 2, ty + tile / 2 + 1);
    }
    ctx.restore();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 15px ${FONT}`;
  ctx.fillText(`${n} / ${COLLECTION_SIZE} tiles`, 0, y0 + size + 24);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 12px ${FONT}`;
  const toNext = 40 - (stats.lines % 40);
  ctx.fillText(n >= COLLECTION_SIZE ? "Complete! The Prism theme is yours." : `Next tile in ${toNext} lines, or a weekly win or 5 journey levels.`, 0, y0 + size + 46, cw - 40);
  ctx.fillStyle = COLORS.combo;
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText(n >= COLLECTION_SIZE ? "Unlocked: Prism theme" : "Reward: Prism theme when complete", 0, y0 + size + 68, cw - 40);
}

// ---- Modes sheet ------------------------------------------------------------------

export const MODES_H = 580;
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
  ctx.fillStyle = `rgba(7,9,14,${0.86 * e})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  const cw = l.cw;
  const card = ctx.createLinearGradient(0, -MODES_H / 2, 0, MODES_H / 2);
  card.addColorStop(0, "#222840");
  card.addColorStop(1, "#151a2a");
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(-cw / 2, -MODES_H / 2, cw, MODES_H, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText(ui.modesView === "main" ? "Choose a mode" : "Daily archive", 0, -252);
  if (ui.modesView === "main") {
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText("\u2699", cw / 2 - 38, -251);
  }

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
    rows.forEach((r, i) => {
      const y = -200 + i * 70;
      ctx.fillStyle = r.hot ? "rgba(255,197,85,0.09)" : "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.roundRect(-cw / 2 + 16, y, cw - 32, 62, 16);
      ctx.fill();
      if (r.hot) {
        ctx.strokeStyle = "rgba(255,197,85,0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.textAlign = "left";
      ctx.font = `600 24px ${FONT}`;
      ctx.fillStyle = COLORS.text;
      ctx.fillText(r.icon, -cw / 2 + 30, y + 31);
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText(r.name, -cw / 2 + 68, y + 21, cw - 150);
      ctx.fillStyle = COLORS.dim;
      ctx.font = `500 12px ${FONT}`;
      ctx.fillText(r.sub, -cw / 2 + 68, y + 43, cw - 110);
      if (r.tag) {
        ctx.textAlign = "right";
        ctx.fillStyle = COLORS.combo;
        ctx.font = `800 12px ${FONT}`;
        ctx.fillText(r.tag, cw / 2 - 28, y + 21);
      }
    });
  } else {
    const dates = archiveDates();
    const cw2 = (cw - 48 - 10) / 2;
    dates.forEach((d, i) => {
      const x = -cw / 2 + 24 + (i % 2) * (cw2 + 10);
      const y = -200 + Math.floor(i / 2) * 58;
      const off = officialResult(d);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.roundRect(x, y, cw2, 50, 14);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.text;
      ctx.font = `700 14px ${FONT}`;
      const [yy, mm, dd] = d.split("-").map(Number);
      ctx.fillText(new Date(yy!, mm! - 1, dd!).toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" }), x + 14, y + 19);
      ctx.fillStyle = off ? COLORS.combo : COLORS.dim;
      ctx.font = `600 12px ${FONT}`;
      ctx.fillText(off ? `${off.score.toLocaleString("en-US")}${parFor(d) ? ` / par ${parFor(d)}` : ""}` : "Not played", x + 14, y + 38, cw2 - 24);
    });
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText("Archive runs never count toward your streak.", 0, 218);
  }

  const bg = ctx.createLinearGradient(0, 232, 0, 280);
  bg.addColorStop(0, "#6cb4ff");
  bg.addColorStop(1, "#3a82e6");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-84, 236, 168, 42, 21);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 16px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(ui.modesView === "archive" ? "Back" : "Close", 0, 258);
  ctx.restore();
}

export function drawChallengeIntro(dt: number, replacing: boolean): void {
  ui.chT = Math.min(1, ui.chT + dt * 2.2);
  const e = 1 - Math.pow(1 - ui.chT, 3);
  const ch = ui.chIntro!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = `rgba(7,9,14,${0.88 * e})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  const cw = Math.min(W - 40, 330);
  const card = ctx.createLinearGradient(0, -170, 0, 190);
  card.addColorStop(0, "#2a2447");
  card.addColorStop(1, "#151a2a");
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(-cw / 2, -170, cw, 360, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,197,85,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.combo;
  ctx.font = `800 13px ${FONT}`;
  ctx.fillText("A FRIEND CHALLENGED YOU", 0, -128);
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText("Beat this score", 0, -92);
  const g = ctx.createLinearGradient(0, -70, 0, -10);
  g.addColorStop(0, "#fff0b3");
  g.addColorStop(1, "#ffb42e");
  ctx.fillStyle = g;
  ctx.font = `900 68px ${FONT}`;
  ctx.fillText(ch.target.toLocaleString(), 0, -40);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 14px ${FONT}`;
  ctx.fillText("on the exact same pieces they got.", 0, 8);
  if (replacing) {
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText("This replaces your current game.", 0, 34);
  }

  const bg = ctx.createLinearGradient(0, 66, 0, 126);
  bg.addColorStop(0, "#ffd166");
  bg.addColorStop(1, "#f59e0b");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-100, 66, 200, 56, 28);
  ctx.fill();
  ctx.fillStyle = "#2a1a00";
  ctx.font = `800 19px ${FONT}`;
  ctx.fillText("Accept challenge", 0, 95);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText("Not now", 0, 154);
  ctx.restore();
}

export function drawHint(dt: number): void {
  ui.hintT = Math.min(1, ui.hintT + dt * 2.2);
  const e = 1 - Math.pow(1 - ui.hintT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = `rgba(7,9,14,${0.86 * e})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  const cw = Math.min(W - 40, 340);
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  const card = ctx.createLinearGradient(0, -190, 0, 190);
  card.addColorStop(0, "#222840");
  card.addColorStop(1, "#151a2a");
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(-cw / 2, -190, cw, 380, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText("How to play", 0, -148);

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
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(String(i + 1), -cw / 2 + 36, y + 1);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 15px ${FONT}`;
    ctx.fillText(head!, -cw / 2 + 62, y - 10);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText(body!, -cw / 2 + 62, y + 10, cw - 84);
    ctx.textAlign = "center";
  });
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText("The game ends when no piece fits.", 0, 106);

  const bg = ctx.createLinearGradient(0, 128, 0, 176);
  bg.addColorStop(0, "#6cb4ff");
  bg.addColorStop(1, "#3a82e6");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-84, 134, 168, 46, 23);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText("Got it", 0, 158);
  ctx.restore();
}


// ---- Settings sheet ----------------------------------------------------------------

const SET_H = 640;
export function settingsLayout(): { k: number; cw: number } {
  const k = Math.min(1, (H - 24) / SET_H);
  return { k, cw: Math.min((W - 24) / k, 360) };
}

type ToggleKey = "sound" | "haptics" | "patterns" | "reduce";
const TOGGLES: { key: ToggleKey; name: string; sub: string }[] = [
  { key: "sound", name: "Sound", sub: "Effects and fanfares" },
  { key: "haptics", name: "Vibration", sub: "Taps and buzzes (Android phones)" },
  { key: "patterns", name: "Colour-blind patterns", sub: "A distinct mark on every colour" },
  { key: "reduce", name: "Calmer visuals", sub: "Less shaking, flashing and particles" },
];
const toggleOn = (k: ToggleKey): boolean => (k === "sound" ? !isMuted() : settings[k]);
const toggleY = (i: number): number => -250 + i * 56;
const themeCell = (i: number, cw: number): { x: number; y: number; w: number; h: number } => {
  const w = (cw - 32) / 4;
  return { x: -cw / 2 + 16 + (i % 4) * w, y: 10 + Math.floor(i / 4) * 84, w, h: 78 };
};

function requirement(i: number): string {
  const t = THEMES[i]!;
  if (t.season) return t.season.label;
  if (t.req === "collection") return "Finish the collection";
  const b = BADGES.find((x) => x.id === t.req);
  return b ? `Earn ${b.name}` : "Locked";
}

export function drawSettings(dt: number): void {
  ui.settingsT = Math.min(1, ui.settingsT + dt * 3);
  const l = settingsLayout();
  const e = 1 - Math.pow(1 - ui.settingsT, 3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = `rgba(7,9,14,${0.86 * e})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(W / 2, H / 2 + (1 - e) * 24);
  ctx.scale(l.k, l.k);
  const cw = l.cw;
  const card = ctx.createLinearGradient(0, -SET_H / 2, 0, SET_H / 2);
  card.addColorStop(0, "#222840");
  card.addColorStop(1, "#151a2a");
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(-cw / 2, -SET_H / 2, cw, SET_H, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText("Settings", 0, -292);

  TOGGLES.forEach((t, i) => {
    const y = toggleY(i);
    const on = toggleOn(t.key);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 15px ${FONT}`;
    ctx.fillText(t.name, -cw / 2 + 28, y + 14, cw - 120);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(t.sub, -cw / 2 + 28, y + 34, cw - 120);
    // the switch
    const sx = cw / 2 - 28 - 50;
    ctx.fillStyle = on ? "#3a82e6" : "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.roundRect(sx, y + 10, 50, 28, 14);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(sx + (on ? 36 : 14), y + 24, 10, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 15px ${FONT}`;
  ctx.fillText("Theme", -cw / 2 + 28, -6);
  THEMES.forEach((t, i) => {
    const c = themeCell(i, cw);
    const ok = themeUnlocked(i);
    const sel = themeIdx === i;
    ctx.fillStyle = sel ? "rgba(255,197,85,0.12)" : "rgba(255,255,255,0.04)";
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
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText(t.name, c.x + c.w / 2, c.y + 50, c.w - 8);
    ctx.fillStyle = sel ? COLORS.combo : COLORS.dim;
    ctx.font = `600 9.5px ${FONT}`;
    ctx.fillText(sel ? "Selected" : ok ? (t.season ? "Limited time" : "Unlocked") : requirement(i), c.x + c.w / 2, c.y + 65, c.w - 6);
    ctx.globalAlpha = 1;
  });

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText(ui.settingsNote || "Tap a theme to wear it. Locked ones show how to earn them.", 0, 262, cw - 40);

  const bg = ctx.createLinearGradient(0, 276, 0, 316);
  bg.addColorStop(0, "#6cb4ff");
  bg.addColorStop(1, "#3a82e6");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-84, 278, 168, 38, 19);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 16px ${FONT}`;
  ctx.fillText("Done", 0, 298);
  ctx.restore();
}

/** Handles a tap on the settings sheet at card-local coordinates. Returns true if the sheet should close. */
export function settingsTap(lx: number, ly: number): boolean {
  const l = settingsLayout();
  const cw = l.cw;
  if (Math.abs(lx) > cw / 2 || Math.abs(ly) > SET_H / 2) return true; // tapped outside the card
  if (ly >= 274 && ly <= 320 && Math.abs(lx) <= 90) return true;
  for (let i = 0; i < TOGGLES.length; i++) {
    const y = toggleY(i);
    if (ly >= y && ly <= y + 48) {
      const key = TOGGLES[i]!.key;
      if (key === "sound") toggleMute();
      else {
        setSetting(key, !settings[key]);
        if (key === "reduce") setReduceMotion(settings.reduce);
      }
      haptics.tick();
      return false;
    }
  }
  for (let i = 0; i < THEMES.length; i++) {
    const c = themeCell(i, cw);
    if (lx >= c.x && lx <= c.x + c.w && ly >= c.y && ly <= c.y + c.h) {
      if (themeUnlocked(i)) { applyTheme(i); ui.settingsNote = `Theme: ${THEMES[i]!.name}`; haptics.tick(); }
      else ui.settingsNote = THEMES[i]!.season ? `${THEMES[i]!.name} is available ${THEMES[i]!.season!.label}.` : `${requirement(i)} to unlock ${THEMES[i]!.name}.`;
      return false;
    }
  }
  return false;
}
