import assert from "node:assert/strict";
import test from "node:test";
import { sandBloom } from "../design/levels/sand-levels.ts";
import {
  countCells,
  createSandGameState,
  currentAmmo,
  expandLevelForPixelBoard,
  findSplitBodies,
  parseSandLevel,
  resolveShot,
  runGrainSettle,
} from "../app/game/sand-rules.ts";
import type { SandBody, SandLevelConfig } from "../app/game/sand-types.ts";

function boardKey(bodies: SandBody[]) {
  return bodies
    .map((body) => `${body.color}:${body.cells.map((c) => `${c.x},${c.y}`).sort().join("|")}`)
    .sort()
    .join(";");
}

const LEVELS = [["Sand Bloom", sandBloom]] as const;

// ---- expansion preserves the puzzle, only resolution changes -------------

for (const [name, level] of LEVELS) {
  test(`${name}: expanding to pixel resolution keeps the same body count, colours and adjacency`, () => {
    const raw = parseSandLevel(level);
    const expanded = parseSandLevel(expandLevelForPixelBoard(level));

    assert.equal(expanded.bodies.length, raw.bodies.length, "uniform upscaling must not merge or split any region");
    assert.equal(
      countCells(expanded.bodies),
      countCells(raw.bodies) * level.pixelScale * level.pixelScale,
      "every blueprint cell becomes exactly pixelScale x pixelScale pixels",
    );

    const rawColorCounts = new Map<string, number>();
    for (const body of raw.bodies) rawColorCounts.set(body.color, (rawColorCounts.get(body.color) ?? 0) + 1);
    const expandedColorCounts = new Map<string, number>();
    for (const body of expanded.bodies) expandedColorCounts.set(body.color, (expandedColorCounts.get(body.color) ?? 0) + 1);
    assert.deepEqual(expandedColorCounts, rawColorCounts, "the same number of regions per colour must survive scaling");
  });

  test(`${name}: the expanded board is already settled — the drawing is still what the player sees`, () => {
    const expandedLevel = expandLevelForPixelBoard(level);
    const { bodies } = parseSandLevel(expandedLevel);
    // runGrainSettle always ends with one bookkeeping REINDEX that (re)states
    // the labels it derived — even when nothing physically moved, which is
    // exactly the case here. "Already stable" means no GRAIN_PASS occurred and
    // the board is pixel-for-pixel the same as what was parsed.
    const settle = runGrainSettle(bodies, expandedLevel.frame);
    assert.ok(settle.steps.every((step) => step.kind !== "GRAIN_PASS"), "expansion must not disturb an already-stable picture");
    assert.equal(boardKey(settle.bodies), boardKey(bodies));
  });

  test(`${name}: expandLevelForPixelBoard is idempotent on an already-expanded level`, () => {
    const once = expandLevelForPixelBoard(level);
    const twice = expandLevelForPixelBoard(once);
    assert.deepEqual(twice, once, "expanding an already-expanded level (pixelScale 1) must be a no-op");
  });
}

test("the radius scales with the board: a disc still covers the same fraction of the picture", () => {
  const level = sandBloom;
  const expanded = expandLevelForPixelBoard(level);
  assert.equal(expanded.sortRadius, level.sortRadius * level.pixelScale);
  const rawFraction = (level.sortRadius * level.sortRadius * Math.PI) / (level.frame.width * level.frame.height);
  const expandedFraction = (expanded.sortRadius * expanded.sortRadius * Math.PI) / (expanded.frame.width * expanded.frame.height);
  assert.ok(Math.abs(rawFraction - expandedFraction) < 1e-9, "the disc must cover the same share of the frame before and after expansion");
});

test("a level with pixelScale 1 expands to itself", () => {
  const level: SandLevelConfig = { ...sandBloom, pixelScale: 1 };
  const expanded = expandLevelForPixelBoard(level);
  assert.equal(expanded.frame.width, level.frame.width);
  assert.equal(expanded.frame.height, level.frame.height);
  assert.deepEqual(expanded.rows, level.rows);
});

// ---- gameplay at pixel resolution behaves the same way it does at blueprint scale ---

test("at pixel resolution: a radius shot still takes only part of a region", () => {
  const level = expandLevelForPixelBoard(sandBloom);
  const state = createSandGameState(level);
  const color = currentAmmo(level, state)!;
  const target = state.bodies.filter((body) => body.color === color)
    .reduce((best, body) => (body.cells.length > best.cells.length ? body : best));
  const resolution = resolveShot(level, state, { bodyId: target.id, x: target.cells[0].x, y: target.cells[0].y });
  assert.equal(resolution.outcome, "SORTED");
  assert.ok(resolution.removed.length > 0);
  assert.ok(resolution.removed.length < target.cells.length, "a disc must not take a whole region at pixel resolution either");
});

test("at pixel resolution: settling stays deterministic and leaves every body whole", () => {
  const level = expandLevelForPixelBoard(sandBloom);
  const state = createSandGameState(level);
  const color = currentAmmo(level, state)!;
  const target = state.bodies.find((body) => body.color === color)!;
  const hit = { bodyId: target.id, x: target.cells[0].x, y: target.cells[0].y };
  const first = resolveShot(level, state, hit);
  const second = resolveShot(level, state, hit);
  assert.equal(first.outcome, "SORTED");
  assert.equal(boardKey(first.state.bodies), boardKey(second.state.bodies), "pixel-resolution settling must stay deterministic");
  assert.deepEqual(findSplitBodies(first.state.bodies), [], "every body the settle hands back is one connected piece");
});
