// The player's gold/booster wallet and daily-login streak (`economy.ts`).
//
// Persistence itself (the `window.localStorage` round-trip) is not exercised
// here, the same way `level-drafts.ts`'s never has been under `node --test`
// (there is no `window` in this runner) — the in-memory wallet and the pure
// streak-decision function (`computeDailyLoginState`) are what get proven;
// the actual browser storage is checked by hand on the dev server, same as
// every other localStorage-backed module in this codebase.

import assert from "node:assert/strict";
import test from "node:test";
import {
  addBoosterCharges,
  addGold,
  BOOSTER_PRICE,
  boosterPrice,
  buyBoosterCharge,
  computeDailyLoginState,
  computeRewardTrackState,
  getEmeralds,
  LEVELS_PER_NODE,
  CYCLE_EMERALDS,
  cycleReward,
  NODES_PER_CHEST,
  spendEmeralds,
  dailyLoginReward,
  DAILY_LOGIN_REWARDS,
  getBoosterCount,
  getGold,
  levelGoldReward,
  spendBoosterCharge,
  spendGold,
  STARTER_BOOSTER_CHARGES,
  STARTER_GOLD,
  __resetWalletForTests,
} from "../app/game/economy.ts";
import { seedEconomyConfig } from "../app/game/economy-config.ts";

// ---- levelGoldReward --------------------------------------------------------

test("levelGoldReward scales 1:1 with difficulty score, rounded to the nearest 5", () => {
  assert.equal(levelGoldReward(0), 20);
  assert.equal(levelGoldReward(100), 120);
  // 20 + 47 = 67 -> nearest 5 is 65; 20 + 48 = 68 -> nearest 5 is 70. Two
  // adjacent scores landing on different multiples of 5 is expected, not a
  // bug — the rounding is what keeps the *displayed* number tidy, not a
  // guarantee that neighbours never differ.
  assert.equal(levelGoldReward(47), 65);
  assert.equal(levelGoldReward(48), 70);
});

// ---- wallet: gold -----------------------------------------------------------

test("a fresh wallet starts at STARTER_GOLD with one charge of each booster", () => {
  __resetWalletForTests();
  assert.equal(getGold(), STARTER_GOLD);
  assert.equal(getBoosterCount("radiusOvercharge"), STARTER_BOOSTER_CHARGES.radiusOvercharge);
  assert.equal(getBoosterCount("prismShot"), STARTER_BOOSTER_CHARGES.prismShot);
});

test("addGold adds, spendGold refuses a short wallet and changes nothing", () => {
  __resetWalletForTests({ gold: 50 });
  addGold(30);
  assert.equal(getGold(), 80);

  assert.equal(spendGold(1000), false);
  assert.equal(getGold(), 80, "a refused spend must not partially deduct");

  assert.equal(spendGold(80), true);
  assert.equal(getGold(), 0);
});

test("addGold ignores a non-positive amount", () => {
  __resetWalletForTests({ gold: 50 });
  addGold(0);
  addGold(-5);
  assert.equal(getGold(), 50);
});

// ---- wallet: boosters --------------------------------------------------------

test("spendBoosterCharge decrements and floors at 0, never negative", () => {
  __resetWalletForTests({ boosters: { radiusOvercharge: 1, prismShot: 0 } });
  spendBoosterCharge("radiusOvercharge");
  assert.equal(getBoosterCount("radiusOvercharge"), 0);
  spendBoosterCharge("radiusOvercharge");
  assert.equal(getBoosterCount("radiusOvercharge"), 0, "spending at 0 must not go negative");

  spendBoosterCharge("prismShot");
  assert.equal(getBoosterCount("prismShot"), 0);
});

test("addBoosterCharges tops up the named booster only", () => {
  __resetWalletForTests({ boosters: { radiusOvercharge: 0, prismShot: 0 } });
  addBoosterCharges("radiusOvercharge", 3);
  assert.equal(getBoosterCount("radiusOvercharge"), 3);
  assert.equal(getBoosterCount("prismShot"), 0);
});

// ---- buyBoosterCharge ---------------------------------------------------------

test("buyBoosterCharge spends gold and adds one charge when affordable", () => {
  __resetWalletForTests({ gold: BOOSTER_PRICE.radiusOvercharge, boosters: { radiusOvercharge: 0, prismShot: 0 } });
  assert.equal(buyBoosterCharge("radiusOvercharge"), true);
  assert.equal(getGold(), 0);
  assert.equal(getBoosterCount("radiusOvercharge"), 1);
});

test("buyBoosterCharge fails without touching gold or inventory when the wallet is short", () => {
  __resetWalletForTests({ gold: BOOSTER_PRICE.prismShot - 1, boosters: { radiusOvercharge: 0, prismShot: 0 } });
  assert.equal(buyBoosterCharge("prismShot"), false);
  assert.equal(getGold(), BOOSTER_PRICE.prismShot - 1, "a failed purchase must not deduct gold");
  assert.equal(getBoosterCount("prismShot"), 0, "a failed purchase must not grant a charge");
});

