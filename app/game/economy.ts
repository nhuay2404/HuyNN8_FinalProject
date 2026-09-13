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
const PROGRESS_KEY = "sand-cannon:v1:reward-track";
const HEARTS_KEY = "sand-cannon:v1:hearts";

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
 * naming ever needs to move, rather than a string literal scattered
 * through the functions below. */
const CONFIG_KEY = {
  starterGold: "starterGold",
  starterBooster: (type: BoosterType) =>
    type === "radiusOvercharge"
      ? "starterBoosterRadiusOvercharge"
      : type === "prismShot"
        ? "starterBoosterPrismShot"
        : "starterBoosterChainSort",
  boosterPrice: (type: BoosterType) =>
    type === "radiusOvercharge"
      ? "boosterPriceRadiusOvercharge"
      : type === "prismShot"
        ? "boosterPricePrismShot"
        : "boosterPriceChainSort",
  dailyLoginDay: (dayIndex: number) => `dailyLoginDay${dayIndex + 1}`,
  cycleEmeralds: (cycleIndex: number) => `rewardTrackCycle${cycleIndex + 1}`,
  levelMilestoneBonus: (levelId: number) => `levelMilestoneBonus${levelId}`,
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
/**
 * Blue Emerald — the skin currency. Earned mainly from the home screen's
 * reward track (the progression section at the bottom of this file), never
 * from clearing a level directly — the one thing it buys (a locked cannon
 * skin — `costumePrice` in `costumes.ts`) stays gated on actually playing.
 * A small top-up also rides along in the Shop's real-money bundles now
 * (2026-09d, on request — see `SandGame.tsx`'s Shop screen), alongside gold
 * and hearts; the reward track is still the only FREE source.
 *
 * Starts at 0, unlike gold: the whole point of the track is that the first
 * 500 arrives as a reward the player watched themselves fill, so a fresh
 * install must not already be holding enough to skip it.
 */
export const STARTER_EMERALDS = 0;

export const STARTER_BOOSTER_CHARGES: Record<BoosterType, number> = {
  radiusOvercharge: 1,
  prismShot: 1,
  chainSort: 1,
};
function starterBoosterCharges(type: BoosterType): number {
  return getEconomyConfigOverride(CONFIG_KEY.starterBooster(type)) ?? STARTER_BOOSTER_CHARGES[type];
}

/**
 * Gold per charge. Radius Overcharge and Prism Shot cost the same (see
 * changelog #162 — they used to differ, deliberately levelled). Chain Sort
 * costs more than either: it does not just widen or colour-blind one shot's
 * own disc, it can clear an entire connected mass regardless of size —
 * `cellsByFloodFill` (sand-rules.ts) has no upper bound on how much one
 * charge takes the way a disc, however large, always does.
 */
export const BOOSTER_PRICE: Record<BoosterType, number> = {
  radiusOvercharge: 100,
  prismShot: 100,
  chainSort: 150,
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
 * Tuned so playing roughly 5 levels (first clears) buys one Radius
 * Overcharge/Prism Shot charge (`BOOSTER_PRICE`, 100 gold): a mid-difficulty
 * level (score 50) pays exactly 20 gold, `BOOSTER_PRICE / 5`. `REWARD_BASE`
 * is the floor (the easiest conceivable level still pays out something for
 * finishing it), `REWARD_PER_POINT` is the slope, and the result is rounded
 * to the nearest 5 so neighbouring levels do not pay out visibly arbitrary
 * numbers like 17 vs 19.
 *
 * Range: 5 (score 0) to 35 (score 100), average 20 across the score range.
 * See CHANGELOG-prototype.md for the worked-through tiers and the 50-level
 * lifetime estimate, and GDD.md §10 for the "5 trận / 1 booster" pacing goal
 * this was rebalanced around.
 */
const REWARD_BASE = 5;
const REWARD_PER_POINT = 0.3;

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

export function levelGoldReward(difficultyScore: number): number {
  return roundToFive(REWARD_BASE + difficultyScore * REWARD_PER_POINT);
}

/**
 * A one-time bonus stacked ON TOP of `levelGoldReward` (or its CSV override)
 * for the five "decade" milestone levels — 10, 20, 30, 40, 50 — paid on the
 * same first-clear beat as the level's own reward (`markLevelCleared`,
 * `SandGame.tsx`'s WIN handler). Growing across the five milestones and
 * landing between 2/3 and 3/4 of a booster's price (`BOOSTER_PRICE`), so
 * each decade reads as "almost enough for a booster all by itself" rather
 * than a token bump — see GDD.md §10.4.
 *
 * Any level id not in `LEVEL_MILESTONE_LEVELS` gets 0 — `levelMilestoneBonus`
 * below is safe to call unconditionally for every level, not just milestones.
 */
export const LEVEL_MILESTONE_LEVELS: readonly number[] = [10, 20, 30, 40, 50];
/** `LEVEL_MILESTONE_LEVELS[i]`'s bonus — 65 (≈2/3 of 100) up to 115 (≈3/4 of
 * 150), increasing with each decade. */
export const LEVEL_MILESTONE_BONUS: readonly number[] = [65, 75, 90, 100, 115];

/** `LEVEL_MILESTONE_BONUS[index]` unless `economy.csv` overrides that
 * milestone's `levelMilestoneBonus<levelId>` row. `undefined` for a level id
 * that is not a milestone at all — callers use `levelMilestoneBonus` below,
 * which folds that case to 0. */
function milestoneBonusAt(index: number): number {
  return getEconomyConfigOverride(CONFIG_KEY.levelMilestoneBonus(LEVEL_MILESTONE_LEVELS[index])) ?? LEVEL_MILESTONE_BONUS[index];
}

/** The milestone bonus for level `levelId` — 0 for every non-milestone level. */
export function levelMilestoneBonus(levelId: number): number {
  const index = LEVEL_MILESTONE_LEVELS.indexOf(levelId);
  return index === -1 ? 0 : milestoneBonusAt(index);
}

/**
 * Daily login, keyed by the REAL calendar weekday now (index 0 = Monday ...
 * 6 = Sunday — `weekdayIndex` below), not by a streak position that used to
 * loop every 7 claims regardless of what day it actually was. Monday through
 * Friday all pay the same flat 10 gold — a fraction of what ONE
 * mid-difficulty level's own first-clear reward pays (`levelGoldReward`'s
 * score-50 case, 20 gold — see that function's own doc comment), so logging
 * in reads as a modest top-up, not a replacement for playing levels. Saturday
 * and Sunday (the weekend) pay NO gold at all: they are the only days
 * `dailyLoginBoosterPerk` hands out a free booster charge instead, and that
 * charge is the entire weekend reward — see CHANGELOG-prototype.md for the
 * full reasoning and GDD.md §10.6 for the weekday table.
 */
export const DAILY_LOGIN_REWARDS: readonly number[] = [10, 10, 10, 10, 10, 0, 0];
/** `DAILY_LOGIN_REWARDS[weekday]` unless `economy.csv` overrides that
 * weekday's `dailyLoginDay<N>` row (`N` = weekday + 1, Monday = day 1). */
export function dailyLoginReward(weekday: number): number {
  return getEconomyConfigOverride(CONFIG_KEY.dailyLoginDay(weekday)) ?? DAILY_LOGIN_REWARDS[weekday];
}

/** Saturday(5) grants Radius Overcharge, Sunday(6) grants Prism Shot — the
 * weekend's own two charges take turns between the two entry-level boosters
 * rather than both days handing out the same one. */
export const WEEKEND_BOOSTER_PERK: Partial<Record<number, BoosterType>> = {
  5: "radiusOvercharge",
  6: "prismShot",
};

/** The calendar's one monthly "lucky day": the 13th of every month grants a
 * free Chain Sort charge — the priciest, strongest booster — regardless of
 * what weekday it happens to land on that month, overriding the weekend's
 * own radius/prism split above on a month where the 13th is a Sat/Sun. */
export const CHAIN_SORT_BONUS_DAY_OF_MONTH = 13;

/** What claiming `date` (a device-local calendar day, `dayOfMonth` 1-31)
 * grants on top of `dailyLoginReward` — `null` on a plain weekday. The 13th
 * of the month wins over the weekend split (`CHAIN_SORT_BONUS_DAY_OF_MONTH`
 * is checked first), everywhere else it is just Saturday/Sunday's own
 * `WEEKEND_BOOSTER_PERK`. */
export function dailyLoginBoosterPerk(dayOfMonth: number, weekday: number): BoosterType | null {
  if (dayOfMonth === CHAIN_SORT_BONUS_DAY_OF_MONTH) return "chainSort";
  return WEEKEND_BOOSTER_PERK[weekday] ?? null;
}

// ---- wallet -----------------------------------------------------------------

export type Wallet = {
  gold: number;
  /** Blue Emerald — see `STARTER_EMERALDS`. Skins only. */
  emeralds: number;
  boosters: Record<BoosterType, number>;
};

function defaultWallet(): Wallet {
  return {
    gold: starterGold(),
    emeralds: STARTER_EMERALDS,
    boosters: {
      radiusOvercharge: starterBoosterCharges("radiusOvercharge"),
      prismShot: starterBoosterCharges("prismShot"),
      chainSort: starterBoosterCharges("chainSort"),
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
      emeralds: sanitiseCount(parsed?.emeralds, STARTER_EMERALDS),
      boosters: {
        radiusOvercharge: sanitiseCount(boosters.radiusOvercharge, starterBoosterCharges("radiusOvercharge")),
        prismShot: sanitiseCount(boosters.prismShot, starterBoosterCharges("prismShot")),
        chainSort: sanitiseCount(boosters.chainSort, starterBoosterCharges("chainSort")),
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

export function getEmeralds(): number {
  return readWallet().emeralds;
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

export function addEmeralds(amount: number) {
  if (amount <= 0) return;
  const wallet = readWallet();
  walletIsFreshDefault = false;
  writeWallet({ ...wallet, emeralds: wallet.emeralds + Math.round(amount) });
}

/** Same contract as `spendGold`: atomic, and false (with nothing deducted)
 * when the wallet cannot cover `amount`. The skin shop's only spend. */
export function spendEmeralds(amount: number): boolean {
  const wallet = readWallet();
  if (wallet.emeralds < amount) return false;
  walletIsFreshDefault = false;
  writeWallet({ ...wallet, emeralds: wallet.emeralds - amount });
  return true;
}

/** Returns whether the spend went through — false, and nothing changes, if the wallet is short. */
export function spendGold(amount: number): boolean {
  const wallet = readWallet();
  if (wallet.gold < amount) return false;
  walletIsFreshDefault = false;
  writeWallet({ ...wallet, gold: wallet.gold - amount });
  return true;
}

/** Dev-only: drops gold straight to 0 — the Settings screen's GameDevOption
 * "reset gold" button, for putting the wallet in a known state while testing
 * the Shop rather than spending it down shot by shot. */
export function resetGold() {
  const wallet = readWallet();
  walletIsFreshDefault = false;
  writeWallet({ ...wallet, gold: 0 });
}

/** Dev-only: puts the WHOLE wallet — gold, emeralds, every booster
 * charge — back to its starter defaults, not just gold. Broader than
 * `resetGold` above (which only zeroes gold for testing the Shop on its
 * own); this is the "reset entire game" button's own piece of a full
 * factory reset. */
export function resetWallet() {
  walletIsFreshDefault = false;
  writeWallet(defaultWallet());
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
    emeralds: overrides?.emeralds ?? base.emeralds,
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

/** Dev-only: forgets every level's first-clear, so the gold-payout flow can
 * be replayed from scratch — the "reset entire game" button's own piece of a
 * full factory reset. Same effect as `__resetClearedLevelsForTests` above,
 * kept as a separate, non-test-prefixed entry point since that one is a test
 * seam ("never called from game code") and this one is meant to be. */
export function resetClearedLevels() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CLEARED_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

// ---- daily login --------------------------------------------------------
// Tied to the REAL calendar now, not a streak position that looped every 7
// claims regardless of what day it actually was: a level's reward depends on
// today's actual weekday (Mon..Sun), and the modal renders the current MONTH
// as a real grid (see `getDailyLoginCalendar`) so "tomorrow" always visibly
// matches tomorrow's real date. `claimedDates` (rather than a single streak
// counter) is what lets that grid put an actual checkmark on every day this
// browser really claimed, not just "before today".

export type DailyLoginState = {
  /** Today's real weekday, 0 = Monday .. 6 = Sunday. */
  weekday: number;
  /** Today's calendar date (device-local), `YYYY-MM-DD`. */
  date: string;
  /** Today's reward, `DAILY_LOGIN_REWARDS[weekday]`. */
  reward: number;
  /** The free booster charge today grants — instead of gold on a weekend day, or on top of gold on the month's 13th — see `dailyLoginBoosterPerk`. */
  boosterPerk: BoosterType | null;
  /** Whether today's reward has already been claimed. */
  claimedToday: boolean;
  /** Consecutive calendar days claimed, counting today once claimed. 0 if today is not claimed and yesterday was not either. */
  streak: number;
};

export type DailyLoginRecord = {
  /** Every date (device-local `YYYY-MM-DD`) actually claimed, pruned to the trailing `CLAIMED_DATES_RETENTION_DAYS` — enough to paint the visible calendar's checkmarks without the array growing forever. */
  claimedDates: string[];
  /** The calendar date (device-local, `YYYY-MM-DD`) of the last claim. */
  lastClaimedOn: string;
  /** Consecutive calendar days claimed as of `lastClaimedOn`. */
  streak: number;
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

/** Real weekday for `date`, Monday = 0 .. Sunday = 6 — `Date#getDay()`
 * (Sunday = 0) rotated so the week (and `DAILY_LOGIN_REWARDS`) reads left to
 * right the way a Vietnamese calendar does, Monday first. */
function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

const CLAIMED_DATES_RETENTION_DAYS = 60;

/** Keeps `dates` de-duplicated, sorted, and trimmed to the trailing
 * `CLAIMED_DATES_RETENTION_DAYS` relative to `now` — the calendar only ever
 * renders one month at a time, so nothing older is ever drawn again. */
function pruneClaimedDates(dates: readonly string[], now: Date): string[] {
  const cutoff = todayKey(new Date(now.getTime() - CLAIMED_DATES_RETENTION_DAYS * 86_400_000));
  return Array.from(new Set(dates)).filter((date) => date >= cutoff).sort();
}

function readDailyRecord(): DailyLoginRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DAILY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DailyLoginRecord> | null;
    if (typeof parsed?.lastClaimedOn !== "string" || !Array.isArray(parsed.claimedDates)) return null;
    const claimedDates = parsed.claimedDates.filter((date): date is string => typeof date === "string");
    return {
      claimedDates,
      lastClaimedOn: parsed.lastClaimedOn,
      streak: typeof parsed.streak === "number" && Number.isFinite(parsed.streak) ? Math.max(0, Math.floor(parsed.streak)) : 1,
    };
  } catch {
    return null;
  }
}

/**
 * The actual claim/streak decision, as a pure function of the last record and
 * now — split out from `getDailyLoginState` so `sand-economy.test.ts` can
 * drive it with fabricated records/dates directly, without a
 * `window.localStorage` to round-trip through.
 *
 * `weekday`/`reward`/`boosterPerk` are entirely determined by the real
 * calendar date, independent of `record` — the whole point of the rework is
 * that today's reward is today's reward, streak or no streak. `record` only
 * decides `claimedToday` (a date exactly matching one already in
 * `claimedDates`) and `streak` (held over from the last claim if the gap to
 * today is 0 or 1 day, reset to 0 by any bigger gap — a broken streak starts
 * over, same as before the rework).
 */
export function computeDailyLoginState(record: DailyLoginRecord | null, now: Date): DailyLoginState {
  const date = todayKey(now);
  const weekday = weekdayIndex(now);
  const reward = dailyLoginReward(weekday);
  const boosterPerk = dailyLoginBoosterPerk(now.getDate(), weekday);
  const claimedToday = record?.claimedDates.includes(date) ?? false;
  let streak = 0;
  if (record) {
    if (claimedToday) {
      streak = record.streak;
    } else {
      const gap = daysBetween(record.lastClaimedOn, date);
      streak = gap <= 1 ? record.streak : 0;
    }
  }
  return { weekday, date, reward, boosterPerk, claimedToday, streak };
}

/** What today's login screen should show, without claiming anything. Thin wrapper over `computeDailyLoginState` — see that function for the actual decision. */
export function getDailyLoginState(now = new Date()): DailyLoginState {
  return computeDailyLoginState(readDailyRecord(), now);
}

export type DailyLoginCalendarCell = {
  /** The cell's calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Day-of-month, for the cell's own label — the ONLY date label the grid
   * shows now (no weekday header row: "không đánh Mon->Sun, chỉ đánh dấu
   * ngày"). */
  dayOfMonth: number;
  /** Real weekday, 0 = Monday .. 6 = Sunday — same indexing as `DAILY_LOGIN_REWARDS`. Not shown in the UI any more, only used to look up `reward`/`boosterPerk`. */
  weekday: number;
  /** What claiming THIS date pays (or paid/would pay) — `dailyLoginReward(weekday)`. */
  reward: number;
  /** The free booster charge this date grants, if any — see `dailyLoginBoosterPerk`. */
  boosterPerk: BoosterType | null;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
  /** True only if this exact date is in `claimedDates` — never inferred from "before today". */
  isClaimed: boolean;
};

/**
 * Builds `date`'s calendar month as a flat, row-major array of its actual
 * days (1..daysInMonth) — no leading/trailing padding from neighbouring
 * months, since the grid no longer aligns to real weekdays (5 cells a row,
 * not 7 — `SandGame.tsx`'s daily-login modal lays this out with a 5-column
 * CSS grid, wrapping wherever it wraps rather than resetting at each real
 * week boundary).
 */
function buildMonthCells(date: Date, claimedDates: ReadonlySet<string>, todayStr: string): DailyLoginCalendarCell[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: DailyLoginCalendarCell[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const cellDate = new Date(year, month, day);
    const cellKey = todayKey(cellDate);
    const weekday = weekdayIndex(cellDate);
    cells.push({
      date: cellKey,
      dayOfMonth: day,
      weekday,
      reward: dailyLoginReward(weekday),
      boosterPerk: dailyLoginBoosterPerk(day, weekday),
      isToday: cellKey === todayStr,
      isPast: cellKey < todayStr,
      isFuture: cellKey > todayStr,
      isClaimed: claimedDates.has(cellKey),
    });
  }
  return cells;
}

/** The current month as a flat grid of cells, real claim state included —
 * what the daily-login modal actually renders. Pure wrapper the same shape
 * as `getDailyLoginState`: reads storage once, computes, returns. */
export function getDailyLoginCalendar(now = new Date()): DailyLoginCalendarCell[] {
  const record = readDailyRecord();
  return buildMonthCells(now, new Set(record?.claimedDates ?? []), todayKey(now));
}

/**
 * Claims today's reward and pays it into the wallet — gold on a weekday
 * (`state.reward`, a no-op on a weekend where it is 0 — `addGold` already
 * ignores non-positive amounts), plus one free charge of `state.boosterPerk`
 * on a weekend claim. Returns `null` if today's reward is already claimed
 * (nothing is paid twice) — the caller (the daily-login modal) should not
 * have offered a Claim button in that state to begin with, but this is the
 * actual guard.
 */
export function claimDailyLogin(now = new Date()): DailyLoginState | null {
  const previous = readDailyRecord();
  const state = computeDailyLoginState(previous, now);
  if (state.claimedToday) return null;
  const gap = previous ? daysBetween(previous.lastClaimedOn, state.date) : Infinity;
  const streak = previous && gap === 1 ? previous.streak + 1 : 1;
  const record: DailyLoginRecord = {
    claimedDates: pruneClaimedDates([...(previous?.claimedDates ?? []), state.date], now),
    lastClaimedOn: state.date,
    streak,
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DAILY_KEY, JSON.stringify(record));
    } catch {
      // Private mode / quota: the gold/booster is still paid below; only the
      // streak bookkeeping is lost, so the worst case is a reset streak
      // tomorrow.
    }
  }
  addGold(state.reward);
  if (state.boosterPerk) addBoosterCharges(state.boosterPerk, 1);
  return { ...state, claimedToday: true, streak };
}

export function __resetDailyLoginForTests() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DAILY_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** Dev-only: forgets the daily-login streak entirely — the "reset entire
 * game" button's own piece of a full factory reset. Same effect as
 * `__resetDailyLoginForTests` above, kept separate since that one is a test
 * seam and this one is meant to be reachable from the Settings screen. */
export function resetDailyLogin() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DAILY_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

// ---- dev date override (testing daily login) -------------------------------
// The daily-login streak is entirely a function of what day `claimDailyLogin`/
// `getDailyLoginState` are told "today" is — real code always leaves that at
// its default (`new Date()`), but testing a multi-day streak (or the exact
// midnight boundary where a streak breaks) by actually waiting real days is
// not practical. `devNow()` is the one knob for that: a whole-day offset,
// persisted so it survives the reload the Settings screen's date tool
// triggers after changing it (both `getDailyLoginState`'s result and
// `SandGame.tsx`'s own once-per-load `cachedInitialDailyLogin` are read at
// module-load time, so the offset has to already be in storage before that
// read happens, not just in a React state update).
const DEV_DATE_OFFSET_KEY = "sand-cannon:v1:dev-date-offset-days";

/** Whole days the dev date tool has nudged "today" by, positive or negative.
 * `0` (the default a real player's browser always stays at) means no
 * override — `devNow()` is then just `new Date()`. */
export function getDevDateOffsetDays(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(DEV_DATE_OFFSET_KEY);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  } catch {
    return 0;
  }
}

/** Dev-only: sets the offset `devNow()` applies. The Settings screen reloads
 * the page right after calling this — see this section's own header for why
 * a React re-render alone would not be enough. */
export function setDevDateOffsetDays(days: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEV_DATE_OFFSET_KEY, String(Math.trunc(days)));
  } catch {
    // The offset just will not survive a reload.
  }
}

/**
 * "Today", nudged by the dev date tool above. The one thing `SandGame.tsx`
 * passes to `getDailyLoginState`/`claimDailyLogin` instead of letting them
 * default to `new Date()` — so a real player (offset always 0) sees exactly
 * the same behaviour either way, and only a tester who has actually opened
 * the date tool ever gets a nudged "today".
 */
export function devNow(): Date {
  const offsetDays = getDevDateOffsetDays();
  if (!offsetDays) return new Date();
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
}

// ---- reward track (home screen progression bar) -----------------------------
// The home screen's Play button used to sit next to a dead "Modes" chip. That
// chip is now the reward track: a five-node bar that fills as levels are
// played and pays out Blue Emerald — the only source of the currency the
// locked cannon skin costs (`costumePrice` in `costumes.ts`).
//
// One level won fills one node, and the chest opens on the fifth — a five-level
// cycle, not a long haul. The reward belongs to the CYCLE rather than to the
// individual nodes: a node is a step on the way, the chest is the payout, and
// `CYCLE_EMERALDS` says what each successive chest is worth. Nothing here
// resets or loops back to the start: cycle 2 pays more than cycle 1, cycle 6
// more than cycle 5, for as long as the player keeps playing.
//
// "Played" means WON — `recordLevelPlayed` is called from the same WIN
// transition `markLevelCleared` is, but unlike gold it counts REPLAYS too:
// the ask was "cứ hoàn thành 1 level là 1 mốc", and a bar that stalls the
// moment a player runs out of unseen levels would stop being a progression
// bar. Emerald only buys skins, so a replayed level topping up the track
// cannot feed back into gold, boosters, or anything that affects play.

/** Levels won per node of the bar. */
export const LEVELS_PER_NODE = 1;
/** Nodes on the bar — the chest opens when this many are filled. */
export const NODES_PER_CHEST = 5;
/** Levels won per full cycle, i.e. per chest. */
export const LEVELS_PER_CYCLE = LEVELS_PER_NODE * NODES_PER_CHEST;

/**
 * Blue Emerald paid by each successive chest, by its 0-based cycle index. The
 * first five are hand-picked; past that the ramp continues on the formula
 * below — a track with no loop, per the design: cycle 6 is worth more than
 * cycle 5, always.
 *
 * 500 for the first cycle is the anchor the rest is tuned around: it is
 * exactly the Rune Cannon's price (`costumes.ts`), so five levels is what the
 * skin costs and the currency reads as "one cycle" rather than as a number a
 * player has to do arithmetic about.
 */
export const CYCLE_EMERALDS: readonly number[] = [500, 600, 750, 900, 1250];
/** How much each cycle past the hand-picked five grows over the one before it. */
const CYCLE_GROWTH = 1.25;

/**
 * Cycle `index`'s reward. Inside the first five a designer can override any of
 * them from `economy.csv` (`rewardTrackCycle1`..`rewardTrackCycle5`); past that
 * the ramp compounds off the last hand-picked value, rounded to 50 so the
 * chest never shows an arbitrary-looking number like 1953.
 */
export function cycleReward(index: number): number {
  if (index < CYCLE_EMERALDS.length) {
    return getEconomyConfigOverride(CONFIG_KEY.cycleEmeralds(index)) ?? CYCLE_EMERALDS[index];
  }
  const last = CYCLE_EMERALDS[CYCLE_EMERALDS.length - 1];
  const grown = last * Math.pow(CYCLE_GROWTH, index - (CYCLE_EMERALDS.length - 1));
  return Math.round(grown / 50) * 50;
}

export type RewardTrackRecord = {
  /** Levels won on this browser, ever — replays included. */
  levelsPlayed: number;
  /** How many chests have already been opened. Also the index of the cycle
   * currently on the bar, which is what `cycleReward` is keyed on. */
  claimedCycles: number;
};

export type RewardTrackNode = {
  /** Position on the bar, 0-based. */
  slot: number;
  filled: boolean;
};

export type RewardTrackState = {
  levelsPlayed: number;
  /** Which cycle is on the bar right now, 0-based. */
  cycle: number;
  /** The nodes of the bar, in order. */
  nodes: RewardTrackNode[];
  /** How many of them are filled, 0..`NODES_PER_CHEST`. */
  filled: number;
  /** 0..1 across the whole bar, for the fill width. */
  progress: number;
  /** Every node filled — the chest is openable. */
  canClaim: boolean;
  /** What opening this chest pays. */
  chestReward: number;
};

function readRewardTrack(): RewardTrackRecord {
  if (typeof window === "undefined") return { levelsPlayed: 0, claimedCycles: 0 };
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { levelsPlayed: 0, claimedCycles: 0 };
    const parsed = JSON.parse(raw) as Partial<RewardTrackRecord> | null;
    return {
      levelsPlayed: sanitiseCount(parsed?.levelsPlayed, 0),
      claimedCycles: sanitiseCount(parsed?.claimedCycles, 0),
    };
  } catch {
    return { levelsPlayed: 0, claimedCycles: 0 };
  }
}

function writeRewardTrack(next: RewardTrackRecord) {
  // Persist BEFORE invalidating and notifying, not after: the snapshot below
  // is rebuilt by re-reading storage, so a listener woken first would read the
  // record this call is in the middle of replacing and cache the old bar
  // (a claimed chest's pips staying lit until the next reload).
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
    } catch {
      // Private mode / quota: the bar just will not survive a reload — the
      // same trade-off every other persisted thing in this file makes.
    }
  }
  cachedTrackState = null;
  rewardTrackVersion += 1;
  for (const listener of rewardTrackListeners) listener();
  // The bar sits next to the gold badge and re-renders off the same
  // subscription, so a track change has to wake the listeners a wallet change
  // does — there is no second store for the HUD to subscribe to.
  notifyWallet();
}

