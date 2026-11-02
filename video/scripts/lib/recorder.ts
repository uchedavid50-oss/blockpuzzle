// Frame-exact screen capture. The page runs on Playwright's fake clock, paused (see pauseClock), so
// every frame is advanced by exactly 1/30 s and screenshotted: no dropped frames, and every take is
// identical.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Page } from "playwright";

export const FPS = 30;
const STEP = 1000 / FPS;

/**
 * Stops page time except when the recorder advances it. Without this, Playwright's installed clock
 * also ticks while each screenshot is taken (~0.1 s), and the recording plays several times too fast.
 */
export async function pauseClock(page: Page, start: Date): Promise<void> {
  await page.clock.pauseAt(new Date(start.getTime() + 3000));
}

export interface Ev { frame: number; type: "tap" | "down" | "up"; x: number; y: number }
export interface Clip { name: string; frames: number; events: Ev[]; marks: Record<string, number> }

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class Recorder {
  private cdp!: CDPSession;
  private dir = "";
  private frame = 0;
  private clip: Clip | null = null;
  readonly clips: Clip[] = [];

  private page!: Page;

  constructor(private readonly rawDir: string, private readonly outDir: string, private readonly scale = 1) {}

  /** Records from this page from now on (each scene can be a fresh page). */
  async use(page: Page): Promise<void> {
    this.page = page;
    this.cdp = await page.context().newCDPSession(page);
  }

  /** Starts a new clip. Time stands still between clips. */
  start(name: string): void {
    this.dir = join(this.rawDir, name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frame = 0;
    this.clip = { name, frames: 0, events: [], marks: {} };
  }

  /** Remembers the current frame under a name (e.g. where a clear lands), for the edit. */
  mark(name: string): void {
    this.clip!.marks[name] = this.frame;
  }

  private async shot(): Promise<void> {
    // Whole milliseconds that add up exactly: frame n is always at n/30 s.
    await this.page.clock.runFor(Math.round((this.frame + 1) * STEP) - Math.round(this.frame * STEP));
    await this.page.screenshot({ path: join(this.dir, `${String(this.frame).padStart(5, "0")}.png`), scale: "device" });
    this.frame++;
  }

  async hold(seconds: number): Promise<void> {
    for (let i = Math.round(seconds * FPS); i > 0; i--) await this.shot();
  }

  /** Advances time without recording (skips a loading moment, a toast fading). */
  async skip(seconds: number): Promise<void> {
    await this.page.clock.runFor(seconds * 1000);
  }

  private touch(type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number): Promise<unknown> {
    return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  }

  async tap(x: number, y: number): Promise<void> {
    this.clip!.events.push({ frame: this.frame, type: "tap", x, y });
    await this.touch("touchStart", x, y);
    await this.shot();
    await this.shot();
    await this.touch("touchEnd", x, y);
    await this.shot();
  }

  /** A finger drag along an eased path; `pauseAt` (0..1) stops mid-way for `pause` seconds. */
  async drag(from: [number, number], to: [number, number], seconds: number, pauseAt?: number, pause = 0): Promise<void> {
    this.clip!.events.push({ frame: this.frame, type: "down", x: from[0], y: from[1] });
    await this.touch("touchStart", from[0], from[1]);
    await this.hold(0.2);
    const n = Math.round(seconds * FPS);
    let paused = pauseAt === undefined;
    for (let i = 1; i <= n; i++) {
      const t = ease(i / n);
      await this.touch("touchMove", from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
      await this.shot();
      if (!paused && i / n >= pauseAt!) { paused = true; await this.hold(pause); }
    }
    await this.hold(0.1);
    await this.touch("touchEnd", to[0], to[1]);
    this.clip!.events.push({ frame: this.frame, type: "up", x: to[0], y: to[1] });
  }

  /** Ends the clip and encodes it to an H.264 file the edit can use. */
  finish(): void {
    const c = this.clip!;
    c.frames = this.frame;
    this.clips.push(c);
    mkdirSync(this.outDir, { recursive: true });
    execFileSync("npx", ["remotion", "ffmpeg", "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(this.dir, "%05d.png"),
      "-c:v", "libx264", "-crf", "12", "-preset", "slow", "-pix_fmt", "yuv420p", join(this.outDir, `${c.name}.mp4`)], { stdio: "inherit" });
    this.clip = null;
    console.log(`  ${c.name}: ${c.frames} frames`);
  }

  /** Writes the clip index, keeping clips from earlier runs that this run did not re-record. */
  writeIndex(path: string, extra: Record<string, unknown>): void {
    const before: Clip[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).clips ?? [] : [];
    const clips = [...before.filter((c) => !this.clips.some((n) => n.name === c.name)), ...this.clips];
    writeFileSync(path, JSON.stringify({ fps: FPS, scale: this.scale, ...extra, clips }, null, 2) + "\n");
  }
}
