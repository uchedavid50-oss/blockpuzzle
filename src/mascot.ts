// "Blip": the journey map's cartoon character, a friendly block creature with big eyes, stubby legs
// and a glowing antenna. Drawing only. Blip stands, walks, hops between levels and cheers; the map
// decides which, and where. Everything is drawn around the feet at (0, 0), facing right.

import { ctx, mix } from "./gfx";

export type MascotMode = "idle" | "hop" | "cheer";

export interface MascotPose {
  mode: MascotMode;
  clock: number; // seconds, drives blinking and bobbing
  hop: number; // 0..1 through a hop (only used in "hop" mode)
  squashX: number; // 1 = normal
  squashY: number;
  look: number; // -1..1: where the eyes point
  color: string; // body colour
  wave: boolean; // idle: wave an arm
}

const OUTLINE = "#3a1a6a";

function capsule(x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
  ctx.fill();
  ctx.stroke();
}

/** Draws Blip with the feet at the origin. Scale the context to size it (about 64 units tall). */
export function drawMascot(p: MascotPose): void {
  const hi = mix(p.color, 255, 0.42);
  const lo = mix(p.color, 0, 0.32);
  const bob = p.mode === "idle" ? Math.sin(p.clock * 2.6) * 1.6 : 0;
  const blink = (p.clock % 3.4) > 3.22;
  const air = p.mode === "hop" && p.hop > 0.12 && p.hop < 0.88;

  ctx.save();
  ctx.scale(p.squashX, p.squashY); // squash and stretch about the feet
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3.4;

  // legs: stubby feet that tuck up in the air
  const tuck = air ? -5 : 0;
  capsule(-8, -4.5 + tuck, 11, 9, lo);
  capsule(8, -4.5 + tuck, 11, 9, lo);

  // antenna: a wobbly stalk with a glowing star bulb
  const wob = Math.sin(p.clock * 5) * 3 + (air ? -4 : 0) + (p.mode === "cheer" ? Math.sin(p.clock * 14) * 4 : 0);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(2, -44 + bob);
  ctx.quadraticCurveTo(4 + wob * 0.5, -54 + bob, 4 + wob, -60 + bob);
  ctx.stroke();
  const glow = ctx.createRadialGradient(4 + wob, -63 + bob, 0, 4 + wob, -63 + bob, 12);
  glow.addColorStop(0, "rgba(255,244,170,0.9)");
  glow.addColorStop(1, "rgba(255,244,170,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(4 + wob, -63 + bob, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffd23a";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 3.2 : 7;
    const a = (i * Math.PI) / 5 - Math.PI / 2 + p.clock * 1.5;
    ctx.lineTo(4 + wob + Math.cos(a) * r, -63 + bob + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // arms: swing a little, wave, or throw up in a cheer
  ctx.lineWidth = 3.2;
  const armY = -24 + bob;
  const sw = p.mode === "hop" ? (air ? -0.9 : 0.4) : Math.sin(p.clock * 2.6) * 0.12;
  const lift = p.mode === "cheer" ? -2.6 + Math.sin(p.clock * 16) * 0.35 : 0;
  ctx.save();
  ctx.translate(-17, armY);
  ctx.rotate(0.5 + sw + lift * 0.55);
  capsule(0, 6, 7, 15, lo);
  ctx.restore();
  ctx.save();
  ctx.translate(17, armY);
  ctx.rotate(p.wave ? -2.5 + Math.sin(p.clock * 14) * 0.45 : -0.5 - sw - lift * 0.55);
  capsule(0, 6, 7, 15, lo);
  ctx.restore();

  // body: a glossy rounded block
  const g = ctx.createLinearGradient(0, -42 + bob, 0, -8);
  g.addColorStop(0, hi);
  g.addColorStop(0.5, p.color);
  g.addColorStop(1, lo);
  ctx.fillStyle = g;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.roundRect(-19, -43 + bob, 38, 36, 13);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.32)";
  ctx.beginPath();
  ctx.roundRect(-14, -40 + bob, 22, 8, 4);
  ctx.fill();

  // face
  const ex = 7.4;
  const ey = -27 + bob;
  const lx = p.look * 1.6;
  for (const sx of [-1, 1]) {
    if (blink) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(sx * ex - 4, ey + 1);
      ctx.quadraticCurveTo(sx * ex, ey + 4, sx * ex + 4, ey + 1);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(sx * ex, ey, 5.4, 6.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2a1450";
    ctx.beginPath(); ctx.arc(sx * ex + lx, ey + 1, 3.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(sx * ex + lx - 1, ey - 0.4, 1.1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "rgba(255,105,150,0.55)";
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * 13, ey + 8, 3.6, 2.4, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  if (air || p.mode === "cheer") {
    ctx.fillStyle = "#7a1d3d";
    ctx.ellipse(0, ey + 9, 3.6, 3.2, 0, 0, Math.PI * 2); // a happy open mouth
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.arc(0, ey + 5.5, 4.2, 0.15 * Math.PI, 0.85 * Math.PI); // a smile
    ctx.stroke();
  }
  ctx.restore();
}
