// The cartoon landmarks of the journey map. Each is drawn in a 100-unit design space with its base
// centred on the origin and standing up the screen (negative y), in the same thick-outlined, flat
// cartoon style as the character. Drawing only; the map decides where they stand and how big.

import { ctx } from "./gfx";
import type { LandmarkKind } from "./map";

const INK = "rgba(58,26,106,0.88)";

function vg(y0: number, y1: number, top: string, bottom: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

/** Fills a path, then draws its cartoon outline. */
function shape(path: () => void, fill: string | CanvasGradient, lw = 3): void {
  ctx.beginPath();
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.stroke();
}
const box = (x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient, lw = 3): void =>
  shape(() => ctx.roundRect(x, y, w, h, r), fill, lw);
const tri = (a: [number, number], b: [number, number], c: [number, number], fill: string | CanvasGradient, lw = 3): void =>
  shape(() => { ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath(); }, fill, lw);
const disc = (x: number, y: number, r: number, fill: string | CanvasGradient, lw = 2.6): void =>
  shape(() => ctx.arc(x, y, r, 0, Math.PI * 2), fill, lw);

/** A soft puff of smoke rising from (x, y), looping. */
function smoke(x: number, y: number, clock: number, color = "rgba(255,255,255,0.85)", count = 3, rise = 36): void {
  for (let i = 0; i < count; i++) {
    const k = (clock * 0.45 + i / count) % 1;
    ctx.globalAlpha = (1 - k) * 0.85;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + Math.sin(k * 5 + i) * 4 + k * 6, y - k * rise, 3 + k * 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function flag(x: number, y: number, h: number, color: string, clock: number): void {
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
  const w = Math.sin(clock * 4) * 3;
  shape(() => { ctx.moveTo(x, y - h); ctx.quadraticCurveTo(x + 9, y - h + 3 + w, x + 18, y - h + 1); ctx.lineTo(x + 18 + w * 0.3, y - h + 11); ctx.quadraticCurveTo(x + 9, y - h + 13 - w, x, y - h + 12); ctx.closePath(); }, color, 2.4);
}

function window_(x: number, y: number, w: number, h: number, lit = true): void {
  box(x, y, w, h, Math.min(w, h) * 0.3, lit ? vg(y, y + h, "#fff6b8", "#ffd45a") : vg(y, y + h, "#bfe6ff", "#7cc4f5"), 2.4);
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
}

const arch = (x: number, base: number, w: number, h: number, fill = "#7a4a2a"): void =>
  shape(() => { ctx.moveTo(x - w / 2, base); ctx.lineTo(x - w / 2, base - h + w / 2); ctx.arc(x, base - h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w / 2, base); ctx.closePath(); }, fill, 2.6);

function cottage(clock: number, roof: string, roofHi: string, wall: string, snow = false): void {
  box(-30, -40, 60, 40, 4, vg(-40, 0, wall, "#e8d3a8"));
  tri([-40, -36], [0, -76], [40, -36], vg(-76, -36, roofHi, roof), 3.4);
  if (snow) {
    shape(() => { ctx.moveTo(-34, -40); ctx.quadraticCurveTo(-18, -62, 0, -70); ctx.quadraticCurveTo(18, -62, 34, -40); ctx.quadraticCurveTo(24, -46, 14, -42); ctx.quadraticCurveTo(4, -50, -6, -43); ctx.quadraticCurveTo(-18, -50, -34, -40); }, "#ffffff", 2.4);
  }
  box(14, -76, 10, 24, 2, "#b5523b");
  smoke(19, -78, clock, snow ? "rgba(255,255,255,0.9)" : "rgba(235,235,245,0.9)");
  arch(-8, 0, 15, 26);
  disc(-4, -11, 1.4, "#ffd45a", 1);
  window_(13, -31, 14, 14, false);
  // little flower box under the window
  box(11, -16, 18, 5, 2, "#5aa84a", 2);
  disc(15, -19, 2.4, "#ff6f91", 1.2); disc(21, -19, 2.4, "#ffd23a", 1.2); disc(26, -19, 2.2, "#ff6f91", 1.2);
}

function windmill(clock: number): void {
  shape(() => { ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.lineTo(12, -60); ctx.lineTo(-12, -60); ctx.closePath(); }, vg(-60, 0, "#ffffff", "#ffd9ec"));
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.lineTo(12, -60); ctx.lineTo(-12, -60); ctx.closePath(); ctx.clip();
  ctx.fillStyle = "#ff5fa8";
  for (let y = -66; y < 6; y += 18) { ctx.beginPath(); ctx.moveTo(-24, y + 12); ctx.lineTo(24, y - 4); ctx.lineTo(24, y + 5); ctx.lineTo(-24, y + 21); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  shape(() => { ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.lineTo(12, -60); ctx.lineTo(-12, -60); ctx.closePath(); }, "rgba(0,0,0,0)");
  arch(0, 0, 14, 22, "#a8483a");
  window_(-5, -44, 10, 10, true);
  tri([-17, -58], [0, -78], [17, -58], vg(-78, -58, "#ffb0d0", "#ff5fa8"), 3.4);
  const a = clock * 0.9;
  const sail = ["#ff5fa8", "#4fc3ff", "#ffd23f", "#8a4dff"];
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(0, -66);
    ctx.rotate(a + (i * Math.PI) / 2);
    box(-5, -54, 12, 50, 3, "#ffffff", 2.6);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(-5, -54, 12, 50, 3); ctx.clip();
    ctx.fillStyle = sail[i]!;
    for (let y = -52; y < -6; y += 12) { ctx.beginPath(); ctx.moveTo(-6, y + 8); ctx.lineTo(8, y); ctx.lineTo(8, y + 5); ctx.lineTo(-6, y + 13); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.restore();
  }
  disc(0, -66, 7, vg(-73, -59, "#ffb0d0", "#ff5fa8"), 2.8);
  ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.6;
  ctx.beginPath(); for (let t = 0.5; t < 11; t += 0.5) { const r = t * 0.5; ctx.lineTo(Math.cos(t + clock) * r, -66 + Math.sin(t + clock) * r); } ctx.stroke();
}

function lighthouse(clock: number): void {
  const beam = 0.35 + 0.35 * Math.sin(clock * 2.2);
  ctx.save();
  ctx.globalAlpha = beam;
  const g = ctx.createLinearGradient(0, 0, 120, 0);
  g.addColorStop(0, "rgba(255,244,170,0.9)"); g.addColorStop(1, "rgba(255,244,170,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, -80); ctx.lineTo(120, -105); ctx.lineTo(120, -58); ctx.closePath(); ctx.fill();
  ctx.restore();
  shape(() => { ctx.moveTo(-17, 0); ctx.lineTo(17, 0); ctx.lineTo(10, -72); ctx.lineTo(-10, -72); ctx.closePath(); }, "#ffffff");
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(17, 0); ctx.lineTo(10, -72); ctx.lineTo(-10, -72); ctx.closePath(); ctx.clip();
  ctx.fillStyle = "#e8453c";
  ctx.fillRect(-20, -26, 40, 15); ctx.fillRect(-20, -58, 40, 14);
  ctx.restore();
  shape(() => { ctx.moveTo(-17, 0); ctx.lineTo(17, 0); ctx.lineTo(10, -72); ctx.lineTo(-10, -72); ctx.closePath(); }, "rgba(0,0,0,0)");
  arch(0, 0, 10, 16, "#5a3a2a");
  box(-13, -88, 26, 17, 5, vg(-88, -71, "#fff8c0", "#ffd45a"));
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -88); ctx.lineTo(0, -71); ctx.stroke();
  tri([-17, -88], [0, -104], [17, -88], vg(-104, -88, "#ff8a7a", "#d9473b"), 3.2);
  disc(0, -106, 3, "#ffd23a", 2);
  for (const [x, w] of [[-26, 14], [24, 11]] as const) shape(() => ctx.ellipse(x, -1, w, 6, 0, 0, Math.PI * 2), "#9aa4b8", 2.4);
}

function pyramid(clock: number): void {
  tri([-52, 0], [0, -84], [52, 0], vg(-84, 0, "#ffe6a0", "#e8b865"), 3.4);
  shape(() => { ctx.moveTo(0, -84); ctx.lineTo(52, 0); ctx.lineTo(14, 0); ctx.closePath(); }, "rgba(184,120,50,0.5)", 0.01);
  ctx.strokeStyle = "rgba(120,70,30,0.4)"; ctx.lineWidth = 2;
  for (const y of [-20, -40, -60]) { const w = (1 - -y / 84) * 52; ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke(); }
  arch(0, 0, 14, 20, "#4a2c1a");
  const tw = 0.5 + 0.5 * Math.sin(clock * 4);
  ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.4 * tw})`;
  ctx.beginPath(); ctx.arc(0, -90, 3 + tw * 2, 0, Math.PI * 2); ctx.fill();
  disc(34, -3, 6, "#6fcf6a", 2);
}

function tent(clock: number): void {
  tri([-38, 0], [0, -62], [38, 0], "#fff3d6", 3.4);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-38, 0); ctx.lineTo(0, -62); ctx.lineTo(38, 0); ctx.closePath(); ctx.clip();
  ctx.fillStyle = "#e8453c";
  for (let i = -3; i <= 3; i += 2) { ctx.beginPath(); ctx.moveTo(i * 5, -62); ctx.lineTo(i * 5 + 10, -62); ctx.lineTo(i * 14 + 18, 0); ctx.lineTo(i * 14 - 4, 0); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  shape(() => { ctx.moveTo(-38, 0); ctx.lineTo(0, -62); ctx.lineTo(38, 0); ctx.closePath(); }, "rgba(0,0,0,0)");
  tri([-9, 0], [0, -26], [9, 0], "#4a2c5a", 2.6);
  flag(0, -62, 16, "#ffd23a", clock);
}

function igloo(): void {
  shape(() => { ctx.moveTo(-44, 0); ctx.arc(0, 0, 44, Math.PI, 0); ctx.closePath(); }, vg(-44, 0, "#ffffff", "#cfe6fb"), 3.4);
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, 43, Math.PI, 0); ctx.closePath(); ctx.clip();
  ctx.strokeStyle = "rgba(90,130,190,0.55)"; ctx.lineWidth = 2;
  for (const r of [14, 28]) { ctx.beginPath(); ctx.arc(0, 0, r + 14, Math.PI, 0); ctx.stroke(); }
  for (let a = 0.25; a < 1; a += 0.15) { ctx.beginPath(); ctx.moveTo(Math.cos(Math.PI * (1 + a)) * 20, Math.sin(Math.PI * (1 + a)) * 20); ctx.lineTo(Math.cos(Math.PI * (1 + a)) * 44, Math.sin(Math.PI * (1 + a)) * 44); ctx.stroke(); }
  ctx.restore();
  shape(() => { ctx.moveTo(-14, 0); ctx.lineTo(-14, -14); ctx.arc(0, -14, 14, Math.PI, 0); ctx.lineTo(14, 0); ctx.closePath(); }, vg(-28, 0, "#9fd0f5", "#6aa8e0"), 3);
  arch(0, 0, 14, 22, "#274a78");
}

function mushroom(clock: number): void {
  box(-15, -38, 30, 38, 8, vg(-38, 0, "#fff3d6", "#e8d3a8"));
  arch(0, 0, 14, 22, "#7a4a2a");
  window_(-12, -33, 8, 8, true);
  shape(() => { ctx.moveTo(-50, -34); ctx.ellipse(0, -34, 50, 40, 0, Math.PI, 2 * Math.PI); ctx.closePath(); }, vg(-74, -34, "#ff8a8a", "#d9383e"), 3.6);
  for (const [x, y, r] of [[-26, -52, 7], [4, -64, 8], [28, -48, 6], [-4, -44, 4.5]] as const) disc(x, y, r, "#ffffff", 2.2);
  smoke(30, -56, clock, "rgba(255,255,255,0.7)", 2, 22);
}

function tower(clock: number, wall: string, wallLo: string, roof: string, roofHi: string, glow: string): void {
  box(-18, -86, 36, 86, 5, vg(-86, 0, wall, wallLo));
  ctx.strokeStyle = "rgba(58,26,106,0.28)"; ctx.lineWidth = 2;
  for (let y = -74; y < 0; y += 16) { ctx.beginPath(); ctx.moveTo(-18, y); ctx.lineTo(18, y); ctx.stroke(); }
  box(-22, -92, 44, 9, 3, wallLo, 3);
  tri([-26, -90], [0, -132], [26, -90], vg(-132, -90, roofHi, roof), 3.4);
  arch(0, -52, 14, 22, glow);
  arch(0, 0, 14, 20, "#5a3a2a");
  disc(0, -134, 3.2, "#ffd23a", 2);
  const tw = 0.5 + 0.5 * Math.sin(clock * 3);
  ctx.fillStyle = `rgba(255,244,170,${0.15 + 0.2 * tw})`;
  ctx.beginPath(); ctx.arc(0, -134, 12, 0, Math.PI * 2); ctx.fill();
}

function volcano(clock: number): void {
  shape(() => { ctx.moveTo(-54, 0); ctx.lineTo(-16, -66); ctx.lineTo(16, -66); ctx.lineTo(54, 0); ctx.closePath(); }, vg(-66, 0, "#9a6a52", "#5a3a34"), 3.6);
  const pulse = 0.5 + 0.5 * Math.sin(clock * 3);
  shape(() => ctx.ellipse(0, -66, 17, 6, 0, 0, Math.PI * 2), `rgb(255,${140 + 60 * pulse},40)`, 2.8);
  ctx.fillStyle = "#ff8a2a";
  shape(() => { ctx.moveTo(-6, -64); ctx.quadraticCurveTo(-10, -44, -14, -24); ctx.quadraticCurveTo(-8, -26, -4, -40); ctx.closePath(); }, "#ff8a2a", 2);
  shape(() => { ctx.moveTo(6, -64); ctx.quadraticCurveTo(12, -40, 24, -14); ctx.quadraticCurveTo(14, -18, 8, -36); ctx.closePath(); }, "#ffb02a", 2);
  smoke(0, -72, clock, "rgba(90,70,80,0.8)", 4, 44);
  for (let i = 0; i < 3; i++) {
    const k = (clock * 0.9 + i / 3) % 1;
    ctx.fillStyle = `rgba(255,${170 + 60 * k},60,${1 - k})`;
    ctx.beginPath(); ctx.arc(Math.sin(i * 2.4) * 10 + (k - 0.5) * 10, -72 - k * 38, 2.4, 0, Math.PI * 2); ctx.fill();
  }
}

function castle(clock: number, wall: string, wallLo: string, roof: string, roofHi: string): void {
  box(-22, -66, 44, 66, 3, vg(-66, 0, wall, wallLo));
  for (let x = -22; x < 22; x += 11) box(x, -74, 7, 10, 1.5, wall, 2.4);
  for (const sx of [-1, 1]) {
    box(sx * 36 - 11, -84, 22, 84, 4, vg(-84, 0, wall, wallLo));
    tri([sx * 36 - 15, -82], [sx * 36, -112], [sx * 36 + 15, -82], vg(-112, -82, roofHi, roof), 3.2);
    window_(sx * 36 - 4, -62, 8, 12, true);
  }
  arch(0, 0, 20, 30, "#5a3a5a");
  window_(-5, -54, 10, 12, true);
  flag(0, -66, 20, roof, clock);
  flag(36, -112, 14, "#ffd23a", clock + 1);
  flag(-36, -112, 14, "#ffd23a", clock + 2);
}

function observatory(clock: number): void {
  box(-28, -32, 56, 32, 4, vg(-32, 0, "#e9e3ff", "#b9aee8"));
  arch(0, 0, 14, 20, "#4a3a7a");
  window_(-20, -24, 9, 9, true);
  window_(11, -24, 9, 9, true);
  shape(() => { ctx.moveTo(-28, -32); ctx.arc(0, -32, 28, Math.PI, 0); ctx.closePath(); }, vg(-60, -32, "#8fd6ff", "#4f8ee0"), 3.4);
  ctx.save();
  ctx.beginPath(); ctx.arc(0, -32, 27, Math.PI, 0); ctx.closePath(); ctx.clip();
  ctx.fillStyle = "rgba(20,10,70,0.7)";
  ctx.fillRect(2, -62, 9, 32);
  ctx.restore();
  ctx.save();
  ctx.translate(6, -44);
  ctx.rotate(-0.7 + Math.sin(clock * 0.7) * 0.12);
  box(0, -5, 34, 10, 4, "#ffd23a", 2.8);
  ctx.restore();
  const tw = 0.5 + 0.5 * Math.sin(clock * 5);
  ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * tw})`;
  for (const [x, y] of [[-34, -58], [34, -72], [-22, -76]] as const) { ctx.beginPath(); ctx.arc(x, y, 2 + tw, 0, Math.PI * 2); ctx.fill(); }
}

function rocket(clock: number): void {
  box(-26, -6, 52, 8, 3, "#9aa4b8", 3);
  const fl = 8 + Math.sin(clock * 24) * 3;
  tri([-8, 2], [0, 2 + fl * 3.2], [8, 2], "#ffb02a", 2.4);
  tri([-4, 2], [0, 2 + fl * 1.8], [4, 2], "#fff3a0", 1.6);
  for (const sx of [-1, 1]) shape(() => { ctx.moveTo(sx * 12, -22); ctx.lineTo(sx * 30, 0); ctx.lineTo(sx * 12, -4); ctx.closePath(); }, "#e8453c", 3);
  shape(() => { ctx.moveTo(-14, -8); ctx.lineTo(-14, -58); ctx.quadraticCurveTo(0, -112, 14, -58); ctx.lineTo(14, -8); ctx.closePath(); }, vg(-100, -8, "#ffffff", "#d6dcee"), 3.4);
  tri([-12, -62], [0, -104], [12, -62], "#e8453c", 3);
  disc(0, -48, 8, vg(-56, -40, "#bfe6ff", "#4f9ae0"), 3);
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.arc(-2.5, -51, 2.2, 0, Math.PI * 2); ctx.fill();
}

function gingerbread(clock: number): void {
  box(-32, -40, 64, 40, 5, vg(-40, 0, "#d49a5e", "#a8683a"));
  shape(() => { ctx.moveTo(-32, -40); for (let x = -32; x < 32; x += 8) ctx.quadraticCurveTo(x + 4, -32, x + 8, -40); ctx.lineTo(32, -44); ctx.lineTo(-32, -44); ctx.closePath(); }, "#ffffff", 2.4);
  tri([-42, -42], [0, -80], [42, -42], vg(-80, -42, "#ffe3f2", "#ffb3d6"), 3.4);
  const gum = ["#ff5fa8", "#4fc3ff", "#ffd23f", "#3fd6a0", "#8a4dff"];
  for (const [x, y, c] of [[-24, -50, 0], [-12, -62, 1], [0, -72, 2], [12, -62, 3], [24, -50, 4]] as const) disc(x, y, 4.4, gum[c]!, 2);
  box(14, -80, 9, 24, 2, "#b5523b");
  smoke(18.5, -82, clock, "rgba(255,255,255,0.95)");
  arch(-9, 0, 16, 28, "#ff7fb0");
  disc(-5, -12, 2.2, "#ffd23f", 1.2);
  window_(12, -32, 15, 15, true);
  box(10, -15, 19, 5, 2, "#ffffff", 2);
  for (const x of [-35, 35]) {
    ctx.lineCap = "round";
    ctx.strokeStyle = INK; ctx.lineWidth = 6.6; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, -26); ctx.stroke();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, -26); ctx.stroke();
    ctx.setLineDash([3.5, 4]); ctx.strokeStyle = "#ff3f6c"; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, -26); ctx.stroke(); ctx.setLineDash([]);
  }
}