/**
 * The bar's whole state as a pure function of the stored record — split out
 * the same way `computeDailyLoginState` is, so `sand-economy.test.ts` can
 * drive it with fabricated records instead of a `window.localStorage`.
 *
 * `filled` is clamped at `NODES_PER_CHEST` rather than rolling over into the
 * next cycle on its own: a completed bar sits there waiting to be claimed, and
 * levels won while it waits are not lost (they are all in `levelsPlayed`) —
 * they just land on the NEXT cycle once this chest is opened.
 */
export function computeRewardTrackState(record: RewardTrackRecord): RewardTrackState {
  const earnedNodes = Math.floor(record.levelsPlayed / LEVELS_PER_NODE);
  const filled = Math.max(0, Math.min(NODES_PER_CHEST, earnedNodes - record.claimedCycles * NODES_PER_CHEST));
  const nodes: RewardTrackNode[] = [];
  for (let slot = 0; slot < NODES_PER_CHEST; slot += 1) {
    nodes.push({ slot, filled: slot < filled });
  }
  return {
    levelsPlayed: record.levelsPlayed,
    cycle: record.claimedCycles,
    nodes,
    filled,
    progress: filled / NODES_PER_CHEST,
    canClaim: filled >= NODES_PER_CHEST,
    chestReward: cycleReward(record.claimedCycles),
  };
}

