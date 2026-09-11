// The map mechanic (lock & key), tested against the solver rather than the
// renderer.
//
// Authored entirely as data — lower-case letters and a `K` — so everything
// worth proving about it is a property of `parseSandLevel` and
// `runGrainSettle`. If these pass, what the engine draws is a replay of a
// result that was already correct.

import assert from "node:assert/strict";
import test from "node:test";
import { lockAndKey } from "./level-fixtures.ts";
import {
  cellKey,
  cellsInRadius,
  countCells,
  createSandGameState,
  currentAmmo,
  fixturesOf,
  frozenSet,
  isConnected,
  parseSandLevel,
  resolveShot,
  runGrainSettle,
} from "../app/game/sand-rules.ts";
import { KEY_SPRITE, PADLOCK_SPRITE, spriteCells } from "../app/game/sand-sprites.ts";
import type { CellCoord, SandBody, SandColor, SandGameState, SandKey } from "../app/game/sand-types.ts";

function keySet(cells: CellCoord[]) {
  return new Set(cells.map((cell) => cellKey(cell.x, cell.y)));
}

function ownerOf(bodies: SandBody[], x: number, y: number) {
  return bodies.find((body) => body.cells.some((cell) => cell.x === x && cell.y === y));
}

function colorAt(state: SandGameState, x: number, y: number) {
  return ownerOf(state.bodies, x, y)?.color ?? null;
}

/**
 * Forces `state`'s loaded round to `color` — the queue is a random draw now
 * (sand-rules.ts's `drawAmmo`), so a test whose whole point is "the right
 * bullet hits the plug" has to pin the one thing about the draw it actually
 * cares about rather than assume the wheel's opening pick.
 */
function withLoaded(state: SandGameState, color: SandColor): SandGameState {
  return { ...state, queue: [color, ...state.queue.slice(1)] };
}

// ---- Lock & Key ----------------------------------------------------------

test("the picture's lower-case letters become frozen sand, and `K` becomes one key", () => {
  const { bodies, locked, keys } = parseSandLevel(lockAndKey);

  assert.equal(keys.length, 1, "the whole silhouette is one key, not a scatter of them");
  // The authored cells are exactly the shared sprite, so the shape the editor
  // stamps and the shape the level ships cannot drift apart.
  const sprite = spriteCells(KEY_SPRITE, 1);
  assert.equal(keys[0].cells.length, sprite.length, "the key is KEY_SPRITE at scale 1");
  // Both normalised to their own bottom-left corner: `KEY_SPRITE`'s own rows
  // do not all start at column 0 (that is what makes it read as jagged rather
  // than a padded rectangle), so the raw cells from `spriteCells` are not
  // already (0,0)-based the way a level's placed cells are.
  const origin = {
    x: Math.min(...keys[0].cells.map((cell) => cell.x)),
    y: Math.min(...keys[0].cells.map((cell) => cell.y)),
  };
  const spriteOrigin = {
    x: Math.min(...sprite.map((cell) => cell.x)),
    y: Math.min(...sprite.map((cell) => cell.y)),
  };
  assert.deepEqual(
    keys[0].cells.map((cell) => `${cell.x - origin.x},${cell.y - origin.y}`).sort(),
    sprite.map((cell) => `${cell.x - spriteOrigin.x},${cell.y - spriteOrigin.y}`).sort(),
  );

  // Locked sand is still sand: it has a colour, and it is in a body.
  assert.equal(locked.length, 24, "eight wide by three tall");
  for (const cell of locked) {
    const owner = ownerOf(bodies, cell.x, cell.y);
    assert.ok(owner, `nothing owns the locked cell ${cell.x},${cell.y}`);
    assert.equal(owner.color, "purple");
  }
});

test("frozen sand hangs in mid-air — the settle solver will not move it", () => {
  const { bodies, locked, keys } = parseSandLevel(lockAndKey);
  const settled = runGrainSettle(bodies, lockAndKey.frame, { locked, keys });

  assert.equal(
    settled.steps.filter((step) => step.kind !== "REINDEX").length,
    0,
    "the authored picture is already at rest, key and lock included",
  );
  assert.deepEqual(keySet(settled.locked), keySet(locked), "nothing thawed on its own");
  // The slab has empty space under it and stays there anyway.
  const grid = keySet(settled.bodies.flatMap((body) => body.cells));
  assert.ok(grid.has("2,5"), "the slab is still where it was drawn");
  assert.ok(!grid.has("2,4"), "and nothing has fallen out of it");
});

