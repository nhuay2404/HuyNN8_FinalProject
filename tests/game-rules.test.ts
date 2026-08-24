import assert from "node:assert/strict";
import test from "node:test";
import { level01 } from "../app/game/level-01.ts";
import { applyBatchAutoFill, createGameState, nextBatchAutoFill, parkedBlockCount, planClusterSplit, resolveCluster } from "../app/game/rules.ts";
import { parseLevelSheet } from "../app/game/level-format.ts";
import { LEVELS_SHEET } from "../app/game/levels-sheet.ts";
import type { BlockColor, GameState, LevelConfig } from "../app/game/types.ts";

function hit(state: GameState, color: BlockColor, count: number, shotIndex: number, remainingBlockCount: number) {
  return resolveCluster(level01, state, { color, count, shotIndex, remainingBlockCount });
}

test("level block inventory exactly matches every goal color requirement", () => {
  assert.equal(level01.adjacency.z, true, "same-color blocks touching through depth must share a cluster");
  assert.equal(level01.adjacency.zStatus, "CONFIRMED");
  assert.equal(level01.blocks.length, level01.goals.reduce((total, goal) => total + goal.target, 0));
  for (const color of ["red", "green", "yellow", "blue", "purple", "orange"] as const) {
    const blocks = level01.blocks.filter((block) => block.color === color).length;
    const required = level01.goals.filter((goal) => goal.color === color).reduce((total, goal) => total + goal.target, 0);
    assert.equal(blocks, required, color);
  }
});

test("the sample route consumes exactly the goal-matched block inventory", () => {
  let state = createGameState(level01);
  state = hit(state, "red", 3, 1, 21);
  state = hit(state, "green", 4, 2, 17);
  state = hit(state, "red", 3, 3, 14);
  assert.equal(state.batches.length, 0);
  state = hit(state, "yellow", 4, 4, 10);
  state = hit(state, "blue", 4, 5, 6);
  assert.equal(state.activeGoals[0]?.color, "orange");

  state = hit(state, "purple", 3, 6, 3);
  state = hit(state, "orange", 2, 7, 1);
  state = hit(state, "orange", 1, 8, 0);

  assert.equal(state.result?.kind, "WIN");
  assert.equal(state.postWinClearing, false);
  assert.equal(state.result?.allClear, true);
  assert.ok(state.activeGoals.every((goal) => goal === null));
});

test("overfill fills the goal and creates a separate excess batch", () => {
  const state = hit(createGameState(level01), "red", 7, 1, 17);
  assert.deepEqual(state.batches.map(({ color, count, sourceShotId }) => ({ color, count, sourceShotId })), [
    { color: "red", count: 1, sourceShotId: 1 },
  ]);
  assert.equal(state.activeGoals[0]?.color, "yellow");
});

test("parking exactly the budget is legal, and a matching shot drains it", () => {
  assert.equal(level01.reserveBlocks, 8, "this level's budget is what the numbers below are measured against");
  let state = createGameState(level01);
  state = hit(state, "blue", 4, 1, 20);
  state = hit(state, "yellow", 4, 2, 16);
  // Two records, but what the level limits is the eight blocks inside them.
  assert.equal(parkedBlockCount(state), 8);
  assert.equal(state.batches.length, 2);
  assert.equal(state.result, null, "a full reserve is not a loss on its own");

  state = hit(state, "green", 4, 3, 12);
  assert.equal(state.result, null);
  assert.equal(parkedBlockCount(state), 0, "the hidden yellow and blue goals should cascade through both records");
});

test("the block that would overflow the budget fails the level", () => {
  let state = createGameState(level01);
  state = hit(state, "blue", 4, 1, 20);
  state = hit(state, "yellow", 4, 2, 16);
  assert.equal(state.result, null);
  state = hit(state, "purple", 3, 3, 13);
  assert.equal(state.result?.kind, "FAIL");
  assert.equal(state.result?.reason, "Reserve full");
});

test("a full reserve is not a loss: a shot an open goal can take still lands", () => {
  let state = createGameState(level01);
  state = hit(state, "blue", 4, 1, 20);
  state = hit(state, "yellow", 4, 2, 16);
  assert.equal(parkedBlockCount(state), level01.reserveBlocks, "the reserve is full before the shot under test");

  // Red is the open goal, so the whole claim is served by the queue and nothing
  // needs parking. A full reserve on its own must not end the level.
  state = hit(state, "red", 3, 3, 13);
  assert.equal(state.result, null);
  assert.equal(state.activeGoals[0]?.current, 3);
  assert.equal(parkedBlockCount(state), 8, "it neither overflowed nor drained yet");

  // Completing that goal opens the next one, which is what actually drains the
  // reserve — the shot pays for itself.
  state = hit(state, "red", 3, 4, 10);
  assert.equal(state.result, null);
  assert.equal(parkedBlockCount(state), 0, "yellow then blue cascade out as their goals open");
});

