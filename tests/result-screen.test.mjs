import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiUrl = new URL("../app/GamePrototype.tsx", import.meta.url);
const rulesUrl = new URL("../app/game/rules.ts", import.meta.url);
const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

// A whole at-rule, not just its first step: the closing brace of a keyframes
// block is the one at the start of a line.
function keyframes(css, name) {
  const start = css.indexOf(`@keyframes ${name}`);
  return start < 0 ? "" : css.slice(start, css.indexOf("\n}", start));
}

// Walks div tokens from an opening tag and returns where its matching close is.
// Self-closing tags are not opens, or the depth never comes back down.
function closingIndexOfDiv(source, openTagIndex) {
  const tag = /<div\b[^>]*?(\/?)>|<\/div>/g;
  tag.lastIndex = openTagIndex;
  let depth = 0;
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    if (match[0] === "</div>") {
      depth -= 1;
      if (depth === 0) return match.index;
    } else if (match[1] !== "/") {
      depth += 1;
    }
  }
  return -1;
}

test("the result screen covers the whole frame, not just the scene below the HUD", async () => {
  const ui = await readFile(uiUrl, "utf8");
  // `.scene-wrap` is inset below the HUD by design, so an overlay nested inside
  // it starts ~116px down the frame and leaves the HUD strip showing along the
  // top — and its `overflow: hidden` clips the fireworks too. The overlay has to
  // be a sibling of the scene, like the dialogs are.
  const sceneAt = ui.indexOf('<div className="scene-wrap">');
  assert.ok(sceneAt > 0, "the scene wrapper is still there");
  const sceneClose = closingIndexOfDiv(ui, sceneAt);
  assert.ok(sceneClose > sceneAt, "found where the scene wrapper closes");
  const overlayAt = ui.indexOf("{state.result && !state.postWinClearing && (");
  assert.ok(overlayAt > sceneClose, "the result overlay must sit outside .scene-wrap");

  const css = await readFile(cssUrl, "utf8");
  const scene = css.slice(css.indexOf(".scene-wrap {"), css.indexOf("}", css.indexOf(".scene-wrap {")));
  assert.match(scene, /inset: calc\(/, "this is the inset that made the nesting matter");
  const overlay = css.slice(css.indexOf(".result-overlay {"), css.indexOf("}", css.indexOf(".result-overlay {")));
  assert.match(overlay, /inset: 0/, "and the overlay covers its whole parent");
});

test("the end of a level is a bordered panel, not a wash over the frame", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const overlayAt = ui.indexOf("{state.result && !state.postWinClearing && (");
  const overlay = ui.slice(overlayAt, ui.indexOf("</section>", overlayAt));
  assert.match(overlay, /<section className="result-card">/, "the content lives in a panel of its own");
  // The medal, the heading, the copy and the buttons all belong to the card, so
  // the backdrop has nothing to lay out and only has to dim.
  for (const part of ["result-medal", "<h2>", "result-actions"]) {
    assert.ok(overlay.indexOf(part) > overlay.indexOf('className="result-card"'), `${part} sits inside the card`);
  }

  const css = await readFile(cssUrl, "utf8");
  const card = css.slice(css.indexOf(".result-card {"), css.indexOf("}", css.indexOf(".result-card {")));
  assert.match(card, /border: 2px solid/, "it has a frame");
  assert.match(card, /border-radius/);
  assert.match(card, /box-shadow:/, "and lifts off the backdrop");
  assert.match(card, /width: min\(100%, \d+px\)/, "held to a readable width instead of filling the frame");
});

