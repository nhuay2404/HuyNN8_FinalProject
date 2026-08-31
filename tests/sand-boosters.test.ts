// Radius Overcharge and Prism Shot, tested at the sand-rules layer — see
// booster-radius-prism-spec.md. Both are folded into `resolveShot` through
// one extra argument, so what a boosted shot actually takes is provable the
// same way an ordinary shot is: build the oracle with `cellsInRadius`
// directly, then check `resolveShot` agrees with it exactly.

import assert from "node:assert/strict";
import test from "node:test";
import { __resetWalletForTests } from "../app/game/economy.ts";
import { lockAndKey, sandBloom } from "../design/levels/sand-levels.ts";
import {
  cellKey,
  cellsInRadius,
  createSandGameState,
  currentAmmo,
  effectiveSortRadius,
  expandLevelForPixelBoard,
  frozenSet,
  getBoosterCharges,
  parseSandLevel,
  resolveShot,
  spendBoosterCharge,
} from "../app/game/sand-rules.ts";
import { RADIUS_GAMEPLAY } from "../app/game/sand-types.ts";
import type { SandBody, SandColor, SandLevelConfig } from "../app/game/sand-types.ts";

const LEVEL = expandLevelForPixelBoard(sandBloom);

function ownerOf(bodies: SandBody[], x: number, y: number) {
  return bodies.find((body) => body.cells.some((cell) => cell.x === x && cell.y === y));
}

/** Aim the disc that takes the most of the bullet in hand — same model as
 * `bestShot` in sand-radius.test.ts, kept local so this file has no
 * dependency on that one's internals. */
function bestShot(bodies: SandBody[], radius: number, color: SandColor) {
  let best: { x: number; y: number; take: number } | null = null;
  for (const body of bodies) {
    for (const cell of body.cells) {
      const take = cellsInRadius(bodies, cell, radius, color).length;
      if (take > 0 && (!best || take > best.take)) best = { x: cell.x, y: cell.y, take };
    }
  }
  return best;
}

// ---- cellsInRadius: matchColor ------------------------------------------

test("matchColor: false takes every colour in the disc, and still skips frozen sand", () => {
  const { bodies, locked } = parseSandLevel(lockAndKey);
  const frozen = new Set(locked.map((cell) => cellKey(cell.x, cell.y)));
  // Centred on the lock itself: whatever a real shot would aim at first, since
  // that is exactly where loose sand of several colours and frozen sand both
  // sit close together.
  const center = { x: locked[0].x, y: locked[0].y };
  const radius = lockAndKey.sortRadius;

  const prism = cellsInRadius(bodies, center, radius, "red" /* ignored under matchColor: false */, frozen, {
    matchColor: false,
  });
  assert.ok(prism.length > 0, "the disc around the lock should still find loose sand of some colour");

  const colors = new Set(
    prism.map((cell) => ownerOf(bodies, cell.x, cell.y)!.color),
  );
  assert.ok(colors.size >= 1);
  // Every cell taken really is inside the disc, isn't frozen, and every loose
  // cell of every colour inside the disc was taken — the same two-way check
  // sand-radius.test.ts runs for a same-colour disc, just without the colour
  // filter on either side.
  const takenKeys = new Set(prism.map((cell) => cellKey(cell.x, cell.y)));
  for (const cell of prism) {
    assert.ok(!frozen.has(cellKey(cell.x, cell.y)), "prism took a frozen cell");
    assert.ok(Math.hypot(cell.x - center.x, cell.y - center.y) <= radius + 1e-9);
  }
  for (const body of bodies) {
    for (const cell of body.cells) {
      const key = cellKey(cell.x, cell.y);
      if (frozen.has(key) || takenKeys.has(key)) continue;
      assert.ok(
        Math.hypot(cell.x - center.x, cell.y - center.y) > radius,
        `left a loose ${body.color} cell at ${key} inside the disc`,
      );
    }
  }
});

test("matchColor defaults to true, so an ordinary call is unaffected by the new option", () => {
  const { bodies } = parseSandLevel(sandBloom);
  const center = { x: 5, y: 8 };
  const withDefault = cellsInRadius(bodies, center, sandBloom.sortRadius, "blue");
  const explicit = cellsInRadius(bodies, center, sandBloom.sortRadius, "blue", undefined, { matchColor: true });
  assert.deepEqual(withDefault, explicit);
});

// ---- effectiveSortRadius --------------------------------------------------

test("effectiveSortRadius: no booster, or Prism Shot, leaves the radius alone", () => {
  assert.equal(effectiveSortRadius(LEVEL, null), LEVEL.sortRadius);
  assert.equal(effectiveSortRadius(LEVEL, undefined), LEVEL.sortRadius);
  assert.equal(effectiveSortRadius(LEVEL, "prismShot"), LEVEL.sortRadius);
});

test("effectiveSortRadius: Radius Overcharge doubles the reach, capped at the frame's diagonal", () => {
  // Sand Bloom's frame is wide enough that doubling never comes close to the
  // diagonal, so this is the plain, uncapped case.
  assert.equal(effectiveSortRadius(LEVEL, "radiusOvercharge"), LEVEL.sortRadius * 2);

  // A level small enough that 2x sortRadius overshoots the frame — spec §7.3's
  // open question, resolved as: no shot ever needs to reach further than the
  // frame's own diagonal, so that is the ceiling.
  const tiny: SandLevelConfig = {
    ...RADIUS_GAMEPLAY,
    id: 0,
    name: "boost-cap-fixture",
    frame: { width: 4, height: 3 },
    rows: ["....", "....", "...."],
    ammoQueue: ["red"],
    sortRadius: 10,
    shotLimit: 1,
    pixelScale: 1,
  };
  const diagonal = Math.hypot(4, 3);
  assert.equal(effectiveSortRadius(tiny, "radiusOvercharge"), diagonal);
  assert.ok(diagonal < tiny.sortRadius * 2, "the fixture is only useful if doubling would have overshot");
});

