// The two map mechanics, tested against the solver rather than the renderer.
//
// Both are authored entirely as data — lower-case letters, a `K`, and a `wind`
// block — so everything worth proving about them is a property of
// `parseSandLevel`, `runGrainSettle` and `runWindGust`. If these pass, what the
// engine draws is a replay of a result that was already correct.

import assert from "node:assert/strict";
import test from "node:test";
import { crosswind, lockAndKey } from "../app/game/sand-levels.ts";
import {
  cellKey,
  cellsInRadius,
  countCells,
  createSandGameState,
  currentAmmo,
  expandLevelForPixelBoard,
  fixturesOf,
  frozenSet,
  isConnected,
  parseSandLevel,
  resolveShot,
  resolveWind,
  runGrainSettle,
  runWindGust,
} from "../app/game/sand-rules.ts";
import { KEY_SPRITE, PADLOCK_SPRITE, spriteCells, spriteHeight, spriteWidth } from "../app/game/sand-sprites.ts";
import type { CellCoord, SandBody, SandGameState, SandKey } from "../app/game/sand-types.ts";

function keySet(cells: CellCoord[]) {
  return new Set(cells.map((cell) => cellKey(cell.x, cell.y)));
}

function ownerOf(bodies: SandBody[], x: number, y: number) {
  return bodies.find((body) => body.cells.some((cell) => cell.x === x && cell.y === y));
}

function colorAt(state: SandGameState, x: number, y: number) {
  return ownerOf(state.bodies, x, y)?.color ?? null;
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
  assert.deepEqual(state.queue, ["yellow", "green", "orange"]);
});

test("a frozen grain cannot be sorted out, even with the right bullet in hand", () => {
  const state = createSandGameState(lockAndKey);
  const frozen = frozenSet(state);
  // Dead centre of the slab, with the colour that owns it.
  const reachable = cellsInRadius(state.bodies, { x: 5, y: 6 }, lockAndKey.sortRadius, "purple", frozen);
  assert.deepEqual(reachable, [], "the disc must not see frozen sand at all");
});

