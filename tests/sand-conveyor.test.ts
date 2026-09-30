// The conveyor's own rules (app/game/sand-conveyor.ts): how a picture's sand
// is carved into boxes, how piles ride the belt and pour into boxes, and the
// two ways a full belt ends the level.

import assert from "node:assert/strict";
import test from "node:test";
import {
  addPiles,
  conveyorCanProgress,
  createConveyorState,
  isConveyorComplete,
  isConveyorFull,
  isConveyorJammed,
  planConveyorBoxes,
  slotX,
  stepConveyor,
  type ConveyorState,
} from "../app/game/sand-conveyor.ts";

test("boxes add up to exactly the sand in the picture, colour by colour", () => {
  const counts = { red: 700, blue: 300, green: 200 } as const;
  const plan = planConveyorBoxes(counts, ["red", "blue", "green"]);
  for (const color of ["red", "blue", "green"] as const) {
    const total = plan.filter((box) => box.color === color).reduce((sum, box) => sum + box.capacity, 0);
    assert.equal(total, counts[color]);
  }
  // ~1/12 of 1200 = 100 per box.
  assert.equal(plan.filter((box) => box.color === "red").length, 7);
  assert.equal(plan.filter((box) => box.color === "green").length, 2);
});

test("box order interleaves colours instead of bunching them", () => {
  const plan = planConveyorBoxes({ red: 600, blue: 600 }, ["red", "blue"]);
  const colors = plan.map((box) => box.color);
  for (let i = 1; i < colors.length; i++) assert.notEqual(colors[i], colors[i - 1]);
});

test("a tiny colour still gets a box of its own", () => {
  const plan = planConveyorBoxes({ red: 1000, yellow: 3 }, ["red", "yellow"]);
  assert.deepEqual(plan.filter((box) => box.color === "yellow").map((box) => box.capacity), [3]);
});

test("the first boxes fill the slots, the rest queue up", () => {
  const state = createConveyorState({ red: 1200 }, ["red"]);
  assert.equal(state.slots.length, 4);
  assert.ok(state.slots.every((box) => box?.color === "red"));
  assert.equal(state.queue.length, 12 - 4);
});

function onlySlot(color: "red" | "blue", capacity: number): ConveyorState {
  return {
    capacity: 5,
    piles: [],
    slots: [null, { id: 1, color, capacity, filled: 0 }, null, null],
    queue: [],
    nextId: 2,
  };
}

test("a pile pours into a matching box as it passes over it", () => {
  let state = addPiles(onlySlot("red", 10), { red: 4 }, 0.1).state;
  const { state: after, events } = stepConveyor(state, 10, 0.1); // travels 0.1 → 1.1, crosses slot 1 at 0.375
  state = after;
  assert.equal(state.piles.length, 0);
  assert.equal(state.slots[1]?.filled, 4);
  assert.deepEqual(events.map((event) => event.kind), ["FILL"]);
});

test("a pile of the wrong colour keeps circling", () => {
  let state = addPiles(onlySlot("red", 10), { blue: 4 }, 0.1).state;
  state = stepConveyor(state, 30, 0.1).state; // three laps
  assert.equal(state.piles.length, 1);
  assert.equal(state.piles[0].amount, 4);
  assert.ok(state.piles[0].x >= 0 && state.piles[0].x < 1);
});

test("a box only takes what it has room for; the rest rides on", () => {
  let state = addPiles(onlySlot("red", 3), { red: 5 }, 0.1).state;
  const result = stepConveyor(state, 3, 0.1);
  state = result.state;
  assert.equal(state.piles[0].amount, 2);
  assert.deepEqual(result.events.map((event) => event.kind), ["FILL", "BOX_FULL"]);
  assert.equal(state.slots[1], null, "queue was empty, so the slot stays empty");
});

test("a full box is replaced by the next one in the queue", () => {
  let state: ConveyorState = {
    ...onlySlot("red", 2),
    queue: [{ id: 7, color: "blue", capacity: 4, filled: 0 }],
  };
  state = addPiles(state, { red: 2 }, 0.1).state;
  const result = stepConveyor(state, 3, 0.1);
  assert.deepEqual(result.events.map((event) => event.kind), ["FILL", "BOX_FULL", "BOX_ENTER"]);
  assert.equal(result.state.slots[1]?.id, 7);
});

test("one shot's pile that crosses two matching slots pours into both", () => {
  let state: ConveyorState = {
    capacity: 5,
    piles: [],
    slots: [
      { id: 1, color: "red", capacity: 2, filled: 0 },
      { id: 2, color: "red", capacity: 5, filled: 0 },
      null,
      null,
    ],
    queue: [],
    nextId: 3,
  };
  state = addPiles(state, { red: 6 }, 0).state;
  state = stepConveyor(state, 1, 0.5).state; // 0 → 0.5, crosses 0.125 and 0.375
  assert.equal(state.slots[0], null);
  assert.equal(state.slots[1]?.filled, 4);
  assert.equal(state.piles.length, 0);
});

test("a shot that puts one pile too many on the belt overflows", () => {
  let state = onlySlot("red", 100);
  for (let i = 0; i < 5; i++) {
    const added = addPiles(state, { blue: 1 }, 0.9);
    assert.equal(added.overflow, false);
    state = added.state;
  }
  assert.ok(isConveyorFull(state));
  assert.equal(addPiles(state, { blue: 1 }, 0.9).overflow, true);
});

test("a full belt with nothing a box on show wants is jammed", () => {
  let state = onlySlot("red", 100);
  for (let i = 0; i < 5; i++) state = addPiles(state, { blue: 1 }, 0.5).state;
  assert.ok(isConveyorJammed(state));
  assert.equal(conveyorCanProgress(state), false);

  let draining = onlySlot("red", 100);
  for (let i = 0; i < 4; i++) draining = addPiles(draining, { blue: 1 }, 0.5).state;
  draining = addPiles(draining, { red: 1 }, 0.5).state;
  assert.ok(isConveyorFull(draining));
  assert.equal(isConveyorJammed(draining), false, "the red pile will still pour out");
});

test("feeding the whole picture through fills every box", () => {
  const counts = { red: 50, blue: 30, green: 20 } as const;
  let state = createConveyorState(counts, ["red", "blue", "green"], 50);
  for (const [color, amount] of Object.entries(counts)) {
    for (let i = 0; i < amount; i += 10) state = addPiles(state, { [color]: 10 }, (i % 7) / 7).state;
  }
  for (let i = 0; i < 400 && !isConveyorComplete(state); i++) state = stepConveyor(state, 0.25).state;
  assert.ok(isConveyorComplete(state));
});

test("slot centres are spread evenly across the belt", () => {
  assert.deepEqual([0, 1, 2, 3].map((index) => slotX(index)), [0.125, 0.375, 0.625, 0.875]);
});
