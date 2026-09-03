// The player's persistent economy: gold, booster inventory, and the daily
// login streak that tops both up. Everything here is client-only state —
// there is no account or server (see `db/schema.ts`, deliberately empty) —
// so it lives in `localStorage`, the same way `level-drafts.ts` and
// `SandGame.tsx`'s tutorials-seen set already do.
//
// This used to be `BOOSTER_CHARGES_TEMP` in `sand-rules.ts`, a flat
// `Infinity` for both boosters with a comment reading: "the day this becomes
// finite (spent from a currency or a level grant), each booster gets its own
// real number here". This module is that day. `sand-rules.ts`'s
// `getBoosterCharges` now delegates to `getBoosterCount` below so
// `SandCannonEngine.ts` and the existing tests do not have to change their
// import.

import { getEconomyConfigOverride, subscribeEconomyConfig } from "./economy-config.ts";
import type { BoosterType } from "./sand-types.ts";

const WALLET_KEY = "sand-cannon:v1:wallet";
const CLEARED_KEY = "sand-cannon:v1:cleared-levels";
const DAILY_KEY = "sand-cannon:v1:daily-login";

// ---- balancing constants ---------------------------------------------------
// See CHANGELOG-prototype.md for the full reasoning behind every number here.
// Nothing below is guessed twice: change one constant and every screen that
// reads through the functions in this file (HUD, Shop, the result card, the
// daily-login modal) moves with it.
//
// Every constant in this section is a FALLBACK — the real, current number
// goes through the matching function just below it, which checks
// `public/design/economy.csv` (`economy-config.ts`) first and only falls back to
// the constant for a key the sheet does not have a row for. The constants
// stay exported (rather than folded into the functions) because they are
// still the shipped defaults a fresh checkout runs on with no CSV edits at
// all, and `sand-economy.test.ts` asserts against them directly.

/** CSV keys `economy.csv` uses — one place to change if the sheet's column
 * naming ever needs to move, rather than four string literals scattered
 * through the functions below. */
const CONFIG_KEY = {
  starterGold: "starterGold",
  starterBooster: (type: BoosterType) =>
    type === "radiusOvercharge" ? "starterBoosterRadiusOvercharge" : "starterBoosterPrismShot",
  boosterPrice: (type: BoosterType) =>
    type === "radiusOvercharge" ? "boosterPriceRadiusOvercharge" : "boosterPricePrismShot",
  dailyLoginDay: (dayIndex: number) => `dailyLoginDay${dayIndex + 1}`,
} as const;

/**
 * What a fresh install starts with. Matches the coin badge's old hardcoded
 * `PLACEHOLDER_COINS` value, so a first-time player sees the same number they
 * always did — it is just real and spendable now instead of a prop.
 */
export const STARTER_GOLD = 100;
function starterGold(): number {
  return getEconomyConfigOverride(CONFIG_KEY.starterGold) ?? STARTER_GOLD;
}

/**
 * One free try of each booster before a player has ever earned or spent a
 * coin — the shop should be something they discover by running out, not a
 * wall in front of a mechanic they have never seen work.
 */
export const STARTER_BOOSTER_CHARGES: Record<BoosterType, number> = {
  radiusOvercharge: 1,
  prismShot: 1,
};
function starterBoosterCharges(type: BoosterType): number {
  return getEconomyConfigOverride(CONFIG_KEY.starterBooster(type)) ?? STARTER_BOOSTER_CHARGES[type];
}

/**
 * Gold per charge. Prism Shot costs more than Radius Overcharge because it is
 * strictly the stronger buff: Radius Overcharge doubles the sorting disc
 * (`effectiveSortRadius`), while Prism Shot drops colour-matching entirely
 * (`cellsInRadius`'s `matchColor: false`) and can clear several colours'
 * worth of sand in one shot regardless of what is loaded. A wildcard shot is
 * worth noticeably more than a bigger circle of the same wildcard-less shot.
 */
