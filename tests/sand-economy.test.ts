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
  getDailyLoginCalendar,
  getEmeralds,
  LEVELS_PER_NODE,
  LEVEL_MILESTONE_LEVELS,
  LEVEL_MILESTONE_BONUS,
  levelMilestoneBonus,
  CYCLE_EMERALDS,
  cycleReward,
  NODES_PER_CHEST,
  spendEmeralds,
  dailyLoginReward,
  DAILY_LOGIN_REWARDS,
  DAILY_LOGIN_BOOSTER_PERK,
  getBoosterCount,
  getGold,
  levelGoldReward,
  spendBoosterCharge,
  spendGold,
  STARTER_BOOSTER_CHARGES,
  STARTER_GOLD,
  __resetWalletForTests,
  computeHeartsState,
  MAX_HEARTS,
  HEARTS_UNLOCK_LEVEL_ID,
} from "../app/game/economy.ts";
import { seedEconomyConfig } from "../app/game/economy-config.ts";

// ---- levelGoldReward --------------------------------------------------------
// Tuned so a mid-difficulty level (score 50) pays exactly BOOSTER_PRICE / 5 —
// 5 first-clears roughly buys one Radius Overcharge/Prism Shot charge.

test("levelGoldReward scales with difficulty score, rounded to the nearest 5", () => {
  assert.equal(levelGoldReward(0), 5);
  assert.equal(levelGoldReward(100), 35);
  assert.equal(levelGoldReward(50), 20, "a mid-difficulty level pays exactly BOOSTER_PRICE.radiusOvercharge / 5");
  assert.equal(levelGoldReward(50), BOOSTER_PRICE.radiusOvercharge / 5);
  // 5 + 0.3*58 = 22.4 -> nearest 5 is 20; 5 + 0.3*59 = 22.7 -> nearest 5 is
  // 25. Two adjacent scores landing on different multiples of 5 is expected,
  // not a bug — the rounding is what keeps the *displayed* number tidy, not
  // a guarantee that neighbours never differ.
  assert.equal(levelGoldReward(58), 20);
  assert.equal(levelGoldReward(59), 25);
});

// ---- level milestone bonus ---------------------------------------------------

test("levelMilestoneBonus pays only the decade levels, growing each time", () => {
  assert.equal(levelMilestoneBonus(1), 0);
  assert.equal(levelMilestoneBonus(15), 0);
  assert.equal(LEVEL_MILESTONE_LEVELS.length, 5);
  assert.deepEqual([...LEVEL_MILESTONE_LEVELS], [10, 20, 30, 40, 50]);
  for (let i = 0; i < LEVEL_MILESTONE_LEVELS.length; i += 1) {
    assert.equal(levelMilestoneBonus(LEVEL_MILESTONE_LEVELS[i]), LEVEL_MILESTONE_BONUS[i]);
    if (i > 0) assert.ok(LEVEL_MILESTONE_BONUS[i] > LEVEL_MILESTONE_BONUS[i - 1], "each milestone should pay more than the last");
  }
  // Every milestone bonus should land roughly between 2/3 of the cheaper
  // boosters' price and 3/4 of the priciest one, per the design ask (a small
  // margin either side since the exact figures are hand-picked, not derived).
  for (const bonus of LEVEL_MILESTONE_BONUS) {
    assert.ok(bonus >= (2 / 3) * BOOSTER_PRICE.radiusOvercharge - 5);
    assert.ok(bonus <= (3 / 4) * BOOSTER_PRICE.chainSort + 5);
  }
});

// ---- wallet: gold -----------------------------------------------------------

