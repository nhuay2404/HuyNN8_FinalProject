import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);
const uiUrl = new URL("../app/GamePrototype.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const htmlUrl = new URL("../outputs/3d-cannon-sort.html", import.meta.url);

function isolate(source, signature, stopAt = "\n  private ") {
  const start = source.indexOf(signature);
  if (start < 0) return "";
  const end = source.indexOf(stopAt, start + signature.length);
  return end > start ? source.slice(start, end) : source.slice(start);
}

test("Weak Points are world-space bullseyes parented to their authored blocks", async () => {
  const source = await readFile(engineUrl, "utf8");
  const build = isolate(source, "private buildWeakPoints() {");
  assert.match(build, /new THREE\.CircleGeometry/);
  assert.match(build, /block\.mesh\.add\(group\)/, "the marker has to inherit the block/model transform");
  assert.match(build, /weakPointFaceNormal\(spec\.face\)/);
  assert.match(build, /WEAK_POINT_VISUAL_RADIUS_RATIO/, "the renderer and the tested hit policy share one scale");
});

test("block impact reads the hook phase at impact and splits claim from ricochet", async () => {
  const source = await readFile(engineUrl, "utf8");
  const hit = isolate(source, "private handleHit(block: BlockRuntime, projectile: Projectile) {");
  assert.match(hit, /resolveBlockImpact\(this\.hookPhase, bullseyeHit\)/);
  assert.match(hit, /if \(impactResolution === "RICOCHET_SHAKE"\)/);
  assert.match(hit, /this\.shakeCluster\(cluster, projectile\.shotIndex\)/);
  assert.match(hit, /this\.startRicochet\(projectile\)/);
  assert.ok(hit.indexOf("RICOCHET_SHAKE") < hit.indexOf("this.releaseCluster"), "a wrong face must return before claim");
});

test("Rainbow Targets and blocks compete by first physical projectile contact", async () => {
  const source = await readFile(engineUrl, "utf8");
  const update = isolate(source, "private updateProjectile(projectile: Projectile) {");
  const sweep = isolate(source, "private sweepRainbowTargets(");
  assert.match(update, /const rainbowHit = this\.sweepRainbowTargets/);
  assert.match(update, /rainbowHit\.t <= hit\.t/);
  assert.match(update, /this\.handleRainbowTargetHit/);
  assert.ok(update.indexOf("handleRainbowTargetHit") < update.indexOf("this.handleHit"));
  assert.match(sweep, /rainbowTargetMotionsForInterval/, "aim prediction must advance the authored target path");
  assert.match(sweep, /relativeFrom/);
  assert.match(sweep, /relativeTo/);
});

test("a Rainbow Target can reward once and always stops its projectile", async () => {
  const source = await readFile(engineUrl, "utf8");
  const hit = isolate(source, "private handleRainbowTargetHit(target: RainbowTargetRuntime, projectile: Projectile) {");
  assert.match(hit, /if \(!target\.active \|\| target\.hit\) return/);
  assert.match(hit, /target\.hit = true/);
  assert.match(hit, /this\.rainbowBankSeconds \+= this\.level\.rainbow\.rewardSeconds/);
  assert.match(hit, /this\.removeProjectile\(projectile\)/);
});

test("the round clock triggers one event, runs through Climax, and fails at zero first", async () => {
  const source = await readFile(engineUrl, "utf8");
  const prepare = isolate(source, "private prepareHookRuntimeStep() {");
  const finish = isolate(source, "private finishHookRuntimeStep() {");
  const timedStep = isolate(source, "private updateTimedGameplayStep() {");
  assert.match(prepare, /this\.mainTimeRemaining = advanceHookCountdown/);
  assert.match(prepare, /if \(this\.mainTimeRemaining <= 0\)/);
  assert.match(prepare, /didCrossRainbowTrigger/);
  assert.match(finish, /this\.rainbowTimeRemaining = advanceHookCountdown/);
  assert.ok(prepare.indexOf("this.failTimeUp()") < prepare.indexOf("didCrossRainbowTrigger"), "TIME_UP owns the physics step");
  assert.ok(
    timedStep.indexOf("this.prepareHookRuntimeStep()") < timedStep.indexOf("this.updateProjectile(projectile)"),
    "the interval must be prepared before projectile collision",
  );
  assert.ok(
    timedStep.indexOf("this.updateProjectile(projectile)") < timedStep.indexOf("this.finishHookRuntimeStep()"),
    "phase boundaries must commit after impacts in the interval",
  );
  assert.match(timedStep, /this\.rainbowEventDuration - this\.rainbowEventElapsed/);
  assert.match(timedStep, /considerBoundary\(this\.rainbowTimeRemaining\)/);
});

test("every result path clears transient gameplay and leaves Climax presentation", async () => {
  const source = await readFile(engineUrl, "utf8");
  const stop = isolate(source, "private stopHookForResult() {");
  assert.match(stop, /this\.clearAimGesture\(true\)/);
  assert.match(stop, /this\.clearModelGesture\(\)/);
  assert.match(stop, /this\.projectiles\.slice\(\)\.forEach/);
  assert.match(stop, /this\.pendingResolutions = \[\]/);
  assert.match(stop, /this\.batchFlight = null/);
  assert.match(stop, /this\.hookPhase = "NORMAL_WEAK_POINT"/);
});

test("Climax hides Weak Points and restores only markers whose blocks remain active", async () => {
  const source = await readFile(engineUrl, "utf8");
  const visual = isolate(source, "private setRainbowVisualState(active: boolean) {");
  assert.match(visual, /visual\.group\.visible = !active && visual\.block\.active/);
  assert.match(visual, /updateRainbowCannonColors/);
  const release = isolate(source, "private releaseCluster(cluster: BlockRuntime[], shotIndex: number) {");
  assert.match(release, /visual\.group\.visible = false/);
});

test("the HUD keeps main time, target bank, and Climax time visibly separate", async () => {
  const ui = await readFile(uiUrl, "utf8");
  assert.match(ui, /className={`round-clock/);
  assert.match(ui, /BANK \+\{hookState\.rainbowBankSeconds\}s/);
  assert.match(ui, /hookState\.rainbowTimeRemaining\.toFixed\(1\)/);
  assert.match(ui, /a plus only means the shot will hit a block or Rainbow Target, not that it will hit a Weak Point/);
});

test("Climax has a restrained falling-firework layer that pauses with the game", async () => {
  const [ui, css] = await Promise.all([readFile(uiUrl, "utf8"), readFile(cssUrl, "utf8")]);
  assert.match(ui, /function ClimaxFireworks\(\)/);
  assert.match(ui, /hookState\.phase === "RAINBOW_CLIMAX" && <ClimaxFireworks/);
  assert.match(css, /@keyframes climax-fall/);
  assert.match(css, /\.game-frame\.is-paused \.climax-fireworks span/);
});

test("the canonical offline HTML ships the hook code and authored level columns", async () => {
  const html = await readFile(htmlUrl, "utf8");
  for (const marker of [
    "RAINBOW_CLIMAX",
    "WEAK POINT",
    "RAINBOW TARGETS",
    "round_time",
    "weak_points",
    "rainbow_paths",
    "faces occupied cell",
    "3D Cannon Sort — Weak Point &amp; Rainbow Climax",
  ]) {
    assert.ok(html.includes(marker), `${marker} is missing from the standalone build`);
  }
});