test("clearing the plug drops the key onto the slab, which opens on contact", () => {
  const state = createSandGameState(lockAndKey);
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
  const state = createSandGameState(lockAndKey);
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

// ---- Wind ----------------------------------------------------------------

test("a gust carries loose sand downwind and lets it fall again", () => {
  const { bodies } = parseSandLevel(crosswind);
  const before = countCells(bodies);
  const gust = runWindGust(bodies, crosswind.frame, "right", 1);

  assert.ok(gust.steps.some((step) => step.kind === "GRAIN_PASS"), "a gust on this mound has to move something");
  assert.equal(countCells(gust.bodies), before, "wind moves sand, it never adds or removes any");

  // The mound's centre of mass has to have moved with the wind, not against it.
  const centre = (list: SandBody[]) =>
    list.flatMap((body) => body.cells).reduce((sum, cell) => sum + cell.x, 0) / before;
  assert.ok(
    centre(gust.bodies) > centre(bodies),
    "sand blown right must end up further right on average",
  );
});

test("wind is deterministic, and blowing left is the mirror of blowing right", () => {
  const { bodies } = parseSandLevel(crosswind);
  const first = runWindGust(bodies, crosswind.frame, "right", 1);
  const second = runWindGust(bodies, crosswind.frame, "right", 1);
  const shape = (outcome: typeof first) =>
    outcome.bodies.flatMap((body) => body.cells.map((cell) => `${body.color}:${cell.x},${cell.y}`)).sort().join("|");
  assert.equal(shape(first), shape(second), "the same board and the same gust must give the same board");

  const before = bodies.flatMap((body) => body.cells).reduce((sum, cell) => sum + cell.x, 0);
  const left = runWindGust(bodies, crosswind.frame, "left", 1);
  const after = left.bodies.flatMap((body) => body.cells).reduce((sum, cell) => sum + cell.x, 0);
  assert.ok(after < before, "a gust from the right must push sand left");
});

test("frozen sand ignores the weather", () => {
  // No key in this board on purpose: with one, the gust would blow it into the
  // slab and open the lock — which is the mechanic working, not the thing under
  // test here.
  const { bodies, locked } = parseSandLevel(lockAndKey);
  const gust = runWindGust(bodies, lockAndKey.frame, "right", 3, { locked });
  assert.deepEqual(keySet(gust.locked), keySet(locked), "a lock is the one thing wind cannot argue with");
  for (const cell of locked) {
    assert.ok(
      gust.bodies.some((body) => body.cells.some((c) => c.x === cell.x && c.y === cell.y)),
      `the locked cell ${cell.x},${cell.y} was blown out of place`,
    );
  }
});

test("wind can blow a key into a lock, and that opens it like any other arrival", () => {
  const frame = { width: 14, height: 12 };
  // Blown three cells right from x=2, `KEY_SPRITE`'s leftmost tooth (local
  // column 1, from the same bottom row the gravity test reads) lands at
  // absolute column 6 — swap that one floor cell for a locked one, so the
  // same fall that carries the key there also opens it.
  const originX = 2;
  const bottomLocalX = Math.min(...spriteCells(KEY_SPRITE, 1).filter((cell) => cell.y === 0).map((cell) => cell.x));
  const lockColumn = originX + bottomLocalX + 3;
  const floor = floorRow(14).cells.filter((cell) => cell.x !== lockColumn);
  const lock: SandBody = { id: "purple-lock", color: "purple", cells: [{ x: lockColumn, y: 0 }] };
  const gust = runWindGust(
    [{ ...floorRow(14), cells: floor }, lock],
    frame,
    "right",
    3,
    { locked: [{ x: lockColumn, y: 0 }], keys: [keyAt(originX, 6)] },
  );
  assert.deepEqual(gust.locked, [], "the key's tip landed right on the lock, so it opened");
  assert.deepEqual(gust.keys, [], "and the key was spent doing it");
});

test("a gust spends no shot and cannot lose the level", () => {
  const state = createSandGameState(crosswind);
  const blown = resolveWind(crosswind, state, crosswind.wind!.phases[0]);
  assert.equal(blown.state.shotsUsed, 0, "wind is not a turn");
  assert.equal(blown.state.result, null);
  assert.equal(blown.removed.length, 0, "and it sorts nothing out of the frame");
});

test("a level with still air is untouched by the wind rule", () => {
  const state = createSandGameState(lockAndKey);
  assert.ok(!lockAndKey.wind, "this level has no weather at all");
  // Handed a phase it does not own, it still must not invent one for itself:
  // the engine is what decides a level has wind, and it never asks this level.
  assert.equal(lockAndKey.wind, undefined);
});

// ---- the wind loop -------------------------------------------------------

test("the wind loop is a list of phases, and each one is its own weather", () => {
  const phases = crosswind.wind!.phases;
  assert.equal(phases.length, 3, "one phase would be a constant, not a pattern");
  assert.deepEqual(phases.map((phase) => phase.direction), ["right", "left", "right"]);
  for (const phase of phases) {
    assert.ok(phase.durationMs > 0, "a phase that blows for no time is not a phase");
    assert.ok(phase.cooldownMs > 0, "and one with no still air leaves nothing to aim at");
    assert.ok(phase.power >= 1);
  }
});

test("a phase whose zone holds no sand does nothing at all", () => {
  const { bodies } = parseSandLevel(crosswind);
  // Well above the mound. The cleanest proof the rule reads the zone rather
  // than only the direction.
  const nowhere = runWindGust(bodies, crosswind.frame, "right", 2, {}, { x: 0, y: 12, width: 12, height: 2 });
  assert.equal(
    nowhere.steps.filter((step) => step.kind !== "REINDEX").length,
    0,
    "there is no sand that high, so nothing should have happened",
  );
});

test("a zoned phase pushes only the sand inside it", () => {
  // A board small enough to state the whole answer: a floor of orange, and a
  // shelf of yellow on top of it with room to slide right. The real levels are
  // too tall to isolate this on — sand blown along the top of a mound then
  // falls *through* the zone boundary, which is correct and would drown out
  // what is being checked here.
  const frame = { width: 6, height: 3 };
  const floor: SandBody = {
    id: "orange-0-0",
    color: "orange",
    cells: Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })),
  };
  const shelf: SandBody = {
    id: "yellow-0-1",
    color: "yellow",
    cells: Array.from({ length: 4 }, (_, x) => ({ x, y: 1 })),
  };

  const gust = runWindGust([floor, shelf], frame, "right", 1, {}, { x: 0, y: 1, width: 6, height: 1 });
  const at = (y: number) => gust.bodies.flatMap((body) => body.cells)
    .filter((cell) => cell.y === y).map((cell) => cell.x).sort((a, b) => a - b);

  assert.deepEqual(at(1), [1, 2, 3, 4], "the shelf inside the zone slid one cell downwind");
  assert.deepEqual(at(0), [0, 1, 2, 3, 4, 5], "the floor below the zone did not move");
});

test("a phase with no zone reaches the whole frame", () => {
  const { bodies } = parseSandLevel(crosswind);
  const everywhere = runWindGust(bodies, crosswind.frame, "right", 1, {}, null);
  const wholeFrame = runWindGust(bodies, crosswind.frame, "right", 1, {}, {
    x: 0, y: 0, width: crosswind.frame.width, height: crosswind.frame.height,
  });
  const shape = (outcome: typeof everywhere) =>
    outcome.bodies.flatMap((body) => body.cells.map((cell) => `${body.color}:${cell.x},${cell.y}`)).sort().join("|");
  assert.equal(shape(everywhere), shape(wholeFrame), "`null` and a frame-sized zone are the same thing");
});

