// A landed shot that spends the last bullet is allowed to sweep away a tiny
// (2%, `WIN_LENIENCY_FRACTION` in sand-rules.ts) leftover of the level's own
// starting sand instead of losing to it — see that constant's own comment for
// why. Tested against the solver rather than the renderer — the swept grains
// still have to travel through the engine's own clear-and-spray animation to
// actually disappear on screen, but that reuses machinery `resolveShot`'s
// `removed` array already drives for an ordinary hit; nothing new for the
// engine to get wrong once the rule itself hands it the right cells.

import assert from "node:assert/strict";
import test from "node:test";
import { createSandGameState, resolveShot } from "../app/game/sand-rules.ts";
import { RADIUS_GAMEPLAY } from "../app/game/sand-types.ts";
import type { SandLevelConfig } from "../app/game/sand-types.ts";

function level(overrides: Partial<SandLevelConfig> = {}): SandLevelConfig {
  return {
    ...RADIUS_GAMEPLAY,
    id: 999,
    name: "leniency fixture",
    // One 50-cell row: cell x has straight-line distance x from x=0, so a
    // shot at x=0 with a given radius reaches an exact, easy-to-predict
    // count of cells — precise enough to sit right on the 2% line on purpose.
    frame: { width: 50, height: 1 },
    rows: ["Y".repeat(50)],
    ammoQueue: ["yellow"],
    sortRadius: 1.5,
    shotLimit: 1,
    pixelScale: 1,
    ...overrides,
  };
}

test("a last shot that leaves exactly 2% of the picture behind still wins", () => {
  // Radius 48 (+ SORT_RADIUS_FORGIVENESS) reaches x=0..48 (49 cells) from
  // x=0, leaving only x=49 — 1 of 50 starting cells, exactly the 2% ceiling.
  const state = createSandGameState(level({ sortRadius: 48, shotLimit: 1 }));
  const resolution = resolveShot(level({ sortRadius: 48, shotLimit: 1 }), state, { bodyId: state.bodies[0].id, x: 0, y: 0 });
  assert.equal(resolution.outcome, "SORTED");
  assert.equal(resolution.state.result?.kind, "WIN");
  assert.equal(resolution.state.phase, "WIN");
  assert.equal(resolution.state.remainingCells, 0, "the leftover grain is swept away, not left sitting there won anyway");
  assert.equal(resolution.state.bodies.length, 0);
  // The swept grain travels through the same clear beat as the 49 the shot
  // actually hit — the engine has nothing new to build to show it vanishing.
  assert.equal(resolution.removed.length, 50, "49 hit + 1 forgiven leftover");
});

test("a last shot that leaves more than 2% behind still loses", () => {
  // Radius 44 (+ forgiveness) reaches x=0..44 (45 cells), leaving x=45..49
  // (5 cells) — 10% of the starting 50, well past the leniency ceiling.
  const state = createSandGameState(level({ sortRadius: 44, shotLimit: 1 }));
  const resolution = resolveShot(level({ sortRadius: 44, shotLimit: 1 }), state, { bodyId: state.bodies[0].id, x: 0, y: 0 });
  assert.equal(resolution.outcome, "SORTED");
  assert.equal(resolution.state.result?.kind, "FAIL");
  assert.equal(resolution.state.remainingCells, 5);
});

test("leniency needs a landed hit — a whiffed last shot with the same tiny leftover still loses", () => {
  // Shot 1 (radius 48) clears x=0..48, leaving the same 1-of-50 (2%) leftover
  // the first test forgives. Shot 2 is the level's last bullet (shotLimit 2)
  // and is aimed at empty space far outside the frame — a clean miss, not a
  // hit that happens to fall short. The engine's own miss animation (a shake,
  // not a clear beat) has nowhere to fold a forgiven grain into, so this
  // stays a loss on purpose rather than winning on a shot that hit nothing.
  const built = level({ sortRadius: 48, shotLimit: 2 });
  let state = createSandGameState(built);
  const first = resolveShot(built, state, { bodyId: state.bodies[0].id, x: 0, y: 0 });
  assert.equal(first.outcome, "SORTED");
  assert.equal(first.state.remainingCells, 1);
  assert.equal(first.state.result, null, "one shot left — the run isn't over yet");
  state = first.state;

  const second = resolveShot(built, state, { bodyId: null, x: 500, y: 500 });
  assert.equal(second.outcome, "NO_MATCH");
  assert.equal(second.state.remainingCells, 1, "the miss does not touch the board");
  assert.equal(second.state.result?.kind, "FAIL");
});