/** What the home screen's bar should show, without claiming anything. Builds
 * a fresh object every call — for a React snapshot use `getRewardTrackSnapshot`
 * below instead, which is the same value held stable between changes. */
export function getRewardTrackState(): RewardTrackState {
  return computeRewardTrackState(readRewardTrack());
}

/**
 * `useSyncExternalStore`'s snapshot for the bar: the same object back on every
 * call until something actually moves the track, so React can compare it by
 * identity. `getRewardTrackState` cannot be used directly for this — a new
 * object every render is a new value every render, which React reads as an
 * endless stream of changes.
 *
 * This is also what keeps the bar out of the hydration mismatch a plain
 * localStorage read during render would cause: paired with `SERVER_REWARD_TRACK`
 * below, the client's hydrating render uses the same empty track the server
 * rendered and only picks up the real one afterwards — the same shape
 * `SERVER_WALLET` already has.
 */
let cachedTrackState: RewardTrackState | null = null;

export function getRewardTrackSnapshot(): RewardTrackState {
  if (!cachedTrackState) cachedTrackState = computeRewardTrackState(readRewardTrack());
  return cachedTrackState;
}

/** A stable reference for the server snapshot — an empty track, never mutated. */
export const SERVER_REWARD_TRACK: RewardTrackState = computeRewardTrackState({
  levelsPlayed: 0,
  claimedCycles: 0,
});

