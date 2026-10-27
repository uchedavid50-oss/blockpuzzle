// Player accounts: who owns a name, and moving an account to another device.
//
// A player is just a random id the device keeps; it is also the restore code. Restoring used to mean
// "use the same id here too", so one purchase could be shared by everyone who had the code. Now a
// restore is a transfer: the account moves to a brand-new id on the new device, and the old id is
// retired. Whoever restores last has it; nobody else does.

import { NOTHING, parse, type Entitlements } from "../entitlements.js";
import type { Reply } from "./handlers.js";
import { movePayments } from "./payments.js";
import { isPlayerId, nameKey, utcToday } from "./rules.js";
import type { Store } from "./store.js";

const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
const DAY = 86_400;
const NAME_HOLD = 3650 * DAY;

export const movedKey = (player: string): string => `moved:${player}`;
export const entSetKey = (player: string): string => `ents:${player}`;
/** The account's cloud save (see signin.ts). */
export const saveKey = (player: string): string => `save:${player}`;
/** How the account signs in: field = method ("email", "google"), value = a masked label to show. */
export const signinKey = (player: string): string => `signin:${player}`;

/** True once this id has been moved to another device: it can no longer post, buy, claim or rename. */
export async function isRetired(store: Store, player: string): Promise<boolean> {
  return (await store.get(movedKey(player))) !== null;
}

/** The id an account lives under now, following moves (a payment started on an old id still lands). */
export async function currentId(store: Store, player: string): Promise<string> {
  let id = player;
  for (let i = 0; i < 8; i++) {
    const next = await store.get(movedKey(id));
    if (!next) return id;
    id = next;
  }
  return id;
}

/**
 * What a player owns. Kept as a set (one atomic add per item, so two purchases confirmed at the same
 * moment cannot overwrite each other), merged with the older JSON record from before the change.
 */
export async function entitlementsOf(store: Store, player: string): Promise<Entitlements> {
  let legacy: Entitlements = NOTHING;
  try { legacy = parse(JSON.parse((await store.get(`ent:${player}`)) ?? "null")); } catch { /* ignore */ }
  return parse({ owned: [...legacy.owned, ...(await store.smembers(entSetKey(player)))] });
}

/**
 * Gives a name to a player, if no one else holds it (lookalikes count as the same name). Releases the
 * player's previous name. Returns false if the name is taken.
 */
export async function claimName(store: Store, player: string, name: string): Promise<boolean> {
  const key = `nm:${nameKey(name)}`;
  if (!(await store.setNx(key, player, NAME_HOLD)) && (await store.get(key)) !== player) return false;
  const [old] = await store.hmget("names", [player]);
  if (old !== null && old !== undefined) {
    const oldKey = `nm:${nameKey(old)}`;
    if (oldKey !== key && (await store.get(oldKey)) === player) await store.del(oldKey);
  }
  await store.hset("names", player, name);
  return true;
}

const randomId = (): string => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

/**
 * Moves everything an account has from one id into another: purchases, coins waiting to be collected,
 * the supporter star, the payment history, and today's "already posted" marks (so a move cannot be used
 * to post the same day twice). The name, the streak and the cloud save move only if `to` has none of
 * its own. Used by a restore (into a brand-new id) and by signing in on a device that has played as a
 * guest (into the account). Does not retire `from`: callers claim that first.
 */
export async function mergeAccount(store: Store, from: string, to: string, now = new Date()): Promise<void> {
  for (const sku of (await entitlementsOf(store, from)).owned) await store.sadd(entSetKey(to), sku);
  const [coins] = await store.mcount([`coins:${from}`]);
  if (coins) { await store.incr(`coins:${from}`, -coins); await store.incr(`coins:${to}`, coins); }

  const [name, supporter] = [(await store.hmget("names", [from]))[0], (await store.hmget("supporters", [from]))[0]];
  if (name && !(await store.hmget("names", [to]))[0]) {
    await store.hset("names", to, name);
    const key = `nm:${nameKey(name)}`;
    if ((await store.get(key)) === from) { await store.del(key); await store.setNx(key, to, NAME_HOLD); }
  }
  if (supporter) { await store.hset("supporters", to, "1"); await store.hdel("supporters", from); }
  await movePayments(store, from, to);

  const streak = await store.get(`streak:${from}`);
  if (streak && !(await store.get(`streak:${to}`))) {
    await store.set(`streak:${to}`, streak);
    const n = (await store.zscore("lb:streak", from)) ?? 0;
    await store.zrem("lb:streak", from);
    if (n > 0) await store.zadd("lb:streak", n, to);
  }
  const save = await store.get(saveKey(from));
  if (save && !(await store.get(saveKey(to)))) await store.set(saveKey(to), save);
  const methods = await store.hkeys(signinKey(from));
  const labels = await store.hmget(signinKey(from), methods);
  for (let i = 0; i < methods.length; i++) if (labels[i]) await store.hset(signinKey(to), methods[i]!, labels[i]!);
  for (const off of [-1, 0, 1]) {
    const date = utcToday(new Date(now.getTime() + off * DAY * 1000));
    if (await store.get(`sub:${date}:${from}`)) await store.setNx(`sub:${date}:${to}`, "1", 4 * DAY);
    const started = await store.get(`start:${date}:${from}`);
    if (started) await store.setNx(`start:${date}:${to}`, started, 4 * DAY);
  }
}

/** Moves an account to a new id and retires the old one (see `mergeAccount` for what moves). */
export async function transferAccount(store: Store, body: unknown, now = new Date()): Promise<Reply> {
  const b = (body ?? {}) as { player?: unknown };
  if (!isPlayerId(b.player)) return reply(400, { error: "bad code", message: "That code does not look right." });
  const old = b.player;
  const fresh = randomId();
  // Claim the move first, atomically: of two devices restoring the same code at once, one wins.
  if (!(await store.setNx(movedKey(old), fresh, 3650 * DAY))) return reply(410, { error: "moved", message: "That code has already been used on another device." });
  await mergeAccount(store, old, fresh, now);
  return reply(200, { player: fresh });
}
