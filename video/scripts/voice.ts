// Generates the voiceover with ElevenLabs: one file per beat, so timing follows the real speech.
// A line is only regenerated when its text or the voice settings change (credits are not spent twice).
// Usage: npm run voice -- howto|admin        npm run voice -- music|sfx
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { howto } from "../src/specs/howto.js";
import { admin } from "../src/specs/admin.js";

const KEY = readFileSync(".env", "utf8").match(/ELEVENLABS_API_KEY=(\S+)/)?.[1];
if (!KEY) throw new Error("ELEVENLABS_API_KEY missing from video/.env");

const VOICE = { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella" };
const MODEL = "eleven_multilingual_v2";
const SETTINGS = { stability: 0.55, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true, speed: 0.95 };

async function post(path: string, body: unknown): Promise<Buffer> {
  const r = await fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST",
    headers: { "xi-api-key": KEY!, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Length of an audio file in seconds (Remotion's bundled ffprobe). */
function seconds(file: string): number {
  const out = execFileSync("npx", ["remotion", "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString();
  return Number(out.trim());
}

async function voice(spec: typeof howto): Promise<void> {
  const dir = `public/voice/${spec.id}`;
  mkdirSync(dir, { recursive: true });
  const manifestPath = `${dir}/manifest.json`;
  const manifest: Record<string, string> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const durations: Record<string, number> = {};
  const beats = spec.beats;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    const file = `${dir}/${b.id}.mp3`;
    const hash = createHash("sha256").update(JSON.stringify([VOICE.id, MODEL, SETTINGS, b.say])).digest("hex").slice(0, 16);
    if (manifest[b.id] !== hash || !existsSync(file)) {
      process.stdout.write(`  ${b.id}: generating… `);
      const audio = await post(`/v1/text-to-speech/${VOICE.id}?output_format=mp3_44100_128`, {
        text: b.say, model_id: MODEL, voice_settings: SETTINGS,
        // Neighbouring lines keep the intonation continuous across separate files.
        previous_text: beats[i - 1]?.say, next_text: beats[i + 1]?.say,
      });
      writeFileSync(file, audio);
      manifest[b.id] = hash;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    } else process.stdout.write(`  ${b.id}: cached… `);
    durations[b.id] = Math.round(seconds(file) * 1000) / 1000;
    console.log(`${durations[b.id]}s`);
  }
  mkdirSync("src/data", { recursive: true });
  writeFileSync(`src/data/voice-${spec.id}.json`, JSON.stringify({ voice: VOICE.name, durations }, null, 2) + "\n");
}

async function music(): Promise<void> {
  mkdirSync("public/audio", { recursive: true });
  const tracks = [
    { file: "bed-howto.mp3", ms: 110_000, prompt: "Light, warm, playful instrumental background for a calm how-to video about a colourful puzzle game. Soft marimba, plucked strings and gentle synth pads, airy and optimistic, steady 96 bpm, no drums hits, no vocals, low dynamics so speech sits on top, ends with a soft resolved chord." },
    { file: "bed-admin.mp3", ms: 80_000, prompt: "Minimal, calm, modern instrumental background for a product tutorial. Soft electric piano, warm pad and subtle muted pluck, clean and focused, 90 bpm, no vocals, no strong drums, low dynamics so speech sits on top, ends with a soft resolved chord." },
  ];
  for (const t of tracks) {
    if (existsSync(`public/audio/${t.file}`)) { console.log(`  ${t.file}: cached`); continue; }
    process.stdout.write(`  ${t.file}: composing… `);
    writeFileSync(`public/audio/${t.file}`, await post("/v1/music?output_format=mp3_44100_128", { prompt: t.prompt, music_length_ms: t.ms, model_id: "music_v1", force_instrumental: true }));
    console.log(`${seconds(`public/audio/${t.file}`)}s`);
  }
}

async function sfx(): Promise<void> {
  mkdirSync("public/audio", { recursive: true });
  const effects = [
    { file: "clear.mp3", s: 1.2, text: "Soft, bright, gentle sparkle chime for a puzzle line clearing. Short, airy, pleasant, quiet UI success sound, no harshness." },
    { file: "outro.mp3", s: 2.5, text: "Warm soft logo reveal shimmer, gentle rising airy swell ending in a soft bell, calm and premium, quiet." },
  ];
  for (const e of effects) {
    if (existsSync(`public/audio/${e.file}`)) { console.log(`  ${e.file}: cached`); continue; }
    process.stdout.write(`  ${e.file}: generating… `);
    writeFileSync(`public/audio/${e.file}`, await post("/v1/sound-generation?output_format=mp3_44100_128", { text: e.text, duration_seconds: e.s, prompt_influence: 0.5 }));
    console.log("done");
  }
}

const what = process.argv[2];
if (what === "howto") await voice(howto);
else if (what === "admin") await voice(admin);
else if (what === "music") await music();
else if (what === "sfx") await sfx();
else throw new Error("usage: npm run voice -- howto|admin|music|sfx");
