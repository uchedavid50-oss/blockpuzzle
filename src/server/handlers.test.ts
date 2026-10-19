import { describe, expect, it } from "vitest";
import { playBot } from "../solver";
import { RULES_VERSION, type MoveTuple } from "../verify";
import { getBoard, getStreaks, renamePlayer, submitScore } from "./handlers";
import { RedisStore } from "./redis";
import { MemoryStore, type Store } from "./store";

const NOW = new Date("2026-10-19T12:00:00Z");
const id = (n: number): string => n.toString(16).padStart(24, "0");

function botGame(date: string, maxMoves: number): { moves: MoveTuple[]; score: number } {
  const moveLog: [number, number, number][] = [];
  const run = playBot({ seed: date, maxMoves, moveLog });
  return { moves: moveLog, score: run.score };
}
const submit = (store: Store, n: number, name: string, game: { moves: MoveTuple[] }, date = "2026-10-19", now = NOW) =>
  submitScore(store, { v: RULES_VERSION, player: id(n), name, date, moves: game.moves }, now);

/** Runs the same flow against any store, so memory and Redis must behave identically. */
async function flow(store: Store): Promise<void> {
  const strong = botGame("2026-10-19", 60);
  const weak = botGame("2026-10-19", 12);

  const a = await submit(store, 1, "Ada", weak);
  expect(a.status).toBe(200);
  expect(a.body.rank).toBe(1);
  expect(a.body.score).toBe(weak.score); // the server computed it, the client never sent one

  const b = await submit(store, 2, "Bo Strong", strong);
  expect(b.body.rank).toBe(1);
  expect(b.body.total).toBe(2);

  const board = await getBoard(store, { date: "2026-10-19", player: id(1) }, NOW);
  const top = board.body.top as { rank: number; name: string; score: number; you: boolean }[];
  expect(top.map((t) => t.name)).toEqual(["Bo Strong", "Ada"]);
  expect(top[1]).toMatchObject({ rank: 2, you: true, score: weak.score });
  expect(board.body.me).toEqual({ rank: 2, score: weak.score });
  expect(board.body.total).toBe(2);

  // the first attempt is the record: a second submission is refused and cannot change the score
  const again = await submit(store, 1, "Ada", strong);
  expect(again.status).toBe(409);
  const after = await getBoard(store, { date: "2026-10-19", player: id(1) }, NOW);
  expect((after.body.me as { score: number }).score).toBe(weak.score);
}

describe("leaderboard handlers (memory store)", () => {
  it("ranks verified games, names them, and keeps the first attempt", async () => flow(new MemoryStore()));

  it("rejects every kind of bad submission", async () => {
    const store = new MemoryStore();
    const g = botGame("2026-10-19", 20);
    const ok = { v: RULES_VERSION, player: id(7), name: "Cleo", date: "2026-10-19", moves: g.moves };
    expect((await submitScore(store, { ...ok, v: RULES_VERSION + 1 }, NOW)).status).toBe(409);
    expect((await submitScore(store, { ...ok, player: "nope" }, NOW)).status).toBe(400);
    expect((await submitScore(store, { ...ok, name: "<b>x</b>" }, NOW)).status).toBe(400);
    expect((await submitScore(store, { ...ok, name: "xx" }, NOW)).status).toBe(400);
    expect((await submitScore(store, { ...ok, date: "2026-10-01" }, NOW)).status).toBe(400); // an old board
    expect((await submitScore(store, { ...ok, date: "2026-12-25" }, NOW)).status).toBe(400); // a future one
    expect((await submitScore(store, { ...ok, moves: [] }, NOW)).status).toBe(422);
    expect((await submitScore(store, { ...ok, moves: [[0, 99, 99]] }, NOW)).status).toBe(422);
    expect((await submitScore(store, null, NOW)).status).toBe(409);
    // a faked score field is simply ignored
    const sneaky = await submitScore(store, { ...ok, score: 999999 }, NOW);
    expect(sneaky.status).toBe(200);
    expect(sneaky.body.score).toBe(g.score);
    expect(sneaky.body.score).not.toBe(999999);
  });

  it("verifies against the date's own pieces, so another day's game does not pass", async () => {
    const store = new MemoryStore();
    const wrongDay = botGame("2026-10-20", 30);
    const r = await submit(store, 3, "Dee", wrongDay, "2026-10-19");
    expect(r.status).toBe(422);
  });

  it("an empty board returns an empty list, not an error", async () => {
    const board = await getBoard(new MemoryStore(), { date: "2026-10-19" }, NOW);
    expect(board.status).toBe(200);
    expect(board.body.top).toEqual([]);
    expect(board.body.me).toBeNull();
  });
});