export const BOOSTER_PRICE: Record<BoosterType, number> = {
  radiusOvercharge: 60,
  prismShot: 100,
};
/** The Shop's actual price for `type` — `BOOSTER_PRICE[type]` unless
 * `economy.csv` overrides it. Exported: `SandGame.tsx`'s Shop panel reads
 * this to render the price it charges, not the raw constant, so an override
 * shows up on the button, not just in what `buyBoosterCharge` deducts. */
export function boosterPrice(type: BoosterType): number {
  return getEconomyConfigOverride(CONFIG_KEY.boosterPrice(type)) ?? BOOSTER_PRICE[type];
}

/**
 * Gold reward for clearing a level, as a function of its `computeLevelDifficulty`
 * (`level-difficulty.ts`) 0–100 score — the same five-factor heuristic the
 * editor's difficulty overview already ranks every level by (§77), so a
 * level does not need a hand-picked reward: it is worth more exactly because
 * it scores as harder. Takes the score rather than the level itself, so this
 * module does not have to import the scorer — the caller (`SandGame.tsx`)
 * already has both the level and a reason to compute its score.
 *
 * `REWARD_BASE` is the floor (the easiest conceivable level still pays out
 * something for finishing it), `REWARD_PER_POINT` is 1:1 with the score, and
 * the result is rounded to the nearest 5 so neighbouring levels do not pay
 * out visibly arbitrary numbers like 47 vs 49.
 *
 * Range: 20 (score 0) to 120 (score 100). See CHANGELOG-prototype.md for the
 * worked-through tiers and the 50-level lifetime estimate.
 */
const REWARD_BASE = 20;
const REWARD_PER_POINT = 1;

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

export function levelGoldReward(difficultyScore: number): number {
  return roundToFive(REWARD_BASE + difficultyScore * REWARD_PER_POINT);
}

/**
 * Daily login, a 7-day cycle that loops rather than escalating forever —
 * escalating within the week rewards coming back the next day, looping caps
 * how much a player can lean on logins alone instead of playing levels.
 * Deliberately smaller than clearing even one easy level most days (20–30
 * gold): this is a bonus for showing up, not the main way to earn — the
 * level roster is. See CHANGELOG-prototype.md for the full reasoning.
 */
export const DAILY_LOGIN_REWARDS: readonly number[] = [10, 15, 20, 25, 30, 40, 80];
/** Day `dayIndex`'s (0-indexed) actual reward — `DAILY_LOGIN_REWARDS[dayIndex]`
 * unless `economy.csv` overrides that one day. The 7-day CYCLE LENGTH itself
 * is not overridable from the sheet — only the amounts — so every existing
 * `% DAILY_LOGIN_REWARDS.length` wraparound stays correct with no change. */
export function dailyLoginReward(dayIndex: number): number {
  return getEconomyConfigOverride(CONFIG_KEY.dailyLoginDay(dayIndex)) ?? DAILY_LOGIN_REWARDS[dayIndex];
}

// ---- wallet -----------------------------------------------------------------

export type Wallet = {
  gold: number;
  boosters: Record<BoosterType, number>;
};

function defaultWallet(): Wallet {
  return {
    gold: starterGold(),
    boosters: {
      radiusOvercharge: starterBoosterCharges("radiusOvercharge"),
      prismShot: starterBoosterCharges("prismShot"),
    },
  };
}

/** A stable reference for `useSyncExternalStore`'s server snapshot — never mutated. */
export const SERVER_WALLET: Wallet = defaultWallet();

let cachedWallet: Wallet | null = null;
const walletListeners = new Set<() => void>();

function notifyWallet() {
  for (const listener of walletListeners) listener();
}

function sanitiseCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

