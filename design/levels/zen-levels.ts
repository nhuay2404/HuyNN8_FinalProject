import { BUILT_IN_LEVELS, thirdLevel } from "./sand-levels.ts";
import { EDITOR_ZEN_LEVELS } from "./zen-custom-levels.ts";
import type { BoosterType, SandLevelConfig } from "../../app/game/sand-types.ts";

// Zen Mode's built-in seed content — see docs/features/zen-mode.md and
// GDD.md's own Zen Mode section for the feature this feeds. Unlike the main
// 50-level roster, Zen levels have no fail state at all: unlimited shots,
// unlimited booster charges, no gold/reward-track payout on clear
// (`SandGame.tsx`'s WIN handler skips the whole economy grant when
// `playingZen` is true) — replayed for the picture and the sound of sand
// settling, not for progress.

/** The exact same "no limit" mechanism `draftToLevel` (level-drafts.ts) uses
 * for a Zen draft — `Infinity` charges of every booster, all at once. */
const ZEN_UNLIMITED_BOOSTERS: Partial<Record<BoosterType, number>> = {
  radiusOvercharge: Infinity,
  prismShot: Infinity,
  chainSort: Infinity,
};

/**
 * Zen ids start counting from here — comfortably clear of the main list's own
 * id range (50 hand-authored levels plus whatever `EDITOR_LEVELS` has grown
 * to), so a Zen id can never collide with a main-list one. `collectZenPlayables`
 * (`SandGame.tsx`) numbers Zen editor drafts starting right after the last
 * built-in Zen id, the same "count up from the end of the built-ins" scheme
 * `collectPlayables` already uses for the main list.
 */
export const ZEN_ID_BASE = 100_000;

/**
 * Strips every FTUE/tutorial field a reused main-list picture might carry
 * (`tutorial`, `ftueGesture`, `ftueFreezeDemo`/`ftueBoosterDemo`/
 * `ftueChainSortDemo` and their scripted targets, `forcedOpeningQueue`,
 * `hideBoosterHud`, `requiresBooster`) on top of forcing unlimited shots and
 * boosters — a Zen level is meant to feel calm and self-explanatory, not
 * resurface an onboarding overlay written for the main list's own pacing.
 */
function toZenLevel(level: SandLevelConfig, id: number): SandLevelConfig {
  return {
    ...level,
    id,
    // Renamed rather than left as the source main-list level's own name —
    // "Level 3" showing up in the Zen picker would read as the SAME level
    // 3 from the main list (same progression, same limits), which it is
    // not: it is that picture, replayed under entirely different rules.
    name: `${level.name} (Zen)`,
    shotLimit: Infinity,
    forcedBoosterCharges: ZEN_UNLIMITED_BOOSTERS,
    tutorial: undefined,
    ftueGesture: undefined,
    ftueFreezeDemo: undefined,
    ftueFreezeTargets: undefined,
    ftueBoosterDemo: undefined,
    ftueBoosterTargets: undefined,
    ftueChainSortDemo: undefined,
    ftueChainSortTarget: undefined,
    forcedOpeningQueue: undefined,
    hideBoosterHud: undefined,
    requiresBooster: undefined,
  };
}

/**
 * Seed content: a handful of existing main-list pictures, replayed with
 * unlimited shots and boosters, so Zen Mode has something to play the moment
 * it ships rather than an empty list waiting on someone to open the Zen
 * editor (`/editor`, "Zen Mode" toggle) first. Picked for variety — an early
 * simple picture, a lock-and-key level, a wall level — not for difficulty,
 * since Zen Mode has no fail state and "hard" does not mean the same thing
 * here as it does on the main list.
 *
 * `EDITOR_ZEN_LEVELS` (zen-custom-levels.ts) is spread in right after —
 * genuinely hand-authored Zen levels, shipped from `/editor`'s own "Ship all
 * Zen levels" button, into their own file rather than these three seeds'.
 */
export const BUILT_IN_ZEN_LEVELS: SandLevelConfig[] = [
  // `no-onboarding-levels` branch: `thirdLevel` (id 3) is no longer in
  // `BUILT_IN_LEVELS`, so it's imported directly here instead of read off a
  // position in that array. The other two seeds still reference by id
  // (`.find`) rather than by position, since removing ids 1-3 from the front
  // of the roster shifted every other level's array index.
  toZenLevel(thirdLevel, ZEN_ID_BASE + 1),
  toZenLevel(BUILT_IN_LEVELS.find((level) => level.id === 10)!, ZEN_ID_BASE + 2),
  toZenLevel(BUILT_IN_LEVELS.find((level) => level.id === 21)!, ZEN_ID_BASE + 3),
  ...EDITOR_ZEN_LEVELS,
];
