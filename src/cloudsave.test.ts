import { describe, expect, it } from "vitest";
import { cleanSnapshot, grantAmount, isSynced, mergeSnapshots, snapshotOf, type Snapshot } from "./cloudsave";
import { ECONOMY } from "./economy";
import { EMPTY_WALLET, type Wallet } from "./wallet";

const W = (w: Partial<Wallet>): string => JSON.stringify({ ...EMPTY_WALLET, ...w });
const wallet = (s: Snapshot): Wallet => JSON.parse(s["blockpuzzle.wallet"]!) as Wallet;
const stats = (s: Snapshot): Record<string, unknown> => JSON.parse(s["blockpuzzle.stats"]!) as Record<string, unknown>;

describe("what is saved", () => {
  it("keeps progress, drops ids, caches and the game in progress", () => {
    for (const k of ["blockpuzzle.wallet", "blockpuzzle.stats", "blockpuzzle.journey", "blockpuzzle.best", "blockpuzzle.daily.2026-10-20", "blockpuzzle.weekly.2026-W43"]) expect(isSynced(k)).toBe(true);
    for (const k of ["blockpuzzle.player", "blockpuzzle.save", "blockpuzzle.entitlements", "blockpuzzle.coinClaim", "blockpuzzle.anonId", "blockpuzzle.started.2026-10-20", "blockpuzzle.daily.junk"]) expect(isSynced(k)).toBe(false);
  });

  it("forgets per-day records older than 30 days", () => {
    const s = snapshotOf({ "blockpuzzle.official.2026-10-20": "{}", "blockpuzzle.official.2026-08-01": "{}", "blockpuzzle.best": "5", "other": "x" }, "2026-10-27");
    expect(Object.keys(s).sort()).toEqual(["blockpuzzle.best", "blockpuzzle.official.2026-10-20"]);
  });

  it("refuses a save from the network with foreign keys or non-string values", () => {
    expect(cleanSnapshot({ "blockpuzzle.best": "5" })).toEqual({ "blockpuzzle.best": "5" });
    expect(cleanSnapshot({ "blockpuzzle.player": "x" })).toBeNull();
    expect(cleanSnapshot({ "blockpuzzle.best": 5 })).toBeNull();
    expect(cleanSnapshot([])).toBeNull();
  });
});

describe("merging two devices", () => {
  it("the first sign-in adds a guest's progress to the account", () => {
    const local = { "blockpuzzle.wallet": W({ coins: 120, earned: 120, grants: ["claim:x"] }), "blockpuzzle.stats": JSON.stringify({ games: 3, lines: 10, bestScore: 400 }) };
    const cloud = { "blockpuzzle.wallet": W({ coins: 300, earned: 300 }), "blockpuzzle.stats": JSON.stringify({ games: 7, lines: 50, bestScore: 900 }) };
    const m = mergeSnapshots({}, local, cloud);
    expect(wallet(m).coins).toBe(420);
    expect(stats(m)).toMatchObject({ games: 10, lines: 60, bestScore: 900 });
  });

  it("only what changed since the last sync is added, so nothing is counted twice", () => {
    const base = { "blockpuzzle.wallet": W({ coins: 100, earned: 100 }), "blockpuzzle.stats": JSON.stringify({ games: 5, hist: [1, 1] }) };
    const local = { "blockpuzzle.wallet": W({ coins: 130, earned: 130 }), "blockpuzzle.stats": JSON.stringify({ games: 6, hist: [2, 1] }) };    // +30 here
    const cloud = { "blockpuzzle.wallet": W({ coins: 40, earned: 100, spent: 60 }), "blockpuzzle.stats": JSON.stringify({ games: 8, hist: [1, 3] }) }; // spent 60 elsewhere
    const m = mergeSnapshots(base, local, cloud);
    expect(wallet(m)).toMatchObject({ coins: 70, earned: 130, spent: 60 });
    expect(stats(m)).toMatchObject({ games: 9, hist: [2, 3] });
    // syncing again with nothing new changes nothing
    expect(mergeSnapshots(m, m, m)).toEqual(m);
  });

  it("a reward paid on both devices before they synced is paid once", () => {
    const base = { "blockpuzzle.wallet": W({ coins: 0 }) };
    const g = "bonus:2026-10-27";
    const local = { "blockpuzzle.wallet": W({ coins: 10 + ECONOMY.starter, earned: 10 + ECONOMY.starter, grants: ["starter", g] }) };
    const cloud = { "blockpuzzle.wallet": W({ coins: 10 + ECONOMY.starter, earned: 10 + ECONOMY.starter, grants: ["starter", g] }) };
    expect(wallet(mergeSnapshots(base, local, cloud)).coins).toBe(10 + ECONOMY.starter);
    // two separate ad views are two rewards, not a repeat
    expect(grantAmount("ad:2026-10-27:1")).toBe(0);
    expect(grantAmount("milestone:1000")).toBe(30);
  });

  it("the balance never goes negative", () => {
    const base = { "blockpuzzle.wallet": W({ coins: 100 }) };
    const m = mergeSnapshots(base, { "blockpuzzle.wallet": W({ coins: 0, spent: 100 }) }, { "blockpuzzle.wallet": W({ coins: 0, spent: 100 }) });
    expect(wallet(m).coins).toBe(0);
  });

  it("journey keeps the best stars and furthest level, and the levels count is recounted", () => {
    const local = { "blockpuzzle.journey": JSON.stringify({ next: 4, stars: { 1: 3, 2: 1, 3: 2 } }), "blockpuzzle.stats": JSON.stringify({ levels: 3 }) };
    const cloud = { "blockpuzzle.journey": JSON.stringify({ next: 6, stars: { 1: 1, 2: 2, 3: 1, 4: 1, 5: 3 } }), "blockpuzzle.stats": JSON.stringify({ levels: 5 }) };
    const m = mergeSnapshots({}, local, cloud);
    expect(JSON.parse(m["blockpuzzle.journey"]!)).toEqual({ next: 6, stars: { 1: 3, 2: 2, 3: 2, 4: 1, 5: 3 } });
    expect(stats(m).levels).toBe(5);
  });

  it("badges join, bests take the higher, the later streak wins, and device preferences stay", () => {
    const local = { "blockpuzzle.badges": '["first","quad"]', "blockpuzzle.best": "800", "blockpuzzle.daily.2026-10-26": "300", "blockpuzzle.streak": '{"last":"2026-10-25","n":9}', "blockpuzzle.theme": "Neon" };
    const cloud = { "blockpuzzle.badges": '["first","perfect"]', "blockpuzzle.best": "1200", "blockpuzzle.daily.2026-10-26": "250", "blockpuzzle.streak": '{"last":"2026-10-27","n":3}', "blockpuzzle.theme": "Gold", "blockpuzzle.muted": "1" };
    const m = mergeSnapshots({}, local, cloud);
    expect(JSON.parse(m["blockpuzzle.badges"]!)).toEqual(["first", "perfect", "quad"]);
    expect(m["blockpuzzle.best"]).toBe("1200");
    expect(m["blockpuzzle.daily.2026-10-26"]).toBe("300");
    expect(JSON.parse(m["blockpuzzle.streak"]!)).toEqual({ last: "2026-10-27", n: 3 });
    expect(m["blockpuzzle.theme"]).toBe("Neon");
    expect(m["blockpuzzle.muted"]).toBe("1"); // this device had none: take the account's
  });
});
