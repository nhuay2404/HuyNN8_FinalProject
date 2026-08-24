import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);
const uiUrl = new URL("../app/GamePrototype.tsx", import.meta.url);

function isolate(source, signature, stopAt = "\n  private ") {
  const start = source.indexOf(signature);
  if (start < 0) return "";
  const end = source.indexOf(stopAt, start + signature.length);
  return end > start ? source.slice(start, end) : source.slice(start);
}

test("clearing a level shows the next puzzle instead of the menu", async () => {
  const source = await readFile(uiUrl, "utf8");
  const advance = source.slice(source.indexOf("const advanceLevel = ()"), source.indexOf("\n", source.indexOf("const advanceLevel = ()")));
  assert.match(advance, /startLevel\(sheet, levelIndex \+ 1, "playing", \{ intro: "handoff" \}\)/);
  const resultActions = source.slice(source.indexOf('className="result-actions"'), source.indexOf("</div>", source.indexOf('className="result-actions"')));
  assert.match(resultActions, /className="result-next" onClick=\{advanceLevel\}/);
  assert.doesNotMatch(resultActions, /goToLevel/, "the next-level button must not route through the menu any more");
});

test("the handoff entrance is set up before the new level's first frame is seen", async () => {
  const source = await readFile(uiUrl, "utf8");
  const effect = source.slice(source.indexOf("const engine = new CannonSortEngine("), source.indexOf("}, [level, session]);"));
  assert.match(effect, /engine\.startHandoffIntro\(\)/, "the engine that was just built is the only one that can play it");
  assert.match(effect, /handoffIntroRef\.current = false/, "the flag is one-shot, or a later restart would replay the entrance");
});

test("the handoff pulls the cluster back and half turns it, then settles in 0.7s", async () => {
  const source = await readFile(engineUrl, "utf8");
  const handoff = isolate(source, "startHandoffIntro() {");
  assert.match(handoff, /this\.introFromScale = this\.playModelScale \* HANDOFF_MODEL_SCALE/, "zoomed out from the fitted play size");
  assert.match(handoff, /this\.modelRoot\.scale\.setScalar\(this\.playModelScale \* HANDOFF_MODEL_SCALE\)/, "applied on the first frame, not waited for");
  assert.match(handoff, /this\.introSpinTurn = HANDOFF_SPIN_TURN/);
  assert.match(handoff, /this\.introDuration = HANDOFF_INTRO_DURATION/);
  assert.match(handoff, /this\.introActive = true/, "play stays locked until the cluster stops moving");

  const duration = source.slice(source.indexOf("const HANDOFF_INTRO_DURATION"), source.indexOf("\n", source.indexOf("const HANDOFF_INTRO_DURATION")));
  assert.match(duration, /= 0\.7;/);
  const turn = source.slice(source.indexOf("const HANDOFF_SPIN_TURN"), source.indexOf("\n", source.indexOf("const HANDOFF_SPIN_TURN")));
  assert.match(turn, /Math\.PI/, "about half a turn");
});

test("the cannon holds still through a handoff instead of flying back in", async () => {
  const source = await readFile(engineUrl, "utf8");
  const handoff = isolate(source, "startHandoffIntro() {");
  assert.match(handoff, /this\.introRaisesCannon = false/);
  assert.match(handoff, /this\.cannonRoot\.position\.y = this\.cannonRestY;/, "at rest, not below the frame");
  assert.doesNotMatch(handoff, /CANNON_INTRO_DROP/, "the cannon never left, so it has nothing to re-enter from");

  const updateIntro = isolate(source, "private updateIntro(frameDelta: number) {");
  assert.match(updateIntro, /if \(this\.introRaisesCannon\) \{/, "the rise belongs to the menu intro only");
  // Coming out of the menu the cannon still has to arrive.
  const setIdle = isolate(source, "setIdle(next: boolean) {");
  assert.match(setIdle, /this\.introRaisesCannon = true/);
});

test("nothing re-aims the cannon while a cluster is still moving", async () => {
  const source = await readFile(engineUrl, "utf8");
  const resize = isolate(source, "private resize() {");
  const introBranch = resize.indexOf("} else if (this.introActive) {");
  const resetAt = resize.indexOf("this.resetCannonDirection()");
  assert.ok(introBranch > 0, "resize has to skip the re-aim during an intro");
  assert.ok(resetAt > introBranch, "the re-aim is only reachable once the intro is over");
  // The observer's own first callback lands inside the intro window, so this is
  // the path that made the turret swing to a pose solved against a moving model.
  assert.match(resize.slice(introBranch, resetAt), /this\.showIdleCrosshair\(\)/, "the crosshair still follows the intro");
});

test("an intro spends its first frame on the clock, not on the easing", async () => {
  const source = await readFile(engineUrl, "utf8");
  const animate = source.slice(source.indexOf("private animate = () => {"));
  const guarded = animate.slice(animate.indexOf("if (this.introActive && !this.paused)"), animate.indexOf("if (!this.paused) {"));
  assert.match(guarded, /if \(this\.introClockPending\) this\.introClockPending = false;\s*\n\s*else this\.updateIntro\(frameDelta\)/);
  // Both entrances arm it, or one of them would still open with a jump the
  // size of the level swap.
  assert.match(isolate(source, "startHandoffIntro() {"), /this\.introClockPending = true/);
  assert.match(isolate(source, "setIdle(next: boolean) {"), /this\.introClockPending = true/);
});

test("the handoff turn is driven by angle, and both intros land on the authored transform", async () => {
  const source = await readFile(engineUrl, "utf8");
  const updateIntro = isolate(source, "private updateIntro(frameDelta: number) {");
  // A half turn has no shorter arc, so a slerp would pick its direction from
  // quaternion signs rather than from the design.
  assert.match(updateIntro, /setFromAxisAngle\(this\.worldUp, this\.introSpinTurn \* \(1 - eased\)\)/);
  assert.match(updateIntro, /this\.introTime \+ frameDelta, this\.introDuration/, "the menu intro and the handoff run at different lengths");
  assert.match(updateIntro, /this\.introSpinTurn = 0/, "cleared on landing, so the menu intro is never spun");
  assert.match(updateIntro, /lerp\(this\.introFromScale, this\.playModelScale, eased\)/, "every intro lands at the level's fitted play size");
  assert.match(updateIntro, /this\.modelRoot\.scale\.setScalar\(this\.playModelScale\)/, "the exact fitted scale is restored at the end");
  // The menu path is untouched.
  assert.match(updateIntro, /slerpQuaternions\(this\.introFromQuaternion, this\.defaultModelOrientation, eased\)/);

  const setIdle = isolate(source, "setIdle(next: boolean) {");
  assert.match(setIdle, /this\.introSpinTurn = 0/, "coming out of the menu is a zoom, not a spin");
  assert.match(setIdle, /this\.introDuration = INTRO_DURATION/);
});

test("large levels are fitted before their first frame while compact levels stay full size", async () => {
  const source = await readFile(engineUrl, "utf8");
  assert.match(source, /this\.playModelScale = computeModelPlayScale\(level\.blocks, BLOCK_SIZE, BLOCK_SPACING\)/);
  const buildBlocks = isolate(source, "private buildBlocks() {");
  assert.match(buildBlocks, /this\.modelRoot\.scale\.setScalar\(this\.playModelScale\)/);
});
