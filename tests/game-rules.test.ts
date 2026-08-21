import assert from "node:assert/strict";
import test from "node:test";
import { level01 } from "../app/game/level-01.ts";
import { applyBatchAutoFill, createGameState, nextBatchAutoFill, resolveCluster } from "../app/game/rules.ts";
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

test("two occupied batch slots are valid and a matching shot can free one", () => {
  let state = createGameState(level01);
  state = hit(state, "blue", 4, 1, 20);
  state = hit(state, "yellow", 4, 2, 16);
  assert.equal(state.batches.length, 2);
  assert.equal(state.result, null);

  state = hit(state, "green", 4, 3, 12);
  assert.equal(state.result, null);
  assert.equal(state.batches.length, 0, "the hidden yellow and blue goals should cascade through both batches");
});

test("failure occurs only when a third batch must be created", () => {
  let state = createGameState(level01);
  state = hit(state, "blue", 4, 1, 20);
  state = hit(state, "yellow", 4, 2, 16);
  assert.equal(state.result, null);
  state = hit(state, "purple", 3, 3, 13);
  assert.equal(state.result?.kind, "FAIL");
  assert.equal(state.result?.reason, "No batch slot left");
});

test("batch auto-fill can consume only part of one batch", () => {
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