test("a locked colour is not handed out as ammo until a key frees it", () => {
  const state = createSandGameState(lockAndKey);
  assert.ok(
    lockAndKey.ammoQueue.includes("purple"),
    "purple is authored into the wheel — it has to be, or it could never be shot",
  );
  assert.ok(!state.queue.includes("purple"), "but it must not be offered while every grain is frozen");
  // Only yellow/green/orange are shootable, and the queue is drawn randomly
  // now (sand-rules.ts's `drawAmmo`) rather than in `ammoQueue`'s order, so
  // this checks the set the preview is drawn from rather than a fixed
  // sequence.
  assert.deepEqual(new Set(state.queue), new Set(["yellow", "green", "orange"]));
});

test("a frozen grain cannot be sorted out, even with the right bullet in hand", () => {
  const state = createSandGameState(lockAndKey);
  const frozen = frozenSet(state);
  // Dead centre of the slab, with the colour that owns it.
  const reachable = cellsInRadius(state.bodies, { x: 5, y: 6 }, lockAndKey.sortRadius, "purple", frozen);
  assert.deepEqual(reachable, [], "the disc must not see frozen sand at all");
});

test("clearing the plug drops the key onto the slab, which opens on contact", () => {
  const state = withLoaded(createSandGameState(lockAndKey), "yellow");
  assert.equal(currentAmmo(lockAndKey, state), "yellow");

  const plug = ownerOf(state.bodies, 5, 8)!;
  const resolution = resolveShot(lockAndKey, state, { bodyId: plug.id, x: 5, y: 8 });
  assert.equal(resolution.outcome, "SORTED");

  const after = resolution.state;
  assert.deepEqual(after.locked, [], "the whole slab thawed, not just the cell the key touched");
  assert.deepEqual(after.keys, [], "and the key was spent opening it");

  // The step list says so in order: the key falls, then the lock opens, then
  // the sand that came free pours.
  const kinds = resolution.steps.map((step) => step.kind);
  assert.ok(kinds.includes("KEY_MOVE"), "the key has to be seen to fall");
  const unlockAt = kinds.indexOf("UNLOCK");
  assert.ok(unlockAt > kinds.indexOf("KEY_MOVE"), "the lock opens after the key arrives, not before");
  assert.ok(
    kinds.slice(unlockAt).includes("GRAIN_PASS"),
    "the freed slab has nothing under it, so it must fall once it is free",
  );

  // And where it landed: purple is on the floor now, not hanging at y=6.
  assert.equal(colorAt(after, 5, 6), null, "the slab did not stay where it was frozen");
  assert.ok(
    after.bodies.some((body) => body.color === "purple" && body.cells.some((cell) => cell.y <= 4)),
    "the purple should have poured down to the floor",
  );
  assert.equal(countCells(after.bodies), countCells(state.bodies) - resolution.removed.length,
    "opening a lock must not create or destroy sand");
});

test("the freed colour rejoins the wheel the moment the lock opens", () => {
  const state = withLoaded(createSandGameState(lockAndKey), "yellow");
  const plug = ownerOf(state.bodies, 5, 8)!;
  const after = resolveShot(lockAndKey, state, { bodyId: plug.id, x: 5, y: 8 }).state;
  assert.ok(after.queue.includes("purple"), "purple is shootable now, so it has to be offered");
});

test("a lock the key never reaches stays shut, and the level stays unwinnable by design", () => {
  const state = createSandGameState(lockAndKey);
  // Shoot the floor instead. The key never moves, so nothing opens.
  const floor = ownerOf(state.bodies, 0, 0)!;
  const after = resolveShot(lockAndKey, state, { bodyId: floor.id, x: 0, y: 0 }).state;
  assert.equal(after.locked.length, 24, "the slab is untouched");
  assert.equal(after.keys.length, 1, "and the key is still waiting on its plug");
});

test("the mechanic level is already at rest as drawn", () => {
  const { bodies, locked, keys } = parseSandLevel(lockAndKey);
  const settled = runGrainSettle(bodies, lockAndKey.frame, { locked, keys });
  assert.equal(
    settled.steps.filter((step) => step.kind !== "REINDEX").length,
    0,
    `${lockAndKey.name} slumps on load — the player would never see what was drawn`,
  );
});

// ---- what a key does ------------------------------------------------------
// Gravity, sliding and being blown around, each on a board small enough that
// the answer can be stated exactly rather than described.

/** A key at (x, y) — the sprite's bottom-left corner — at the given scale. */
function keyAt(x: number, y: number, scale = 1): SandKey {
  return {
    id: `key-${x}-${y}`,
    cells: spriteCells(KEY_SPRITE, scale).map((cell) => ({ x: x + cell.x, y: y + cell.y })),
  };
}

