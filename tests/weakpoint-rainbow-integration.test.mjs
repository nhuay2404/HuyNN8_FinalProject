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
  // Presentation only now: the decal says which face, and the hit test reads
  // the face. Nothing may tie the drawn radius back to what counts as a hit.
  assert.match(build, /WEAK_POINT_VISUAL_RADIUS_RATIO/, "the decal still has an authored size");
  const test = isolate(source, "private projectileHitWeakPoint(block: BlockRuntime, projectile: Projectile) {");
  assert.doesNotMatch(test, /RADIUS|isBullseyeHit/, "the hit test must not consult the drawn radius");
  assert.match(test, /isWeakPointFaceHit\(\{/);
});

test("block impact reads the bypass flag at impact and splits claim from ricochet", async () => {
  const source = await readFile(engineUrl, "utf8");
  const hit = isolate(source, "private handleHit(block: BlockRuntime, projectile: Projectile) {");
  assert.match(hit, /resolveBlockImpact\(bypassArmed, faceHit\)/);
  // Read and spend in one place, or two balls landing in the same step would
  // both claim on one reward.
  assert.match(hit, /const bypassArmed = this\.weakPointBypassArmed;/);
  assert.match(hit, /if \(bypassArmed\) this\.consumeWeakPointBypass\(\);/);
  assert.ok(
    hit.indexOf("const bypassArmed") < hit.indexOf("this.consumeWeakPointBypass()"),
    "the flag has to be read before it is spent",
  );
  assert.match(hit, /if \(impactResolution === "RICOCHET_SHAKE"\)/);
  assert.match(hit, /this\.shakeCluster\(cluster, projectile\.shotIndex\)/);
  assert.match(hit, /this\.startRicochet\(projectile\)/);
  assert.ok(hit.indexOf("RICOCHET_SHAKE") < hit.indexOf("this.releaseCluster"), "a wrong face must return before claim");

  // A wrong face raises the guard on the struck block, not on the cluster: the
  // shake already says the group held.
  assert.match(hit, /this\.spawnShield\(block\)/);
  assert.ok(hit.indexOf("this.spawnShield(block)") < hit.indexOf("this.releaseCluster"), "the shield belongs to the refused branch");

  // The ball rebounds off a Weak Point too. Deleting it at the moment of the
  // hit read as the block swallowing the shot instead of breaking.
  assert.doesNotMatch(hit, /this\.removeProjectile\(projectile\)/, "the claim path must not delete the ball");
  assert.equal(hit.match(/this\.startRicochet\(projectile\)/g).length, 2, "both outcomes bounce the ball");
});

