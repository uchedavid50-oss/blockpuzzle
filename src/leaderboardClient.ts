// The game's side of the leaderboard: a private player id, and calls to the /api routes. Everything
// here fails soft: if the network or the server is unavailable, the game simply hides the feature.

import { RULES_VERSION, type MoveTuple } from "./verify";

const PLAYER_KEY = "blockpuzzle.player";

export interface Player { id: string; name: string | null }

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The anonymous id this device posts under, made once and kept. No account, no personal data. */
export function getPlayer(): Player {
  try {
    const d = JSON.parse(localStorage.getItem(PLAYER_KEY) ?? "null") as Partial<Player> | null;
    if (d && typeof d.id === "string" && /^[a-f0-9]{24,32}$/.test(d.id)) return { id: d.id, name: typeof d.name === "string" ? d.name : null };
  } catch { /* fall through to a new id */ }
  const fresh: Player = { id: randomId(), name: null };
  try { localStorage.setItem(PLAYER_KEY, JSON.stringify(fresh)); } catch { /* ignore */ }
  return fresh;
}

export function savePlayerName(name: string): void {
  const p = getPlayer();
  try { localStorage.setItem(PLAYER_KEY, JSON.stringify({ ...p, name })); } catch { /* ignore */ }
}

/** True once /api/health says a leaderboard is configured. The UI shows leaderboard controls only then. */
export const lb = { available: false };

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  // no-store: the server lets shared caches keep boards for a few seconds, but this player must always see their own just-posted score.
  try { return await fetch(path, { ...init, cache: "no-store", signal: ctl.signal }); } finally { clearTimeout(timer); }
}

export async function checkLeaderboard(): Promise<void> {
  try {
    const r = await call("/api/health");
    lb.available = r.ok && ((await r.json()) as { leaderboard?: boolean }).leaderboard === true;
  } catch { lb.available = false; }
}

export type PostResult =
  | { ok: true; rank: number; total: number; score: number; streak: number }
  | { ok: false; error: string; message?: string };

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Posts a finished first attempt. The server replays the moves and works out the score itself. */
export async function postDaily(date: string, moves: readonly MoveTuple[], name: string): Promise<PostResult> {
  try {
    const { status, data } = await post("/api/submit", { v: RULES_VERSION, player: getPlayer().id, name, date, moves });
    if (status === 200) return { ok: true, rank: Number(data.rank), total: Number(data.total), score: Number(data.score), streak: Number(data.streak) };
    return { ok: false, error: String(data.error ?? "failed"), message: typeof data.message === "string" ? data.message : undefined };
  } catch { return { ok: false, error: "network", message: "Could not reach the leaderboard. Try again later." }; }
}

export async function renameOnServer(name: string): Promise<boolean> {
  try { return (await post("/api/rename", { player: getPlayer().id, name })).status === 200; } catch { return false; }
}

export interface BoardData { total: number; me: { rank: number; score: number } | null; top: { rank: number; name: string; score: number; you: boolean }[] }
export interface StreakData { me: { rank: number; streak: number } | null; top: { rank: number; name: string; streak: number; best: number; you: boolean }[] }

export async function fetchBoard(date: string): Promise<BoardData | null> {
  try {
    const r = await call(`/api/board?date=${encodeURIComponent(date)}&player=${getPlayer().id}`);
    return r.ok ? ((await r.json()) as BoardData) : null;
  } catch { return null; }
}

export async function fetchStreaks(): Promise<StreakData | null> {
  try {
    const r = await call(`/api/streaks?player=${getPlayer().id}`);
    return r.ok ? ((await r.json()) as StreakData) : null;
  } catch { return null; }
}