// The track is its own store rather than riding on `subscribeWallet`:
// `getRewardTrackState()` builds a fresh object every call, so it can never be
// a `useSyncExternalStore` snapshot directly. A version counter can, and it is
// the only thing the HUD actually needs to know changed. Claiming ALSO moves
// the wallet, which notifies its own listeners separately — the two stores
// stay independent on purpose, since `recordLevelPlayed` moves the bar without
// touching a coin.
let rewardTrackVersion = 0;
const rewardTrackListeners = new Set<() => void>();

/** `useSyncExternalStore`'s subscribe function for the home screen's bar. */
export function subscribeRewardTrack(listener: () => void) {
  rewardTrackListeners.add(listener);
  return () => rewardTrackListeners.delete(listener);
}

/** A number that changes exactly when the track does — the snapshot to pair
 * with `subscribeRewardTrack`. `0` is a stable server snapshot. */
export function getRewardTrackVersion(): number {
  return rewardTrackVersion;
}

// A cycle amount edited in `economy.csv` changes what the chest on the bar is
// worth without any level being played, so the cached snapshot has to go with
// it — otherwise the label would sit on the old number until the next win.
// Subscribed unconditionally, same as `applyStarterOverrideIfFresh`: on a
// server nothing ever notifies it.
subscribeEconomyConfig(() => {
  cachedTrackState = null;
  rewardTrackVersion += 1;
  for (const listener of rewardTrackListeners) listener();
});