test("a full reserve plus a shot the queue cannot use ends the level", () => {
  let state = createGameState(level01);
  state = hit(state, "blue", 4, 1, 20);
  state = hit(state, "yellow", 4, 2, 16);
  assert.equal(parkedBlockCount(state), level01.reserveBlocks);

  // Purple has no open goal, so every block of the claim would have to be
  // parked, and there is nowhere to park it.
  const doomed = planClusterSplit(level01, state, "purple", 3);
  assert.equal(doomed.toGoal, 0, "nothing this claim carries can serve the queue");
  assert.equal(doomed.fits, false);

  state = hit(state, "purple", 3, 3, 13);
  assert.equal(state.result?.kind, "FAIL");
  assert.equal(state.result?.reason, "Reserve full");
});

test("a single claim larger than the budget fails even with the reserve empty", () => {
  // The unit of the limit is what changed: nine blocks in one record used to be
  // one slot and therefore free, and is now over budget on its own.
  const state = hit(createGameState(level01), "yellow", 9, 1, 15);
  assert.equal(parkedBlockCount(createGameState(level01)), 0);
  assert.equal(state.result?.kind, "FAIL");
  assert.equal(state.result?.reason, "Reserve full");
});

test("planClusterSplit reports the same split the transaction will apply", () => {
  let state = createGameState(level01);
  // Red is the open goal at six, so seven red is six into the goal and one parked.
  const overfill = planClusterSplit(level01, state, "red", 7);
  assert.deepEqual(
    { goalSlot: overfill.goalSlot, toGoal: overfill.toGoal, excess: overfill.excess, fits: overfill.fits },
    { goalSlot: 0, toGoal: 6, excess: 1, fits: true },
  );

  // Yellow has no open goal, so the whole claim has to be parked.
  const parked = planClusterSplit(level01, state, "yellow", 4);
  assert.deepEqual({ goalSlot: parked.goalSlot, toGoal: parked.toGoal, excess: parked.excess }, { goalSlot: -1, toGoal: 0, excess: 4 });

  state = hit(state, "blue", 4, 1, 20);
  state = hit(state, "yellow", 4, 2, 16);
  const full = planClusterSplit(level01, state, "purple", 3);
  assert.equal(full.parked, 8);
  assert.equal(full.fits, false, "asking must agree with what resolveCluster then does");
});

test("batch auto-fill can consume only part of one batch", () => {
  const customLevel: LevelConfig = {
    ...level01,
    // Room for the ten-block claim below: this test is about partial draining,
    // not about the budget.
    reserveBlocks: 12,
    goals: [
      { id: "green-1", color: "green", target: 1 },
      { id: "blue-1", color: "blue", target: 1 },
      { id: "red-6", color: "red", target: 6 },
    ],
    blocks: [
      ...level01.blocks.filter((block) => block.color === "red").slice(0, 6),
      ...level01.blocks.filter((block) => block.color === "green").slice(0, 1),
      ...level01.blocks.filter((block) => block.color === "blue").slice(0, 1),
    ],
  };
  let state = createGameState(customLevel);
  state = resolveCluster(customLevel, state, { color: "red", count: 10, shotIndex: 1, remainingBlockCount: 14 });
  state = resolveCluster(customLevel, state, { color: "green", count: 1, shotIndex: 2, remainingBlockCount: 13 });

  assert.equal(state.activeGoals[0], null, "the red goal should complete from the batch");
  assert.deepEqual(state.batches.map(({ color, count }) => ({ color, count })), [{ color: "red", count: 4 }]);
});

test("same-color results from different shots never merge", () => {
  let state = createGameState(level01);
  state = hit(state, "blue", 1, 1, 23);
  state = hit(state, "blue", 1, 2, 22);
  assert.equal(state.batches.length, 2);
  assert.notEqual(state.batches[0].id, state.batches[1].id);
});

// goal_split hands one colour two goals, and the two slots advance on their own,
// so the queue can reach the second purple while the first is still open. That
// used to throw out of assertDifferentActiveGoalColors on 48 of level 3's legal
// orderings — a crash, not a loss.
test("a queued goal whose colour is still open waits instead of throwing", () => {
  const { levels, issues } = parseLevelSheet(LEVELS_SHEET);
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
  // The goal_split board is row 8 now: the onboarding ramp took rows 1-5 and
  // pushed the three original boards down. This test is about the split, so it
  // follows the split rather than the row number.
  const level3 = levels.find((level) => level.id === 8);
  assert.ok(level3, "the goal_split level this test is about is missing");
  assert.deepEqual(level3.goals.map((goal) => `${goal.color}${goal.target}`), ["purple3", "orange6", "red6", "purple3"]);

  const claims: Array<[BlockColor, number]> = [
    ["purple", 3], ["purple", 3], ["orange", 3], ["orange", 3], ["red", 3], ["red", 3],
  ];

  const orderings: Array<Array<[BlockColor, number]>> = [];
  const walk = (remaining: Array<[BlockColor, number]>, taken: Array<[BlockColor, number]>) => {
    if (!remaining.length) return void orderings.push(taken);
    const seen = new Set<string>();
    for (let index = 0; index < remaining.length; index += 1) {
      const claim = remaining[index];
      if (seen.has(claim[0])) continue;
      seen.add(claim[0]);
      walk([...remaining.slice(0, index), ...remaining.slice(index + 1)], [...taken, claim]);
    }
  };
  walk(claims, []);
  assert.equal(orderings.length, 90, "every distinct order the six clusters can be claimed in");

  let deferrals = 0;
  for (const ordering of orderings) {
    let state = createGameState(level3);
    let remaining = level3.blocks.length;
    for (const [color, count] of ordering) {
      remaining -= count;
      // Throwing here is the regression; the loop is the assertion.
      state = resolveCluster(level3, state, { color, count, shotIndex: 1, remainingBlockCount: remaining });
      deferrals += state.lastEvents.filter((event) => event.includes("waits for the other slot")).length;
      if (state.result) break;
    }
    assert.equal(state.result?.kind, "WIN", `${ordering.map(([color]) => color).join(" -> ")} should finish`);
  }
  assert.ok(deferrals > 0, "a test that never reaches the waiting branch would not prove anything");
});