test("Prism Shot never costs less than Radius Overcharge — it is at least as strong a buff (colour-agnostic vs. a bigger circle)", () => {
  assert.ok(BOOSTER_PRICE.prismShot >= BOOSTER_PRICE.radiusOvercharge);
});

// ---- daily login: computeDailyLoginState -------------------------------------

test("no record yet: day 0, unclaimed", () => {
  const state = computeDailyLoginState(null, new Date("2026-08-29T09:00:00"));
  assert.deepEqual(state, { day: 0, reward: DAILY_LOGIN_REWARDS[0], claimedToday: false });
});

test("claimed earlier today: same day, reported as already claimed", () => {
  const now = new Date("2026-08-29T21:00:00");
  const state = computeDailyLoginState({ lastDay: 2, lastClaimedOn: "2026-08-29" }, now);
  assert.deepEqual(state, { day: 2, reward: DAILY_LOGIN_REWARDS[2], claimedToday: true });
});

test("claimed exactly yesterday: streak advances by one day", () => {
  const now = new Date("2026-08-29T09:00:00");
  const state = computeDailyLoginState({ lastDay: 2, lastClaimedOn: "2026-08-28" }, now);
  assert.deepEqual(state, { day: 3, reward: DAILY_LOGIN_REWARDS[3], claimedToday: false });
});

test("streak wraps from day 7 (index 6) back to day 1 (index 0), not past the array", () => {
  const now = new Date("2026-08-29T09:00:00");
  const state = computeDailyLoginState({ lastDay: DAILY_LOGIN_REWARDS.length - 1, lastClaimedOn: "2026-08-28" }, now);
  assert.equal(state.day, 0);
  assert.equal(state.reward, DAILY_LOGIN_REWARDS[0]);
});

test("a gap of 2+ days resets the streak to day 0, even from a high streak", () => {
  const now = new Date("2026-08-29T09:00:00");
  const state = computeDailyLoginState({ lastDay: 5, lastClaimedOn: "2026-08-26" }, now);
  assert.equal(state.day, 0);
  assert.equal(state.claimedToday, false);
});

test("DAILY_LOGIN_REWARDS is a 7-day cycle, non-decreasing, and stays well under a typical level's reward", () => {
  assert.equal(DAILY_LOGIN_REWARDS.length, 7);
  for (let i = 1; i < DAILY_LOGIN_REWARDS.length; i += 1) {
    assert.ok(DAILY_LOGIN_REWARDS[i] >= DAILY_LOGIN_REWARDS[i - 1], "each day should pay at least as much as the last");
  }
  const weeklyTotal = DAILY_LOGIN_REWARDS.reduce((sum, value) => sum + value, 0);
  assert.ok(weeklyTotal / 7 < levelGoldReward(50), "the average daily bonus should stay a supplement, not outpace a mid-difficulty level");
});

// ---- economy.csv overrides (economy-config.ts) -------------------------------
// `seedEconomyConfig` sets the module-level cache directly, the same
// browser-free seam `economy-config.test.ts` uses for its parser and
// `work/standalone-entry.tsx` uses for real — see that module's own header.

test("boosterPrice/dailyLoginReward fall back to the hardcoded constants with no sheet loaded", () => {
  seedEconomyConfig([]);
  assert.equal(boosterPrice("radiusOvercharge"), BOOSTER_PRICE.radiusOvercharge);
  assert.equal(boosterPrice("prismShot"), BOOSTER_PRICE.prismShot);
  assert.equal(dailyLoginReward(0), DAILY_LOGIN_REWARDS[0]);
  assert.equal(dailyLoginReward(6), DAILY_LOGIN_REWARDS[6]);
});

test("a economy.csv row overrides just the one booster price it names", () => {
  seedEconomyConfig([{ key: "boosterPriceRadiusOvercharge", value: 999 }]);
  assert.equal(boosterPrice("radiusOvercharge"), 999);
  assert.equal(boosterPrice("prismShot"), BOOSTER_PRICE.prismShot, "an unrelated key must not move");
  seedEconomyConfig([]);
});

test("a sheet row overrides one daily-login day without disturbing the rest of the week", () => {
  seedEconomyConfig([{ key: "dailyLoginDay3", value: 500 }]);
  assert.equal(dailyLoginReward(2), 500, "dailyLoginDay3 is index 2 (0-indexed)");
  assert.equal(dailyLoginReward(0), DAILY_LOGIN_REWARDS[0]);
  assert.equal(dailyLoginReward(6), DAILY_LOGIN_REWARDS[6]);
  seedEconomyConfig([]);
});

