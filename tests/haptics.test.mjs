import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HAPTIC_PATTERNS,
  LANDING_MAX_TICKS,
  landingPulseMs,
} from "../app/game/haptics.ts";

test("the chosen tier keeps every pulse in the felt-but-not-tiring range", () => {
  const durations = Object.values(HAPTIC_PATTERNS).flatMap((pattern) => (Array.isArray(pattern) ? pattern : [pattern]));
  for (const duration of durations) {
    // Under 10ms is unreliable on Android; a single pulse over 300ms reads as
    // a fault rather than as feedback.
    assert.ok(duration >= 10, `pulse of ${duration}ms is too short to be felt reliably`);
    assert.ok(duration <= 300, `pulse of ${duration}ms is long enough to feel like a malfunction`);
  }
  assert.equal(HAPTIC_PATTERNS.impact, 25, "the impact pulse is the tier's reference point");
});

test("losing buzzes longer than any single progress buzz", () => {
  const progress = [HAPTIC_PATTERNS.impact, HAPTIC_PATTERNS.batchCreated];
  for (const pulse of progress) {
    assert.ok(HAPTIC_PATTERNS.lose > pulse, "a loss must be unmistakable next to routine feedback");
  }
});

test("landing pulses decay so a burst reads as separate taps", () => {
  const first = landingPulseMs(0);
  const second = landingPulseMs(1);
  assert.equal(first, 18);
  assert.ok(second < first, "each cube should land a little softer than the one before");
  for (let order = 0; order < LANDING_MAX_TICKS; order += 1) {
    assert.ok(landingPulseMs(order) >= 10, `tick ${order} fell below the reliable minimum`);
    assert.ok(landingPulseMs(order) <= first, `tick ${order} got stronger instead of softer`);
  }
});

test("a long burst stops ticking instead of turning into a rattle", () => {
  assert.equal(landingPulseMs(LANDING_MAX_TICKS), 0);
  assert.equal(landingPulseMs(LANDING_MAX_TICKS + 20), 0);
});

// Comments legitimately discuss navigator.vibrate, so only real code is checked.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("every haptic call site goes through the shared module", async () => {
  const engine = await readFile(new URL("../app/game/CannonSortEngine.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../app/GamePrototype.tsx", import.meta.url), "utf8");
  for (const source of [engine, ui]) {
    assert.doesNotMatch(
      stripComments(source),
      /navigator\s*\.\s*vibrate/,
      "vibration must only be reached through haptics.ts, which owns the enabled flag and the support check",
    );
  }
  assert.match(engine, /haptic\("impact"\)/, "the shot landing on a block is the anchor haptic");
  assert.match(
    engine,
    /haptic\(after\.result\.kind === "WIN" \? "win" : "lose"\)/,
    "the level ending must buzz on both outcomes",
  );
  assert.match(
    engine,
    /haptic\("lose"\);\r?\n\s*this\.callbacks\.onState/,
    "running out of shots is a separate loss path and needs its own buzz",
  );
  assert.match(ui, /hapticBlockLanded\(sprite\.order\)/, "each cube buzzes as it reaches its slot");
});

test("one resolution emits at most one buzz, most urgent first", async () => {
  const source = await readFile(new URL("../app/game/CannonSortEngine.ts", import.meta.url), "utf8");
  const start = source.indexOf("private emitResolutionHaptics(");
  const end = source.indexOf("\n  private resolvePending(", start);
  assert.ok(start >= 0 && end > start, "could not isolate emitResolutionHaptics");

  const method = source.slice(start, end);
  const order = ["win", "batchFull", "goalComplete", "batchCreated"].map((event) => method.indexOf(`"${event}"`));
  for (const index of order) assert.ok(index > 0, "every outcome needs a haptic branch");
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i] > order[i - 1], "branches must run from most urgent to least");
  }
  // Every branch but the last returns, so patterns can never stack up and
  // cancel one another out.
  assert.equal((method.match(/return;/g) ?? []).length, 3);
});
