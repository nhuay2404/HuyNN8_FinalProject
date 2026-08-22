import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);
const uiUrl = new URL("../app/GamePrototype.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const rulesUrl = new URL("../app/game/rules.ts", import.meta.url);

function isolate(source, signature, stopAt = "\n  private ") {
  const start = source.indexOf(signature);
  if (start < 0) return "";
  const end = source.indexOf(stopAt, start + signature.length);
  return end > start ? source.slice(start, end) : source.slice(start);
}

test("a break pushes ring after ring, not just the blocks it touched", async () => {
  const source = await readFile(engineUrl, "utf8");
  const wave = isolate(source, "private sendBreakWave(cluster: BlockRuntime[]) {");
  assert.ok(wave, "sendBreakWave carries the push out of the hole");
  // The front walks outward instead of stopping at the cluster's own faces.
  assert.match(wave, /let front: BlockRuntime\[\] = cluster/);
  assert.match(wave, /front = \[\.\.\.nextRing\.keys\(\)\]/, "each ring becomes the next ring's source");
  assert.match(wave, /amplitude \*= WAVE_FALLOFF/, "the push has to weaken, or the far side kicks as hard as the hole");
  assert.match(wave, /delay: ring \* WAVE_RING_DELAY/, "the delay per ring is what makes it read as a wave");
  // Without this the wave would spread sideways through its own ring and crawl
  // instead of travelling as one front.
  const marking = wave.indexOf("for (const candidate of nextRing.keys()) reached.add(candidate.id)");
  const collecting = wave.indexOf("nextRing.set(candidate, away)");
  assert.ok(collecting > 0 && marking > collecting, "a ring is marked reached only after it is fully collected");
});

test("the wave holds a ring still until the push reaches it", async () => {
  const source = await readFile(engineUrl, "utf8");
  const update = isolate(source, "private updateNeighborKicks() {");
  assert.match(update, /if \(kick\.age < kick\.delay\)/, "a ring waiting its turn must not start early");
  assert.match(update, /const progress = \(kick\.age - kick\.delay\) \/ kick\.duration/);
  assert.match(update, /amount \* WAVE_PUSH \* kick\.amplitude/, "distance from the break decides how far a block moves");
});

test("a shot that lands puffs solid white round smoke", async () => {
  const source = await readFile(engineUrl, "utf8");
  const resources = isolate(source, "private ensureSmokeResources() {");
  assert.match(resources, /new THREE\.SphereGeometry\(0\.5, \d+, \d+\)/, "round puffs, and real geometry rather than sprites");
  assert.match(resources, /new THREE\.MeshBasicMaterial\(\{ color: 0xffffff \}\)/, "unlit and opaque, or the white greys out under the scene lights");
  assert.doesNotMatch(resources, /transparent/, "the puff never fades by alpha");

  const update = isolate(source, "private updateSmoke() {");
  assert.match(update, /const collapse = progress < 0\.55/, "the puff leaves by shrinking");
  assert.doesNotMatch(update, /\.opacity/, "touching opacity is what would break the solid white");

  // Every landing shows it, including a shot the reserve refuses.
  const handleHit = isolate(source, "private handleHit(block: BlockRuntime, projectile: Projectile) {");
  const effectAt = handleHit.indexOf("this.playImpactEffect(projectile.mesh.position, projectile.shotIndex)");
  assert.ok(effectAt > 0, "handleHit has to play the landing effect");
  assert.ok(effectAt < handleHit.indexOf("return"), "it comes before every early return, so no branch can skip it");
  // The router is the only place a skin is asked about, and the cannon still
  // gets the smoke.
  const impact = isolate(source, "private playImpactEffect(point: THREE.Vector3, seed: number) {");
  assert.match(impact, /else this\.spawnImpactSmoke\(point, seed\)/);
});

test("a shot that gets under the cluster lands on the floor instead of vanishing", async () => {
  const source = await readFile(engineUrl, "utf8");
  const update = isolate(source, "private updateProjectile(projectile: Projectile) {");
  assert.match(update, /projectile\.previous\.y > GROUND_Y && next\.y <= GROUND_Y/);
  assert.match(update, /this\.playGroundEffect\(contact, projectile\.shotIndex\)/);
  const groundRouter = isolate(source, "private playGroundEffect(point: THREE.Vector3, seed: number) {");
  assert.match(groundRouter, /else this\.spawnGroundSmoke\(point, seed\)/, "the cannon still skids into the floor with dust");
  // The block sweep runs first, so ground contact can never steal a hit.
  assert.ok(
    update.indexOf("const hit = this.sweepBlocks") < update.indexOf("GROUND_Y"),
    "blocks are tested before the floor",
  );
  const ground = source.slice(source.indexOf("const GROUND_Y"), source.indexOf("\n", source.indexOf("const GROUND_Y")));
  assert.match(ground, /-1\.9/, "the floor sits below the cannon base and well under the lowest block");
});

test("a shot that hit nothing shrinks away as it falls", async () => {
  const source = await readFile(engineUrl, "utf8");
  const fall = isolate(source, "private updateProjectileFall(projectile: Projectile, position: THREE.Vector3) {");
  assert.ok(fall, "the flight has its own presentation pass");
  assert.match(fall, /const descending = projectile\.velocity\.y \+ GRAVITY\.y \* projectile\.time < 0/);
  assert.match(fall, /if \(!descending\) return/, "a climbing shot keeps its full size");
  assert.match(fall, /\(position\.y - GROUND_Y\) \/ PROJECTILE_FALL_FADE_SPAN/, "size follows how close the floor is");
  assert.match(fall, /lerp\(PROJECTILE_FALL_MIN_SCALE, 1, height\)/);
  // Drawn size only. A shrinking ball that also collided smaller would change
  // what a shot hits, which is the fairness bug the aim fix removed.
  assert.doesNotMatch(fall, /PROJECTILE_RADIUS/);
  const sweep = isolate(source, "private sweepBlocks(worldA: THREE.Vector3, worldB: THREE.Vector3, inverseModel: THREE.Matrix4): SweepHit | null {");
  assert.match(sweep, /const radius = PROJECTILE_RADIUS;/, "the sweep never reads the mesh scale");

  // The pool hands the same mesh to the next shot.
  const fire = isolate(source, "private fire({ start, velocity }: BallisticSolution) {");
  assert.match(fire, /mesh\.scale\.setScalar\(1\)/, "a reused mesh would otherwise start out tiny");
});

test("a falling shot leaves a trail, spaced by time and gone quickly", async () => {
  const source = await readFile(engineUrl, "utf8");
  const fall = isolate(source, "private updateProjectileFall(projectile: Projectile, position: THREE.Vector3) {");
  assert.match(fall, /Math\.floor\(projectile\.time \/ interval\)/, "spaced by flight time, not once per frame");
  assert.match(fall, /if \(ticks !== projectile\.trailTicks\)/);
  assert.match(fall, /else this\.spawnFallTrail\(position, seed\)/);
  // The cannon's dust still waits for the shot to start dropping; only the
  // wand's ray runs the whole flight.
  assert.match(fall, /if \(this\.isMagic\(\) \|\| descending\)/);
  assert.match(fall, /this\.isMagic\(\) \? SPARKLE_TRAIL_INTERVAL : FALL_TRAIL_INTERVAL/);

  const trail = isolate(source, "private spawnFallTrail(point: THREE.Vector3, seed: number) {");
  assert.match(trail, /count: 1/, "one puff per step, or the trail becomes a rope");
  assert.match(trail, /life: FALL_TRAIL_LIFETIME/);
  // A trail puff must not bloom the way an impact puff does: growing puffs make
  // the line widen behind the ball, which reads as a thick wedge.
  assert.match(trail, /startScale: 1/);
  assert.match(trail, /size: PROJECTILE_RADIUS \* 0?\.\d+/, "smaller than the ball it trails");

  // Lifetime is per puff, so a trail puff can be gone long before an impact
  // puff would be.
  const update = isolate(source, "private updateSmoke() {");
  assert.match(update, /const progress = puff\.age \/ puff\.life/);
  const trailLife = source.slice(source.indexOf("const FALL_TRAIL_LIFETIME"), source.indexOf("\n", source.indexOf("const FALL_TRAIL_LIFETIME")));
  const impactLife = source.slice(source.indexOf("const SMOKE_LIFETIME"), source.indexOf("\n", source.indexOf("const SMOKE_LIFETIME")));
  assert.ok(
    Number(trailLife.match(/[\d.]+/)[0]) < Number(impactLife.match(/[\d.]+/)[0]),
    "a trail puff has to be shorter-lived than an impact puff",
  );
});

test("a claim no longer floats a hit label over the model", async () => {
  const sources = [
    ["the UI", await readFile(uiUrl, "utf8")],
    ["the engine", await readFile(engineUrl, "utf8")],
    ["the stylesheet", await readFile(cssUrl, "utf8")],
  ];
  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /burst-label|onBurst|burstKey|burst-up/, `${name} still carries the hit label`);
  }
  // The colour name only ever existed to be printed on that label.
  assert.doesNotMatch(await readFile(rulesUrl, "utf8"), /colorLabel/, "nothing prints a colour name any more");
});

test("smoke joins the fixed-step loop and shares one geometry and material", async () => {
  const source = await readFile(engineUrl, "utf8");
  const animate = source.slice(source.indexOf("private animate = () => {"));
  assert.match(animate, /if \(this\.smoke\.length\) this\.updateSmoke\(\)/);
  const resources = isolate(source, "private ensureSmokeResources() {");
  assert.match(resources, /this\.disposables\.push\(this\.smokeGeometry, this\.smokeMaterial\)/, "released once, with the other shared visuals");
});
