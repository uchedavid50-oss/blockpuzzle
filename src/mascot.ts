// "Bun": the journey map's cartoon rabbit. A chubby white bunny with long ears, a fluffy tail, big
// hind legs and a bow in the player's theme colour. Drawing only. Bun stands, hops between levels
// and cheers; the map decides which, and where. Everything is drawn around the feet at (0, 0),
// facing right.

import { ctx, mix } from "./gfx";

export type MascotMode = "idle" | "hop" | "cheer";

export interface MascotPose {
  mode: MascotMode;
  clock: number; // seconds, drives blinking, twitching and bobbing
  hop: number; // 0..1 through a hop (only used in "hop" mode)
  squashX: number; // 1 = normal
  squashY: number;
  look: number; // -1..1: where the eyes point
  color: string; // the bow
  wave: boolean; // idle: wave a paw
}

const OUTLINE = "#3a1a6a";
const FUR = "#fffbff";
const FUR_LO = "#e6dafa";
const PINK = "#ff9ec4";

function ellipse(x: number, y: number, rx: number, ry: number, rot: number, fill: string | CanvasGradient, lw = 3.2): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) { ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw; ctx.stroke(); }
}

/** A long ear rooted at (bx, by), tilted by `angle` (0 = straight up, negative = back toward the tail). */
function ear(bx: number, by: number, angle: number, len: number): void {
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(angle);
  ellipse(0, -len / 2, 6.4, len / 2, 0, vgrad(-len, 0, FUR, FUR_LO), 3.2);
  ellipse(0.4, -len / 2 + 1.5, 3.2, len / 2 - 5, 0, PINK, 0);
  ctx.restore();
}

