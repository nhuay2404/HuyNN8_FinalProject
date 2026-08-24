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

test("Weak Points use the white target mark while flying Rainbow Targets keep the spectrum", async () => {
  const source = await readFile(engineUrl, "utf8");
  const build = isolate(source, "private buildWeakPoints() {");
  const targetBuild = isolate(source, "private buildRainbowTargets() {");
  const spectrumLogo = isolate(
    source,
    "function createSpectrumRingGeometries",
    "\n}\n\nfunction createWeakPointTargetGeometries",
  );
  const weakPointLogo = isolate(
    source,
    "function createWeakPointTargetGeometries",
    "\n}\n\nfunction gridKey",
  );

  assert.match(source, /const WEAK_POINT_TARGET_COLOR = 0xffffff;/, "the product target mark is white");
  assert.match(source, /const WEAK_POINT_TARGET_OUTLINE = 0x10152f;/, "a navy keyline protects it on bright blocks");
  assert.equal(
    weakPointLogo.match(/new THREE\.RingGeometry/g)?.length,
    4,
    "two white rings and their two wider keylines are shared by every marker",
  );
  assert.doesNotMatch(weakPointLogo, /CircleGeometry/, "transparent gaps and centre let the block colour show through");
  assert.match(weakPointLogo, /radius \* 0\.73, radius \* 1\.05/, "the outside keyline extends past the white ring");
  assert.match(weakPointLogo, /radius \* 0\.22, radius \* 0\.54/, "the inside keyline protects both edges");
  assert.match(build, /createWeakPointTargetGeometries\(visualRadius\)/);
  assert.match(build, /color: WEAK_POINT_TARGET_OUTLINE/);
  assert.match(build, /color: WEAK_POINT_TARGET_COLOR/);
  assert.doesNotMatch(build, /RAINBOW_RING_COLORS|createSpectrumRingGeometries/, "a block marker must not look like the Rainbow reward");
  assert.match(build, /if \(this\.options\.showWeakPoints === false\) return;/, "the controls-only tutorial can hide the mechanic entirely");

  assert.match(spectrumLogo, /RAINBOW_RING_COLORS\.map/, "the flying objective still owns all seven spectrum bands");
  assert.match(spectrumLogo, /new THREE\.RingGeometry/);
  assert.match(spectrumLogo, /new THREE\.CircleGeometry/, "the flying bullseye centre stays filled");
  assert.match(targetBuild, /createSpectrumRingGeometries\(RAINBOW_TARGET_RADIUS\)/);
  assert.match(targetBuild, /RAINBOW_RING_COLORS\.map/, "target materials stay rainbow as well as their geometry");
  assert.doesNotMatch(build, /CylinderGeometry|TorusGeometry/, "only the flying target receives physical depth");
  assert.doesNotMatch(source, /WEAK_POINT_CRACK|createWeakPointCrackGeometry/);
  assert.match(build, /block\.mesh\.add\(group\)/, "the marker has to inherit the block/model transform");
  assert.match(build, /weakPointFaceNormal\(spec\.face\)/);
  // Presentation only: the bullseye says which face, and the hit test reads the
  // face. Nothing may tie the drawn size back to what counts as a hit.
  assert.match(build, /WEAK_POINT_VISUAL_RADIUS_RATIO/, "the decal still has an authored size");
  const test = isolate(source, "private projectileHitWeakPoint(block: BlockRuntime, projectile: Projectile) {");
  assert.doesNotMatch(test, /RADIUS|isBullseyeHit/, "the hit test must not consult the drawn radius");
  assert.match(test, /isWeakPointFaceHit\(\{/);
});

test("a Weak Point reveal pops subtly only when its Puzzle face is exterior", async () => {
  const source = await readFile(engineUrl, "utf8");
  const build = isolate(source, "private buildWeakPoints() {");
  const exposure = isolate(source, "private isWeakPointExternallyExposed(visual: WeakPointVisual) {");
  const reveal = isolate(source, "private updateWeakPointReveal(visual: WeakPointVisual) {");
  const sync = isolate(source, "private syncWeakPointVisual(visual: WeakPointVisual) {");
  const bypass = isolate(source, "private setRainbowVisualState(active: boolean) {");
  const hit = isolate(source, "private projectileHitWeakPoint(block: BlockRuntime, projectile: Projectile) {");

  const duration = Number(source.match(/const WEAK_POINT_REVEAL_SECONDS = ([0-9.]+);/)?.[1]);
  const startScale = Number(source.match(/const WEAK_POINT_REVEAL_START_SCALE = ([0-9.]+);/)?.[1]);
  const peakScale = Number(source.match(/const WEAK_POINT_REVEAL_PEAK_SCALE = ([0-9.]+);/)?.[1]);
  assert.ok(duration >= 0.12 && duration <= 0.3, `the reveal should stay brief, got ${duration}s`);
  assert.ok(startScale >= 0.85 && startScale < 1, `the mark should begin only slightly tucked in, got ${startScale}`);
  assert.ok(peakScale > 1 && peakScale <= 1.08, `the overshoot should remain restrained, got ${peakScale}`);

  assert.match(build, /group\.visible = false/, "the constructor must not flash every mark before the first fixed step");
  assert.match(exposure, /isWeakPointFaceExposed\(visual\.spec/);
  assert.match(exposure, /\?\.active === true/, "an inactive block left in blockMap no longer covers the face");
  assert.match(
    sync,
    /visible && exposed && \(!visual\.wasVisible \|\| !visual\.wasExposed\)/,
    "a blink reveal and a newly uncovered live mark each start one pop",
  );
  assert.match(sync, /else if \(!visible\)/, "hiding the mark cancels an unfinished pop");
  assert.match(sync, /this\.updateWeakPointReveal\(visual\)/);

  assert.match(reveal, /visual\.group\.scale\.setScalar\(scale\)/, "only the mark itself grows");
  assert.match(reveal, /visual\.group\.scale\.setScalar\(1\)/, "every reveal lands on the exact resting scale");
  assert.doesNotMatch(reveal, /block\.mesh\.scale|opacity|emissive|spawn/i, "the quiet cue needs no block pulse, flash or particles");

  assert.match(bypass, /this\.syncWeakPointVisual\(visual\)/, "restoring marks after the bypass uses the same exposure gate");
  assert.doesNotMatch(hit, /reveal|exposed|scale/i, "the presentation effect must not change the whole-face hit rule");
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
  assert.match(hit, /this\.options\.canClaimColor/, "a tutorial may temporarily protect colours it has not introduced");
  assert.equal(
    hit.match(/this\.startRicochet\(projectile\)/g).length,
    3,
    "tutorial refusal, wrong-face refusal and a successful claim all bounce the ball",
  );
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
  assert.match(hit, /target\.impactStartedAt = this\.roundElapsed/, "the target should stay for its impact response");
  assert.match(hit, /target\.impactDirection\.copy\(projectile\.velocity\)/, "the recoil follows the incoming ball");
  assert.match(hit, /target\.group\.visible = true/, "the target cannot disappear before the impact animation");
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

test("a target flies one seeded linear path, solved in its own frame", async () => {
  const source = await readFile(engineUrl, "utf8");
  const motions = isolate(source, "private rainbowTargetMotionsForInterval(intervalStart: number, intervalEnd: number) {");
  const update = isolate(source, "private updateRainbowTargets() {");

  assert.match(update, /rainbowLinearAt\(target\.seed, progress\)/);
  assert.doesNotMatch(source, /evaluateRainbowPath|pathId|RAINBOW_PATHS/, "the authored path table is gone");

  // Hitting something that is moving needs the segment it travels during the
  // step, not one sampled point, and the sweep solves relative to the target.
  assert.match(motions, /rainbowLinearAt\(target\.seed, \(liveStart - target\.spawnTime\)/);
  assert.match(motions, /rainbowLinearAt\(target\.seed, \(liveEnd - target\.spawnTime\)/);
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

test("the Rainbow Target is a deep 3D model with a physical impact response", async () => {
  const source = await readFile(engineUrl, "utf8");
  const build = isolate(source, "private buildRainbowTargets() {");
  const impact = isolate(source, "private updateRainbowTargetImpact(target: RainbowTargetRuntime) {");

  assert.match(build, /new THREE\.CylinderGeometry[\s\S]*RAINBOW_TARGET_DEPTH/, "the target body must have authored depth");
  assert.match(build, /new THREE\.TorusGeometry/, "front and back rims make the depth readable");
  assert.match(build, /frontRim\.position\.z/);
  assert.match(build, /backRim\.position\.z/);

  assert.match(impact, /RAINBOW_TARGET_IMPACT_DURATION/);
  assert.match(impact, /RAINBOW_TARGET_IMPACT_PUSH/);
  assert.match(impact, /target\.impactDirection/);
  assert.match(impact, /target\.group\.rotateX\(wobble\)/);
  assert.match(impact, /target\.group\.scale\.set\(/, "the plate compresses before it leaves");
  assert.match(impact, /target\.group\.visible = false/, "the impact animation owns the eventual hide");
});

test("the Rainbow Target hitbox extends beyond the visible plate", async () => {
  const source = await readFile(engineUrl, "utf8");
  const colliderRadius = Number(source.match(/const RAINBOW_TARGET_COLLIDER_RADIUS = ([0-9.]+);/)?.[1]);
  const visibleRadius = Number(source.match(/const RAINBOW_TARGET_RADIUS = ([0-9.]+);/)?.[1]);
  const projectileRadius = Number(source.match(/const PROJECTILE_RADIUS = ([0-9.]+);/)?.[1]);
  assert.equal(colliderRadius, 0.8);
  assert.ok(colliderRadius > visibleRadius, "the collider must be more forgiving than the visible target");
  assert.equal(Math.round((colliderRadius + projectileRadius) * 100) / 100, 0.95, "the swept hit radius includes the ball");
  const aimRay = isolate(source, "private raycastRainbowTargetSurfacePoint(");
  assert.match(aimRay, /RAINBOW_TARGET_COLLIDER_RADIUS/, "crosshair selection uses the same forgiving radius");
  const sweep = isolate(source, "private sweepRainbowTargets(");
  assert.equal(
    sweep.match(/RAINBOW_TARGET_COLLIDER_RADIUS \+ PROJECTILE_RADIUS/g)?.length,
    2,
    "both moving and sampled target sweeps include the ball radius",
  );
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
  assert.match(visual, /if \(active\)/);
  assert.match(visual, /visual\.group\.visible = false/);
  assert.match(visual, /visual\.revealAge = null/);
  assert.match(visual, /this\.syncWeakPointVisual\(visual\)/);
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
  assert.match(
    ui,
    /const showClimaxFeedback = \(screen === "playing" \|\| \(tutorialMode && tutorialProgress\.chapter === 2\)\) && bypassArmed;/,
    "Climax feedback belongs to campaign play and the final tutorial only",
  );
  assert.match(ui, /showClimaxFeedback && !state\.result && <ClimaxFireworks/);
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
    "Prefer FRONT BACK RIGHT LEFT TOP BOTTOM",
    "Umbrella Trial",
    "Pixel Spark Portrait",
    "rainbow_target_count",
    "faces occupied cell",
    "3D Cannon Sort — Weak Point &amp; Rainbow Climax",
  ]) {
    assert.ok(html.includes(marker), `${marker} is missing from the standalone build`);
  }
});
