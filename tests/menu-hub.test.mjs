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

test("the menu blocks every gameplay gesture", async () => {
  const source = await readFile(engineUrl, "utf8");
  const canInteract = isolate(source, "private canInteract() {");
  assert.match(canInteract, /!this\.idle/, "aiming, rotating and firing all gate on canInteract");
});

test("the cluster turns in the menu even while a dialog is open", async () => {
  const source = await readFile(engineUrl, "utf8");
  const animate = source.slice(source.indexOf("private animate = () => {"));
  const idleBranch = animate.indexOf("if (this.idle) {");
  const pausedBranch = animate.indexOf("if (!this.paused) {");
  assert.ok(idleBranch > 0, "animate must spin the model while idle");
  assert.ok(
    idleBranch < pausedBranch,
    "the spin has to sit outside the paused branch, or opening settings would freeze the menu",
  );
  assert.match(animate.slice(idleBranch, pausedBranch), /premultiply\(this\.idleSpinDelta\)/);
});

test("the menu holds the cluster smaller and without the cannon", async () => {
  const source = await readFile(engineUrl, "utf8");
  const setIdle = isolate(source, "setIdle(next: boolean) {");
  assert.match(setIdle, /this\.cannonRoot\.visible = false/, "the menu shows the model alone");
  assert.match(setIdle, /this\.modelRoot\.scale\.setScalar\(MENU_MODEL_SCALE\)/, "the menu needs room to zoom into");
});

test("leaving the menu starts an intro instead of cutting straight to play", async () => {
  const source = await readFile(engineUrl, "utf8");
  const setIdle = isolate(source, "setIdle(next: boolean) {");
  assert.match(setIdle, /this\.introActive = true/);
  assert.match(setIdle, /this\.introFromQuaternion\.copy\(this\.modelRoot\.quaternion\)/, "the zoom has to start from wherever the idle spin left the cluster");
  assert.match(setIdle, /this\.cannonRoot\.position\.y = this\.cannonRestY - CANNON_INTRO_DROP/, "the cannon rises from below the frame");
});

test("the intro lands exactly on the authored transform and unlocks play only then", async () => {
  const source = await readFile(engineUrl, "utf8");
  const updateIntro = isolate(source, "private updateIntro(frameDelta: number) {");
  assert.match(updateIntro, /slerpQuaternions\(this\.introFromQuaternion, this\.defaultModelOrientation, eased\)/);
  assert.match(updateIntro, /lerp\(this\.introFromScale, 1, eased\)/);
  assert.match(updateIntro, /this\.modelRoot\.quaternion\.copy\(this\.defaultModelOrientation\)/, "the last frame must be exact, not eased-approximate");
  assert.match(updateIntro, /this\.modelRoot\.scale\.setScalar\(1\)/);
  assert.match(updateIntro, /this\.introActive = false/);

  // Firing mid-zoom would be judged against a model still in motion, which is
  // the same unfairness the aim fix removed.
  const canInteract = isolate(source, "private canInteract() {");
  assert.match(canInteract, /!this\.introActive/);
});

test("the level button is gone from the in-game toolbar", async () => {
  const source = await readFile(uiUrl, "utf8");
  assert.doesNotMatch(source, /level-button/);
  assert.doesNotMatch(source, /modal === "levels"/);
  // Anchored on the role rather than the class string, which now carries the
  // rise state and changes shape.
  const toolbarStart = source.indexOf('role="toolbar"');
  assert.ok(toolbarStart > 0, "could not find the in-game toolbar");
  const toolbar = source.slice(toolbarStart, source.indexOf("</div>", toolbarStart));
  assert.match(toolbar, /Open settings/);
  assert.match(toolbar, /Restart level/);
  assert.equal((toolbar.match(/<button/g) ?? []).length, 2, "settings and restart only");
});

test("levels and sheet import are reachable from the menu only", async () => {
  const source = await readFile(uiUrl, "utf8");
  // Both live inside the hub branch of the settings dialog.
  const hubBranch = source.slice(source.indexOf('{screen === "hub" ? ('), source.indexOf('<button className="hub-return-button"'));
  assert.match(hubBranch, /className="level-list"/);
  assert.match(hubBranch, /className="sheet-file-button"/);
  // And a drop only counts while the menu is up.
  assert.match(source, /screen === "hub" && Array\.from\(event\.dataTransfer\.types\)/);
});

test("tapping play hands over the level immediately and only then clears the menu", async () => {
  const source = await readFile(uiUrl, "utf8");
  const enterLevel = source.slice(source.indexOf("const enterLevel = ()"), source.indexOf("useEffect", source.indexOf("const enterLevel = ()")));
  assert.match(enterLevel, /setIdle\(false\)/, "the model must snap on the tap, not when the animation ends");
  assert.match(enterLevel, /setHubLeaving\(true\)/);
  // The overlay stops taking input while its furniture animates away, so a fast
  // player can aim during the exit.
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.hub-screen\.is-leaving \{ pointer-events: none; \}/);
});