/**
 * True only for a wallet this module itself just synthesised from
 * `defaultWallet()` because there was nothing real to read back (no
 * localStorage entry yet, or storage that would not round-trip) — never for
 * one read back off an actual saved wallet. Cleared the moment any real
 * earning or spending happens. This is what lets `applyStarterOverrideIfFresh`
 * correct a starter-value CSV override that finishes loading a beat after
 * the wallet was first read (`economy-config.ts`'s fetch is asynchronous;
 * the very first render that reads the wallet is not) without ever touching
 * a wallet that has actually done anything.
 */
let walletIsFreshDefault = false;

function readWallet(): Wallet {
  if (cachedWallet) return cachedWallet;
  if (typeof window === "undefined") return defaultWallet();
  try {
    const raw = window.localStorage.getItem(WALLET_KEY);
    if (!raw) {
      cachedWallet = defaultWallet();
      walletIsFreshDefault = true;
      return cachedWallet;
    }
    const parsed = JSON.parse(raw) as Partial<Wallet> | null;
    const boosters = (parsed?.boosters ?? {}) as Partial<Record<BoosterType, number>>;
    cachedWallet = {
      gold: sanitiseCount(parsed?.gold, starterGold()),
      boosters: {
        radiusOvercharge: sanitiseCount(boosters.radiusOvercharge, starterBoosterCharges("radiusOvercharge")),
        prismShot: sanitiseCount(boosters.prismShot, starterBoosterCharges("prismShot")),
      },
    };
  } catch {
    // Private-mode storage, or a value that does not round-trip: start fresh
    // rather than crash the HUD over a corrupt wallet.
    cachedWallet = defaultWallet();
    walletIsFreshDefault = true;
  }
  return cachedWallet;
}

/**
 * Re-synthesises a still-untouched wallet once `economy.csv` finishes
 * loading, so a starter-value override is not silently stuck at the
 * hardcoded default for the rest of the browser profile's life. Subscribed
 * to `economy-config.ts` unconditionally below — safe even server-side,
 * since nothing there ever calls `refresh` outside a browser, so the
 * subscription is just never notified.
 *
 * Guarded by `walletIsFreshDefault` (cleared by every real mutation below),
 * so this can only ever replace a wallet that has never earned or spent a
 * single coin — a real player's balance is never touched by a later CSV
 * edit, on purpose: only what a BRAND NEW install starts with should move.
 */
function applyStarterOverrideIfFresh() {
  if (!walletIsFreshDefault || !cachedWallet) return;
  writeWallet(defaultWallet());
}
subscribeEconomyConfig(applyStarterOverrideIfFresh);

function writeWallet(next: Wallet) {
  cachedWallet = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(WALLET_KEY, JSON.stringify(next));
    } catch {
      // Quota or a private tab that refuses storage: the session keeps the
      // in-memory value, only persistence across reloads is lost.
    }
  }
  notifyWallet();
}

/** `useSyncExternalStore`'s subscribe function — fires on any wallet change. */
export function subscribeWallet(listener: () => void) {
  walletListeners.add(listener);
  return () => walletListeners.delete(listener);
}

export function getWallet(): Wallet {
  return readWallet();
}

export function getGold(): number {
  return readWallet().gold;
}

export function getBoosterCount(type: BoosterType): number {
  return readWallet().boosters[type];
}

export function addGold(amount: number) {
  if (amount <= 0) return;
  const wallet = readWallet();
  walletIsFreshDefault = false;
  writeWallet({ ...wallet, gold: wallet.gold + Math.round(amount) });
}

/** Returns whether the spend went through — false, and nothing changes, if the wallet is short. */
export function spendGold(amount: number): boolean {
  const wallet = readWallet();
  if (wallet.gold < amount) return false;
  walletIsFreshDefault = false;
  writeWallet({ ...wallet, gold: wallet.gold - amount });
  return true;
}

export function addBoosterCharges(type: BoosterType, amount: number) {
  if (amount <= 0) return;
  const wallet = readWallet();
  walletIsFreshDefault = false;
  writeWallet({ ...wallet, boosters: { ...wallet.boosters, [type]: wallet.boosters[type] + amount } });
}