describe("renamePlayer", () => {
  it("renames a known player, and nobody else", async () => {
    const store = new MemoryStore();
    await submit(store, 1, "Ada", botGame("2026-10-19", 10));
    expect((await renamePlayer(store, { player: id(1), name: "Ada Lovelace" })).status).toBe(200);
    const board = await getBoard(store, { date: "2026-10-19" }, NOW);
    expect((board.body.top as { name: string }[])[0]!.name).toBe("Ada Lovelace");
    expect((await renamePlayer(store, { player: id(9), name: "Stranger" })).status).toBe(404); // never posted
    expect((await renamePlayer(store, { player: id(1), name: "f u c k" })).status).toBe(400);
    expect((await renamePlayer(store, { player: "x", name: "Fine Name" })).status).toBe(400);
  });
});

describe("streaks", () => {
  it("builds a streak across days and shows only live ones", async () => {
    const store = new MemoryStore();
    const day = (d: string) => botGame(d, 10);
    for (const d of ["2026-10-17", "2026-10-18", "2026-10-19"]) {
      const r = await submit(store, 1, "Ada", day(d), d, new Date(`${d}T10:00:00Z`));
      expect(r.status).toBe(200);
    }
    await submit(store, 2, "Bo Short", day("2026-10-19"), "2026-10-19");

    const s = await getStreaks(store, { player: id(1) }, NOW);
    const top = s.body.top as { name: string; streak: number; you: boolean }[];
    expect(top[0]).toMatchObject({ name: "Ada", streak: 3, you: true });
    expect(top[1]).toMatchObject({ name: "Bo Short", streak: 1 });
    expect(s.body.me).toEqual({ rank: 1, streak: 3 });

    // a week later nobody has played: the lapsed streaks are gone, not shown stale
    const later = await getStreaks(store, {}, new Date("2026-10-27T12:00:00Z"));
    expect(later.body.top).toEqual([]);
  });

  it("a weekly freeze bridges one missed day on the server too", async () => {
    const store = new MemoryStore();
    for (const d of ["2026-10-19", "2026-10-21"]) // Monday then Wednesday: Tuesday missed
      await submit(store, 5, "Eve", botGame(d, 8), d, new Date(`${d}T10:00:00Z`));
    const s = await getStreaks(store, { player: id(5) }, new Date("2026-10-21T12:00:00Z"));
    expect(s.body.me).toEqual({ rank: 1, streak: 2 });
  });
});

/** A tiny stand-in for the Upstash REST API, so RedisStore's command formats are checked for real. */
function fakeUpstash(): typeof fetch {
  const mem = new MemoryStore();
  return (async (_url: unknown, init?: RequestInit) => {
    const [cmd, ...a] = JSON.parse(String(init?.body)) as (string | number)[];
    const s = (i: number): string => String(a[i]);
    let result: unknown = null;
    switch (cmd) {
      case "SET":
        if (a.includes("NX")) result = (await mem.setNx(s(0), s(1), 0)) ? "OK" : null;
        else { await mem.set(s(0), s(1)); result = "OK"; }
        break;
      case "GET": result = await mem.get(s(0)); break;
      case "EXPIRE": result = 1; break;
      case "ZADD": await mem.zadd(s(0), Number(a[1]), s(2)); result = 1; break;
      case "ZREM": await mem.zrem(s(0), s(1)); result = 1; break;
      case "ZCARD": result = await mem.zcard(s(0)); break;
      case "ZSCORE": { const v = await mem.zscore(s(0), s(1)); result = v === null ? null : String(v); break; }
      case "ZREVRANK": result = await mem.zrevrank(s(0), s(1)); break;
      case "ZREVRANGE": result = (await mem.zrevrange(s(0), Number(a[1]), Number(a[2]))).flatMap((e) => [e.member, String(e.score)]); break;
      case "HSET": await mem.hset(s(0), s(1), s(2)); result = 1; break;
      case "HMGET": result = await mem.hmget(s(0), a.slice(1).map(String)); break;
      default: return new Response(JSON.stringify({ error: `unknown command ${cmd}` }), { status: 200 });
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;
}

describe("leaderboard handlers (Redis REST store)", () => {
  it("behaves exactly like the memory store", async () => flow(new RedisStore("https://redis.test", "token", fakeUpstash())));
  it("surfaces an HTTP failure as an error", async () => {
    const down = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    await expect(new RedisStore("https://redis.test", "t", down).get("x")).rejects.toThrow(/503/);
  });
  it("surfaces a Redis error message", async () => {
    const bad = (async () => new Response(JSON.stringify({ error: "WRONGTYPE" }), { status: 200 })) as typeof fetch;
    await expect(new RedisStore("https://redis.test", "t", bad).get("x")).rejects.toThrow(/WRONGTYPE/);
  });
});
