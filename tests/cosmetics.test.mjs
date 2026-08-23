import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COSMETICS,
  COSMETIC_ORDER,
  DEFAULT_COSMETIC,
  LOCKED_COSMETIC_SLOTS,
  getCosmetic,
  getSelectedCosmetic,
} from "../app/game/cosmetics.ts";

const cosmeticsUrl = new URL("../app/game/cosmetics.ts", import.meta.url);
const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);
const uiUrl = new URL("../app/GamePrototype.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

function isolate(source, signature, stopAt = "\n  private ") {
  const start = source.indexOf(signature);
  if (start < 0) return "";
  const end = source.indexOf(stopAt, start + signature.length);
  return end > start ? source.slice(start, end) : source.slice(start);
}

test("both skins exist, and an unknown id falls back instead of throwing", () => {
  assert.deepEqual(COSMETIC_ORDER, ["classic-cannon", "magic-wand"]);
  for (const id of COSMETIC_ORDER) {
    const cosmetic = COSMETICS[id];
    assert.equal(cosmetic.id, id);
    assert.ok(cosmetic.name && cosmetic.tagline, `${id} needs a name and a tagline for the picker`);
    assert.equal(typeof cosmetic.build, "function");
  }
  assert.equal(COSMETICS["classic-cannon"].flavor, "gunpowder");
  assert.equal(COSMETICS["magic-wand"].flavor, "magic");
  // A stored id from a build that had more skins must not take the game down.
  assert.equal(getCosmetic("nope-not-a-skin").id, DEFAULT_COSMETIC);
  // Nothing has selected anything in a bare node run, so the default stands.
  assert.equal(getSelectedCosmetic(), DEFAULT_COSMETIC);
  assert.ok(LOCKED_COSMETIC_SLOTS > 0, "the tray shows where the next skins go");
});

test("the rigs are built round, and nothing is a flat coloured plate", async () => {
  const source = await readFile(cosmeticsUrl, "utf8");
  const magic = isolate(source, "function buildMagicWand(groups: CosmeticRigGroups) {", "\n}");
  const cannon = isolate(source, "function buildClassicCannon(groups: CosmeticRigGroups) {", "\n}");
  // Runes drawn as thin boxes read as solid-colour cards lying on the base from
  // every angle the model can be turned to.
  assert.doesNotMatch(magic, /BoxGeometry/, "no flat plates on the arcane rig");

  // Both skins are the same class of object: same pedestal footprint, same
  // barrel length. A rig modelled at some other scale never looked like a
  // sibling of the one it replaces.
  const barrelOf = (rig) => rig.match(/CylinderGeometry\(([\d.]+), ([\d.]+), 2\.35, \d+\)/).slice(1).map(Number);
  const [magicBack, magicMuzzle] = barrelOf(magic);
  const [cannonBack, cannonMuzzle] = barrelOf(cannon);
  assert.match(magic, /CylinderGeometry\(1\.08, 1\.3, 0\.48, \d+\)/, "same base as the cannon");
  assert.match(cannon, /CylinderGeometry\(1\.08, 1\.3, 0\.48, \d+\)/);
  // The reversal is the read: the cannon flares out to its muzzle, the arcane
  // barrel narrows into its focus crystal.
  assert.ok(cannonMuzzle > cannonBack, "the cannon flares toward the muzzle");
  assert.ok(magicMuzzle < magicBack, "the arcane barrel tapers toward the muzzle");
  assert.ok(magicMuzzle >= 0.15, `a ${magicMuzzle} muzzle is a stick again, not a barrel`);

  // Segment floors, per geometry type. These counts are what the silhouette is
  // read at: the rig fills a third of the screen, so the numbers a shape was
  // blocked out with showed as facets.
  const floors = {
    CylinderGeometry: [null, null, null, 20],
    SphereGeometry: [null, 16, 12],
    TorusGeometry: [null, null, 12, 24],
    CapsuleGeometry: [null, null, 6, 14],
  };
  const calls = source.matchAll(/new THREE\.(Cylinder|Sphere|Torus|Capsule)Geometry\(([^)]*)\)/g);
  let checked = 0;
  for (const [call, kind, rawArgs] of calls) {
    const args = rawArgs.split(",").map((arg) => Number(arg.trim()));
    // Skip the calls that read their sizes from a variable rather than a
    // literal; the ring loop above is the only one.
    if (args.some((arg) => Number.isNaN(arg))) continue;
    checked += 1;
    for (const [index, floor] of floors[`${kind}Geometry`].entries()) {
      if (floor === null) continue;
      assert.ok(args[index] >= floor, `${call} has ${args[index]} where ${floor} is the floor`);
    }
  }
  // Only here so a regex that stops matching cannot make this test pass by
  // checking nothing.
  assert.ok(checked >= 12, `the scan found only ${checked} geometry calls, so it is not reading the rigs`);
});