test("a batch auto-fill can be described without applying it", () => {
  let state = createGameState(level01);
  // Yellow has no open goal at the start, so the cluster becomes a batch.
  state = hit(state, "yellow", 4, 1, 20);
  assert.equal(state.batches.length, 1);

  const batchesBefore = JSON.stringify(state.batches);
  const goalsBefore = JSON.stringify(state.activeGoals);
  const transfer = nextBatchAutoFill(level01, state);

  assert.equal(transfer, null, "yellow has no open goal yet, so nothing is due");
  assert.equal(JSON.stringify(state.batches), batchesBefore, "asking must not change anything");
  assert.equal(JSON.stringify(state.activeGoals), goalsBefore);
});

test("stepping the cascade by hand lands on the same state as resolving it in one call", () => {
  const customLevel: LevelConfig = {
    ...level01,
    reserveBlocks: 12,
    goals: [
      { id: "green-1", color: "green", target: 1 },
      { id: "blue-1", color: "blue", target: 1 },
      { id: "red-6", color: "red", target: 6 },
    ],
    blocks: [
      ...level01.blocks.filter((block) => block.color === "red").slice(0, 6),
      ...level01.blocks.filter((block) => block.color === "green").slice(0, 1),
      ...level01.blocks.filter((block) => block.color === "blue").slice(0, 1),
    ],
  };
  const start = resolveCluster(customLevel, createGameState(customLevel), { color: "red", count: 10, shotIndex: 1, remainingBlockCount: 14 });

  const wholeTransaction = resolveCluster(customLevel, start, { color: "green", count: 1, shotIndex: 2, remainingBlockCount: 13 });

  // The engine's path: resolve without auto-fill, then walk the cascade.
  let stepped = resolveCluster(customLevel, start, { color: "green", count: 1, shotIndex: 2, remainingBlockCount: 13 }, false);
  assert.deepEqual(
    stepped.batches.map(({ color, count }) => ({ color, count })),
    [{ color: "red", count: 10 }],
    "without auto-fill the batch is still untouched, which is what the flight is drawn over",
  );

  const seen = [];
  for (;;) {
    const transfer = nextBatchAutoFill(customLevel, stepped);
    if (!transfer) break;
    seen.push(transfer);
    stepped = applyBatchAutoFill(customLevel, stepped, transfer);
    assert.ok(seen.length < 10, "the cascade must terminate");
  }

  assert.ok(seen.length >= 1, "the red goal is filled from the batch, so there is something to show");
  assert.deepEqual(stepped.activeGoals, wholeTransaction.activeGoals);
  assert.deepEqual(stepped.batches, wholeTransaction.batches);
  assert.equal(stepped.nextGoalIndex, wholeTransaction.nextGoalIndex);
  assert.deepEqual(stepped.result, wholeTransaction.result);
});

test("a stale transfer is refused instead of double-filling a goal", () => {
  // Red must be batched before its goal opens, so a transfer is pending: with
  // two slots the open goals are green and blue, and red has nowhere to go yet.
  const customLevel: LevelConfig = {
    ...level01,
    goals: [
      { id: "green-1", color: "green", target: 1 },
      { id: "blue-1", color: "blue", target: 1 },
      { id: "red-6", color: "red", target: 6 },
    ],
    blocks: [
      ...level01.blocks.filter((block) => block.color === "red").slice(0, 6),
      ...level01.blocks.filter((block) => block.color === "green").slice(0, 1),
      ...level01.blocks.filter((block) => block.color === "blue").slice(0, 1),
    ],
  };
  let state = resolveCluster(customLevel, createGameState(customLevel), { color: "red", count: 6, shotIndex: 1, remainingBlockCount: 2 });
  state = resolveCluster(customLevel, state, { color: "green", count: 1, shotIndex: 2, remainingBlockCount: 1 }, false);

  const transfer = nextBatchAutoFill(customLevel, state);
  assert.ok(transfer, "the red batch is due into the red goal");
  const once = applyBatchAutoFill(customLevel, state, transfer);
  const twice = applyBatchAutoFill(customLevel, once, transfer);
  assert.equal(twice, once, "replaying the same transfer changes nothing");
});