/** Counts one won level toward the bar. Called from the same WIN transition
 * that pays the level's gold — see this section's header for why replays
 * count here but not there. */
export function recordLevelPlayed() {
  const record = readRewardTrack();
  writeRewardTrack({ ...record, levelsPlayed: record.levelsPlayed + 1 });
}

/**
 * Opens the chest: pays this cycle's emerald into the wallet and advances the
 * track to the next cycle. Returns the emerald paid, or `null` when the bar is
 * not actually complete — the caller's button should not have been live in
 * that state, but this is the guard that makes it true.
 */
export function claimRewardTrack(): number | null {
  const record = readRewardTrack();
  const state = computeRewardTrackState(record);
  if (!state.canClaim) return null;
  writeRewardTrack({ ...record, claimedCycles: record.claimedCycles + 1 });
  addEmeralds(state.chestReward);
  return state.chestReward;
}

/**
 * Dev-only: tops the bar up to a full, claimable chest without winning the
 * five levels it would normally take. Rounds `levelsPlayed` UP to the end of
 * the current cycle rather than setting it outright, so the track stays
 * consistent with itself — the next chest after this one still costs a real
 * five levels, and a bar part way along is completed rather than reset.
 */
export function fillRewardTrack() {
  const record = readRewardTrack();
  // `max` so a bar that is already full — with extra levels banked toward the
  // NEXT cycle — is left alone rather than having those levels taken back.
  const full = (record.claimedCycles + 1) * LEVELS_PER_CYCLE;
  writeRewardTrack({ ...record, levelsPlayed: Math.max(record.levelsPlayed, full) });
}

