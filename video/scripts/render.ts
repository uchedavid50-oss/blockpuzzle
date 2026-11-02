// Renders both videos and runs the delivery checks. Usage: npm run render [-- howto|admin]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";

const VERSION = process.env.VERSION ?? "v1";
const videos = [
  { id: "howto", file: `out/how-to-play-${VERSION}.mp4`, bed: "public/audio/bed-howto.mp3" },
  { id: "admin", file: `out/admin-dashboard-${VERSION}.mp4`, bed: "public/audio/bed-admin.mp3" },
].filter((v) => !process.argv[2] || v.id === process.argv[2]);

const ff = (args: string[]): string => {
  const r = spawnSync("npx", ["remotion", "ffmpeg", "-hide_banner", ...args], { encoding: "utf8" });
  return (r.stdout ?? "") + (r.stderr ?? "");
};

mkdirSync("out", { recursive: true });
for (const v of videos) {
  console.log(`\n▶ ${v.id} → ${v.file}`);
  if (!process.env.SKIP_RENDER) execFileSync("npx", ["remotion", "render", "src/index.ts", v.id, v.file, "--codec=h264", "--crf=16", "--audio-bitrate=256k", "--log=error"], { stdio: "inherit" });

  // The music bed must not drop out while the video plays (prints nothing when it is continuous).
  const seconds = execFileSync("npx", ["remotion", "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", v.file]).toString().trim();
  const silence = ff(["-t", seconds, "-i", v.bed, "-af", "silencedetect=n=-45dB:d=0.4", "-f", "null", "-"]).split("\n").filter((l) => l.includes("silence_start"));
  console.log(silence.length ? `  ✗ music bed has gaps:\n${silence.join("\n")}` : "  ✓ music bed has no silent gaps");

  // Loudness: two-pass normalisation of the final mix to -16 LUFS (peaks kept under -1.5 dBTP),
  // which is what phones and web players expect for speech.
  const m = JSON.parse(ff(["-i", v.file, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]).match(/\{[\s\S]*\}/)![0]);
  const tmp = v.file.replace(".mp4", ".tmp.mp4");
  ff(["-y", "-i", v.file, "-c:v", "copy", "-af",
    `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    "-ar", "48000", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", tmp]);
  renameSync(tmp, v.file);
  const after = ff(["-i", v.file, "-vn", "-af", "loudnorm=print_format=summary", "-f", "null", "-"]);
  console.log(`  loudness: ${m.input_i} → ${after.match(/Input Integrated:\s+(-?[\d.]+)/)?.[1]} LUFS, peak ${after.match(/Input True Peak:\s+(-?[\d.+]+)/)?.[1]} dBTP`);
}
