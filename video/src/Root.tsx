import React from "react";
import { Composition } from "remotion";
import { Explainer } from "./Explainer";
import { plan, type Capture } from "./plan";
import { FPS } from "./timing";
import { howto } from "./specs/howto";
import { admin } from "./specs/admin";
import gameCapture from "./data/game.json";
import adminCapture from "./data/admin.json";
import howtoVoice from "./data/voice-howto.json";
import adminVoice from "./data/voice-admin.json";

const videos = [
  { spec: howto, capture: gameCapture as unknown as Capture, durations: howtoVoice.durations as Record<string, number>, w: 1080, h: 1920 },
  { spec: admin, capture: adminCapture as unknown as Capture, durations: adminVoice.durations as Record<string, number>, w: 1920, h: 1080 },
];

export const Root: React.FC = () => (
  <>
    {videos.map(({ spec, capture, durations, w, h }) => {
      const p = plan(spec, durations, capture);
      return (
        <Composition key={spec.id} id={spec.id} component={Explainer} width={w} height={h} fps={FPS} durationInFrames={p.total}
          defaultProps={{ spec, p, capture, durations }} />
      );
    })}
  </>
);