test("the in-game settings dialog offers a way back to the menu", async () => {
  const source = await readFile(uiUrl, "utf8");
  assert.match(source, /className="hub-return-button" type="button" onClick=\{returnToHub\}/);
  const returnToHub = source.slice(source.indexOf("const returnToHub"), source.indexOf("\n", source.indexOf("const returnToHub")));
  assert.match(returnToHub, /startLevel\(sheet, levelIndex, "hub"\)/, "the menu must show a whole cluster, not a half-cleared board");
});

test("the crosshair cannot come back over the menu", async () => {
  const source = await readFile(engineUrl, "utf8");
  const showIdle = isolate(source, "private showIdleCrosshair() {");
  assert.match(
    showIdle,
    /classList\.toggle\("is-visible", !this\.idle && !this\.introActive\)/,
    "resize() also calls this, and a resize observation lands right after the menu opens",
  );
  assert.doesNotMatch(showIdle, /classList\.add\("is-visible"\)/);
});

test("the tools column rises with the rest of the level frame", async () => {
  const ui = await readFile(uiUrl, "utf8");
  assert.match(ui, /game-tools \$\{hudRising \? "is-rising" : ""\}/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.game-tools\.is-rising \.icon-button \{ animation: hud-rise/);
  assert.match(css, /\.hud-top\.is-rising \.goal-section \{ animation: hud-rise/);
});

test("the settings button looks the same in the menu and in a level", async () => {
  const ui = await readFile(uiUrl, "utf8");
  // The menu button reuses the in-game class, so size and shape can only be
  // changed in one place.
  assert.match(ui, /className="icon-button hub-settings-button"/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const hubButton = css.slice(css.indexOf(".hub-settings-button {"), css.indexOf("}", css.indexOf(".hub-settings-button {")));
  assert.match(hubButton, /width: 44px; height: 44px/, "same size as .game-tools .icon-button");
  assert.doesNotMatch(hubButton, /border-radius/, "shape comes from .icon-button, not from an override here");
  assert.doesNotMatch(hubButton, /background/, "colour comes from .icon-button too");
});

test("confirm and result actions read left to right as cancel then commit", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const restartActions = ui.slice(ui.indexOf('className="restart-actions"'), ui.indexOf("</div>", ui.indexOf('className="restart-actions"')));
  assert.ok(restartActions.indexOf("confirm-no") < restartActions.indexOf("confirm-yes"), "No sits left of Yes");
  assert.match(restartActions, />No</);
  assert.match(restartActions, />Yes</);

  const resultActions = ui.slice(ui.indexOf('className="result-actions"'), ui.indexOf("</div>", ui.indexOf('className="result-actions"')));
  assert.ok(resultActions.indexOf("Replay level") < resultActions.indexOf("Next level"), "Replay sits left of Next level");
});

test("no Vietnamese text is left in anything the player can read", async () => {
  const files = ["../app/GamePrototype.tsx", "../app/game/cosmetics.ts", "../app/game/rules.ts", "../app/game/level-format.ts", "../app/game/level-source.ts", "../app/game/CannonSortEngine.ts", "../work/levels.tsv"];
  const vietnamese = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const offenders = source
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      // Code comments are not player-facing; the check is about strings and data.
      .filter(({ line }) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("#"))
      .filter(({ line }) => vietnamese.test(line));
    assert.deepEqual(offenders.map((entry) => `${file}:${entry.number}`), [], `Vietnamese left in ${file}`);
  }
});

test("no phone tap highlight can flash over the screen", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // The play button covers the whole frame, so the highlight a phone paints over
  // a tapped element was a full-screen flash exactly at the transition.
  assert.match(css, /-webkit-tap-highlight-color: transparent;/);
  // Anchored on the line start: "html, body {" also contains "body {".
  const bodyStart = css.indexOf("\nbody {");
  assert.ok(bodyStart > 0, "could not find the body rule");
  const body = css.slice(bodyStart, css.indexOf("}", bodyStart));
  assert.match(body, /-webkit-tap-highlight-color: transparent/, "inherited from body so drag zones are covered too");
  assert.match(css, /\.hub-screen\.is-leaving \.hub-tap \{[^}]*outline: none;/, "a full-screen focus ring would read as a flash too");
});

test("the play hint pulse cannot collide with the exit animation", async () => {
  const ui = await readFile(uiUrl, "utf8");
  assert.match(ui, /<span className="hub-play-hint"><span>TAP TO PLAY<\/span><\/span>/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.hub-play-hint > span \{[^}]*animation: hub-play-pulse/, "pulse sits on the child");
  const hintRule = css.slice(css.indexOf(".hub-play-hint {"), css.indexOf("}", css.indexOf(".hub-play-hint {")));
  assert.doesNotMatch(hintRule, /animation/, "the parent only carries the exit animation");
});