function cakeTower(clock: number): void {
  shape(() => ctx.ellipse(0, 1, 46, 8, 0, 0, Math.PI * 2), "#ffffff", 2.6);
  const tiers: [number, number, number, string, string][] = [[0, 70, 26, "#ffb3d6", "#ff7fb8"], [-26, 52, 24, "#fff0d6", "#f2d09a"], [-50, 36, 22, "#9a5a3a", "#6f3a24"]];
  for (const [y, w, h, hi, lo] of tiers) {
    box(-w / 2, y - h, w, h, 6, vg(y - h, y, hi, lo));
    shape(() => { ctx.moveTo(-w / 2, y - h + 2); for (let x = -w / 2; x < w / 2; x += 9) ctx.quadraticCurveTo(x + 4.5, y - h + 12, x + 9, y - h + 2); ctx.lineTo(w / 2, y - h - 4); ctx.lineTo(-w / 2, y - h - 4); ctx.closePath(); }, "#ffffff", 2.2);
  }
  const sp = ["#ff5fa8", "#ffd23f", "#4fc3ff", "#3fd6a0"];
  for (const [x, y, c] of [[-24, -12, 0], [-8, -6, 1], [10, -14, 2], [26, -8, 3], [-14, -38, 3], [8, -34, 0], [-4, -62, 1], [10, -64, 2]] as const) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(x * 0.2); ctx.fillStyle = sp[c]!; ctx.beginPath(); ctx.roundRect(-3.2, -1.2, 6.4, 2.4, 1.2); ctx.fill(); ctx.restore();
  }
  disc(0, -78, 6, "#ff3f6c", 2.4);
  box(10, -88, 5, 16, 2, "#ffffff", 2);
  const fl = 1 + Math.sin(clock * 12) * 0.2;
  shape(() => { ctx.moveTo(12.5, -92); ctx.quadraticCurveTo(17, -98 * fl, 12.5, -104 * fl); ctx.quadraticCurveTo(8, -98 * fl, 12.5, -92); }, "#ffb02a", 1.8);
}