test("nothing on a barrel crosses its housing while the shot pushes it back", async () => {
  const source = await readFile(cosmeticsUrl, "utf8");
  const engine = await readFile(engineUrl, "utf8");

  // The two files have to agree on the travel, or the clearance is solved
  // against the wrong number.
  const travelIn = (text) => Number(text.match(/const RECOIL_TRAVEL = ([\d.]+)/)[1]);
  assert.equal(travelIn(source), travelIn(engine), "RECOIL_TRAVEL must match on both sides");
  assert.match(engine, /position\.z = this\.recoil \* RECOIL_TRAVEL/, "and the engine has to use the constant");

  // Solved, not written down: a hand-tuned squash is what let the barrel's back
  // rim rise out of the cradle on every shot.
  const solver = isolate(source, "function housingYScale(", "\n}");
  assert.match(solver, /barrelBackZ \+ RECOIL_TRAVEL/);
  assert.match(solver, /barrelBackRadius \+ BARREL_LIFT/);
  // Either a solved squash or a hand-written number; the loop below is what
  // rejects the second kind.
  const housings = [...source.matchAll(/\.scale\.set\(1, (housingYScale\([^)]*\)|[\d.]+), 1\)/g)]
    .map(([, value]) => value);
  assert.equal(housings.length, 2, "both rigs have a housing");
  for (const value of housings) {
    assert.match(value, /^housingYScale\(/, `housing squash "${value}" is hand-tuned again`);
  }

  // And the shapes that used to pop are gone: a cap tucked inside the housing
  // appears out of nowhere the moment the barrel slides back.
  for (const rig of ["buildClassicCannon", "buildMagicWand"]) {
    const body = isolate(source, `function ${rig}(groups: CosmeticRigGroups) {`, "\n}");
    assert.doesNotMatch(body, /breech/, `${rig} still caps its barrel behind the housing`);
  }
});