// ---- getBoosterCharges ------------------------------------------------------
// Finite now — see `economy.ts`. The wallet-mechanics themselves (buying,
// spending, the starter grant) are covered in `sand-economy.test.ts`; this
// just checks the seam `getBoosterCharges`/`spendBoosterCharge` still expose
// into `sand-rules.ts` for `SandCannonEngine.ts` to call.

test("getBoosterCharges reads the real wallet, and spendBoosterCharge decrements it", () => {
  __resetWalletForTests({ boosters: { radiusOvercharge: 2, prismShot: 0 } });
  assert.equal(getBoosterCharges("radiusOvercharge"), 2);
  assert.equal(getBoosterCharges("prismShot"), 0);

  spendBoosterCharge("radiusOvercharge");
  assert.equal(getBoosterCharges("radiusOvercharge"), 1);

  // Never goes negative — a booster that reads 0 stays at 0.
  spendBoosterCharge("prismShot");
  assert.equal(getBoosterCharges("prismShot"), 0);
});

// ---- resolveShot: booster folded into the one disc it resolves -----------

test("resolveShot with no booster behaves exactly as before (regression guard)", () => {
  const state = createSandGameState(LEVEL);
  const color = currentAmmo(LEVEL, state)!;
  const target = bestShot(state.bodies, LEVEL.sortRadius, color)!;
  const owner = ownerOf(state.bodies, target.x, target.y)!;
  const withoutArg = resolveShot(LEVEL, state, { bodyId: owner.id, x: target.x, y: target.y });
  const withNullBooster = resolveShot(LEVEL, state, { bodyId: owner.id, x: target.x, y: target.y }, null);
  assert.deepEqual(withoutArg.removed, withNullBooster.removed);
  assert.equal(withoutArg.outcome, withNullBooster.outcome);
});

test("Radius Overcharge: a shot takes exactly what the doubled (capped) disc reaches", () => {
  const state = createSandGameState(LEVEL);
  const color = currentAmmo(LEVEL, state)!;
  const target = bestShot(state.bodies, LEVEL.sortRadius, color)!;
  const owner = ownerOf(state.bodies, target.x, target.y)!;
  const hit = { bodyId: owner.id, x: target.x, y: target.y };

  const plain = resolveShot(LEVEL, state, hit);
  const boosted = resolveShot(LEVEL, state, hit, "radiusOvercharge");

  const boostedRadius = effectiveSortRadius(LEVEL, "radiusOvercharge");
  assert.ok(boostedRadius > LEVEL.sortRadius, "fixture is only meaningful if the radius actually grew");
  const oracle = cellsInRadius(state.bodies, target, boostedRadius, color, frozenSet(state));
  assert.deepEqual(boosted.removed, oracle);
  assert.ok(
    boosted.removed.length >= plain.removed.length,
    "a bigger disc around the same centre can never take less than the smaller one did",
  );
});

test("Prism Shot: a shot takes every loose colour in the un-doubled disc", () => {
  const level = lockAndKey;
  const state = createSandGameState(level);
  const ammo = currentAmmo(level, state)!;
  assert.equal(ammo, "yellow", "fixture assumes the opening bullet — purple starts entirely locked");

  // Row y=2 is solid Green (LOCK_PICTURE's "GGGGGGGGGGGG"), directly above
  // solid Orange at y=0-1: a point here is inside `sortRadius` of both
  // colours, and neither is the yellow bullet in hand. An ordinary shot here
  // would be NO_MATCH; Prism Shot has to take both anyway.
  const center = { x: 6, y: 2 };
  const owner = ownerOf(state.bodies, center.x, center.y)!;
  assert.equal(owner.color, "green");
  const hit = { bodyId: owner.id, x: center.x, y: center.y };

  const plain = resolveShot(level, state, hit);
  assert.equal(plain.outcome, "NO_MATCH", "fixture assumes the yellow bullet finds nothing here unboosted");

  const prism = resolveShot(level, state, hit, "prismShot");
  const oracle = cellsInRadius(
    state.bodies,
    center,
    effectiveSortRadius(level, "prismShot"),
    ammo,
    frozenSet(state),
    { matchColor: false },
  );
  assert.deepEqual(prism.removed, oracle);
  const colorsTaken = new Set(prism.removed.map((cell) => ownerOf(state.bodies, cell.x, cell.y)!.color));
  assert.deepEqual(colorsTaken, new Set(["green", "orange"]));
});

test("Prism Shot still leaves locked sand behind — it is invisible to the disc, not a special case", () => {
  const level = lockAndKey;
  const state = createSandGameState(level);
  const [firstLocked] = state.locked;
  const lockedBefore = new Set(state.locked.map((cell) => cellKey(cell.x, cell.y)));
  const owner = ownerOf(state.bodies, firstLocked.x, firstLocked.y);

  const resolution = resolveShot(
    level,
    state,
    { bodyId: owner?.id ?? null, x: firstLocked.x, y: firstLocked.y },
    "prismShot",
  );
  for (const cell of resolution.removed) {
    assert.ok(!lockedBefore.has(cellKey(cell.x, cell.y)), "a locked cell was removed by a Prism Shot");
  }
});