/** Called from `SandCannonEngine.fire()` — spec §7.1's "consumed the instant it leaves the barrel". A no-op once the count is already 0, rather than going negative. */
export function spendBoosterCharge(type: BoosterType) {
  const wallet = readWallet();
  if (wallet.boosters[type] <= 0) return;
  walletIsFreshDefault = false;
  writeWallet({ ...wallet, boosters: { ...wallet.boosters, [type]: wallet.boosters[type] - 1 } });
}

/** The Shop's "Buy" button. Atomic: a short wallet loses no gold if it cannot afford the charge. */
export function buyBoosterCharge(type: BoosterType): boolean {
  if (!spendGold(boosterPrice(type))) return false;
  addBoosterCharges(type, 1);
  return true;
}

/**
 * Same as `buyBoosterCharge`, but for `qty` at once — the Shop's confirm
 * dialog lets a player dial in a quantity (its own stepper, 0-99) before
 * committing. Atomic across the whole batch, same as the single-charge
 * version: either the full `qty × boosterPrice(type)` goes through and all
 * `qty` charges land, or (short wallet) nothing changes at all — never a
 * partial buy that spends some gold for fewer charges than asked. A `qty`
 * of 0 is a no-op that still reports success: nothing was asked for, so
 * nothing failed.
 */
export function buyBoosterCharges(type: BoosterType, qty: number): boolean {
  if (qty <= 0) return true;
  if (!spendGold(boosterPrice(type) * qty)) return false;
  addBoosterCharges(type, qty);
  return true;
}

/**
 * Resets the in-memory wallet (and, in a browser, clears it from storage) —
 * a test-only seam so `sand-economy.test.ts` can start every case from a
 * known state instead of whatever an earlier test in the same process left
 * behind. Never called from game code.
 */
export function __resetWalletForTests(overrides?: Partial<Wallet>) {
  const base = defaultWallet();
  cachedWallet = {
    gold: overrides?.gold ?? base.gold,
    boosters: { ...base.boosters, ...(overrides?.boosters ?? {}) },
  };
  // A test's own known-state wallet, not "nothing was here yet" — must never
  // be silently replaced by `applyStarterOverrideIfFresh`.
  walletIsFreshDefault = false;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(WALLET_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }
}

// ---- first-clear tracking ---------------------------------------------------
// A level pays its gold reward exactly once, on the first time it is ever
// won on this browser — see CHANGELOG-prototype.md for why replays pay
// nothing: full pay on every replay would make one easy level an infinite
// tap for gold, and the whole point of scoring the reward off difficulty is
// that the number means something. Mirrors `TUTORIALS_SEEN_KEY` in
// `SandGame.tsx` — same shape of question ("has id X already happened on
// this browser?"), same small-Set-as-JSON-array storage.

function loadClearedLevels(): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(CLEARED_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : []);
  } catch {
    return new Set();
  }
}

export function hasClearedLevel(id: number): boolean {
  return loadClearedLevels().has(id);
}

/** Marks the level cleared and returns whether this was the FIRST time — the caller's cue to pay out `levelGoldReward`. */
export function markLevelCleared(id: number): boolean {
  const cleared = loadClearedLevels();
  if (cleared.has(id)) return false;
  cleared.add(id);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CLEARED_KEY, JSON.stringify([...cleared]));
    } catch {
      // Private mode / quota: the level will be treated as unseen again next
      // time, which just means it pays out again — a mild overpay, not a bug
      // a player can lean on since they cannot force storage to fail.
    }
  }
  return true;
}

export function __resetClearedLevelsForTests() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CLEARED_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

// ---- daily login --------------------------------------------------------

export type DailyLoginState = {
  /** 0-indexed position in `DAILY_LOGIN_REWARDS` for TODAY, whether or not it has been claimed yet. */
  day: number;
  /** Today's reward, `DAILY_LOGIN_REWARDS[day]`. */
  reward: number;
  /** Whether today's reward has already been claimed. */
  claimedToday: boolean;
};