test("power is how far one gust carries, and it scales with the board", () => {
  const { bodies } = parseSandLevel(crosswind);
  const centre = (list: SandBody[]) => {
    const cells = list.flatMap((body) => body.cells);
    return cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
  };
  const soft = centre(runWindGust(bodies, crosswind.frame, "right", 1).bodies);
  const hard = centre(runWindGust(bodies, crosswind.frame, "right", 3).bodies);
  assert.ok(hard > soft, "more power has to carry sand further, not just differently");

  // Authored in blueprint cells, so expansion has to scale both power and zone
  // or a gust would reach a different fraction of the picture at 5x.
  const expanded = expandLevelForPixelBoard(crosswind);
  const authoredZone = crosswind.wind!.phases[1].zone!;
  const scaledZone = expanded.wind!.phases[1].zone!;
  assert.equal(expanded.wind!.phases[1].power, crosswind.wind!.phases[1].power * crosswind.pixelScale);
  assert.equal(scaledZone.y, authoredZone.y * crosswind.pixelScale);
  assert.equal(scaledZone.height, authoredZone.height * crosswind.pixelScale);
  assert.equal(
    expanded.wind!.phases[1].durationMs,
    crosswind.wind!.phases[1].durationMs,
    "durations are real time and must NOT be scaled with the board",
  );
});

test("both mechanic levels are already at rest as drawn", () => {
  for (const level of [lockAndKey, crosswind]) {
    const { bodies, locked, keys } = parseSandLevel(level);
    const settled = runGrainSettle(bodies, level.frame, { locked, keys });
    assert.equal(
      settled.steps.filter((step) => step.kind !== "REINDEX").length,
      0,
      `${level.name} slumps on load — the player would never see what was drawn`,
    );
  }
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

test("a key is rigid: support under only one of its legs is not enough to hold it", () => {
  const frame = { width: 14, height: 12 };
  // `KEY_SPRITE`'s bottom row is three separate legs with gaps between them —
  // a pillar under just the leftmost one leaves the rest of the shape hanging
  // in open air, so the whole rigid body has to keep falling.
  const originX = 3;
  const bottomLocalX = Math.min(...spriteCells(KEY_SPRITE, 1).filter((cell) => cell.y === 0).map((cell) => cell.x));
  const pillar: SandBody = {
    id: "green-pillar",
    color: "green",
    cells: [1, 2, 3, 4].map((y) => ({ x: originX + bottomLocalX, y })),
  };
  const settled = runGrainSettle([floorRow(14), pillar], frame, { keys: [keyAt(originX, 6)] });
  assert.equal(settled.keys.length, 1, "a key never breaks up on the way down");
  // It rests on the pillar rather than the floor (y=1 would be the floor) —
  // a real, if modest, perch — but the point is what it does NOT do: teleport,
  // split apart, or hang above where any of its cells could still fall.
  assert.equal(keyBottomLeft(settled.keys)!.y, 2, "it should have settled onto the one leg the pillar caught");
});

test("wind carries a key across the frame, and gravity still applies to it", () => {
  const frame = { width: 16, height: 12 };
  const gust = runWindGust([floorRow(16)], frame, "right", 3, { keys: [keyAt(2, 6)] });
  const landed = keyBottomLeft(gust.keys)!;
  // Three cells of power, then a straight drop — the gravity test above shows
  // this sprite needs no settle drift of its own, so the gust is the only
  // horizontal move here.
  assert.equal(landed.x, 5, "power carried it downwind, and gravity settled it the rest of the way");
  assert.equal(landed.y, 1, "and it fell to the floor in the same resolution");
});

test("friction resists a key being blown, without preventing it entirely", () => {
  const frame = { width: 16, height: 12 };
  const loose = runWindGust([floorRow(16)], frame, "right", 3, { keys: [keyAt(2, 6)], friction: 0 });
  const sticky = runWindGust([floorRow(16)], frame, "right", 3, { keys: [keyAt(2, 6)], friction: 1 });
  const looseX = keyBottomLeft(loose.keys)!.x;
  const stickyX = keyBottomLeft(sticky.keys)!.x;
  assert.ok(stickyX < looseX, "more friction has to carry the key less far in the same gust");
  assert.equal(loose.keys.length, 1, "friction never breaks a key apart");
  assert.equal(sticky.keys.length, 1);
});

test("friction paces a slide but does not change where it ends up at rest", () => {
  const frame = { width: 14, height: 12 };
  const shelf: SandBody = { id: "green-shelf", color: "green", cells: Array.from({ length: 8 }, (_, x) => ({ x, y: 1 })) };
  const eager = runGrainSettle([floorRow(14), shelf], frame, { keys: [keyAt(0, 3)], friction: 0 });
  const patient = runGrainSettle([floorRow(14), shelf], frame, { keys: [keyAt(0, 3)], friction: 1 });
  assert.deepEqual(keyBottomLeft(eager.keys), keyBottomLeft(patient.keys));
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