test("a fresh wallet starts at STARTER_GOLD with one charge of each booster", () => {
  __resetWalletForTests();
  assert.equal(getGold(), STARTER_GOLD);
  assert.equal(getBoosterCount("radiusOvercharge"), STARTER_BOOSTER_CHARGES.radiusOvercharge);
  assert.equal(getBoosterCount("prismShot"), STARTER_BOOSTER_CHARGES.prismShot);
  assert.equal(getBoosterCount("chainSort"), STARTER_BOOSTER_CHARGES.chainSort);
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
  __resetWalletForTests({ boosters: { radiusOvercharge: 1, prismShot: 0, chainSort: 0 } });
  spendBoosterCharge("radiusOvercharge");
  assert.equal(getBoosterCount("radiusOvercharge"), 0);
  spendBoosterCharge("radiusOvercharge");
  assert.equal(getBoosterCount("radiusOvercharge"), 0, "spending at 0 must not go negative");

  spendBoosterCharge("prismShot");
  assert.equal(getBoosterCount("prismShot"), 0);
});

test("addBoosterCharges tops up the named booster only", () => {
  __resetWalletForTests({ boosters: { radiusOvercharge: 0, prismShot: 0, chainSort: 0 } });
  addBoosterCharges("radiusOvercharge", 3);
  assert.equal(getBoosterCount("radiusOvercharge"), 3);
  assert.equal(getBoosterCount("prismShot"), 0);
});

// ---- buyBoosterCharge ---------------------------------------------------------

test("buyBoosterCharge spends gold and adds one charge when affordable", () => {
  __resetWalletForTests({ gold: BOOSTER_PRICE.radiusOvercharge, boosters: { radiusOvercharge: 0, prismShot: 0, chainSort: 0 } });
  assert.equal(buyBoosterCharge("radiusOvercharge"), true);
  assert.equal(getGold(), 0);
  assert.equal(getBoosterCount("radiusOvercharge"), 1);
});

test("buyBoosterCharge fails without touching gold or inventory when the wallet is short", () => {
  __resetWalletForTests({ gold: BOOSTER_PRICE.prismShot - 1, boosters: { radiusOvercharge: 0, prismShot: 0, chainSort: 0 } });
  assert.equal(buyBoosterCharge("prismShot"), false);
  assert.equal(getGold(), BOOSTER_PRICE.prismShot - 1, "a failed purchase must not deduct gold");
  assert.equal(getBoosterCount("prismShot"), 0, "a failed purchase must not grant a charge");
});

test("Prism Shot never costs less than Radius Overcharge — it is at least as strong a buff (colour-agnostic vs. a bigger circle)", () => {
  assert.ok(BOOSTER_PRICE.prismShot >= BOOSTER_PRICE.radiusOvercharge);
});

test("Chain Sort costs strictly more than either other booster — no cap on how much one charge can take", () => {
  assert.ok(BOOSTER_PRICE.chainSort > BOOSTER_PRICE.radiusOvercharge);
  assert.ok(BOOSTER_PRICE.chainSort > BOOSTER_PRICE.prismShot);
});

// ---- daily login: computeDailyLoginState -------------------------------------
// Reward now follows the REAL calendar weekday (Monday = 0 .. Sunday = 6),
// not a looping streak position — 2026-08-29 is a real-world Saturday,
// 2026-08-28 a Friday, 2026-08-26 a Wednesday, 2026-08-31 a Monday.

test("no record yet: today's real weekday, unclaimed, no streak", () => {
  const state = computeDailyLoginState(null, new Date("2026-08-29T09:00:00"));
  assert.deepEqual(state, {
    weekday: 5,
    date: "2026-08-29",
    reward: DAILY_LOGIN_REWARDS[5],
    boosterPerk: "prismShot",
    claimedToday: false,
    streak: 0,
  });
});

test("claimed earlier today: reported as already claimed, streak held", () => {
  const now = new Date("2026-08-29T21:00:00");
  const state = computeDailyLoginState({ claimedDates: ["2026-08-29"], lastClaimedOn: "2026-08-29", streak: 3 }, now);
  assert.equal(state.claimedToday, true);
  assert.equal(state.streak, 3);
  assert.equal(state.reward, DAILY_LOGIN_REWARDS[5]);
});

