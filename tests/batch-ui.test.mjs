import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiUrl = new URL("../app/GamePrototype.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);

// Slice one rule out of the stylesheet so an assertion cannot accidentally be
// satisfied by a declaration that belongs to a neighbouring selector.
function rule(css, selector) {
  // Anchored to a line start so ".batch-pip" cannot match inside
  // ".batch-slot.empty .batch-pip".
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `missing rule ${selector}`);
  const end = css.indexOf("}", start);
  assert.ok(end > start, `unterminated rule ${selector}`);
  return css.slice(start, end);
}

function reserveMarkup(ui) {
  const start = ui.indexOf(`className={\`batch-section`);
  assert.ok(start >= 0, "missing the reserve section");
  const end = ui.indexOf(`</section>`, start);
  assert.ok(end > start, "unterminated reserve section");
  return ui.slice(start, end);
}

function isolate(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const end = source.indexOf("\n  }", start);
  assert.ok(end > start, `unterminated ${signature}`);
  return source.slice(start, end);
}

test("the reserve draws one slot per block of budget, taken or not", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const markup = reserveMarkup(ui);

  // The row is the budget itself, so every slot is always on screen and their
  // size never shifts as it fills. Rendering only the taken ones is what would
  // turn "room left" back into something you have to read.
  assert.match(ui, /Array\.from\(\{ length: Math\.max\(level\.reserveBlocks, filledSlots\.length\) \}/);
  assert.match(markup, /traySlots\.map/);
  assert.match(markup, /"batch-pip is-socket"/, "an unused slot is the same shape, empty");
  assert.match(markup, /data-reserve-tray/, "one rack, addressed as one thing");
  assert.equal(markup.split(`className="batch-slot"`).length - 1, 1, "exactly one rack element");
});

test("nothing in the reserve prints a number", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const markup = reserveMarkup(ui);

  // The chip that read "BATCH 0/8" is gone, digits and glyph together.
  assert.doesNotMatch(markup, /×\{/, "no count on the rack");
  assert.doesNotMatch(markup, /<b>|<em>/, "no counter element");
  assert.doesNotMatch(ui, /batch-caption/, "the caption chip is gone from the markup");
  assert.doesNotMatch(ui, /batchCapacity/, "and so is the old slot-count field");

  const css = await readFile(cssUrl, "utf8");
  assert.doesNotMatch(css, /batch-caption/, "and from the stylesheet");
});

test("the count still reaches a screen reader now that nothing shows it", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const markup = reserveMarkup(ui);

  assert.match(ui, /const parkedBlocks = state\.batches\.reduce\(/, "still summed in blocks");
  assert.match(ui, /const batchWarning = parkedBlocks >= level\.reserveBlocks;/);
  assert.match(markup, /Reserve, \$\{parkedBlocks\} of \$\{level\.reserveBlocks\} block/);
  // Slots are decoration on top of that label, never read out one by one.
  assert.match(markup, /className="batch-tray" aria-hidden="true"/);
});

test("the flight anchors survive the redesign", async () => {
  const ui = await readFile(uiUrl, "utf8");
  const markup = reserveMarkup(ui);

  // A batch emptying into a goal is measured from the slots that are leaving, so
  // every taken slot carries the id of the record it belongs to.
  assert.match(markup, /data-batch-id=\{slot\.batchId\}/);
  // A cluster flying into the reserve targets the rack itself.
  assert.match(ui, /: "\[data-reserve-tray\]"/);
});

test("the rack reads as a container and its slots cannot spill out of it", async () => {
  const css = await readFile(cssUrl, "utf8");
  const ui = await readFile(uiUrl, "utf8");
  const slot = rule(css, ".batch-slot");
  const tray = rule(css, ".batch-tray");
  const pip = rule(css, ".batch-pip");

  // A thicker bottom border is the lip that separates a rack from a pill, and
  // the height has to stay 32px or --hud-height stops matching the HUD.
  assert.match(slot, /height: 32px/);
  const wall = Number(slot.match(/border: (\d+)px/)[1]);
  const lip = Number(slot.match(/border-bottom-width: (\d+)px/)[1]);
  assert.ok(lip > wall, `lip ${lip}px must be thicker than the walls ${wall}px`);

  // One column per slot and never a second row: two stacked slots at the cap
  // below would not fit the rack's height, so the columns are what has to give.
  assert.match(tray, /grid-template-columns: repeat\(var\(--pips, 1\), minmax\(0, 1fr\)\)/);
  assert.match(ui, /"--pips": traySlots\.length/, "no folding: one column per slot");
  assert.doesNotMatch(ui, /trayColumns/, "the fold helper is gone");
  const cap = Number(pip.match(/max-height: (\d+)px/)[1]);
  const inner = 32 - wall - lip;
  assert.ok(cap <= inner, `a ${cap}px slot must fit inside ${inner}px`);
});

test("the rack keeps its own colour because it holds several at once", async () => {
  const css = await readFile(cssUrl, "utf8");
  const rack = rule(css, ".batch-slot");
  const pip = rule(css, ".batch-pip");
  const socket = rule(css, ".batch-pip.is-socket");

  // Tinting the walls from --batch would either pick a winner among the parked
  // colours or wash out. The colour belongs to the slots.
  assert.doesNotMatch(rack, /--batch/, "the rack must not borrow a block colour");
  assert.match(pip, /var\(--batch\)/, "each taken slot is coloured by its record");
  assert.doesNotMatch(socket, /--batch/, "an empty slot has no colour to borrow");
  assert.match(socket, /animation: none/, "it was always there, so it never drops in");
});

test("a shot at a full reserve is allowed to fire, and to lose the level", async () => {
  const engine = await readFile(engineUrl, "utf8");
  const fire = isolate(engine, "private fire({ start, velocity }: BallisticSolution) {");
  const handleHit = isolate(engine, "private handleHit(block: BlockRuntime, projectile: Projectile) {");

  // A full reserve is a risk the player takes, not a move the game takes away.
  // Any gate here would make the fail condition unreachable, which is exactly
  // what happened the last time this was built the other way round.
  assert.doesNotMatch(fire, /aimReserveBlocked|claimFitsReserve/, "fire must not gate on the reserve");
  assert.doesNotMatch(handleHit, /planClusterSplit/, "the claim goes through and resolveCluster decides");
  assert.doesNotMatch(engine, /checkReserveDeadlock/, "with nothing refused there is no dead end to detect");

  // The doomed cubes still fly, so the last thing before the panel is the claim
  // that caused it rather than a cluster vanishing in silence.
  const animation = isolate(engine, "private createSortAnimation(pending: PendingResolution): SortAnimationEvent | null {");
  assert.match(animation, /if \(split\.excess > 0\) \{/, "the reserve leg is drawn whether or not it fits");
  assert.doesNotMatch(animation, /split\.excess > 0 && split\.fits/, "the suppressed-leg form is gone");
});
