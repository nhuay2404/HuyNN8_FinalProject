import type { BatchTransfer, BlockColor, ClusterResult, GameState, GoalState, LevelConfig } from "./types";

function assertDifferentActiveGoalColors(goals: Array<GoalState | null>) {
  const colors = goals.flatMap((goal) => (goal ? [goal.color] : []));
  if (new Set(colors).size !== colors.length) {
    throw new Error("Invalid level data: active goals must use different colors");
  }
}

export function createGameState(level: LevelConfig): GameState {
  const goalCounts = new Map<BlockColor, number>();
  const blockCounts = new Map<BlockColor, number>();
  for (const goal of level.goals) goalCounts.set(goal.color, (goalCounts.get(goal.color) ?? 0) + goal.target);
  for (const block of level.blocks) blockCounts.set(block.color, (blockCounts.get(block.color) ?? 0) + 1);
  const colors = new Set([...goalCounts.keys(), ...blockCounts.keys()]);
  for (const color of colors) {
    const required = goalCounts.get(color) ?? 0;
    const available = blockCounts.get(color) ?? 0;
    if (required !== available) {
      throw new Error(`Invalid level data: ${color} has ${available} blocks but goals require ${required}`);
    }
  }

  const activeGoals: Array<GoalState | null> = [];
  for (let slot = 0; slot < level.activeGoalSlots; slot += 1) {
    const goal = level.goals[slot];
    activeGoals.push(goal ? { ...goal, current: 0 } : null);
  }
  assertDifferentActiveGoalColors(activeGoals);

  return {
    phase: "PLAYING",
    activeGoals,
    nextGoalIndex: Math.min(level.activeGoalSlots, level.goals.length),
    batches: [],
    shotIndex: 0,
    remainingBlockCount: level.blocks.length,
    postWinClearing: false,
    result: null,
    lastEvents: ["Level ready"],
  };
}

function nextGoalIntoSlot(level: LevelConfig, state: GameState, slotIndex: number, events: string[]) {
  const next = level.goals[state.nextGoalIndex];
  // The slots advance on their own, so the queue can reach a second goal of a
  // colour the other slot is still working on — goal_split authors exactly that
  // shape. Opening it would break the one-colour-per-slot invariant and throw,
  // so the slot waits instead: it holds its place empty and takes the goal once
  // the colour is free.
  if (next && state.activeGoals.some((goal, index) => index !== slotIndex && goal?.color === next.color)) {
    state.activeGoals[slotIndex] = null;
    events.push(`Goal ${next.color} ×${next.target} waits for the other slot`);
    return;
  }

  state.activeGoals[slotIndex] = next ? { ...next, current: 0 } : null;
  if (next) {
    state.nextGoalIndex += 1;
    assertDifferentActiveGoalColors(state.activeGoals);
    events.push(`Goal opened: ${next.color} ×${next.target}`);
  }
}

// A slot that waited tries again as soon as a goal finishes, or the queue would
// stall behind it. One blocked head blocks every empty slot equally, so the
// first slot that cannot take it ends the sweep.
function fillWaitingSlots(level: LevelConfig, state: GameState, events: string[]) {
  for (let slot = 0; slot < state.activeGoals.length; slot += 1) {
    if (state.activeGoals[slot]) continue;
    const queueBefore = state.nextGoalIndex;
    nextGoalIntoSlot(level, state, slot, events);
    if (state.nextGoalIndex === queueBefore) return;
  }
}

// Blocks parked across every batch record. This is the quantity the level
// budgets: a batch of six costs six, not one, so the price of deferring a claim
// finally matches how much was deferred.
export function parkedBlockCount(state: GameState) {
  return state.batches.reduce((total, batch) => total + batch.count, 0);
}

// One claim split the way the transaction will split it: what the open goal of
// that colour can take, and what has to be parked. resolveCluster, the engine's
// flight planner and the aim-time legality check all read this one function, so
// the animation can never disagree with the state it is drawn over.
export type ClusterSplit = {
  goalSlot: number;
  toGoal: number;
  excess: number;
  parked: number;
  fits: boolean;
};

