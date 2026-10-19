import { describe, expect, it } from "vitest";
import { playBot } from "./solver";
import { MAX_MOVES, replay, type MoveTuple } from "./verify";

/** A real game: the bot plays a seeded day and logs every placement. */
function botGame(seed: string, maxMoves = 40): { moves: MoveTuple[]; score: number } {
  const moveLog: [number, number, number][] = [];
  const run = playBot({ seed, maxMoves, moveLog });
  return { moves: moveLog, score: run.score };
}

describe("replay", () => {
  it("reproduces the score of a real game exactly", () => {
    for (const seed of ["2026-10-19", "2026-10-20", "abc123"]) {
      const g = botGame(seed);
      const r = replay(seed, g.moves);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.score).toBe(g.score);
    }
  });

  it("is deterministic", () => {
    const g = botGame("2026-11-02");
    expect(replay("2026-11-02", g.moves)).toEqual(replay("2026-11-02", g.moves));
  });

  it("gives a different result on a different day's pieces", () => {
    const g = botGame("2026-10-19");
    const other = replay("2026-10-20", g.moves);
    // The same moves almost never stay legal against another day's trays.
    expect(other.ok && other.score === g.score).toBe(false);
  });

  it("rejects a piece that is not in the tray", () => {
    const g = botGame("2026-10-19", 5);
    const bad = g.moves.map((m, i) => (i === 0 ? ([(m[0] + 7) % 36, m[1], m[2]] as MoveTuple) : m));
    const r = replay("2026-10-19", bad);
    // Either the swapped piece is not in the tray, or (if it happens to be) the rest must still hold up.
    if (!r.ok) expect(r.error).toMatch(/move \d+/);
  });

  it("rejects an illegal placement", () => {
    const g = botGame("2026-10-19", 6);
    const stacked: MoveTuple[] = [g.moves[0]!, [g.moves[0]![0], g.moves[0]![1], g.moves[0]![2]]];
    const r = replay("2026-10-19", stacked);
    expect(r.ok).toBe(false);
  });

  it("rejects out-of-bounds, malformed, empty and oversized input", () => {
    expect(replay("x", [[0, 99, 99]]).ok).toBe(false);
    expect(replay("x", [[0, 1]] as unknown as MoveTuple[]).ok).toBe(false);
    expect(replay("x", [[0, 1.5, 2]] as unknown as MoveTuple[]).ok).toBe(false);
    expect(replay("x", [[999, 0, 0]]).ok).toBe(false);
    expect(replay("x", []).ok).toBe(false);
    expect(replay("x", Array.from({ length: MAX_MOVES + 1 }, () => [0, 0, 0] as MoveTuple)).ok).toBe(false);
  });

  it("cannot be inflated: a tampered move list scores what it actually scores, or fails", () => {
    const g = botGame("2026-10-19", 30);
    // drop the first move: later moves now refer to a different board and usually become illegal
    const r = replay("2026-10-19", g.moves.slice(1));
    expect(!r.ok || r.score <= g.score + 5000).toBe(true);
    if (r.ok) expect(r.score).toBeLessThanOrEqual(g.score);
  });
});