function lollipopTower(clock: number): void {
  box(-5, -78, 10, 78, 4, "#ffffff", 3);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(-5, -78, 10, 78, 4); ctx.clip();
  ctx.fillStyle = "#ff5fa8";
  for (let y = -80; y < 0; y += 14) { ctx.beginPath(); ctx.moveTo(-6, y + 10); ctx.lineTo(6, y); ctx.lineTo(6, y + 5); ctx.lineTo(-6, y + 15); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  ctx.save();
  ctx.translate(0, -104);
  ctx.rotate(Math.sin(clock * 0.8) * 0.05);
  disc(0, 0, 30, vg(-30, 30, "#ffd0ec", "#ff5fa8"), 3.4);
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 5; ctx.lineCap = "round";
  ctx.beginPath(); for (let a = 0.4; a < 22; a += 0.3) { const r = 1.15 * a; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.ellipse(-12, -17, 8, 4.5, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  for (const [x, c] of [[-14, "#4fc3ff"], [12, "#3fd6a0"], [0, "#ffb02a"]] as const) disc(x, -4, 6.5, c, 2.4);
}

/** Draws a landmark in its 100-unit design space. `clock` is seconds, for the little animations. */
export function drawLandmark(kind: LandmarkKind, clock: number): void {
  switch (kind) {
    case "cottage": return cottage(clock, "#d9473b", "#ff8a7a", "#fff3d6");
    case "beachHut": return cottage(clock, "#1fb8c8", "#7fe6ee", "#ffe9b8");
    case "cabin": return cottage(clock, "#7a5a8a", "#b69acb", "#f3e6d6", true);
    case "cloudHome": return cottage(clock, "#ff6fa8", "#ffb0d0", "#ffffff");
    case "windmill": return windmill(clock);
    case "lighthouse": return lighthouse(clock);
    case "pyramid": return pyramid(clock);
    case "tent": return tent(clock);
    case "igloo": return igloo();
    case "mushroom": return mushroom(clock);
    case "witchTower": return tower(clock, "#8e7bd0", "#5a4a98", "#4a2c8a", "#8a5ad0", "#ffe27a");
    case "emberTower": return tower(clock, "#b8604a", "#7a3a2c", "#3a1616", "#7a2c22", "#ff9a3a");
    case "crystalTower": return tower(clock, "#8ee6d6", "#3aa8b0", "#2a7ab0", "#7ad0f5", "#e8fff8");
    case "volcano": return volcano(clock);
    case "castle": return castle(clock, "#ffe3f0", "#e8b4cc", "#ff5fa8", "#ff9fcf");
    case "iceCastle": return castle(clock, "#e6f6ff", "#a8d4f0", "#5aa0e8", "#9fd0ff");
    case "observatory": return observatory(clock);
    case "rocket": return rocket(clock);
    case "gingerbread": return gingerbread(clock);
    case "cakeTower": return cakeTower(clock);
    case "lollipopTower": return lollipopTower(clock);
  }
}
