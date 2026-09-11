// Freeze Map x Lock & Key: a key's own physics is not part of what Freeze
// holds — only `sandPass` itself is. Tested against the solver rather than
// the renderer, same reasoning as sand-mechanics.test.ts.

import assert from "node:assert/strict";
import test from "node:test";
import { lockAndKey } from "./level-fixtures.ts";
import { createSandGameState, fixturesOf, parseSandLevel, runGrainSettle } from "../app/game/sand-rules.ts";

// The plug of yellow the key rests on (see `lockAndKey`'s own comment) —
// clearing it is what a real shot would do; here it is just sliced out of
// `bodies` directly, since the settle solver under test does not care how
// the hole got there.
function withoutYellowPlug(level: typeof lockAndKey) {
  const { bodies } = parseSandLevel(level);
  return bodies.filter((body) => body.color !== "yellow");
}

test("a key keeps falling and unlocking while the board is frozen", () => {
  const state = createSandGameState(lockAndKey);
  const fixtures = fixturesOf(lockAndKey, state);
  const bodies = withoutYellowPlug(lockAndKey);
  assert.equal(fixtures.keys!.length, 1, "the fixture starts with its one key still resting on the slab");
  assert.ok(fixtures.locked!.length > 0, "the purple slab starts locked");

  const frozen = runGrainSettle(bodies, lockAndKey.frame, fixtures, undefined, true);

  // `unlockPass` consumes a key the instant it opens a lock (sand-rules.ts) —
  // so a key that reached the slab and opened it is gone from `keys`, not
  // just moved. Its disappearing, alongside the slab's own `locked` count
  // hitting 0, is exactly what proves both its fall and its unlock ran even
  // though this settle was frozen.
  assert.equal(frozen.keys.length, 0, "the key fell, reached the slab and was spent opening it, even though the settle was frozen");
  assert.equal(frozen.locked.length, 0, "the slab opened even though the settle was frozen");

  // The purple the unlock just freed is sand like any other while frozen —
  // it hangs exactly where the slab was, it does not also fall in this same
  // settle. Only the still-unfrozen settle below lets it drop.
  const originalPurpleY = new Set(bodies.find((body) => body.color === "purple")!.cells.map((cell) => cell.y));
  const frozenPurpleY = new Set(frozen.bodies.find((body) => body.color === "purple")!.cells.map((cell) => cell.y));
  assert.deepEqual(frozenPurpleY, originalPurpleY, "freed purple hangs exactly where the slab was — frozen sand does not fall");

  const unfrozen = runGrainSettle(bodies, lockAndKey.frame, fixtures, undefined, false);
  const unfrozenPurpleY = [...new Set(unfrozen.bodies.find((body) => body.color === "purple")!.cells.map((cell) => cell.y))];
  assert.ok(Math.min(...unfrozenPurpleY) < Math.min(...originalPurpleY), "the same picture, unfrozen, lets the freed purple actually fall");
});