test("the panel comes out of the depth of the frame", async () => {
  const css = await readFile(cssUrl, "utf8");
  // A z move needs a 3D context from the parent; without the perspective the
  // pop collapses into a plain scale.
  const overlay = css.slice(css.indexOf(".result-overlay {"), css.indexOf("}", css.indexOf(".result-overlay {")));
  assert.match(overlay, /perspective: \d+px/);

  const card = css.slice(css.indexOf(".result-card {"), css.indexOf("}", css.indexOf(".result-card {")));
  assert.match(card, /animation: result-pop/);
  const pop = keyframes(css, "result-pop");
  assert.match(pop, /translateZ\(-\d+px\)/, "starts away from the viewer");
  assert.match(pop, /translateZ\(\d+px\)/, "overshoots past the screen plane");
  assert.match(pop, /translateZ\(0\)/, "and settles flat");
  // The backdrop fades first and the card follows, so the panel is seen
  // arriving rather than being there already.
  assert.match(card, /animation: result-pop [\d.]+s [^;]* \.0?\d+s both/, "the card's pop is delayed behind the backdrop");
});

test("winning throws fireworks, from behind the panel, and losing does not", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const overlayAt = ui.indexOf("{state.result && !state.postWinClearing && (");
  const overlay = ui.slice(overlayAt, ui.indexOf("</section>", overlayAt));
  assert.match(overlay, /kind === "WIN" && <ResultFireworks \/>/, "a loss is not a celebration");
  assert.ok(
    overlay.indexOf("<ResultFireworks />") < overlay.indexOf('className="result-card"'),
    "rendered before the card, so the sparks come out from under it instead of across the text",
  );

  // Fixed table, computed once: a burst that reshuffled on every re-render
  // would flicker.
  const sparks = ui.slice(ui.indexOf("const RESULT_SPARKS"), ui.indexOf("function ResultFireworks"));
  assert.match(sparks, /Array\.from\(\{ length: 18 \}/);
  assert.doesNotMatch(sparks, /Math\.random/);
  const component = ui.slice(ui.indexOf("function ResultFireworks"), ui.indexOf("function focusableIn"));
  assert.match(component, /aria-hidden="true"/, "decoration, not content");
  for (const property of ["--spark-angle", "--spark-distance", "--spark-delay", "--spark-color"]) {
    assert.match(component, new RegExp(`"${property}"`), `${property} has to reach the CSS`);
  }

  const css = await readFile(cssUrl, "utf8");
  const spark = keyframes(css, "result-spark");
  // rotate first, then translate: one angle per spark aims the whole flight.
  assert.match(spark, /rotate\(var\(--spark-angle\)\) translateY\(calc\(var\(--spark-distance\) \* -1\)\)/);
  const layer = css.slice(css.indexOf(".result-fireworks {"), css.indexOf("}", css.indexOf(".result-fireworks {")));
  assert.match(layer, /pointer-events: none/, "it must never eat a tap meant for the buttons");
  assert.match(layer, /z-index: 0/);
});

test("every reason the game can fail for has a line of copy to show", async () => {
  const [ui, rules, engine] = await Promise.all([
    readFile(uiUrl, "utf8"),
    readFile(rulesUrl, "utf8"),
    readFile(engineUrl, "utf8"),
  ]);

  // The panel used to print one hardcoded sentence about batch slots for every
  // loss, including running out of shots. It reads the reason now, so a new
  // reason without copy would show the fallback instead of explaining itself.
  const panel = ui.slice(ui.indexOf("result-medal"), ui.indexOf("result-actions"));
  assert.match(panel, /FAIL_BODY\[state\.result\.reason \?\? ""\]/);
  assert.doesNotMatch(panel, /both were taken/, "the hardcoded batch-slot sentence is gone");

  const reasons = [...rules.matchAll(/reason: "([^"]+)"/g), ...engine.matchAll(/reason: "([^"]+)"/g)]
    .map((match) => match[1]);
  assert.ok(reasons.length >= 2, `expected the fail reasons to be found, got ${reasons.length}`);

  const table = ui.slice(ui.indexOf("const FAIL_BODY"), ui.indexOf("type ModalView"));
  for (const reason of new Set(reasons)) {
    assert.ok(table.includes(`"${reason}"`), `FAIL_BODY is missing a line for "${reason}"`);
  }
});