/** Dev-only, alongside the Settings screen's other economy resets — puts the
 * bar back to empty so the chest flow can be tested more than once. */
export function resetRewardTrack() {
  writeRewardTrack({ levelsPlayed: 0, claimedCycles: 0 });
}

export function __resetRewardTrackForTests() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

// ---- hearts (lives) ---------------------------------------------------------
// A play-attempt currency, separate from gold/emeralds: unlike those,
// hearts do not sit in `Wallet` (nothing about them round-trips through
// `addGold`-shaped math) and are not earned by playing — they regenerate on
// a wall clock, the same "real time, not a stat" shape `daily-login`'s date
// arithmetic already has above, just counted in minutes instead of days.
//
// Locked entirely until `HEARTS_UNLOCK_LEVEL_ID` is first cleared
// (`isHeartsUnlocked`) — a brand new player never sees the HUD chip or pays
// a heart to play, the same "discover it by earning it" reasoning
// `STARTER_BOOSTER_CHARGES`'s own comment gives for a free first charge of
// each booster. Before that level, `spendHeart` is never called (every call
// site in `SandGame.tsx` checks `isHeartsUnlocked()` first) and Zen Mode
// never calls it at all — Zen is unlimited play by design (see
// zen-levels.ts), a lives system would contradict the entire point of it.
//
// "Spent" means one PLAY ATTEMPT started — the Home screen's Play button, or
// an explicit Restart (the FAIL card's "Play again", Settings' own Restart)
// — never a WIN card's Continue into the next level (that continues a
// session already paid for) and never the scripted FTUE demo's own
// `restart()` calls (an automated tutorial beat, not a player choosing to
// retry). See each call site's own comment in `SandGame.tsx`.

