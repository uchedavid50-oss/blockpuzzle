import React from "react";
import { AbsoluteFill, Audio, Easing, Freeze, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Nunito";
import type { VideoSpec } from "./specs/types";
import { DISSOLVE, camera, resolve, type Capture, type Plan, type PlannedBeat, type Segment } from "./plan";
import { FPS } from "./timing";

const { fontFamily: NUNITO } = loadFont("normal", { weights: ["600", "700", "800", "900"], subsets: ["latin"] });

// The game's own palette (src/gfx.ts).
const C = { violet: "#8a4dff", deep: "#5a22c8", magenta: "#ff4fa0", ink: "#3d1a5c", dim: "#8d6aa8" };

/** Where the captured screen sits in the frame, and how much it is scaled. */
interface Layout { x: number; y: number; k: number; w: number; h: number }
function layoutFor(spec: VideoSpec): Layout {
  if (spec.orientation === "portrait") {
    const h = 1320, k = h / spec.viewport.h, w = spec.viewport.w * k;
    return { x: (1080 - w) / 2, y: 330, k, w, h };
  }
  const k = 1, w = spec.viewport.w * k, h = spec.viewport.h * k;
  return { x: 560, y: (1080 - h - 44) / 2 + 44, k, w, h };
}

const ease = Easing.bezier(0.33, 0, 0.2, 1);
const fade = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

// ---- Background and device ---------------------------------------------------------------------

const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const drift = Math.sin(f / 140) * 40;
  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #ffe6f4 0%, #f3e9ff 50%, #e4d9ff 100%)" }}>
      <div style={{ position: "absolute", width: 900, height: 900, left: -300 + drift, top: -260, borderRadius: "50%", background: C.magenta, opacity: 0.10, filter: "blur(160px)" }} />
      <div style={{ position: "absolute", width: 1000, height: 1000, right: -360 - drift, bottom: -380, borderRadius: "50%", background: C.violet, opacity: 0.13, filter: "blur(170px)" }} />
    </AbsoluteFill>
  );
};

