// A key hidden behind sand (`SandLevelConfig.hiddenKeyRows`): invisible as a
// real, physics-participating key until every one of its own cells is clear
// of covering sand — same all-or-nothing moment `hiddenFreezeRows` reveals
// its own trigger on. Tested against the solver rather than the renderer,
// same reasoning as sand-mechanics.test.ts (the renderer's own cell-by-cell
// "peek" is a pure visual tease with no gameplay effect to assert on here).

import assert from "node:assert/strict";
import test from "node:test";
import { RADIUS_GAMEPLAY, type SandLevelConfig } from "../app/game/sand-types.ts";
import { createSandGameState, resolveShot } from "../app/game/sand-rules.ts";

// A brown 2-cell plug (rows index 2, y=7) sits directly over a hidden 2-cell
// key on the second grid — same cells, same shape. Clearing just one of the
// two plug cells must not reveal the key; only clearing both does. Below it,
// a locked purple slab (rows index 3, y=6) the key opens once it is real and
// falls onto it.
const ROWS = [
  "......",
  "......",
  "..NN..",
  "pppppp",
  "BBBBBB",
  "BBBBBB",
  "BBBBBB",
  "BBBBBB",
  "BBBBBB",
  "BBBBBB",
];
const HIDDEN_KEY_ROWS = [
  "......",
  "......",
  "..KK..",
  "......",
  "......",
  "......",
  "......",
  "......",
  "......",
  "......",
];

const level: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,
  id: 9001,
  name: "Hidden Key Fixture",
  frame: { width: 6, height: 10 },
  rows: ROWS,
  hiddenKeyRows: HIDDEN_KEY_ROWS,
  ammoQueue: ["brown", "purple", "blue"],
  // Small enough that a shot centred on one plug cell does not also reach
  // its neighbour — each of the two plug cells needs its own shot.
  sortRadius: 0.6,
  shotLimit: 20,
  pixelScale: 1,
};

function withLoaded(state: ReturnType<typeof createSandGameState>, color: "brown" | "purple" | "blue") {
  return { ...state, queue: [color, ...state.queue.slice(1)] };
}

test("a key hidden behind sand stays hidden until every one of its cells clears, not just some", () => {
  let state = createSandGameState(level);
  assert.equal(state.keys.length, 0, "no real key yet — it starts entirely hidden");
  assert.equal(state.hiddenKeys.length, 1, "one hidden key, the whole 2-cell shape as one group");

  // Clear only the left plug cell (x=2, y=7) — half the key's own footprint.
  state = withLoaded(state, "brown");
  const afterFirst = resolveShot(level, state, { bodyId: "brown-2-7", x: 2, y: 7 });
  assert.equal(afterFirst.outcome, "SORTED");
  state = afterFirst.state;
  assert.equal(state.keys.length, 0, "still not revealed — only half its footprint is clear");
  assert.equal(state.hiddenKeys.length, 1, "still hidden");

  // Clear the remaining plug cell (x=3, y=7) — now the whole footprint is clear.
  state = withLoaded(state, "brown");
  const afterSecond = resolveShot(level, state, { bodyId: "brown-3-7", x: 3, y: 7 });
  assert.equal(afterSecond.outcome, "SORTED");
  state = afterSecond.state;
  assert.equal(state.hiddenKeys.length, 0, "fully uncovered now — no longer hidden");
  assert.equal(state.keys.length, 1, "revealed into a real key");

  // From here on it is an ordinary key: it was revealed already touching the
  // locked slab (row 2 sits right above row 3's slab), so the next settle —
  // triggered here by an unrelated real shot into the blue floor, the same
  // way any other shot would — is what actually runs `unlockPass` on it for
  // the first time and opens the slab, exactly as a key authored visible
  // would.
  state = withLoaded(state, "blue");
  const afterThird = resolveShot(level, state, { bodyId: "blue-0-5", x: 0, y: 5 });
  assert.equal(afterThird.outcome, "SORTED");
  state = afterThird.state;
  assert.equal(state.locked.length, 0, "the revealed key opened the slab like any other key");
});
