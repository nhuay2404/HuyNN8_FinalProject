// Wall Obstacle: a permanent, colourless hole in the board. Authored as `W`
// in the picture, tested against the solver rather than the renderer — see
// `sand-mechanics.test.ts`'s own header comment for why that is enough.

import assert from "node:assert/strict";
import test from "node:test";
import {
  cellKey,
  createSandGameState,
  parseSandLevel,
  resolveShot,
  runGrainSettle,
} from "../app/game/sand-rules.ts";
import { RADIUS_GAMEPLAY } from "../app/game/sand-types.ts";
import type { SandLevelConfig } from "../app/game/sand-types.ts";

function level(rows: string[], overrides: Partial<SandLevelConfig> = {}): SandLevelConfig {
  return {
    ...RADIUS_GAMEPLAY,
    id: 999,
    name: "wall fixture",
    frame: { width: rows[0].length, height: rows.length },
    rows,
    ammoQueue: ["yellow"],
    sortRadius: 1.5,
    shotLimit: 20,
    pixelScale: 1,
    ...overrides,
  };
}

test("a `W` cell parses as a wall, not sand, and never trips the palette check", () => {
  const { bodies, walls, issues } = parseSandLevel(level([
    "...",
    ".W.",
    ".Y.",
  ]));
  assert.deepEqual(issues, []);
  assert.equal(bodies.length, 1, "only the yellow cell is a body");
  assert.equal(bodies[0].cells.length, 1);
  assert.deepEqual(walls, [{ x: 1, y: 1 }]);
});

test("a wall never counts toward remainingCells — it is not sand and can never be cleared", () => {
  const state = createSandGameState(level([
    "...",
    ".W.",
    ".Y.",
  ]));
  assert.equal(state.remainingCells, 1, "only the one yellow cell counts");
  assert.deepEqual(state.walls, [{ x: 1, y: 1 }]);
});

test("sand rests on top of a wall instead of falling through to the floor", () => {
  // The wall spans the full width at y=2, same as `DEFAULT_LEVEL_PICTURE`'s
  // own full-width rows (sand-levels.ts) — a lone one-cell-wide wall would
  // let the grain erode diagonally off its edge instead of resting flat, the
  // same taper-stability rule every hand-authored picture already respects
  // (see that file's own comment on `SECOND_LEVEL_PICTURE`).
  const picture = level([
    ".Y.",
    "...",
    "WWW",
    "...",
    "...",
  ]);
  const { bodies, walls } = parseSandLevel(picture);
  const settled = runGrainSettle(bodies, picture.frame, { walls });

  const grid = new Set(settled.bodies.flatMap((body) => body.cells).map((cell) => cellKey(cell.x, cell.y)));
  assert.ok(grid.has("1,3"), "the grain lands directly on top of the wall, not on the true floor");
  assert.ok(!grid.has("1,0"), "the wall stopped it well short of the floor");
  assert.deepEqual(settled.walls, walls, "the wall itself never moves");
});

test("a wall is never in reach of the radius disc — only matching sand is ever taken", () => {
  // The wall sits between the aim point and nothing else; the yellow grain is
  // close enough that a generous radius would reach it too.
  const lvl = level([
    "Y..",
    ".W.",
    "...",
  ], { sortRadius: 2 });
  const state = createSandGameState(lvl);
  const resolution = resolveShot(lvl, state, { bodyId: null, x: 1, y: 1 });

  assert.equal(resolution.outcome, "SORTED", "the disc still reached the yellow grain from the wall's cell");
  assert.deepEqual(resolution.removed, [{ x: 0, y: 2 }]);
  // The wall was never a candidate to begin with — `removed` holds only sand,
  // and the wall cell is untouched in the resulting state.
  assert.deepEqual(resolution.state.walls, [{ x: 1, y: 1 }]);
});

test("walls carry through a shot unchanged, whatever the sand around them does", () => {
  const lvl = level([
    "YY.",
    ".W.",
    "...",
  ], { sortRadius: 3 });
  const state = createSandGameState(lvl);
  const resolution = resolveShot(lvl, state, { bodyId: null, x: 0, y: 2 });
  assert.equal(resolution.outcome, "SORTED");
  assert.deepEqual(resolution.state.walls, [{ x: 1, y: 1 }]);
});