export function planClusterSplit(
  level: LevelConfig,
  state: GameState,
  color: BlockColor,
  count: number,
): ClusterSplit {
  const goalSlot = state.activeGoals.findIndex((goal) => goal?.color === color);
  const goal = goalSlot >= 0 ? state.activeGoals[goalSlot]! : null;
  const toGoal = goal ? Math.min(count, goal.target - goal.current) : 0;
  const excess = count - toGoal;
  const parked = parkedBlockCount(state);
  return { goalSlot, toGoal, excess, parked, fits: parked + excess <= level.reserveBlocks };
}

function createBatchOrFail(
  level: LevelConfig,
  state: GameState,
  shotIndex: number,
  color: BlockColor,
  count: number,
  events: string[],
) {
  if (count <= 0) return true;
  const parked = parkedBlockCount(state);
  if (parked + count > level.reserveBlocks) {
    state.phase = "FAIL";
    state.result = {
      kind: "FAIL",
      allClear: state.remainingBlockCount === 0,
      reason: "Reserve full",
    };
    events.push(`${count} ${color} needed a place but the reserve holds ${parked}/${level.reserveBlocks}`);
    return false;
  }

  state.batches.push({
    id: `batch-${shotIndex}`,
    sourceShotId: shotIndex,
    color,
    count,
    createdAt: shotIndex,
  });
  events.push(`Batch stored: ${color} ×${count}`);
  return true;
}

function advanceGoal(level: LevelConfig, state: GameState, slot: number, events: string[]) {
  const goal = state.activeGoals[slot];
  if (!goal || goal.current !== goal.target) return;
  events.push(`Goal complete: ${goal.color} ×${goal.target}`);
  nextGoalIntoSlot(level, state, slot, events);
  fillWaitingSlots(level, state, events);
}

function orderedMatchingBatchIndex(level: LevelConfig, state: GameState, color: BlockColor) {
  if (level.batchPriority !== "OLDEST_FIRST_TEMP") {
    throw new Error(`Unsupported temporary batch priority: ${level.batchPriority}`);
  }
  // TODO(design): Replace when official same-color batch priority is confirmed.
  return state.batches.findIndex((batch) => batch.color === color);
}

// The next batch that would empty into an open goal, described without touching
// anything. The engine asks for this so it can show the move before it happens;
// resolveCluster asks for it in a loop to finish the cascade in one call.
export function nextBatchAutoFill(level: LevelConfig, state: GameState): BatchTransfer | null {
  if (state.result) return null;

  for (let slot = 0; slot < state.activeGoals.length; slot += 1) {
    const goal = state.activeGoals[slot];
    if (!goal) continue;
    const batchIndex = orderedMatchingBatchIndex(level, state, goal.color);
    if (batchIndex < 0) continue;

    const batch = state.batches[batchIndex];
    const amount = Math.min(batch.count, goal.target - goal.current);
    if (amount <= 0) continue;
    return {
      batchId: batch.id,
      goalId: goal.id,
      goalSlot: slot,
      color: batch.color,
      count: amount,
      goalFromCount: goal.current,
    };
  }
  return null;
}

export function applyBatchAutoFill(level: LevelConfig, previous: GameState, transfer: BatchTransfer): GameState {
  const state: GameState = {
    ...previous,
    activeGoals: previous.activeGoals.map((goal) => (goal ? { ...goal } : null)),
    batches: previous.batches.map((batch) => ({ ...batch })),
    lastEvents: [],
  };
  const events = state.lastEvents;
  const batchIndex = state.batches.findIndex((batch) => batch.id === transfer.batchId);
  const goal = state.activeGoals[transfer.goalSlot];
  // The transfer was measured against this exact state, so a mismatch means the
  // caller advanced the game in between and the move no longer applies.
  if (batchIndex < 0 || !goal || goal.id !== transfer.goalId) return previous;

  const batch = state.batches[batchIndex];
  const amount = Math.min(transfer.count, batch.count, goal.target - goal.current);
  if (amount <= 0) return previous;

  batch.count -= amount;
  goal.current += amount;
  events.push(`Batch ${batch.color} filled ${amount}`);
  if (batch.count === 0) state.batches.splice(batchIndex, 1);
  else events.push(`Batch ${batch.color} has ${batch.count} left`);
  if (goal.current === goal.target) advanceGoal(level, state, transfer.goalSlot, events);

  checkWin(level, state, events);
  return state;
}