/** The level id that unlocks the hearts system — before this level is first
 * cleared, hearts do not exist as far as the player is concerned: no HUD
 * chip, no cost to play. */
export const HEARTS_UNLOCK_LEVEL_ID = 10;

/** Full tank. */
export const MAX_HEARTS = 5;

/** How long one missing heart takes to regenerate. */
export const HEART_REGEN_MINUTES = 30;
const HEART_REGEN_MS = HEART_REGEN_MINUTES * 60_000;

/** Whether the hearts system has been unlocked on this browser yet — level
 * `HEARTS_UNLOCK_LEVEL_ID` cleared at least once. */
export function isHeartsUnlocked(): boolean {
  return hasClearedLevel(HEARTS_UNLOCK_LEVEL_ID);
}

export type HeartsState = {
  /** Current hearts, 0..`MAX_HEARTS`. */
  hearts: number;
  /** Milliseconds until the next heart finishes regenerating — `null` once the tank is full (nothing regenerating). */
  msUntilNext: number | null;
};

type HeartsRecord = {
  hearts: number;
  /** When the CURRENT regen cycle started, or `null` if the tank is full
   * (nothing regenerating, so no start time to track). Advanced forward by
   * whole `HEART_REGEN_MS` steps every time this record is read stale — see
   * `computeHeartsState` — rather than left to drift, so the remainder
   * toward the NEXT heart after this read is always measured from a point
   * that is really the start of that specific heart's own countdown. */
  regenStartedAt: number | null;
};

function defaultHeartsRecord(): HeartsRecord {
  return { hearts: MAX_HEARTS, regenStartedAt: null };
}