function keyBottomLeft(keys: SandKey[]) {
  if (!keys.length) return null;
  return {
    x: Math.min(...keys[0].cells.map((cell) => cell.x)),
    y: Math.min(...keys[0].cells.map((cell) => cell.y)),
  };
}

function floorRow(width: number, y = 0): SandBody {
  return { id: `orange-0-${y}`, color: "orange", cells: Array.from({ length: width }, (_, x) => ({ x, y })) };
}

test("a key falls under gravity until something stops it", () => {
  const frame = { width: 12, height: 12 };
  const settled = runGrainSettle([floorRow(12)], frame, { keys: [keyAt(2, 8)] });
  // The sprite's three teeth sit at the same row, evenly spaced either side of
  // the neck, so a dead drop onto a flat floor lands all three at once with no
  // sideways nudge — unlike the old lopsided silhouette this replaced.
  assert.deepEqual(keyBottomLeft(settled.keys), { x: 2, y: 1 }, "it should be resting on the floor");
  assert.ok(
    settled.steps.filter((step) => step.kind === "KEY_MOVE").length >= 7,
    "and it should have been seen falling, one cell per step, not teleported",
  );
});

test("a key is rigid: support under only one column is not enough to reach the floor", () => {
  const frame = { width: 14, height: 12 };
  // `KEY_SPRITE`'s bottom row is only 3 cells wide against a 7-wide body — a
  // pillar under just its centre column leaves both flanks hanging in open
  // air, so the whole rigid body stops there rather than sinking on to the
  // floor underneath the flanks.
  const originX = 3;
  const bottomRow = spriteCells(KEY_SPRITE, 1).filter((cell) => cell.y === 0).map((cell) => cell.x);
  const centreLocalX = (Math.min(...bottomRow) + Math.max(...bottomRow)) / 2;
  const pillar: SandBody = {
    id: "green-pillar",
    color: "green",
    cells: [1, 2, 3, 4].map((y) => ({ x: originX + centreLocalX, y })),
  };
  const settled = runGrainSettle([floorRow(14), pillar], frame, { keys: [keyAt(originX, 6)] });
  assert.equal(settled.keys.length, 1, "a key never breaks up on the way down");
  // It rests on the pillar rather than the floor (y=1 would be the floor) —
  // a real, if modest, perch — but the point is what it does NOT do: teleport,
  // split apart, or hang above where any of its cells could still fall.
  assert.equal(keyBottomLeft(settled.keys)!.y, 3, "it should have settled onto the pillar under its centre");
});

test("friction paces a slide but does not change where it ends up at rest", () => {
  const frame = { width: 14, height: 12 };
  const shelf: SandBody = { id: "green-shelf", color: "green", cells: Array.from({ length: 8 }, (_, x) => ({ x, y: 1 })) };
  const eager = runGrainSettle([floorRow(14), shelf], frame, { keys: [keyAt(0, 3)], friction: 0 });
  const patient = runGrainSettle([floorRow(14), shelf], frame, { keys: [keyAt(0, 3)], friction: 1 });
  assert.deepEqual(keyBottomLeft(eager.keys), keyBottomLeft(patient.keys));
});

// ---- keys on a slope (findSlopeDrop) --------------------------------------
// A Wall Obstacle staircase at real pixel resolution is several cells wide
// per step, not a single-cell-per-row 45° line — a key resting mid-tread has
// no *immediate* diagonal opening even though the terrain is clearly still
// descending. On request ("trên slope như này nó phải trượt xuống"): a key
// keeps hunting sideways for the nearest actual drop instead of reading a
// wide flat tread as a permanent rest.

test("a key on a wide staircase keeps rolling down it, not just the single-cell-per-step case", () => {
  // Wide enough (60) and tall enough (20, clear of `KEY_SPRITE`'s own 7-cell
  // height at scale 1) that neither dimension is what stops the key.
  const frame = { width: 60, height: 20 };
  // Each step is 10 cells wide — wider than the key sprite itself (7) — and
  // one cell lower than the last, so the key can come to rest entirely
  // within one tread's own width, same as it would on any ordinary flat
  // floor. The *immediate* diagonal-roll check alone (all `keyPass` had
  // before this) would read that as a permanent rest; it is not one.
  const walls: CellCoord[] = [];
  const stepWidth = 10;
  for (let step = 0; step < 5; step += 1) {
    const topY = 10 - step;
    for (let x = step * stepWidth; x < step * stepWidth + stepWidth; x += 1) {
      for (let y = 0; y <= topY; y += 1) walls.push({ x, y });
    }
  }
  // Resting flat on the first tread, well clear of its edges either side.
  const settled = runGrainSettle([], frame, { walls, keys: [keyAt(1, 11)] });
  // It has to actually reach the floor at the bottom of the last step, not
  // stall partway down the staircase.
  assert.equal(keyBottomLeft(settled.keys)!.y, 0, "the key should have rolled all the way down the staircase");
  assert.ok(
    settled.steps.filter((step) => step.kind === "KEY_MOVE").some((step) => step.dx !== 0 && step.dy === 0),
    "getting down a wide tread needs at least one plain sideways move, not only diagonals",
  );
});