test("a refused block wears a blue guard that fades and never stacks", async () => {
  const source = await readFile(engineUrl, "utf8");
  const spawn = isolate(source, "private spawnShield(block: BlockRuntime) {");
  const step = isolate(source, "private updateShields() {");

  // Parented to the block so it rides the shake the same impact started.
  assert.match(spawn, /block\.mesh\.add\(mesh\)/);
  assert.match(spawn, /color: 0x49b8ff/, "blue, the colour players read as a shield");
  assert.match(spawn, /transparent: true/);
  assert.match(spawn, /MeshBasicMaterial/, "unlit, or the scene key light turns it into a face tint");
  // A second shot restarts the flash instead of adding a second layer, which
  // would double the opacity and read as a solid box.
  assert.match(spawn, /this\.shields\.find\(\(shield\) => shield\.block === block\)/);
  assert.match(spawn, /existing\.age = 0/);

  assert.match(step, /opacity = SHIELD_PEAK_OPACITY \* \(1 - progress\)/, "it fades out rather than cutting");
  assert.match(step, /!shield\.block\.active/, "a claimed block drops its guard instead of riding the debris");
  assert.match(step, /material\.dispose\(\)/, "each flash owns its material, so each must release it");
  assert.match(source, /if \(this\.shields\.length\) this\.updateShields\(\);/, "and it steps in the fixed loop");
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

test("a Rainbow Target arms one bypass and always stops its projectile", async () => {
  const source = await readFile(engineUrl, "utf8");
  const hit = isolate(source, "private handleRainbowTargetHit(target: RainbowTargetRuntime, projectile: Projectile) {");
  assert.match(hit, /if \(!target\.active \|\| target\.hit\) return/);
  assert.match(hit, /target\.hit = true/, "the latch is what makes the reward single-use");
  assert.match(hit, /this\.armWeakPointBypass\(\)/);
  assert.match(hit, /this\.removeProjectile\(projectile\)/);

  // Two targets before the next shot still owe one bypass: arming is a set, not
  // an increment, and nothing anywhere counts owed shots.
  const arm = isolate(source, "private armWeakPointBypass() {");
  assert.match(arm, /this\.weakPointBypassArmed = true;/);
  assert.doesNotMatch(arm, /\+\+|\+= 1/, "the bypass must not stack");

  // A shot that hits nothing keeps the reward, so only the block-impact path
  // may spend it.
  const consume = isolate(source, "private consumeWeakPointBypass() {");
  assert.match(consume, /this\.weakPointBypassArmed = false;/);
  const miss = isolate(source, "private handleMiss(projectile: Projectile) {");
  assert.doesNotMatch(miss, /BypassArmed|consumeWeakPointBypass/, "a miss must not spend the bypass");
});

test("the round is untimed, and the step that moves targets is the step that moves shots", async () => {
  const source = await readFile(engineUrl, "utf8");
  const timedStep = isolate(source, "private updateTimedGameplayStep() {");

  // Nothing ends a round on time any more. The clock that remains counts up and
  // exists only so the seeded spawn schedule has something to fire against.
  assert.doesNotMatch(source, /failTimeUp|mainTimeRemaining|"Time up"/, "the round timer is gone");
  assert.match(timedStep, /this\.roundElapsed \+= FIXED_STEP;/);

  // This is the only place projectiles are integrated, so the target interval
  // has to be built before they move and committed after.
  assert.equal(source.match(/this\.updateProjectile\(projectile\)/g).length, 1, "one integration site");
  assert.ok(
    timedStep.indexOf("rainbowTargetMotionsForInterval") < timedStep.indexOf("this.updateProjectile(projectile)"),
    "the moving-target interval must be prepared before collision",
  );
  assert.ok(
    timedStep.indexOf("this.updateProjectile(projectile)") < timedStep.indexOf("this.updateRainbowTargets()"),
    "the visible transform commits after the impacts in that interval",
  );

  // The sub-stepping existed to keep phase-at-impact exact. With a flag read at
  // impact there is no boundary left to split on.
  assert.doesNotMatch(source, /considerBoundary|hookStepDelta/, "the phase sub-stepping is gone");
});

test("a target flies a seeded free-form path, solved in its own frame", async () => {
  const source = await readFile(engineUrl, "utf8");
  const motions = isolate(source, "private rainbowTargetMotionsForInterval(intervalStart: number, intervalEnd: number) {");
  const update = isolate(source, "private updateRainbowTargets() {");

  assert.match(update, /rainbowWanderAt\(target\.seed, progress\)/);
  assert.doesNotMatch(source, /evaluateRainbowPath|pathId|RAINBOW_PATHS/, "the authored path table is gone");

  // Hitting something that is moving needs the segment it travels during the
  // step, not one sampled point, and the sweep solves relative to the target.
  assert.match(motions, /rainbowWanderAt\(target\.seed, \(liveStart - target\.spawnTime\)/);
  assert.match(motions, /rainbowWanderAt\(target\.seed, \(liveEnd - target\.spawnTime\)/);
  const sweep = isolate(source, "private sweepRainbowTargets(");
  assert.match(sweep, /relativeFrom/);
  assert.match(sweep, /relativeTo/);
  // Ordering a tie by id compared strings, so a tenth target sorted before the
  // second. spawnIndex is the number that id was built from.
  assert.doesNotMatch(sweep, /target\.id < best\.target\.id/);
  assert.match(sweep, /target\.spawnIndex < best\.target\.spawnIndex/);
});

test("the bullseye is a seven-colour spectrum", async () => {
  const source = await readFile(engineUrl, "utf8");
  const colors = source.slice(source.indexOf("const RAINBOW_RING_COLORS"), source.indexOf("] as const;", source.indexOf("const RAINBOW_RING_COLORS")));
  assert.equal((colors.match(/0x[0-9a-f]{6}/g) ?? []).length, 7, "seven rings, one per spectrum band");
  const build = isolate(source, "private buildRainbowTargets() {");
  assert.match(build, /RAINBOW_RING_COLORS\.map/, "geometry and material are shared across every target");
  assert.match(build, /createRainbowSpawnSchedule\(\{/);
  assert.match(build, /levelSeed: this\.level\.id/, "the same level schedules the same round twice");
});

test("every result path clears transient gameplay and leaves Climax presentation", async () => {
  const source = await readFile(engineUrl, "utf8");
  const stop = isolate(source, "private stopHookForResult() {");
  assert.match(stop, /this\.clearAimGesture\(true\)/);
  assert.match(stop, /this\.clearModelGesture\(\)/);
  assert.match(stop, /this\.projectiles\.slice\(\)\.forEach/);
  assert.match(stop, /this\.pendingResolutions = \[\]/);
  assert.match(stop, /this\.batchFlight = null/);
  assert.match(stop, /this\.weakPointBypassArmed = false;/, "a result cannot leave the rainbow layer up");
});

test("an armed bypass hides every Weak Point and coats the rig", async () => {
  const source = await readFile(engineUrl, "utf8");
  const visual = isolate(source, "private setRainbowVisualState(active: boolean) {");
  assert.match(visual, /visual\.group\.visible = !active && visual\.block\.active/);
  assert.match(visual, /this\.applyRainbowCannonFilter\(active\)/);
  const release = isolate(source, "private releaseCluster(cluster: BlockRuntime[], shotIndex: number) {");
  assert.match(release, /visual\.group\.visible = false/);

  // A coat over the rig, not a repaint of it: hue-cycling the cannon's own
  // materials recoloured the gun instead of layering something onto it.
  const filter = isolate(source, "private applyRainbowCannonFilter(active: boolean) {");
  assert.match(filter, /this\.cannonRoot\.add\(mesh\)/, "parented to the rig, so it rides aim and recoil");
  assert.match(filter, /transparent: true/);
  assert.match(filter, /MeshBasicMaterial/, "unlit, or the scene key light makes it paint");
  assert.match(filter, /makeRainbowTexture\(\)/);
  assert.doesNotMatch(source, /updateRainbowCannonColors|cannonMaterialColors/, "the recolour path is gone");
});

test("the armed state shows falling fireworks and a moving rainbow band", async () => {
  const [ui, css] = await Promise.all([readFile(uiUrl, "utf8"), readFile(cssUrl, "utf8")]);
  assert.match(ui, /function ClimaxFireworks\(\)/);
  assert.match(ui, /bypassArmed && <ClimaxFireworks/);
  assert.match(css, /@keyframes climax-fall/);
  assert.match(css, /\.game-frame\.is-paused \.climax-fireworks span/);

  // The banner carries the wave and the sentence. Absolutely positioned, or an
  // armed state would change --hud-height and shove the 3D scene around.
  assert.match(ui, /className="bypass-banner"/);
  assert.match(ui, /Next shot ignores Weak Points/);
  assert.match(ui, /role="status"/);
  const banner = css.slice(css.indexOf(".bypass-banner {"), css.indexOf("}", css.indexOf(".bypass-banner {")));
  assert.match(banner, /position: absolute/);
  assert.match(banner, /var\(--hud-height\)/);
  assert.match(css, /\.bypass-banner-wave[\s\S]{0,400}animation: rainbow-status/);
});

test("the canonical offline HTML ships the hook code and authored level columns", async () => {
  const html = await readFile(htmlUrl, "utf8");
  for (const marker of [
    "Next shot ignores Weak Points",
    "weak_points",
    "rainbow_target_count",
    "faces occupied cell",
    "3D Cannon Sort — Weak Point &amp; Rainbow Climax",
  ]) {
    assert.ok(html.includes(marker), `${marker} is missing from the standalone build`);
  }
});
