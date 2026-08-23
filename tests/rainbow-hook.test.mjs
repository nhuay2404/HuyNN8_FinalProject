import assert from "node:assert/strict";
import test from "node:test";
import {
  RAINBOW_BASELINE,
  RAINBOW_PATHS,
  WEAK_POINT_HIT_RADIUS_RATIO,
  WEAK_POINT_VISUAL_RADIUS_RATIO,
  advanceHookCountdown,
  advanceHookElapsed,
  climaxSecondsForHits,
  createRainbowTargetTimeline,
  didCrossRainbowTrigger,
  evaluateRainbowPath,
  getActiveRainbowTargets,
  getRainbowEventDuration,
  isBullseyeHit,
  resolveBlockImpact,
} from "../app/game/rainbow-hook.ts";

const closeTo = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: expected ${expected}, got ${actual}`);
};

test("the hook exposes exactly the twelve authored paths", () => {
  assert.deepEqual(RAINBOW_PATHS.map((path) => path.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(RAINBOW_PATHS.slice(0, 10).every((path) => path.kind === "linear"));
  assert.ok(RAINBOW_PATHS.slice(10).every((path) => path.kind === "quadratic"));
});

test("linear paths evaluate their normalized endpoints and midpoint", () => {
  assert.deepEqual(evaluateRainbowPath(1, 0), { u: -0.15, v: 0.25 });
  assert.deepEqual(evaluateRainbowPath(1, 1), { u: 1.15, v: 0.25 });
  closeTo(evaluateRainbowPath(1, 0.5).u, 0.5, "path 1 midpoint u");
  closeTo(evaluateRainbowPath(8, 0.5).u, 0.5, "path 8 midpoint u");
  closeTo(evaluateRainbowPath(8, 0.5).v, 0.5, "path 8 midpoint v");
});

test("arc paths use their quadratic control point rather than linear interpolation", () => {
  const leftToRight = evaluateRainbowPath(11, 0.5);
  const rightToLeft = evaluateRainbowPath(12, 0.5);
  closeTo(leftToRight.u, 0.5, "path 11 midpoint u");
  closeTo(rightToLeft.u, 0.5, "path 12 midpoint u");
  closeTo(leftToRight.v, 0.44, "path 11 quadratic midpoint v");
  closeTo(rightToLeft.v, 0.44, "path 12 quadratic midpoint v");
  assert.ok(leftToRight.v < 0.68, "the arc must rise toward the top of normalized screen space");
});

test("path sampling clamps finite progress at authored off-screen endpoints", () => {
  assert.deepEqual(evaluateRainbowPath(3, -2), evaluateRainbowPath(3, 0));
  assert.deepEqual(evaluateRainbowPath(3, 4), evaluateRainbowPath(3, 1));
  assert.throws(() => evaluateRainbowPath(3, Number.NaN), /must be finite/);
  assert.throws(() => evaluateRainbowPath(99, 0.5), /Unknown rainbow path id/);
});

test("the forgiving prototype hit radius is visibly larger than the bullseye", () => {
  assert.equal(WEAK_POINT_VISUAL_RADIUS_RATIO, 0.21);
  assert.equal(WEAK_POINT_HIT_RADIUS_RATIO, 0.28);
  assert.ok(WEAK_POINT_HIT_RADIUS_RATIO > WEAK_POINT_VISUAL_RADIUS_RATIO);
});

test("bullseye hit testing selects the two tangent axes for every face pair", () => {
  const cases = [
    ["PX", { x: 40, y: 0.1, z: 0.1 }],
    ["NX", { x: -40, y: 0.1, z: 0.1 }],
    ["PY", { x: 0.1, y: 40, z: 0.1 }],
    ["NY", { x: 0.1, y: -40, z: 0.1 }],
    ["PZ", { x: 0.1, y: 0.1, z: 40 }],
    ["NZ", { x: 0.1, y: 0.1, z: -40 }],
  ];

  for (const [face, localPoint] of cases) {
    assert.equal(isBullseyeHit({ localPoint, impactedFace: face, weakPointFace: face }), true, face);
  }
});

test("bullseye hit testing uses a circular boundary scaled to the block", () => {
  const base = { impactedFace: "PZ", weakPointFace: "PZ", blockSize: 2 };
  assert.equal(isBullseyeHit({ ...base, localPoint: { x: 0.56, y: 0, z: 99 } }), true, "the radius edge is included");
  assert.equal(isBullseyeHit({ ...base, localPoint: { x: 0.4, y: 0.4, z: 99 } }), false, "a square corner is outside the circle");
  assert.equal(isBullseyeHit({ ...base, localPoint: { x: 0.57, y: 0, z: 99 } }), false, "outside the radius misses");
});

test("an otherwise centred impact cannot hit a Weak Point authored on another face", () => {
  assert.equal(isBullseyeHit({
    localPoint: { x: 0, y: 0, z: 0.5 },
    impactedFace: "PZ",
    weakPointFace: "PX",
  }), false);
});

test("block impact is resolved from the phase at impact time", () => {
  assert.equal(resolveBlockImpact("NORMAL_WEAK_POINT", true), "CLAIM_CLUSTER");
  assert.equal(resolveBlockImpact("NORMAL_WEAK_POINT", false), "RICOCHET_SHAKE");
  assert.equal(resolveBlockImpact("RAINBOW_TARGET_EVENT", false), "RICOCHET_SHAKE");
  assert.equal(resolveBlockImpact("RAINBOW_CLIMAX", false), "CLAIM_CLUSTER");
});

test("the baseline timeline reproduces A 0–4, B 2–6, C 4–8", () => {
  const timeline = createRainbowTargetTimeline();
  assert.deepEqual(timeline, [
    { index: 0, label: "A", spawnAtSeconds: 0, leaveAtSeconds: 4 },
    { index: 1, label: "B", spawnAtSeconds: 2, leaveAtSeconds: 6 },
    { index: 2, label: "C", spawnAtSeconds: 4, leaveAtSeconds: 8 },
  ]);
  assert.equal(getRainbowEventDuration(timeline), 8);
  assert.equal(getRainbowEventDuration(RAINBOW_BASELINE), 8, "level-style config is accepted directly");
  assert.deepEqual(getActiveRainbowTargets(timeline, 3).map((target) => target.label), ["A", "B"]);
  assert.deepEqual(getActiveRainbowTargets(timeline, 4).map((target) => target.label), ["B", "C"]);
  assert.deepEqual(getActiveRainbowTargets(timeline, 8), []);
});

test("the separate Climax bank grows by five seconds per baseline hit", () => {
  assert.equal(RAINBOW_BASELINE.rewardSecondsPerHit, 5);
  assert.deepEqual([0, 1, 2, 3].map((hits) => climaxSecondsForHits(hits)), [0, 5, 10, 15]);
  assert.throws(() => climaxSecondsForHits(-1), /non-negative integer/);
});

test("the 25-second trigger fires only on the countdown crossing", () => {
  assert.equal(didCrossRainbowTrigger(25.1, 25), true);
  assert.equal(didCrossRainbowTrigger(26, 24.5), true);
  assert.equal(didCrossRainbowTrigger(25, 24), false, "a previously-triggered range does not retrigger");
  assert.equal(didCrossRainbowTrigger(20, 19), false, "round_time <= 25 remains an explicit caller policy");
  assert.equal(didCrossRainbowTrigger(30, 29), false);
  assert.equal(didCrossRainbowTrigger(26, 24, 25, true), false, "the one-shot latch suppresses retriggering");
});

test("fixed-step hook clocks land on authored boundaries without an extra frame", () => {
  const step = 1 / 60;
  let main = 90;
  let triggerCount = 0;
  for (let tick = 0; tick < 65 * 60; tick += 1) {
    const previous = main;
    main = advanceHookCountdown(main, step, 25);
    if (didCrossRainbowTrigger(previous, main, 25, triggerCount > 0)) triggerCount += 1;
  }
  assert.equal(main, 25);
  assert.equal(triggerCount, 1);

  let eventElapsed = 0;
  for (let tick = 0; tick < 8 * 60; tick += 1) {
    eventElapsed = advanceHookElapsed(eventElapsed, step, 8);
  }
  assert.equal(eventElapsed, 8, "the baseline event ends on tick 480");

  let climax = 5;
  for (let tick = 0; tick < 5 * 60; tick += 1) climax = advanceHookCountdown(climax, step);
  assert.equal(climax, 0, "a five-second reward ends on tick 300");
});