export type DailyLoginRecord = {
  /** The streak position of the last claim, 0-indexed into `DAILY_LOGIN_REWARDS`. */
  lastDay: number;
  /** The calendar date (device-local, `YYYY-MM-DD`) of the last claim. */
  lastClaimedOn: string;
};

/** Device-local calendar date as `YYYY-MM-DD`, so the streak follows the
 * player's own clock rather than UTC rolling over at a strange local hour. */
function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Whole calendar days between two `YYYY-MM-DD` keys — DST-safe since both are parsed as local midnight and the 12-hour pad absorbs any hour-length day. */
function daysBetween(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T12:00:00`);
  const to = new Date(`${toKey}T12:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function readDailyRecord(): DailyLoginRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DAILY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DailyLoginRecord> | null;
    if (typeof parsed?.lastClaimedOn !== "string" || typeof parsed.lastDay !== "number") return null;
    return { lastDay: parsed.lastDay, lastClaimedOn: parsed.lastClaimedOn };
  } catch {
    return null;
  }
}

/**
 * The actual streak decision, as a pure function of the last claim and now —
 * split out from `getDailyLoginState` so `sand-economy.test.ts` can drive it
 * with fabricated records/dates directly, without a `window.localStorage` to
 * round-trip through (this file's persistence is untested under `node
 * --test` the same way `level-drafts.ts`'s is — see that file's tests, or
 * the lack of them — but the date/streak arithmetic here is exactly the kind
 * of thing worth proving by itself: gap math, week wraparound, reset-on-miss).
 *
 * A gap of exactly 0 days (already claimed today) reports `claimedToday` and
 * holds the streak at `lastDay`. A gap of 1 day advances the streak by one,
 * wrapping past the end of `DAILY_LOGIN_REWARDS` back to day 0 — a full week
 * kept, not a countdown to zero. Any other gap (2+ days missed, or no record
 * at all) resets to day 0: a broken streak starts over, on purpose — see
 * CHANGELOG-prototype.md.
 */
export function computeDailyLoginState(record: DailyLoginRecord | null, now: Date): DailyLoginState {
  if (!record) return { day: 0, reward: dailyLoginReward(0), claimedToday: false };

  const gap = daysBetween(record.lastClaimedOn, todayKey(now));
  let day: number;
  let claimedToday: boolean;
  if (gap <= 0) {
    day = record.lastDay;
    claimedToday = true;
  } else if (gap === 1) {
    day = (record.lastDay + 1) % DAILY_LOGIN_REWARDS.length;
    claimedToday = false;
  } else {
    day = 0;
    claimedToday = false;
  }
  return { day, reward: dailyLoginReward(day), claimedToday };
}

/** What today's login screen should show, without claiming anything. Thin wrapper over `computeDailyLoginState` — see that function for the actual decision. */
export function getDailyLoginState(now = new Date()): DailyLoginState {
  return computeDailyLoginState(readDailyRecord(), now);
}

/**
 * Claims today's reward and pays it into the wallet. Returns `null` if
 * today's reward is already claimed (nothing is paid twice) — the caller
 * (the daily-login modal) should not have offered a Claim button in that
 * state to begin with, but this is the actual guard.
 */
export function claimDailyLogin(now = new Date()): DailyLoginState | null {
  const state = getDailyLoginState(now);
  if (state.claimedToday) return null;
  const record: DailyLoginRecord = { lastDay: state.day, lastClaimedOn: todayKey(now) };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DAILY_KEY, JSON.stringify(record));
    } catch {
      // Private mode / quota: the gold is still paid below; only the streak
      // bookkeeping is lost, so the worst case is day 0 again tomorrow.
    }
  }
  addGold(state.reward);
  return { ...state, claimedToday: true };
}

export function __resetDailyLoginForTests() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DAILY_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
