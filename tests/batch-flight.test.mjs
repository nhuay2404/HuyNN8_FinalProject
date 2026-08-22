import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);
const uiUrl = new URL("../app/GamePrototype.tsx", import.meta.url);

function constant(source, name) {
  const match = source.match(new RegExp(`const ${name} = ([0-9.]+);`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
}

test("a batch flight always finishes in under a second, whatever the batch holds", async () => {
  const source = await readFile(engineUrl, "utf8");
  const flight = constant(source, "BATCH_FLIGHT_MS");
  const stagger = constant(source, "BATCH_STAGGER_MS");
  const budget = constant(source, "BATCH_FLIGHT_BUDGET_MS");
  const tail = constant(source, "BATCH_FLIGHT_TAIL_MS");

  // The engine derives the stagger from the budget, so the worst case is the
  // budget itself plus the tail — never the stagger times an unbounded count.
  assert.ok(budget + tail < 1000, `worst case ${budget + tail}ms must stay under 1000ms`);

  for (const count of [1, 2, 4, 6, 12, 40]) {
    const perCube = count > 1 ? Math.min(stagger, (budget - flight) / (count - 1)) : 0;
    const total = flight + perCube * (count - 1) + tail;
    assert.ok(total < 1000, `${count} cubes would take ${Math.round(total)}ms`);
  }
});

test("the engine resolves a shot without auto-fill and walks the cascade itself", async () => {
  const source = await readFile(engineUrl, "utf8");
  assert.match(
    source,
    /resolveCluster\(this\.level, this\.state, pending\.result, false\)/,
    "auto-fill must be left out of the shot's own transaction so it can be shown separately",
  );
  const update = source.slice(source.indexOf("private updateBatchFlight()"), source.indexOf("private updateAutoClear()"));
  assert.match(update, /nextBatchAutoFill\(this\.level, this\.state\)/);
  assert.match(update, /this\.callbacks\.onBatchFlight\(/);
  // The state change lands after the countdown, never before.
  assert.ok(
    update.indexOf("applyBatchAutoFill") < update.indexOf("nextBatchAutoFill"),
    "the pending flight is applied first, then the next one is looked for",
  );
});

test("nothing else moves while a batch is in the air", async () => {
  const source = await readFile(engineUrl, "utf8");
  const resolvePending = source.slice(source.indexOf("private resolvePending()"), source.indexOf("private updateBatchFlight()"));
  assert.match(resolvePending, /if \(this\.batchFlight \|\| !this\.pendingResolutions\.length\) return;/, "a queued shot waits for the flight");
  const autoClear = source.slice(source.indexOf("private updateAutoClear()"), source.indexOf("private setPhase("));
  assert.match(autoClear, /if \(this\.batchFlight\) return;/, "post-win clearing waits too, or two explanations overlap");
});

test("the flight is drawn between the batch slot and the goal card on screen", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const handler = ui.slice(ui.indexOf("const handleBatchFlight"), ui.indexOf("const engine = new CannonSortEngine"));
  // Found by batch id, not slot index: a batch keeps its identity while the
  // slots around it shift.
  assert.match(handler, /\[data-batch-id="\$\{event\.batchId\}"\]/);
  assert.match(handler, /\[data-goal-slot="\$\{event\.goalSlot\}"\]/);
  assert.match(handler, /planBatchFlight\(/, "same clamped path as the cluster sprites, so nothing flies off-screen");
  assert.match(handler, /fromCount: event\.goalFromCount/, "the goal count climbs as the cubes land");
  assert.match(ui, /data-batch-id=\{slot\.batchId\}/);
});

test("a batch of any size becomes that many cubes, staggered and inside the frame", async () => {
  const { planBatchFlight, FLIGHT_EDGE_MARGIN } = await import("../app/game/sort-flight.ts");
  const bounds = { width: 430, height: 680 };
  // A batch slot sits high on the left, a goal card high on the right.
  const from = { x: 96, y: 96 };
  const to = { x: 300, y: 40 };

  for (const count of [1, 3, 6]) {
    const plans = planBatchFlight(from, to, count, 60, bounds);
    assert.equal(plans.length, count, `${count} units should send ${count} cubes`);
    assert.deepEqual(plans.map((plan) => plan.delayMs), plans.map((_, index) => index * 60), "each cube leaves a beat after the one before");
    for (const plan of plans) {
      for (const [name, point] of Object.entries(plan.path)) {
        assert.ok(
          point.x >= FLIGHT_EDGE_MARGIN && point.x <= bounds.width - FLIGHT_EDGE_MARGIN
          && point.y >= FLIGHT_EDGE_MARGIN && point.y <= bounds.height - FLIGHT_EDGE_MARGIN,
          `${name} of cube ${plan.index} left the frame`,
        );
      }
    }
  }
});

test("cubes leaving a batch fan out instead of stacking on one path", async () => {
  const { planBatchFlight } = await import("../app/game/sort-flight.ts");
  const plans = planBatchFlight({ x: 200, y: 300 }, { x: 200, y: 60 }, 3, 60, { width: 430, height: 680 });
  const starts = new Set(plans.map((plan) => plan.path.source.x));
  assert.equal(starts.size, 3, "three cubes should not all start from the same pixel");
});