/**
 * The actual regen math, as a pure function of the stored record and now —
 * same split as `computeDailyLoginState`/`computeRewardTrackState` above, so
 * `sand-economy.test.ts` can drive it with fabricated records/dates instead
 * of a real clock or `window.localStorage`.
 *
 * A full tank (`hearts >= MAX_HEARTS`) always reports `msUntilNext: null` —
 * nothing to regenerate toward. Otherwise, every whole `HEART_REGEN_MS`
 * elapsed since `regenStartedAt` becomes one more heart (capped at
 * `MAX_HEARTS`), and the remainder is what is left of the CURRENT heart's
 * own countdown — not the elapsed time restarted from zero, so reading this
 * twice in a row a second apart reports one second less, not the same
 * number twice.
 */
export function computeHeartsState(record: HeartsRecord, now: number): HeartsState {
  if (record.hearts >= MAX_HEARTS || record.regenStartedAt === null) {
    return { hearts: Math.min(MAX_HEARTS, record.hearts), msUntilNext: null };
  }
  const elapsed = Math.max(0, now - record.regenStartedAt);
  const regenerated = Math.floor(elapsed / HEART_REGEN_MS);
  const hearts = Math.min(MAX_HEARTS, record.hearts + regenerated);
  if (hearts >= MAX_HEARTS) {
    return { hearts: MAX_HEARTS, msUntilNext: null };
  }
  const remainder = elapsed - regenerated * HEART_REGEN_MS;
  return { hearts, msUntilNext: HEART_REGEN_MS - remainder };
}

/** The record `computeHeartsState` would have produced meanwhile, folded
 * back into storage — so a later read (or a spend) starts from "how many
 * hearts are ACTUALLY there right now", not a stale pre-regen count. */
function settleHeartsRecord(record: HeartsRecord, now: number): HeartsRecord {
  const state = computeHeartsState(record, now);
  if (state.msUntilNext === null) return { hearts: state.hearts, regenStartedAt: null };
  return { hearts: state.hearts, regenStartedAt: now - (HEART_REGEN_MS - state.msUntilNext) };
}

function readHeartsRecord(): HeartsRecord {
  if (typeof window === "undefined") return defaultHeartsRecord();
  try {
    const raw = window.localStorage.getItem(HEARTS_KEY);
    if (!raw) return defaultHeartsRecord();
    const parsed = JSON.parse(raw) as Partial<HeartsRecord> | null;
    if (typeof parsed?.hearts !== "number") return defaultHeartsRecord();
    const regenStartedAt = typeof parsed.regenStartedAt === "number" ? parsed.regenStartedAt : null;
    return { hearts: Math.max(0, Math.min(MAX_HEARTS, Math.floor(parsed.hearts))), regenStartedAt };
  } catch {
    return defaultHeartsRecord();
  }
}

function writeHeartsRecord(record: HeartsRecord) {
  cachedHeartsState = null;
  heartsVersion += 1;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(HEARTS_KEY, JSON.stringify(record));
    } catch {
      // Private mode / quota: the session keeps the in-memory value, only
      // persistence across reloads is lost, same trade-off every other
      // persisted store in this file makes.
    }
  }
  for (const listener of heartsListeners) listener();
}

/** What the HUD chip should show right now, without spending anything. */
export function getHeartsState(now = Date.now()): HeartsState {
  return computeHeartsState(readHeartsRecord(), now);
}

/**
 * The Play/Restart entry points' one gate: spends a heart and returns `true`
 * if there was one to spend, or changes nothing and returns `false` if the
 * tank was empty — the caller's cue to block the attempt (toast + the
 * regen countdown) instead of starting it. Settles the record to "how many
 * hearts are really there right now" first, so a spend attempted the instant
 * a heart finishes regenerating sees it.
 */
export function spendHeart(now = Date.now()): boolean {
  const settled = settleHeartsRecord(readHeartsRecord(), now);
  if (settled.hearts <= 0) {
    writeHeartsRecord(settled);
    return false;
  }
  const hearts = settled.hearts - 1;
  // Only START a fresh regen clock if the tank was full the instant before
  // this spend (`regenStartedAt` was `null`) — a tank already missing hearts
  // keeps counting toward the heart already in flight; spending another does
  // not reset that progress.
  const regenStartedAt = settled.regenStartedAt ?? now;
  writeHeartsRecord({ hearts, regenStartedAt });
  return true;
}

/** Dev-only: refills to a full tank, alongside the Settings screen's other economy resets. */
export function resetHearts() {
  writeHeartsRecord(defaultHeartsRecord());
}

export function __resetHeartsForTests() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(HEARTS_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

let cachedHeartsState: HeartsState | null = null;
let heartsVersion = 0;
const heartsListeners = new Set<() => void>();

/** `useSyncExternalStore`'s subscribe function for the HUD chip. */
export function subscribeHearts(listener: () => void) {
  heartsListeners.add(listener);
  return () => heartsListeners.delete(listener);
}

/** A number that changes exactly when hearts are spent or reset — regen
 * ticking by itself does NOT bump this (nothing writes storage just because
 * time passed), so the HUD countdown re-renders off its own 1-second timer
 * in `SandGame.tsx`, not this. This is only for "the STORED record changed"
 * (a spend, a dev reset). */
export function getHeartsVersion(): number {
  return heartsVersion;
}

/** A stable reference for the server snapshot — a full tank, never mutated
 * (matches a fresh install's real starting state, and hearts are locked
 * until level 10 anyway, so no real player's server-rendered pass ever
 * shows anything else). */
export const SERVER_HEARTS: HeartsState = { hearts: MAX_HEARTS, msUntilNext: null };