function vgrad(y0: number, y1: number, top: string, bottom: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

/** Draws Bun with the feet at the origin. Scale the context to size it (about 80 units tall with the ears). */
export function drawMascot(p: MascotPose): void {
  const u = p.hop;
  const air = p.mode === "hop" && u > 0.12 && u < 0.88;
  const bob = p.mode === "idle" ? Math.sin(p.clock * 2.6) * 1.3 : 0;
  const blink = p.clock % 3.6 > 3.42;
  const bowLo = mix(p.color, 0, 0.3);
  const bowHi = mix(p.color, 255, 0.3);

  ctx.save();
  ctx.scale(p.squashX, p.squashY); // squash and stretch about the feet
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // fluffy tail
  const tw = Math.sin(p.clock * 7) * (p.mode === "cheer" ? 2.4 : 0.8);
  ellipse(-21 + (air ? -3 : 0), -15 + bob + tw * 0.3, 8, 8, 0, FUR, 3);
  ellipse(-21 + (air ? -3 : 0), -15 + bob + tw * 0.3, 4, 4, 0, "rgba(255,255,255,0.9)", 0);

  // thighs: the big hind legs. They tuck under when standing and kick out behind in the air.
  const kick = air ? Math.sin(Math.PI * Math.min(1, (u - 0.12) / 0.76)) : 0;
  for (const x0 of [-9, 8]) ellipse(x0 + (air ? -6 * kick : 0), -13 + (air ? -3 * kick : 0), 9.5, 11, air ? -0.8 * kick : 0.12, vgrad(-24, 0, FUR, FUR_LO), 3.2);

  // body
  ellipse(0, -21 + bob, 19.5, 18, 0, vgrad(-40, -4, FUR, FUR_LO), 3.6);
  ellipse(3, -17 + bob, 11, 11, 0, "rgba(255,255,255,0.85)", 0); // pale belly

  // hind feet: planted when standing, stretched out behind in the air
  for (const x0 of [-9, 9]) {
    const fx = x0 + (air ? -15 * kick : 2);
    const fy = air ? -11 - 4 * kick : -4.2;
    ellipse(fx, fy, 11, 5.8, air ? -0.95 * kick : 0, vgrad(fy - 6, fy + 6, FUR, FUR_LO), 3.2);
    ellipse(fx + (air ? -3 : 3.5), fy + 0.6, 3.6, 2.6, air ? -0.95 * kick : 0, PINK, 0);
  }

  // front paws: swing a little, wave, or throw up in a cheer
  const sw = p.mode === "hop" ? (air ? -0.8 : 0.5) : Math.sin(p.clock * 2.6) * 0.12;
  const up = p.mode === "cheer" ? Math.sin(p.clock * 16) * 0.3 - 2.3 : 0;
  ctx.save();
  ctx.translate(-9, -20 + bob);
  ctx.rotate(0.35 + sw + up * 0.5);
  ellipse(0, 6, 4.6, 8.4, 0, FUR, 3);
  ctx.restore();
  ctx.save();
  ctx.translate(13, -19 + bob);
  ctx.rotate(p.wave ? -2.6 + Math.sin(p.clock * 14) * 0.45 : -0.35 - sw - up * 0.5);
  ellipse(0, 6, 4.6, 8.4, 0, FUR, 3);
  ctx.restore();

  // bow at the neck, in the theme colour
  ctx.save();
  ctx.translate(2, -28 + bob);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(s * 11, -6); ctx.lineTo(s * 11, 6); ctx.closePath();
    ctx.fillStyle = vgrad(-6, 6, bowHi, bowLo);
    ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2.6; ctx.stroke();
  }
  ellipse(0, 0, 3.6, 3.6, 0, bowLo, 2.4);
  ctx.restore();

  // ears: behind the head. Idle: a lazy sway and a quick twitch. Hop: they stream back. Cheer: straight up.
  const sway = Math.sin(p.clock * 1.7) * 0.06;
  const twitch = p.clock % 4.3 > 4.0 ? Math.sin(p.clock * 38) * 0.22 : 0;
  let a1 = -0.14 + sway;
  let a2 = 0.16 - sway + twitch;
  if (p.mode === "hop") {
    const stream = air ? -1.15 - 0.2 * Math.sin(p.clock * 22) : u <= 0.12 ? 0.35 : 0.55; // forward on take-off, flop on landing
    a1 = stream - 0.08;
    a2 = stream + 0.1;
  } else if (p.mode === "cheer") {
    a1 = -0.12 + Math.sin(p.clock * 18) * 0.12;
    a2 = 0.14 - Math.sin(p.clock * 18) * 0.12;
  }
  ear(-5, -48 + bob, a1, 31);
  ear(9, -49 + bob, a2, 33);

  // head
  ellipse(3, -37 + bob, 18.5, 17, 0, vgrad(-54, -20, FUR, FUR_LO), 3.6);

  // face (it looks right, the way the rabbit is heading)
  const lx = p.look * 1.4;
  for (const ex of [-2.5, 10.5]) {
    if (blink) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(ex - 4, -37 + bob + 1);
      ctx.quadraticCurveTo(ex, -37 + bob + 4.5, ex + 4, -37 + bob + 1);
      ctx.stroke();
      continue;
    }
    ellipse(ex, -38 + bob, 4.8, 6.2, 0, "#ffffff", 2.4);
    ctx.fillStyle = "#2a1450";
    ctx.beginPath(); ctx.arc(ex + 0.6 + lx, -37 + bob, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(ex - 0.4 + lx, -38.8 + bob, 1.1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "rgba(255,110,160,0.5)";
  for (const cx of [-8, 17]) { ctx.beginPath(); ctx.ellipse(cx, -30 + bob, 3.6, 2.4, 0, 0, Math.PI * 2); ctx.fill(); }
  // nose and mouth, with a little twitch
  const nz = Math.sin(p.clock * 9) * 0.5;
  ctx.fillStyle = "#ff6fa0";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14.5, -32 + bob + nz); ctx.lineTo(19.5, -32 + bob + nz); ctx.lineTo(17, -28.6 + bob + nz); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  if (air || p.mode === "cheer") {
    ctx.fillStyle = "#7a1d3d";
    ctx.ellipse(17, -24 + bob, 2.8, 3, 0, 0, Math.PI * 2); // an open, happy mouth
    ctx.fill(); ctx.stroke();
  } else {
    ctx.moveTo(17, -28.6 + bob); ctx.lineTo(17, -26.2 + bob);
    ctx.moveTo(13.2, -25.8 + bob); ctx.quadraticCurveTo(17, -22.5 + bob, 20.4, -25.8 + bob);
    ctx.stroke();
  }
  // whiskers
  ctx.strokeStyle = "rgba(58,26,106,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const dy of [-1.5, 2]) { ctx.moveTo(19, -30 + bob + dy); ctx.lineTo(28, -32 + bob + dy * 1.8); }
  ctx.stroke();
  ctx.restore();
}
