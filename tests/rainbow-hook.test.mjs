import assert from "node:assert/strict";
import test from "node:test";
import {
  RAINBOW_TARGET_DEFAULTS,
  WEAK_POINT_VISUAL_RADIUS_RATIO,
  createRainbowSpawnSchedule,
  isWeakPointFaceHit,
  rainbowWanderAt,
  resolveBlockImpact,
} from "../app/game/rainbow-hook.ts";
import * as hook from "../app/game/rainbow-hook.ts";

const closeTo = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: expected ${expected}, got ${actual}`);
};

test("a target enters off one side and leaves off the other", () => {
  // The margin is what makes a target fly in rather than appear: at both ends it
  // is outside the 0..1 frame, so the player never sees it materialise.
  for (const seed of [1, 7, 42, 900]) {
    const start = rainbowWanderAt(seed, 0);
    const end = rainbowWanderAt(seed, 1);
    assert.ok(start.u < 0 || start.u > 1, `seed ${seed} should start off-frame, got u=${start.u}`);
    assert.ok(end.u < 0 || end.u > 1, `seed ${seed} should end off-frame, got u=${end.u}`);
    assert.ok(Math.sign(start.u - 0.5) !== Math.sign(end.u - 0.5), `seed ${seed} should cross the frame`);
  }
});

test("a flight is never a straight line and never a single arc", () => {
  // A line has a constant second difference of zero; one arc has a constant
  // non-zero one. Sampling three-point curvature across the crossing and finding
  // it changing sign is what separates a wander from either of those.
  for (const seed of [3, 11, 58, 204]) {
    const samples = Array.from({ length: 41 }, (_, index) => rainbowWanderAt(seed, index / 40).v);
    const curvature = [];
    for (let i = 1; i < samples.length - 1; i += 1) {
      curvature.push(samples[i + 1] - 2 * samples[i] + samples[i - 1]);
    }
    const positive = curvature.some((value) => value > 1e-6);
    const negative = curvature.some((value) => value < -1e-6);
    assert.ok(positive && negative, `seed ${seed} should bend both ways, not trace a line or one arc`);
  }
});

test("a flight stays inside the band the cannon can reach", () => {
  for (let seed = 0; seed < 60; seed += 1) {
    for (let step = 0; step <= 20; step += 1) {
      const { v } = rainbowWanderAt(seed, step / 20);
      // The band is what the cannon can actually reach, not what fits on screen.
      assert.ok(v >= 0.12 - 1e-9 && v <= 0.48 + 1e-9, `seed ${seed} left the reachable band at v=${v}`);
    }
  }
});

test("the same seed always flies the same path, and different seeds do not", () => {
  assert.deepEqual(rainbowWanderAt(5, 0.37), rainbowWanderAt(5, 0.37));
  assert.notDeepEqual(rainbowWanderAt(5, 0.37), rainbowWanderAt(6, 0.37));
  // Out-of-range progress is clamped, so a late frame cannot fling a target past
  // its own exit point.
  assert.deepEqual(rainbowWanderAt(5, -3), rainbowWanderAt(5, 0));
  assert.deepEqual(rainbowWanderAt(5, 9), rainbowWanderAt(5, 1));
  assert.throws(() => rainbowWanderAt(5, Number.NaN), /progress must be finite/);
  assert.throws(() => rainbowWanderAt(Number.NaN, 0.5), /seed must be finite/);
});

test("a round schedules its authored number of targets, scattered but repeatable", () => {
  assert.deepEqual(
    { ...RAINBOW_TARGET_DEFAULTS },
    { targetCount: 3, spawnGapSeconds: 12, targetDurationSeconds: 4.5 },
  );

  const schedule = createRainbowSpawnSchedule({ levelSeed: 1 });
  assert.equal(schedule.length, 3, "the authored count is what flies");
  assert.deepEqual(schedule, createRainbowSpawnSchedule({ levelSeed: 1 }), "same level, same round");
  assert.notDeepEqual(schedule, createRainbowSpawnSchedule({ levelSeed: 2 }));

  // Each one is on screen for the authored duration, and they arrive in order.
  for (const [index, window] of schedule.entries()) {
    assert.equal(window.index, index);
    closeTo(window.leaveAtSeconds - window.spawnAtSeconds, 4.5, `target ${index} duration`);
    if (index > 0) assert.ok(window.spawnAtSeconds > schedule[index - 1].spawnAtSeconds);
  }

  // The first gap is half to one gap, later ones half to one and a half, so the
  // scatter is bounded rather than arbitrary.
  assert.ok(schedule[0].spawnAtSeconds >= 6 && schedule[0].spawnAtSeconds <= 12, `first at ${schedule[0].spawnAtSeconds}`);
  for (let index = 1; index < schedule.length; index += 1) {
    const gap = schedule[index].spawnAtSeconds - schedule[index - 1].spawnAtSeconds;
    assert.ok(gap >= 6 && gap <= 18, `gap ${index} was ${gap}`);
  }
});

test("a schedule gives every target its own flight seed", () => {
  const seeds = createRainbowSpawnSchedule({ levelSeed: 4, targetCount: 5 }).map((window) => window.seed);
  assert.equal(new Set(seeds).size, seeds.length, "two targets must not fly the same path");
});

test("a schedule refuses nonsense rather than producing a broken round", () => {
  assert.throws(() => createRainbowSpawnSchedule({ levelSeed: 1, targetCount: -1 }), /non-negative integer/);
  assert.throws(() => createRainbowSpawnSchedule({ levelSeed: 1, targetCount: 1.5 }), /non-negative integer/);
  assert.throws(() => createRainbowSpawnSchedule({ levelSeed: Number.NaN }), /levelSeed must be finite/);
  assert.throws(() => createRainbowSpawnSchedule({ levelSeed: 1, baseGapSeconds: -1 }), /non-negative finite/);
  assert.deepEqual(createRainbowSpawnSchedule({ levelSeed: 1, targetCount: 0 }), []);
});

test("the hook no longer carries a clock, a bank or a path table", () => {
  // The round is untimed and a hit arms one shot instead of banking seconds, so
  // every helper that existed to serve those is gone rather than left dangling.
  for (const name of [
    "RAINBOW_PATHS",
    "RAINBOW_BASELINE",
    "evaluateRainbowPath",
    "createRainbowTargetTimeline",
    "getRainbowEventDuration",
    "getActiveRainbowTargets",
    "advanceHookCountdown",
    "advanceHookElapsed",
    "climaxSecondsForHits",
    "didCrossRainbowTrigger",
    "HOOK_TIME_EPSILON_SECONDS",
  ]) {
    assert.equal(hook[name], undefined, `${name} should be gone`);
  }
});

test("the bullseye radius is presentation only and no longer gates a hit", () => {
  assert.equal(WEAK_POINT_VISUAL_RADIUS_RATIO, 0.21);
  // A separate, wider hit radius used to exist so that aiming at a disc was
  // survivable. With the whole face counting there is nothing left to widen.
  assert.equal(Object.keys(hook).some((name) => /HIT_RADIUS/.test(name)), false);
  assert.equal(typeof hook.isBullseyeHit, "undefined", "the radius predicate is gone");
});

test("a Weak Point is the whole face, anywhere on it", () => {
  for (const face of ["PX", "NX", "PY", "NY", "PZ", "NZ"]) {
    assert.equal(isWeakPointFaceHit({ impactedFace: face, weakPointFace: face }), true, face);
  }
});

test("landing on a face the Weak Point was not authored on is not a hit", () => {
  assert.equal(isWeakPointFaceHit({ impactedFace: "PZ", weakPointFace: "PX" }), false);
  assert.equal(isWeakPointFaceHit({ impactedFace: "PZ", weakPointFace: "NZ" }), false, "the opposite face is a different face");
});

test("a block impact is resolved from the bypass flag as it stands at impact", () => {
  // Armed claims whatever it lands on; unarmed still needs the marked face.
  assert.equal(resolveBlockImpact(true, false), "CLAIM_CLUSTER");
  assert.equal(resolveBlockImpact(true, true), "CLAIM_CLUSTER");
  assert.equal(resolveBlockImpact(false, true), "CLAIM_CLUSTER");
  assert.equal(resolveBlockImpact(false, false), "RICOCHET_SHAKE");
});
