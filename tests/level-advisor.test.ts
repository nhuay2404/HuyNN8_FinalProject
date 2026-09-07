import assert from "node:assert/strict";
import test from "node:test";
import { adviseLevel } from "../app/game/level-advisor.ts";
import type { DifficultyResult } from "../app/game/level-difficulty.ts";
import type { LevelAnalysis } from "../app/game/level-analysis.ts";

function result(breakdown: Partial<DifficultyResult["breakdown"]>): DifficultyResult {
  const full = { size: 0, colors: 0, interleaving: 0, ammo: 0, radius: 0, ...breakdown };
  const score = Math.round(
    ((full.size + full.colors + full.interleaving + full.ammo + full.radius) / 5) * 100,
  );
  return { score, breakdown: full, label: "medium" };
}

function analysis(overrides: Partial<LevelAnalysis>): LevelAnalysis {
  return {
    strongShots: 10,
    carelessWins: 4,
    carelessRuns: 8,
    slack: 6,
    suggestedShotLimit: 16,
    verdict: "good",
    ...overrides,
  };
}

test("a solver run that couldn't clear the board raises a structural warning", () => {
  const suggestions = adviseLevel({
    result: result({}),
    analysis: analysis({ verdict: "unclearable", strongShots: null, slack: null, suggestedShotLimit: null }),
    prevScore: null,
  });
  assert.ok(suggestions.some((s) => s.id === "unclearable" && s.severity === "warning"));
});

test("no solver run yet means no unclearable suggestion, even on a hard board", () => {
  const suggestions = adviseLevel({ result: result({ colors: 0.9 }), analysis: null, prevScore: null });
  assert.ok(!suggestions.some((s) => s.id === "unclearable"));
});

test("heavily interleaved colours suggest merging blobs", () => {
  const suggestions = adviseLevel({ result: result({ interleaving: 0.9 }), analysis: null, prevScore: null });
  assert.ok(suggestions.some((s) => s.id === "interleaving"));
});

test("a solid single-blob picture does not trigger the interleaving suggestion", () => {
  const suggestions = adviseLevel({ result: result({ interleaving: 0.1 }), analysis: null, prevScore: null });
  assert.ok(!suggestions.some((s) => s.id === "interleaving"));
});

test("radius and ammo both near their tightest flags a stacked-difficulty warning", () => {
  const suggestions = adviseLevel({
    result: result({ radius: 0.9, ammo: 0.9 }),
    analysis: null,
    prevScore: null,
  });
  assert.ok(suggestions.some((s) => s.id === "stacked-tight"));
});

test("a tight radius alone, without a tight budget, does not stack-warn", () => {
  const suggestions = adviseLevel({
    result: result({ radius: 0.9, ammo: 0.2 }),
    analysis: null,
    prevScore: null,
  });
  assert.ok(!suggestions.some((s) => s.id === "stacked-tight"));
});

test("many colours on a small board suggests a bigger frame or fewer colours", () => {
  const suggestions = adviseLevel({
    result: result({ colors: 0.8, size: 0.1 }),
    analysis: null,
    prevScore: null,
  });
  assert.ok(suggestions.some((s) => s.id === "crowded-colors"));
});

test("a sharp score jump from the previous level warns about the ramp", () => {
  const suggestions = adviseLevel({ result: result({ size: 1 }), analysis: null, prevScore: 20 });
  // size:1 alone scores 20 — bump colors too so the jump clears the threshold.
  const jumpy = adviseLevel({ result: result({ size: 1, colors: 1 }), analysis: null, prevScore: 10 });
  assert.ok(jumpy.some((s) => s.id === "progression-up"));
  assert.ok(!suggestions.some((s) => s.id === "progression-up"));
});

test("a sharp score drop from the previous level is only an info note", () => {
  const suggestions = adviseLevel({ result: result({}), analysis: null, prevScore: 90 });
  const dropNote = suggestions.find((s) => s.id === "progression-down");
  assert.ok(dropNote);
  assert.equal(dropNote?.severity, "info");
});

test("the first level in the roster has no previous score to compare against", () => {
  const suggestions = adviseLevel({ result: result({}), analysis: null, prevScore: null });
  assert.ok(!suggestions.some((s) => s.id === "progression-up" || s.id === "progression-down"));
});

test("a well-judged, unremarkable level has nothing to suggest", () => {
  const suggestions = adviseLevel({
    result: result({ size: 0.4, colors: 0.4, interleaving: 0.3, ammo: 0.4, radius: 0.4 }),
    analysis: analysis({ verdict: "good" }),
    prevScore: 40,
  });
  assert.deepEqual(suggestions, []);
});