test("the wand aims down a rune circle instead of iron sights", async () => {
  const engine = await readFile(engineUrl, "utf8");
  // One place decides it, so the first build and every later swap agree.
  const rig = isolate(engine, "private buildCosmeticRig() {");
  assert.match(rig, /classList\.toggle\("is-magic", this\.isMagic\(\)\)/);
  // The crosshair element outlives the engine, so the mark has to come off.
  assert.match(engine.slice(engine.indexOf("dispose() {")), /"is-magic",/);

  const css = await readFile(cssUrl, "utf8");
  // Sliced to the keyframes that follow this block, not the first in the file:
  // other features add their own animations above it.
  const magicStart = css.indexOf(".aim-crosshair.is-magic {");
  const magic = css.slice(magicStart, css.indexOf("@keyframes", magicStart));
  assert.match(magic, /border-radius: 50%/, "the bars become rings");
  assert.match(magic, /animation: rune-spin/);
  assert.match(magic, /repeating-conic-gradient/, "tick marks around the circle");
  assert.match(magic, /-webkit-mask:/, "and the mask needs the prefixed form too");
  // A circle cannot show the 45 degree flip the cross uses for "no target", so
  // that state has to be re-stated in colour.
  assert.match(magic, /is-aiming:not\(\.is-target-valid\)[\s\S]{0,220}border-color/);
  assert.match(magic, /is-target-valid::before \{ border-color/);
  const spin = css.slice(css.indexOf("@keyframes rune-spin"), css.indexOf("}", css.indexOf("@keyframes rune-spin") + 40));
  assert.match(spin, /translate\(-50%,-50%\) rotate/, "the rings are centred by the same translate the cross uses");
});

test("the choice is stored the way the haptics preference is", async () => {
  const source = await readFile(cosmeticsUrl, "utf8");
  assert.match(source, /const STORAGE_KEY = "cannon-sort:v1:cosmetic"/);
  const read = isolate(source, "function readStoredCosmetic(): CosmeticId {", "\n}");
  assert.match(read, /typeof window === "undefined"/, "the server pass has no storage to read");
  assert.match(read, /catch \{/, "a file:// page or privacy mode can refuse storage outright");
  const write = isolate(source, "export function setSelectedCosmetic(next: CosmeticId) {", "\n}");
  assert.match(write, /catch \{/);
  assert.match(write, /window\.localStorage\.setItem\(STORAGE_KEY/);
});

test("a skin is only a look: it cannot move the muzzle or touch the flight", async () => {
  const source = await readFile(cosmeticsUrl, "utf8");
  // The muzzle is where every shot starts. A rig that moved it would give one
  // skin a different trajectory from the other. Comments may name it; code may
  // not, and the rig groups do not even hand it over.
  const code = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(code, /muzzleAnchor/, "rigs decorate the frame, they do not move it");
  for (const name of ["FIXED_LAUNCH_SPEED", "PROJECTILE_RADIUS", "GRAVITY", "SHOT_COOLDOWN"]) {
    assert.ok(!code.includes(name), `${name} is gameplay and has no business in a skin`);
  }
  const groups = isolate(source, "export type CosmeticRigGroups = {", "\n};");
  assert.doesNotMatch(groups, /muzzleAnchor/, "the anchor is not even passed to a rig");
  // And the frame itself still owns the anchor.
  const engine = await readFile(engineUrl, "utf8");
  const frame = isolate(engine, "private buildCannon() {");
  assert.match(frame, /this\.muzzleAnchor\.position\.z = -2\.18/);
  assert.match(frame, /this\.buildCosmeticRig\(\)/);
});

test("swapping a skin takes the old rig back out and frees it", async () => {
  const engine = await readFile(engineUrl, "utf8");
  const swap = isolate(engine, "setCosmetic(id: CosmeticId) {");
  assert.match(swap, /if \(this\.cosmetic\.id === id\) return/, "re-picking the same skin rebuilds nothing");
  assert.match(swap, /disposeCosmeticParts\(this\.cosmeticParts\)/);
  assert.match(swap, /this\.buildCosmeticRig\(\)/);

  const source = await readFile(cosmeticsUrl, "utf8");
  const dispose = isolate(source, "export function disposeCosmeticParts(parts: THREE.Object3D[]) {", "\n}");
  assert.match(dispose, /geometry\?\.dispose\(\)/);
  assert.match(dispose, /entry\.dispose\(\)/, "materials go too, or a skin swap leaks one per swap");
  // Rigs must not share module level geometry: the engine's teardown disposes
  // whatever it finds in its scene, which would rob the next level.
  assert.doesNotMatch(source.slice(0, source.indexOf("function buildClassicCannon")), /new THREE\.(Box|Cylinder|Sphere|Torus|Octahedron|Capsule)Geometry/);
});

test("the wand replaces the cannon's smoke instead of layering on top of it", async () => {
  const engine = await readFile(engineUrl, "utf8");
  const impact = isolate(engine, "private playImpactEffect(point: THREE.Vector3, seed: number) {");
  assert.match(impact, /if \(this\.isMagic\(\)\) this\.spawnSparkleBurst/);
  assert.match(impact, /else this\.spawnImpactSmoke/, "either one or the other, never both");
  const ground = isolate(engine, "private playGroundEffect(point: THREE.Vector3, seed: number) {");
  assert.match(ground, /if \(this\.isMagic\(\)\) this\.spawnFirework/);
  assert.match(ground, /else this\.spawnGroundSmoke/);
  // Every branch asks the same question, so a third skin plugs in at one place.
  const flavor = isolate(engine, "private isMagic() {");
  assert.match(flavor, /this\.cosmetic\.flavor === "magic"/);

  // A shot that ended on the floor is the firework; a shot that landed on a
  // block is the bling. They must not be the same call.
  const firework = isolate(engine, "private spawnFirework(point: THREE.Vector3, seed: number) {");
  const burst = isolate(engine, "private spawnSparkleBurst(point: THREE.Vector3, seed: number) {");
  const gravityOf = (text) => Number(text.match(/gravity: (-?[\d.]+)/)[1]);
  assert.ok(gravityOf(firework) < gravityOf(burst), "a firework falls; bling floats");
});

test("the sparkles run in the fixed step and share one geometry per engine", async () => {
  const engine = await readFile(engineUrl, "utf8");
  const animate = engine.slice(engine.indexOf("private animate = () => {"));
  assert.match(animate, /if \(this\.sparkles\.length\) this\.updateSparkles\(\)/);
  const resources = isolate(engine, "private ensureSparkleResources() {");
  assert.match(resources, /this\.disposables\.push\(this\.sparkleGeometry\)/);
  assert.match(resources, /new THREE\.MeshBasicMaterial\(\{ color \}\)/, "unlit, so a spark reads as light");
  const update = isolate(engine, "private updateSparkles() {");
  assert.match(update, /scale\.setScalar\(Math\.max\(0\.001/, "it goes out by shrinking, like the smoke");
});

test("the preview fires demo shots that cannot reach the level", async () => {
  const engine = await readFile(engineUrl, "utf8");
  const showcase = isolate(engine, "private updateShowcase() {");
  assert.ok(showcase, "the preview has its own update");
  // fire() raises the shot index, arms a cooldown and can end the level on the
  // shot limit. None of that may happen behind a menu.
  assert.doesNotMatch(showcase, /this\.state/);
  assert.doesNotMatch(showcase, /handleHit|sweepBlocks|this\.fire\(/);
  const launch = isolate(engine, "private launchShowcaseShot() {");
  assert.doesNotMatch(launch, /this\.state\s*=/);
  assert.match(launch, /takeProjectileMesh\(\)/, "borrows the same pool rather than allocating per demo shot");

  const enter = isolate(engine, "setShowcase(next: boolean) {");
  assert.match(enter, /this\.modelRoot\.visible = false/, "the cluster steps aside for the rig");
  assert.match(enter, /this\.cannonRoot\.position\.copy\(SHOWCASE_POSITION\)/);
  assert.match(enter, /this\.cannonRoot\.position\.copy\(this\.cannonRestPosition\)/, "and goes back exactly, not approximately");
  // Aiming and firing stay locked while the picker is up.
  assert.match(isolate(engine, "private canInteract() {"), /!this\.showcase/);
  // Pooled meshes have to leave the scene before teardown disposes what it
  // finds, or the shared projectile geometry goes with them.
  assert.match(engine.slice(engine.indexOf("dispose() {")), /this\.clearShowcaseShots\(\)/);
});

test("closing the picker takes its particles with it", async () => {
  const engine = await readFile(engineUrl, "utf8");
  const showcase = isolate(engine, "setShowcase(next: boolean) {");

  // A puff lives 0.46s and a firework 0.72s, so a demo shot fired just before
  // the screen closes keeps playing over the menu behind it. Cleared on both
  // transitions, and before the branch, so neither direction inherits a burst.
  const clearAt = showcase.indexOf("this.clearParticles()");
  assert.ok(clearAt > 0, "setShowcase has to drop the live particles");
  assert.ok(clearAt < showcase.indexOf("if (next) {"), "cleared for both directions, not just one");

  const clear = isolate(engine, "private clearParticles() {");
  assert.match(clear, /this\.smoke = \[\]/, "puffs go");
  assert.match(clear, /this\.sparkles = \[\]/, "and sparks go");
  assert.match(clear, /this\.scene\.remove\(puff\.mesh\)/, "out of the scene, not just out of the array");
  assert.match(clear, /this\.scene\.remove\(sparkle\.mesh\)/);

  // The barrel is left mid-recoil by the last demo shot, and the decay would
  // otherwise keep running on whatever the rig does next.
  assert.match(showcase, /this\.recoil = 0/);
  assert.match(showcase, /this\.barrelVisual\.position\.z = 0/);
});

test("thumbnails are rendered by the one shared renderer, once", async () => {
  const source = await readFile(cosmeticsUrl, "utf8");
  const capture = isolate(source, "export function getCosmeticThumbnails(renderer: THREE.WebGLRenderer) {", "\n}");
  assert.match(capture, /if \(thumbnailCache\) return thumbnailCache/, "opening the picker twice must not re-render");
  assert.match(capture, /renderer\.readRenderTargetPixels\(target/);
  assert.match(capture, /renderer\.setRenderTarget\(previousTarget\)/, "the game's own target has to be handed back");
  assert.match(capture, /renderer\.setClearAlpha\(previousAlpha\)/);
  assert.match(capture, /target\.dispose\(\)/);
  assert.match(capture, /SRGBColorSpace/, "or the cards come out darker than the model on screen");
  // Flipped, because WebGL reads rows bottom up and a canvas writes them top down.
  assert.match(capture, /size - 1 - row/);

  const engine = await readFile(engineUrl, "utf8");
  assert.match(engine, /getCosmeticThumbnails\(this\.renderer\)/, "no second WebGL context for the picker");
});

test("the Skin button opens a picker that leaves the preview visible", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const sideButtons = ui.slice(ui.indexOf('className="hub-side-buttons"'), ui.indexOf("</div>", ui.indexOf('className="hub-side-buttons"')));
  assert.match(sideButtons, /onClick=\{openCosmetics\}/, "Skin is live now");
  // The button carries the rig as its mark, drawn rather than loaded, and the
  // word stays: an icon on its own would not say which screen it opens.
  assert.match(sideButtons, /<CannonMountIcon \/>\s*\n\s*Skin/);
  const icon = ui.slice(ui.indexOf("function CannonMountIcon()"), ui.indexOf("function focusableIn"));
  assert.match(icon, /viewBox="0 0 24 24"/);
  assert.match(icon, /aria-hidden="true"/, "the word is the accessible name, not the drawing");
  assert.match(icon, /rotate\(38 12\.7 8\.8\)/, "the barrel is the tilted mass");
  assert.doesNotMatch(icon, /<img|url\(|fill="var\(/, "no asset, and no var() in a presentation attribute — it does not resolve there");
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /\.hub-side-icon-accent \{ fill: var\(--accent\)/, "the gold parts are filled from CSS instead");
  // Tutorial now owns the second menu slot that used to be the disabled Shop
  // placeholder. It stays a sibling of Skin, so opening either screen cannot
  // accidentally turn the other button into part of its overlay.
  assert.match(sideButtons, /className="hub-side-button hub-tutorial-button"[\s\S]{0,180}onClick=\{beginTutorial\}/);
  assert.match(sideButtons, /<span className="hub-tutorial-icon"[^>]*>\?<\/span>\s*\n\s*Tutorial/);

  // Not a modal: .modal-overlay paints an opaque backdrop, which would cover
  // the rig the picker exists to show.
  const screen = ui.slice(ui.indexOf('className="cosmetic-screen"'), ui.indexOf('className="cosmetic-tray"'));
  assert.doesNotMatch(screen, /modal-overlay/);
  assert.match(ui, /aria-modal="true"/);

  // The picker replaces the menu instead of sitting on top of it: the level
  // name, the side buttons and the play hint were bleeding through the
  // see-through middle and fighting the skin being previewed.
  assert.match(ui, /\{screen === "hub" && !cosmeticOpen && \(/, "the menu is unmounted while the picker is up");
  assert.doesNotMatch(ui, /inert=\{cosmeticOpen/, "nothing left behind to make inert");
  assert.doesNotMatch(screen, /cosmetic-currency/, "no placeholder currency on this screen");
  assert.doesNotMatch(css, /cosmetic-currency/);
  // Focus cannot go back to a button that has not been re-mounted yet.
  assert.match(ui, /cosmeticClosingRef\.current = true/);
  const restore = ui.slice(ui.indexOf("if (cosmeticOpen || !cosmeticClosingRef.current) return;"));
  assert.match(restore.slice(0, 200), /skinButtonRef\.current\?\.focus\(\)/);

  const stage = css.slice(css.indexOf(".cosmetic-stage {"), css.indexOf("}", css.indexOf(".cosmetic-stage {")));
  assert.match(stage, /pointer-events: none/, "the window onto the 3D preview cannot catch taps");
});

test("the picker's scrim stays off the rig it is showing", async () => {
  const css = await readFile(cssUrl, "utf8");
  const screen = css.slice(css.indexOf(".cosmetic-screen {"), css.indexOf("}", css.indexOf(".cosmetic-screen {")));
  const gradient = screen.match(/linear-gradient\(180deg,([^;]+)\)/);
  assert.ok(gradient, "the screen dims the scene with one vertical gradient");
  const stops = [...gradient[1].matchAll(/rgba\([^)]*,\s*(\.\d+|[01])\)\s*(\d+)%/g)]
    .map(([, alpha, percent]) => [Number(percent), Number(alpha)]);
  assert.ok(stops.length >= 3, "parsed the stops");

  const alphaAt = (pct) => {
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [p0, a0] = stops[i];
      const [p1, a1] = stops[i + 1];
      if (pct >= p0 && pct <= p1) return a0 + (a1 - a0) * ((pct - p0) / (p1 - p0));
    }
    return stops.at(-1)[1];
  };

  // The rig fills 26-55% of the frame height — measured by projecting its
  // corners, see SHOWCASE_POSITION. A ramp that reaches the bottom of that band
  // puts the model's own base in shadow, which is what it used to do (0.34 at
  // 55%). The tray below paints its own background, so nothing down there needs
  // the scrim to be heavy either.
  for (const pct of [26, 35, 45, 55]) {
    assert.ok(alphaAt(pct) <= 0.2, `scrim is ${alphaAt(pct).toFixed(2)} at ${pct}% of the frame, over the rig`);
  }
  assert.ok(alphaAt(0) > 0.4, "the top still has to carry the title");
});

test("a card previews, the button equips, and closing reverts the preview", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const open = ui.slice(ui.indexOf("const openCosmetics = ()"), ui.indexOf("const closeCosmetics"));
  assert.match(open, /captureCosmeticThumbnails\(\)/);
  assert.match(open, /engine\.setShowcase\(true\)/);

  const close = ui.slice(ui.indexOf("const closeCosmetics = useCallback"), ui.indexOf("const showCosmetic"));
  assert.match(close, /setCosmetic\(equippedCosmetic\)/, "a skin only looked at must not stick");
  assert.match(close, /setShowcase\(false\)/);

  const show = ui.slice(ui.indexOf("const showCosmetic = ("), ui.indexOf("const equipCosmetic"));
  assert.match(show, /setPreviewCosmetic\(id\)/);
  assert.match(show, /setCosmetic\(id\)/);

  const equip = ui.slice(ui.indexOf("const equipCosmetic = ()"), ui.indexOf("useEffect", ui.indexOf("const equipCosmetic = ()")));
  assert.match(equip, /setEquippedCosmetic\(previewCosmetic\)/);
  assert.match(equip, /storeSelectedCosmetic\(previewCosmetic\)/, "and it survives a reload");

  // The button reads the state rather than being toggled by hand.
  assert.match(ui, /\{previewCosmetic === equippedCosmetic \? "Selected" : "Select"\}/);
  assert.match(ui, /className="cosmetic-card is-locked"[\s\S]{0,120}disabled/, "empty slots are inert");
});