test("claimed exactly yesterday: not claimed today yet, streak still held (bumped only by an actual claim)", () => {
  const now = new Date("2026-08-29T09:00:00");
  const state = computeDailyLoginState({ claimedDates: ["2026-08-28"], lastClaimedOn: "2026-08-28", streak: 2 }, now);
  assert.equal(state.claimedToday, false);
  assert.equal(state.streak, 2);
});

test("a gap of 2+ days resets the streak to 0", () => {
  const now = new Date("2026-08-29T09:00:00");
  const state = computeDailyLoginState({ claimedDates: ["2026-08-26"], lastClaimedOn: "2026-08-26", streak: 5 }, now);
  assert.equal(state.claimedToday, false);
  assert.equal(state.streak, 0);
});

test("weekday reward table: Mon-Fri are plain and rise gently, Sat-Sun pay the most (+perk)", () => {
  assert.equal(DAILY_LOGIN_REWARDS.length, 7);
  for (let i = 1; i < 5; i += 1) {
    assert.ok(DAILY_LOGIN_REWARDS[i] >= DAILY_LOGIN_REWARDS[i - 1], "Mon..Fri should not pay less than the day before");
  }
  assert.ok(DAILY_LOGIN_REWARDS[5] > DAILY_LOGIN_REWARDS[4], "Saturday should pay more than Friday");
  assert.ok(DAILY_LOGIN_REWARDS[6] > DAILY_LOGIN_REWARDS[5], "Sunday should pay more than Saturday");
  assert.deepEqual(Object.keys(DAILY_LOGIN_BOOSTER_PERK).map(Number).sort(), [5, 6], "only the weekend (Sat/Sun) grants a booster perk");
  assert.ok(Object.values(DAILY_LOGIN_BOOSTER_PERK).every((type) => type === "prismShot"), "the weekend perk is Prism Shot on both days");
  const weeklyTotal = DAILY_LOGIN_REWARDS.reduce((sum, value) => sum + value, 0);
  // The week-long average sits in the same ballpark as a mid-difficulty
  // level's one-off reward rather than dwarfing it — a bonus for showing up,
  // paid at most once a day, not a replacement for playing levels (Sunday's
  // own single best day is allowed to run a bit ahead of that, same as the
  // old cycle's own day-7 "hero" reward always did).
  assert.ok(weeklyTotal / 7 <= levelGoldReward(50) * 1.1, "the average daily bonus should stay close to a mid-difficulty level's reward, not dwarf it");
});

test("computeDailyLoginState's boosterPerk is null Mon-Fri, and Prism Shot on the weekend", () => {
  const monday = computeDailyLoginState(null, new Date("2026-08-31T09:00:00"));
  assert.equal(monday.weekday, 0);
  assert.equal(monday.boosterPerk, null);
  const friday = computeDailyLoginState(null, new Date("2026-08-28T09:00:00"));
  assert.equal(friday.weekday, 4);
  assert.equal(friday.boosterPerk, null);
  const saturday = computeDailyLoginState(null, new Date("2026-08-29T09:00:00"));
  assert.equal(saturday.weekday, 5);
  assert.equal(saturday.boosterPerk, "prismShot");
  const sunday = computeDailyLoginState(null, new Date("2026-08-30T09:00:00"));
  assert.equal(sunday.weekday, 6);
  assert.equal(sunday.boosterPerk, "prismShot");
});

// ---- daily login: getDailyLoginCalendar --------------------------------------