const Device: React.FC<{ spec: VideoSpec; L: Layout; children: React.ReactNode }> = ({ spec, L, children }) => {
  if (spec.orientation === "portrait") {
    const bezel = 16;
    return (
      <div style={{ position: "absolute", left: L.x - bezel, top: L.y - bezel, width: L.w + bezel * 2, height: L.h + bezel * 2, borderRadius: 74, background: "#1a1230",
        boxShadow: "0 50px 100px rgba(60,20,120,0.28), 0 12px 30px rgba(60,20,120,0.18), inset 0 0 0 2px #3a2d5c" }}>
        <div style={{ position: "absolute", left: bezel, top: bezel, width: L.w, height: L.h, borderRadius: 58, overflow: "hidden", background: "#fff" }}>{children}</div>
      </div>
    );
  }
  const bar = 44;
  return (
    <div style={{ position: "absolute", left: L.x, top: L.y - bar, width: L.w, height: L.h + bar, borderRadius: 16, overflow: "hidden", background: "#fff",
      boxShadow: "0 40px 90px rgba(60,20,120,0.22), 0 10px 26px rgba(60,20,120,0.14), 0 0 0 1px rgba(60,20,120,0.10)" }}>
      <div style={{ height: bar, background: "#f4effc", display: "flex", alignItems: "center", padding: "0 18px", gap: 9, borderBottom: "1px solid #e6dcf7" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
        <div style={{ margin: "0 auto", transform: "translateX(-30px)", background: "#fff", borderRadius: 8, padding: "5px 90px", fontFamily: NUNITO, fontWeight: 700, fontSize: 15, color: C.dim }}>
          your-game.com/admin.html
        </div>
      </div>
      <div style={{ position: "relative", width: L.w, height: L.h, overflow: "hidden" }}>{children}</div>
    </div>
  );
};

// ---- Screen contents ---------------------------------------------------------------------------

/** One clip, played from `clipAt`, holding its last frame if the beat outlasts it. */
const ClipLayer: React.FC<{ spec: VideoSpec; seg: Segment; first: boolean }> = ({ spec, seg, first }) => {
  const f = useCurrentFrame();
  const clip = seg.clip!;
  const at = Math.min(seg.clipAt + f, clip.frames - 1);
  return (
    <AbsoluteFill style={{ opacity: first ? 1 : fade(f, 0, DISSOLVE) }}>
      <Freeze frame={at}>
        <OffthreadVideo src={staticFile(`clips/${spec.id === "howto" ? "game" : "admin"}/${clip.name}.mp4`)} muted style={{ width: spec.viewport.w, height: spec.viewport.h }} />
      </Freeze>
    </AbsoluteFill>
  );
};

/** A soft glow ~1 s before each tap, then a light grey ring as the finger lands. */
const Taps: React.FC<{ seg: Segment }> = ({ seg }) => {
  const f = useCurrentFrame();
  const evs = (seg.clip?.events ?? []).filter((e) => e.type !== "up");
  return (
    <>
      {evs.map((e, i) => {
        const at = e.frame - seg.clipAt; // segment-relative frame of the touch
        if (f < at - 30 || f > at + 18) return null;
        const pre = f < at ? fade(f, at - 30, at - 8) : interpolate(f, [at, at + 10], [1, 0], { extrapolateRight: "clamp" });
        const ring = f >= at ? (f - at) / 18 : -1;
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left: e.x - 34, top: e.y - 34, width: 68, height: 68, borderRadius: 34, opacity: pre,
              background: "radial-gradient(circle, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.35) 45%, rgba(255,255,255,0) 70%)" }} />
            {ring >= 0 && (
              <div style={{ position: "absolute", left: e.x - (16 + ring * 18), top: e.y - (16 + ring * 18), width: (16 + ring * 18) * 2, height: (16 + ring * 18) * 2,
                borderRadius: "50%", border: "3px solid rgba(110,110,125,0.55)", background: "rgba(150,150,165,0.18)", opacity: 1 - ring }} />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};

/** Dims everything except one box, fading between boxes. */
const Spotlights: React.FC<{ pb: PlannedBeat; capture: Capture }> = ({ pb, capture }) => {
  const f = useCurrentFrame();
  const spots = pb.beat.spot ?? [];
  return (
    <>
      {spots.map((s, i) => {
        const a = Math.round(s.at * FPS), b = i + 1 < spots.length ? Math.round(spots[i + 1]!.at * FPS) : pb.frames;
        if (f < a || f > b) return null;
        const o = Math.min(fade(f, a, a + 12), 1 - fade(f, b - 10, b));
        const box = resolve(s, capture);
        return (
          <div key={i} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 14, opacity: o,
            boxShadow: "0 0 0 4000px rgba(30,12,60,0.38), 0 0 0 3px rgba(255,255,255,0.9), 0 0 30px 6px rgba(138,77,255,0.45)" }} />
        );
      })}
    </>
  );
};

const Blurs: React.FC<{ pb: PlannedBeat; capture: Capture }> = ({ pb, capture }) => (
  <>
    {(pb.beat.blur ?? []).map((a, i) => {
      const b = resolve(a, capture);
      return <div key={i} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 8, backdropFilter: "blur(9px)", WebkitBackdropFilter: "blur(9px)", background: "rgba(246,241,255,0.25)" }} />;
    })}
  </>
);

const Screen: React.FC<{ spec: VideoSpec; p: Plan; capture: Capture; L: Layout }> = ({ spec, p, capture, L }) => {
  const f = useCurrentFrame();
  const cam = camera(p, spec, f);
  return (
    <div style={{ position: "absolute", width: spec.viewport.w, height: spec.viewport.h, transformOrigin: "0 0", transform: `scale(${L.k})` }}>
      <div style={{ position: "absolute", inset: 0, transformOrigin: `${cam.x}px ${cam.y}px`, transform: `scale(${cam.s})` }}>
        {p.segments.map((seg, i) => seg.clip && (
          <Sequence key={seg.start} from={seg.start} durationInFrames={seg.frames + (i + 1 < p.segments.length ? DISSOLVE : 0)} layout="none">
            <ClipLayer spec={spec} seg={seg} first={i === 0} />
            <Taps seg={seg} />
          </Sequence>
        ))}
        {p.beats.map((pb) => pb.beat.clip && (
          <Sequence key={pb.beat.id} from={pb.start} durationInFrames={pb.frames} layout="none">
            <Blurs pb={pb} capture={capture} />
            <Spotlights pb={pb} capture={capture} />
          </Sequence>
        ))}
      </div>
    </div>
  );
};

// ---- Captions ----------------------------------------------------------------------------------

const same = (a?: PlannedBeat, b?: PlannedBeat) => !!a && !!b && a.beat.caption === b.beat.caption && a.beat.step === b.beat.step && a.beat.chip === b.beat.chip;

const Caption: React.FC<{ spec: VideoSpec; pb: PlannedBeat; prev?: PlannedBeat; next?: PlannedBeat }> = ({ spec, pb, prev, next }) => {
  const f = useCurrentFrame();
  const { beat } = pb;
  if (!beat.caption) return null;
  const inO = same(prev, pb) ? 1 : fade(f, 0, 14);
  const outO = same(pb, next) ? 1 : 1 - fade(f, pb.frames - 8, pb.frames);
  const o = Math.min(inO, outO);
  const lift = (1 - inO) * 18;
  const portrait = spec.orientation === "portrait";
  const title = beat.id === "hook";
  const chipIn = same(prev, pb) ? 1 : fade(f, 8, 22);
  return (
    <div style={{
      position: "absolute", fontFamily: NUNITO, opacity: o, transform: `translateY(${lift}px)`,
      ...(portrait ? { left: 60, right: 60, top: 70, height: 230, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }
        : { left: 100, width: 400, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }),
    }}>
      {beat.step !== undefined && (
        <div style={{ color: C.violet, fontWeight: 900, fontSize: portrait ? 30 : 24, letterSpacing: "0.16em", marginBottom: portrait ? 10 : 12 }}>STEP {beat.step}</div>
      )}
      <div style={{ color: title ? C.deep : C.ink, fontWeight: title ? 900 : 800, fontSize: title ? (portrait ? 84 : 64) : portrait ? 58 : 48, lineHeight: 1.12, letterSpacing: "-0.01em" }}>
        {beat.caption}
      </div>
      {beat.chip && (
        <div style={{ marginTop: portrait ? 18 : 22, alignSelf: portrait ? "center" : "flex-start", opacity: chipIn, transform: `scale(${0.9 + chipIn * 0.1})`,
          background: "#fff", color: C.deep, fontWeight: 800, fontSize: portrait ? 30 : 24, padding: portrait ? "10px 26px" : "8px 22px", borderRadius: 999,
          boxShadow: "0 4px 14px rgba(90,34,200,0.18), 0 0 0 2px rgba(138,77,255,0.35)" }}>
          {beat.chip}
        </div>
      )}
    </div>
  );
};

// ---- End card ----------------------------------------------------------------------------------

const EndCard: React.FC<{ spec: VideoSpec }> = ({ spec }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 6, fps, config: { damping: 14, mass: 0.8 } });
  const sub = fade(f, 22, 40);
  const portrait = spec.orientation === "portrait";
  return (
    <AbsoluteFill style={{ opacity: fade(f, 0, 16), alignItems: "center", justifyContent: "center", fontFamily: NUNITO }}>
      <Backdrop />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${0.85 + pop * 0.15})`, opacity: pop }}>
        <Img src={staticFile("brand/icon.png")} style={{ width: portrait ? 260 : 220, height: portrait ? 260 : 220, borderRadius: portrait ? 58 : 50, boxShadow: "0 30px 60px rgba(90,34,200,0.30)" }} />
        <div style={{ marginTop: 44, fontSize: portrait ? 104 : 96, fontWeight: 900, color: C.deep, letterSpacing: "-0.01em" }}>{spec.endCard.title}</div>
        <div style={{ marginTop: 10, fontSize: portrait ? 40 : 36, fontWeight: 700, color: C.dim, opacity: sub }}>{spec.endCard.subtitle}</div>
      </div>
    </AbsoluteFill>
  );
};

// ---- Sound -------------------------------------------------------------------------------------

/** Voice starts a few frames into its beat, so cuts land just before the words. */
const LEAD = 4;
const MUSIC = 0.3, DUCKED = 0.036; // ~18.5 dB under the voice

const Sound: React.FC<{ spec: VideoSpec; p: Plan; durations: Record<string, number> }> = ({ spec, p, durations }) => {
  const talk = (f: number) => {
    let v = 0;
    for (const pb of p.beats) {
      const a = pb.start + LEAD, b = a + Math.round((durations[pb.beat.id] ?? 0) * FPS);
      v = Math.max(v, interpolate(f, [a - 8, a, b, b + 12], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    }
    return v;
  };
  const end = p.segments[p.segments.length - 1]!;
  const music = (f: number) => {
    const base = MUSIC - (MUSIC - DUCKED) * talk(f);
    const intro = interpolate(f, [0, 20], [0, 1], { extrapolateRight: "clamp" });
    const swell = f >= end.start ? interpolate(f, [end.start, end.start + 30], [1, 1.25], { extrapolateRight: "clamp" }) : 1;
    const out = interpolate(f, [p.total - 50, p.total - 2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return base * intro * swell * out;
  };
  return (
    <>
      <Audio src={staticFile(`audio/bed-${spec.id}.mp3`)} volume={music} />
      {p.beats.map((pb) => (
        <Sequence key={pb.beat.id} from={pb.start + LEAD} layout="none">
          <Audio src={staticFile(`voice/${spec.id}/${pb.beat.id}.mp3`)} volume={1} />
        </Sequence>
      ))}
      {p.segments.flatMap((seg) => seg.beats.flatMap((pb) => (pb.beat.sfx ?? []).map((m) => {
        const mark = seg.clip?.marks[m];
        if (mark === undefined) return null;
        return (
          <Sequence key={`${pb.beat.id}-${m}`} from={seg.start + mark - seg.clipAt + 6} layout="none">
            <Audio src={staticFile("audio/clear.mp3")} volume={0.32} />
          </Sequence>
        );
      })))}
      <Sequence from={end.start} layout="none">
        <Audio src={staticFile("audio/outro.mp3")} volume={0.45} />
      </Sequence>
    </>
  );
};

// ---- The video ---------------------------------------------------------------------------------

export const Explainer: React.FC<{ spec: VideoSpec; p: Plan; capture: Capture; durations: Record<string, number> }> = ({ spec, p, capture, durations }) => {
  const L = layoutFor(spec);
  const end = p.segments[p.segments.length - 1]!;
  return (
    <AbsoluteFill>
      <Backdrop />
      <Device spec={spec} L={L}>
        <Screen spec={spec} p={p} capture={capture} L={L} />
      </Device>
      {p.beats.map((pb, i) => (
        <Sequence key={pb.beat.id} from={pb.start} durationInFrames={pb.frames}>
          <Caption spec={spec} pb={pb} prev={p.beats[i - 1]} next={p.beats[i + 1]} />
        </Sequence>
      ))}
      <Sequence from={end.start}>
        <EndCard spec={spec} />
      </Sequence>
      <Sound spec={spec} p={p} durations={durations} />
    </AbsoluteFill>
  );
};