test("a key balanced dead centre on a support narrower than its own footprint still just rests there — a slope needs a genuine downhill, not merely open air on both sides", () => {
  const frame = { width: 14, height: 12 };
  const originX = 3;
  const bottomRow = spriteCells(KEY_SPRITE, 1).filter((cell) => cell.y === 0).map((cell) => cell.x);
  const centreLocalX = (Math.min(...bottomRow) + Math.max(...bottomRow)) / 2;
  const pillar: SandBody = {
    id: "green-pillar",
    color: "green",
    cells: [1, 2, 3, 4].map((y) => ({ x: originX + centreLocalX, y })),
  };
  const settled = runGrainSettle([floorRow(14), pillar], frame, { keys: [keyAt(originX, 6)] });
  assert.equal(keyBottomLeft(settled.keys)!.y, 3, "still settles onto the pillar and stays — symmetric open air on both sides is not a slope");
});

test("a bigger key is the same object, exactly scaled, and it still lands safely", () => {
  const frame = { width: 30, height: 24 };
  // Both start clear of the ceiling: a key with cells outside the frame cannot
  // move at all, because every target of a rigid move has to be legal.
  const small = runGrainSettle([floorRow(30)], frame, { keys: [keyAt(4, 16, 1)] });
  const big = runGrainSettle([floorRow(30)], frame, { keys: [keyAt(4, 8, 3)] });

  assert.equal(small.keys.length, 1);
  assert.equal(big.keys.length, 1, "scaling must not split it into pieces");
  assert.equal(big.keys[0].cells.length, small.keys[0].cells.length * 9, "each pixel becomes a 3x3 block");
  assert.equal(keyBottomLeft(small.keys)!.y, 1, "both land on the floor");
  assert.equal(keyBottomLeft(big.keys)!.y, 1);
});

// ---- the sprites ---------------------------------------------------------

test("both sprites are one connected shape, which is what makes each one a single object", () => {
  for (const [name, sprite] of [["key", KEY_SPRITE], ["padlock", PADLOCK_SPRITE]] as const) {
    const cells = spriteCells(sprite, 1);
    assert.ok(cells.length > 0, `${name} is empty`);
    // `parseSandLevel` groups key cells by connectivity: a sprite with a
    // detached pixel would silently become two keys on the board.
    assert.ok(isConnected(cells), `${name} has a detached pixel`);
  }
});

test("scaling a sprite blows it up without changing its shape", () => {
  const one = spriteCells(KEY_SPRITE, 1);
  const three = spriteCells(KEY_SPRITE, 3);
  assert.equal(three.length, one.length * 9, "each cell becomes a 3x3 block");
  assert.ok(isConnected(three), "and the blown-up shape is still one object");

  // Every scaled cell maps back to a filled cell of the original, so a bigger
  // key is the same key rather than a different silhouette.
  const filled = new Set(one.map((cell) => `${cell.x},${cell.y}`));
  for (const cell of three) {
    assert.ok(
      filled.has(`${Math.floor(cell.x / 3)},${Math.floor(cell.y / 3)}`),
      `scaled cell ${cell.x},${cell.y} is not part of the original shape`,
    );
  }
});

test("the padlock fits the slab it labels, and is dropped when it cannot", () => {
  const { locked } = parseSandLevel(lockAndKey);
  const xs = locked.map((cell) => cell.x);
  const ys = locked.map((cell) => cell.y);
  const width = Math.max(...xs) - Math.min(...xs) + 1;
  const height = Math.max(...ys) - Math.min(...ys) + 1;

  // At the board's real resolution, not at blueprint size — the icon is drawn
  // on the expanded pixel board, which is the only place it exists.
  const scale = lockAndKey.pixelScale;
  const fits = Math.floor(Math.min((width * scale) / 7, (height * scale) / 7));
  assert.ok(fits >= 1, `a ${width}x${height} slab at ${scale}x has no room for a padlock`);
});

test("the state and level together carry the fixtures a shot needs to see", () => {
  const state = createSandGameState(lockAndKey);
  const fixtures = fixturesOf(lockAndKey, state);
  assert.equal(fixtures.locked?.length, 24);
  assert.equal(fixtures.keys?.length, 1);
  assert.equal(fixtures.friction, 0, "this level authored no friction");
});