test("getDailyLoginCalendar lists exactly the days of the month, in order, no week padding, with exactly one claimable today", () => {
  const cells = getDailyLoginCalendar(new Date("2026-08-15T09:00:00"));
  // August 2026 has 31 days — no leading/trailing days from neighbouring
  // months any more (the grid no longer aligns to real weekday columns, per
  // the "5 ô một hàng, không đánh Mon->Sun" ask), so the flat list is
  // exactly the month's own day count, day 1 first.
  assert.equal(cells.length, 31);
  assert.equal(cells[0].dayOfMonth, 1);
  assert.equal(cells[cells.length - 1].dayOfMonth, 31);
  const todays = cells.filter((cell) => cell.isToday);
  assert.equal(todays.length, 1);
  assert.equal(todays[0].date, "2026-08-15");
  assert.equal(todays[0].dayOfMonth, 15);
  for (const cell of cells) {
    assert.equal(cell.reward, DAILY_LOGIN_REWARDS[cell.weekday]);
    assert.equal(cell.isPast, cell.date < "2026-08-15");
    assert.equal(cell.isFuture, cell.date > "2026-08-15");
  }
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
  // 2026-08-31 is a real-world Monday (weekday 0), which dailyLoginDay1 overrides.
  const state = computeDailyLoginState(null, new Date("2026-08-31T09:00:00"));
  assert.equal(state.weekday, 0);
  assert.equal(state.reward, 777);
  seedEconomyConfig([]);
});

test("a sheet edit moves a level milestone's bonus", () => {
  seedEconomyConfig([{ key: "levelMilestoneBonus10", value: 999 }]);
  assert.equal(levelMilestoneBonus(10), 999);
  assert.equal(levelMilestoneBonus(20), LEVEL_MILESTONE_BONUS[1], "an unlisted milestone keeps its hardcoded value");
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

// ---- hearts -------------------------------------------------------------
// A play-attempt currency locked until level 10, regenerating on a wall
// clock (`HEART_REGEN_MINUTES`) rather than being earned by playing — see
// `computeHeartsState`'s own comment in economy.ts.

test("hearts unlock at level 10, not earlier or later", () => {
  assert.equal(HEARTS_UNLOCK_LEVEL_ID, 10);
});

test("a full tank reports no countdown, whatever regenStartedAt says", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  assert.deepEqual(computeHeartsState({ hearts: MAX_HEARTS, regenStartedAt: null }, now), {
    hearts: MAX_HEARTS,
    msUntilNext: null,
  });
  // A stray `regenStartedAt` left over from a full tank is ignored — `hearts
  // >= MAX_HEARTS` wins regardless.
  assert.deepEqual(computeHeartsState({ hearts: MAX_HEARTS, regenStartedAt: now - 1000 }, now), {
    hearts: MAX_HEARTS,
    msUntilNext: null,
  });
});

test("no time passed: same heart count, full countdown remaining", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  const state = computeHeartsState({ hearts: 2, regenStartedAt: now }, now);
  assert.equal(state.hearts, 2);
  assert.equal(state.msUntilNext, 30 * 60_000);
});

test("exactly one regen interval passed: one more heart, fresh countdown for the next", () => {
  const start = Date.parse("2026-09-11T12:00:00Z");
  const now = start + 30 * 60_000;
  const state = computeHeartsState({ hearts: 2, regenStartedAt: start }, now);
  assert.equal(state.hearts, 3);
  assert.equal(state.msUntilNext, 30 * 60_000);
});

test("partway through an interval: same heart count, countdown ticked down by the elapsed time", () => {
  const start = Date.parse("2026-09-11T12:00:00Z");
  const now = start + 5 * 60_000;
  const state = computeHeartsState({ hearts: 2, regenStartedAt: start }, now);
  assert.equal(state.hearts, 2);
  assert.equal(state.msUntilNext, 25 * 60_000);
});

test("regen caps at MAX_HEARTS even after a very long absence", () => {
  const start = Date.parse("2026-09-11T12:00:00Z");
  const now = start + 100 * 30 * 60_000; // 100 intervals worth
  const state = computeHeartsState({ hearts: 1, regenStartedAt: start }, now);
  assert.equal(state.hearts, MAX_HEARTS);
  assert.equal(state.msUntilNext, null);
});

test("zero hearts still counts down toward the first one back", () => {
  const start = Date.parse("2026-09-11T12:00:00Z");
  const now = start + 10 * 60_000;
  const state = computeHeartsState({ hearts: 0, regenStartedAt: start }, now);
  assert.equal(state.hearts, 0);
  assert.equal(state.msUntilNext, 20 * 60_000);
});