// Shared by both paths so the animated, step-by-step version and this one can
// never drift apart.
function runBatchAutoFill(level: LevelConfig, state: GameState, events: string[]) {
  let guard = 0;
  const guardLimit = level.goals.length + level.blocks.length + 8;

  for (;;) {
    guard += 1;
    if (guard >= guardLimit) throw new Error("Batch auto-fill cascade exceeded its safety guard");
    const transfer = nextBatchAutoFill(level, state);
    if (!transfer) return;
    const next = applyBatchAutoFill(level, state, transfer);
    if (next === state) return;
    // The cascade is applied in place because resolveCluster hands us a state it
    // already owns.
    state.activeGoals = next.activeGoals;
    state.batches = next.batches;
    state.nextGoalIndex = next.nextGoalIndex;
    state.phase = next.phase;
    state.postWinClearing = next.postWinClearing;
    state.result = next.result;
    events.push(...next.lastEvents);
  }
}

function checkWin(level: LevelConfig, state: GameState, events: string[]) {
  const queueDone = state.nextGoalIndex >= level.goals.length;
  const activeDone = state.activeGoals.every((goal) => goal === null);
  if (!state.result && queueDone && activeDone && state.batches.length === 0) {
    state.phase = "WIN";
    state.postWinClearing = level.postWinAutoClear && state.remainingBlockCount > 0;
    state.result = { kind: "WIN", allClear: state.remainingBlockCount === 0 };
    events.push("All goals complete");
  }
}

// `autoFill` is only turned off by the engine, which runs the same cascade one
// step at a time so each batch can be seen moving into its goal. Everything else
// wants the whole transaction resolved in one call.
export function resolveCluster(
  level: LevelConfig,
  previous: GameState,
  result: ClusterResult,
  autoFill = true,
): GameState {
  if (previous.result) return previous;
  if (level.overfillTransaction !== "CREATE_EXCESS_THEN_ADVANCE_TEMP") {
    throw new Error(`Unsupported temporary overfill transaction: ${level.overfillTransaction}`);
  }

  const state: GameState = {
    ...previous,
    activeGoals: previous.activeGoals.map((goal) => (goal ? { ...goal } : null)),
    batches: previous.batches.map((batch) => ({ ...batch })),
    result: null,
    phase: "PLAYING",
    shotIndex: Math.max(previous.shotIndex, result.shotIndex),
    remainingBlockCount: result.remainingBlockCount,
    lastEvents: [],
  };
  const events = state.lastEvents;
  const split = planClusterSplit(level, state, result.color, result.count);

  if (split.goalSlot < 0) {
    createBatchOrFail(level, state, result.shotIndex, result.color, result.count, events);
  } else {
    const goal = state.activeGoals[split.goalSlot]!;
    goal.current += split.toGoal;
    events.push(`${result.color} +${split.toGoal} into the goal`);

    // TODO(design): Temporary order creates/reserves excess before opening the
    // next goal. The official transaction order remains unconfirmed.
    if (split.excess > 0 && !createBatchOrFail(level, state, result.shotIndex, result.color, split.excess, events)) return state;
    if (goal.current === goal.target) advanceGoal(level, state, split.goalSlot, events);
    if (autoFill) runBatchAutoFill(level, state, events);
  }

  checkWin(level, state, events);
  return state;
}