test("computeDailyLoginState's reward field reflects a sheet override too, not just dailyLoginReward directly", () => {
  seedEconomyConfig([{ key: "dailyLoginDay1", value: 777 }]);
  const state = computeDailyLoginState(null, new Date("2026-08-29T09:00:00"));
  assert.equal(state.day, 0);
  assert.equal(state.reward, 777);
  seedEconomyConfig([]);
});

test("a sheet override for starterGold/starterBoosterCharges reaches a brand new wallet", () => {
  seedEconomyConfig([
    { key: "starterGold", value: 250 },
    { key: "starterBoosterRadiusOvercharge", value: 3 },
  ]);
  __resetWalletForTests();
  assert.equal(getGold(), 250);
  assert.equal(getBoosterCount("radiusOvercharge"), 3);
  assert.equal(getBoosterCount("prismShot"), STARTER_BOOSTER_CHARGES.prismShot, "the unlisted booster keeps its hardcoded starter count");
  seedEconomyConfig([]);
});

// ---- reward track ----------------------------------------------------------
// Same split as the daily-login block above: the stored record is a browser
// concern this runner has no `window` for, so what gets proven here is the
// pure decision function (`computeRewardTrackState`) plus the reward ramp and
// the emerald spend, which are all real logic rather than storage.

test("a fresh track shows an empty bar of five nodes, worth the first cycle", () => {
  const state = computeRewardTrackState({ levelsPlayed: 0, claimedCycles: 0 });
  assert.equal(state.nodes.length, NODES_PER_CHEST);
  assert.equal(state.filled, 0);
  assert.equal(state.progress, 0);
  assert.equal(state.canClaim, false);
  assert.equal(state.cycle, 0);
  assert.equal(state.chestReward, CYCLE_EMERALDS[0]);
});

test("one level won fills exactly one node", () => {
  for (let won = 0; won <= NODES_PER_CHEST; won += 1) {
    const state = computeRewardTrackState({ levelsPlayed: won, claimedCycles: 0 });
    assert.equal(state.filled, won, `${won} levels should fill ${won} nodes`);
    assert.equal(state.nodes.filter((node) => node.filled).length, won);
    assert.equal(state.progress, won / NODES_PER_CHEST);
  }
});

test("the chest opens on the fifth level, not before", () => {
  assert.equal(computeRewardTrackState({ levelsPlayed: 4, claimedCycles: 0 }).canClaim, false);
  const full = computeRewardTrackState({ levelsPlayed: 5, claimedCycles: 0 });
  assert.equal(full.canClaim, true);
  assert.equal(full.progress, 1);
});

test("levels won while a full chest waits to be opened are held, not lost", () => {
  // Two levels past a complete bar: the bar itself cannot show more than five
  // nodes, but nothing is thrown away — those two land on the next cycle the
  // moment this chest is opened.
  const waiting = computeRewardTrackState({ levelsPlayed: 7, claimedCycles: 0 });
  assert.equal(waiting.filled, NODES_PER_CHEST, "the bar is capped at a full chest");
  assert.equal(waiting.canClaim, true);
  const afterClaim = computeRewardTrackState({ levelsPlayed: 7, claimedCycles: 1 });
  assert.equal(afterClaim.filled, 2, "the two carried over start the next cycle");
  assert.equal(afterClaim.canClaim, false);
});

test("the next chest is worth more than the one before it — the track never loops", () => {
  const first = computeRewardTrackState({ levelsPlayed: 5, claimedCycles: 0 });
  assert.equal(first.chestReward, 500, "the first cycle is the Rune Cannon's price");
  let previous = first.chestReward;
  for (let cycle = 1; cycle < 12; cycle += 1) {
    const reward = computeRewardTrackState({ levelsPlayed: (cycle + 1) * 5, claimedCycles: cycle }).chestReward;
    assert.ok(reward > previous, `cycle ${cycle + 1} (${reward}) should pay more than ${previous}`);
    previous = reward;
  }
});

test("a sheet edit moves a cycle's reward", () => {
  seedEconomyConfig([{ key: "rewardTrackCycle1", value: 900 }]);
  assert.equal(cycleReward(0), 900);
  assert.equal(cycleReward(1), CYCLE_EMERALDS[1], "an unlisted cycle keeps its hardcoded value");
  seedEconomyConfig([]);
});

test("a fresh wallet holds no emerald, and cannot buy a skin it has not earned", () => {
  __resetWalletForTests();
  assert.equal(getEmeralds(), 0);
  assert.equal(spendEmeralds(500), false, "a short wallet refuses the spend");
  assert.equal(getEmeralds(), 0, "and loses nothing trying");
});

test("emerald spends atomically, like gold", () => {
  __resetWalletForTests({ emeralds: 500 });
  assert.equal(spendEmeralds(500), true);
  assert.equal(getEmeralds(), 0);
  assert.equal(spendEmeralds(1), false);
  assert.equal(getEmeralds(), 0);
});
