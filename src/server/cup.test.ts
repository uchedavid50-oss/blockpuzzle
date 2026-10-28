import { describe, expect, it } from "vitest";
import { ECONOMY } from "../economy";
import { playBot } from "../solver";
import { RULES_VERSION, type MoveTuple } from "../verify";
import { unclaimedCoins } from "./coins";
import { claimCupPrize, prizeFor } from "./cup";
import { getBoard, startDaily, submitScore } from "./handlers";
import { isBoardId, isWeekId, boardOpen, weekOver } from "./rules";
import { MemoryStore, type Store } from "./store";

const WEEK = "w-2026-10-26"; // a Monday
const MID = new Date("2026-10-28T12:00:00Z");
const AFTER = new Date("2026-11-03T12:00:00Z"); // well after the week ended
const id = (n: number): string => n.toString(16).padStart(24, "0");
const HOUR = 3_600_000;

function game(maxMoves: number): { moves: MoveTuple[]; score: number } {
  const moveLog: [number, number, number][] = [];
  const run = playBot({ seed: WEEK, maxMoves, moveLog });
  return { moves: moveLog, score: run.score };
}
async function post(store: Store, n: number, name: string, g: { moves: MoveTuple[] }, now = MID) {
  await startDaily(store, { player: id(n), date: WEEK }, new Date(now.getTime() - HOUR));
  return submitScore(store, { v: RULES_VERSION, player: id(n), name, date: WEEK, moves: g.moves }, now);
}

describe("week board ids", () => {
  it("accepts a Monday-named week and a day, and nothing else", () => {
    expect(isWeekId(WEEK)).toBe(true);
    expect(isBoardId("2026-10-28")).toBe(true);
    for (const bad of ["w-2026-10-27", "w-2026-13-01", "w-x", "2026-10-26x", "", 5, null]) expect(isBoardId(bad)).toBe(false);
  });
  it("is open for the whole week and closed after it", () => {
    expect(boardOpen(WEEK, MID)).toBe(true);
    expect(boardOpen(WEEK, AFTER)).toBe(false);
    expect(boardOpen("w-2026-11-02", MID)).toBe(false); // next week has not begun anywhere yet
    expect(weekOver(WEEK, MID)).toBe(false);
    expect(weekOver(WEEK, AFTER)).toBe(true);
  });
});

describe("Weekly Cup", () => {
  it("replays scores on the week's own pieces, ranks them, and keeps the daily streak out of it", async () => {
    const store = new MemoryStore();
    const strong = game(60), weak = game(12);
    const a = await post(store, 1, "Ada", weak);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ score: weak.score, streak: 0, rank: 1 });
    const b = await post(store, 2, "Bo Strong", strong);
    expect(b.body.rank).toBe(1);
    const board = await getBoard(store, { date: WEEK, player: id(1) }, MID);
    expect((board.body.top as { name: string }[]).map((t) => t.name)).toEqual(["Bo Strong", "Ada"]);
    expect((await store.zcard("lb:streak"))).toBe(0);
  });

  it("refuses a game played on the wrong pieces and a second attempt", async () => {
    const store = new MemoryStore();
    const moveLog: [number, number, number][] = [];
    playBot({ seed: "2026-10-28", maxMoves: 20, moveLog }); // a daily's pieces, not the cup's
    expect((await post(store, 1, "Ada", { moves: moveLog })).status).toBe(422);
    const g = game(20);
    expect((await post(store, 2, "Bo Strong", g)).status).toBe(200);
    expect((await post(store, 2, "Bo Strong", g)).status).toBe(409);
  });

  it("refuses posting once the week has closed", async () => {
    const store = new MemoryStore();
    expect((await post(store, 1, "Ada", game(10), AFTER)).status).toBe(400);
  });

  it("pays the top places once, only after the week, into the claimable balance", async () => {
    const store = new MemoryStore();
    await post(store, 1, "Ada", game(10));
    await post(store, 2, "Bo Strong", game(50));
    expect((await claimCupPrize(store, { player: id(2), week: WEEK }, MID)).status).toBe(409); // still open
    const first = await claimCupPrize(store, { player: id(2), week: WEEK }, AFTER);
    expect(first.body).toEqual({ rank: 1, prize: ECONOMY.cup.prizes[0] });
    expect(await unclaimedCoins(store, id(2))).toBe(ECONOMY.cup.prizes[0]);
    const again = await claimCupPrize(store, { player: id(2), week: WEEK }, AFTER);
    expect(again.body).toMatchObject({ prize: 0, already: true });
    expect(await unclaimedCoins(store, id(2))).toBe(ECONOMY.cup.prizes[0]); // not paid twice
    expect((await claimCupPrize(store, { player: id(1), week: WEEK }, AFTER)).body).toEqual({ rank: 2, prize: ECONOMY.cup.prizes[1] });
    expect((await claimCupPrize(store, { player: id(9), week: WEEK }, AFTER)).body).toEqual({ rank: 0, prize: 0 }); // did not play
  });

  it("has prizes for the top ten and none below", () => {
    expect(prizeFor(1)).toBe(300);
    expect(prizeFor(4)).toBe(ECONOMY.cup.restPrize);
    expect(prizeFor(ECONOMY.cup.top)).toBe(ECONOMY.cup.restPrize);
    expect(prizeFor(ECONOMY.cup.top + 1)).toBe(0);
    expect(prizeFor(0)).toBe(0);
  });
});
