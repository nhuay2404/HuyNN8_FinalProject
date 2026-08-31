import assert from "node:assert/strict";
import test from "node:test";
import { defaultLevel, secondConsequence, BUILT_IN_LEVELS } from "../design/levels/sand-levels.ts";
import { sandBloom } from "./level-fixtures.ts";
import { analyseLevel, playCareless, playStrong } from "../app/game/level-analysis.ts";
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MAX_HEIGHT,
  MAX_WIDTH,
  MIN_DIMENSION,
  PIXEL_BUDGET,
  autoPixelScale,
  blankRows,
  coloursUsed,
  countPaintedCells,
  createDraft,
  draftToLevel,
  draftToTypeScript,
  effectivePixelScale,
  expandDraftToPixels,
  resizeDraft,
  settleDraft,
  syncQueueToPicture,
  validateDraft,
  type LevelDraft,
} from "../app/game/level-drafts.ts";
import {
  createSandGameState,
  expandLevelForPixelBoard,
  parseSandLevel,
  runGrainSettle,
} from "../app/game/sand-rules.ts";
import { RADIUS_GAMEPLAY } from "../app/game/sand-types.ts";

/**
 * A small, already-at-rest picture: a filled block sitting on the floor.
 *
 * `MIN_DIMENSION` is in board pixels now, so the smallest legal board is 12
 * across — there is no blueprint to draw a six-cell picture on any more.
 */
function solidDraft(): LevelDraft {
  const draft = createDraft("Test", 12, 12);
  return syncQueueToPicture({
    ...draft,
    rows: [
      "............",
      "............",
      "............",
      "............",
      "............",
      "............",
      "............",
      "............",
      "............",
      "BBBBBBYYYYYY",
      "BBBBBBYYYYYY",
      "GGGGGGYYYYYY",
    ],
  });
}

// ---- drawing model -------------------------------------------------------

test("a blank draft is empty, and painting is what fills it", () => {
  const draft = createDraft("Blank", 16, 16);
  assert.equal(draft.rows.length, 16);
  for (const row of draft.rows) assert.equal(row, ".".repeat(16));
  assert.equal(countPaintedCells(draft), 0);
  assert.deepEqual(coloursUsed(draft), []);
  assert.deepEqual(blankRows(3, 2), ["...", "..."]);
});

test("a new draft is the board itself, at the resolution the game runs", () => {
  const draft = createDraft("Fresh");
  assert.deepEqual(
    { width: draft.width, height: draft.height },
    { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
    "the default board is the size the shipped levels run at",
  );
  // The one thing that must never drift again: no expansion between what the
  // author draws and what is played.
  assert.equal(draft.pixelScale, 1);
  assert.equal(effectivePixelScale(draft), 1);
  const level = draftToLevel(draft, 1);
  assert.deepEqual(expandLevelForPixelBoard(level).frame, level.frame, "expansion is a no-op now");
});

test("two drafts made in the same millisecond still get different ids", () => {
  // Duplicating a level does exactly this, and colliding ids would make the
  // editor edit two entries at once.
  const ids = new Set(Array.from({ length: 50 }, () => createDraft("Same").id));
  assert.equal(ids.size, 50);
});

test("resizing keeps the picture anchored to the floor", () => {
  // Sand rests on the floor, so rows have to grow and shrink at the top. If
  // resizing trimmed the bottom, the drawing would appear to jump.
  const blank = ".".repeat(12);
  const draft = {
    ...createDraft("Anchor", 12, 12),
    rows: [...Array<string>(10).fill(blank), "RRRRRRRRRRRR", "GGGGGGGGGGGG"],
  };

  const taller = resizeDraft(draft, 12, 14);
  assert.deepEqual(taller.rows, [...Array<string>(12).fill(blank), "RRRRRRRRRRRR", "GGGGGGGGGGGG"]);
  assert.deepEqual(resizeDraft(taller, 12, 12).rows, draft.rows, "growing then shrinking round-trips");

  const wider = resizeDraft(draft, 14, 12);
  assert.deepEqual(wider.rows, [
    ...Array<string>(10).fill(".".repeat(14)),
    "RRRRRRRRRRRR..",
    "GGGGGGGGGGGG..",
  ]);
});

test("createDraft clamps its dimensions the same way resizing does", () => {
  const tiny = createDraft("Tiny", 1, 1);
  assert.equal(tiny.width, MIN_DIMENSION);
  assert.equal(tiny.height, MIN_DIMENSION);
  assert.equal(tiny.rows.length, MIN_DIMENSION);
  for (const row of tiny.rows) assert.equal(row.length, MIN_DIMENSION);

  const huge = createDraft("Huge", 999, 999);
  assert.equal(huge.width, MAX_WIDTH);
  assert.equal(huge.height, MAX_HEIGHT);
});

test("resizing clamps to the editor's bounds", () => {
  const draft = createDraft("Clamp", 10, 10);
  assert.equal(resizeDraft(draft, 1, 1).width, MIN_DIMENSION);
  assert.equal(resizeDraft(draft, 1, 1).height, MIN_DIMENSION);
  assert.equal(resizeDraft(draft, 999, 999).width, MAX_WIDTH);
  assert.equal(resizeDraft(draft, 999, 999).height, MAX_HEIGHT);
  const big = resizeDraft(draft, 999, 999);
  assert.equal(big.rows.length, MAX_HEIGHT);
  for (const row of big.rows) assert.equal(row.length, MAX_WIDTH);
});

test("coloursUsed reports exactly what is painted, in palette order", () => {
  const draft = { ...createDraft("Palette", 6, 6), rows: ["OB....", "..GR..", "......", "......", "......", "......"] };
  assert.deepEqual(coloursUsed(draft), ["red", "green", "blue", "orange"]);
  assert.equal(countPaintedCells(draft), 4);
});

// ---- resolution ----------------------------------------------------------

test("auto pixel scale is the biggest whole scale that fits, or 1", () => {
  for (let width = MIN_DIMENSION; width <= MAX_WIDTH; width += 1) {
    for (let height = MIN_DIMENSION; height <= MAX_HEIGHT; height += 1) {
      const scale = autoPixelScale(width, height);
      assert.equal(scale, Math.floor(scale), "only whole scales keep the puzzle identical");
      assert.ok(scale >= 1, `${width}x${height} produced scale ${scale}`);
      const pixels = width * height * scale * scale;
      // A board that is already over budget at 1x cannot be shrunk any
      // further — the budget is a comfort warning, not a hard cap.
      if (scale > 1) {
        assert.ok(pixels <= PIXEL_BUDGET, `${width}x${height} at ${scale}x is ${pixels} pixels, over budget`);
      }
    }
  }
});

test("a blueprint-era draft is expanded to the board it was always playing", () => {
  // The old model: a small picture plus a scale the game applied at load.
  const legacy: LevelDraft = {
    ...createDraft("Legacy", 12, 14),
    width: 12,
    height: 14,
    rows: [...Array<string>(13).fill("............"), "OOOOOOOOOOOO"],
    sortRadius: 2.5,
    pixelScale: 5,
  };

  const migrated = expandDraftToPixels(legacy);
  assert.deepEqual(
    { width: migrated.width, height: migrated.height },
    { width: 60, height: 70 },
    "the picture becomes the board the game was already running",
  );
  assert.equal(migrated.pixelScale, 1, "and there is nothing left to expand");
  assert.equal(migrated.sortRadius, 12.5, "the disc has to grow with the board or the puzzle changes");
  assert.equal(migrated.rows.length, 70);
  for (const row of migrated.rows) assert.equal(row.length, 60);
  assert.equal(
    countPaintedCells(migrated),
    countPaintedCells(legacy) * 25,
    "each authored cell became a 5x5 block of itself",
  );

  // Idempotent: a draft that is already at pixel resolution is left alone.
  assert.deepEqual(expandDraftToPixels(migrated), migrated);
});

test("an explicit pixel scale still overrides the automatic one", () => {
  // Only reachable through migration now, but that is exactly where it has to
  // keep working: it is how an old draft's true size is recovered.
  const draft = createDraft("Manual", 12, 14);
  assert.equal(effectivePixelScale(draft), 1, "a new draft is the board itself");
  assert.equal(effectivePixelScale({ ...draft, pixelScale: null }), autoPixelScale(12, 14));
  assert.equal(effectivePixelScale({ ...draft, pixelScale: 3 }), 3);
});

// ---- draft to level ------------------------------------------------------

test("a draft becomes a level that carries the shared gameplay policy", () => {
  const level = draftToLevel(solidDraft(), 7);
  assert.equal(level.id, 7);
  assert.equal(level.shotRule, RADIUS_GAMEPLAY.shotRule);
  assert.equal(level.settlePolicy, RADIUS_GAMEPLAY.settlePolicy);
  assert.equal(level.ammoRule, RADIUS_GAMEPLAY.ammoRule);
  assert.deepEqual(level.frame, { width: 12, height: 12 });
  assert.deepEqual(level.rows, solidDraft().rows);
});

test("an unnamed draft still produces a named level", () => {
  const level = draftToLevel({ ...solidDraft(), name: "   " }, 1);
  assert.equal(level.name, "Untitled");
});

test("a draft that validates clean actually starts a game", () => {
  const draft = solidDraft();
  assert.deepEqual(validateDraft(draft).filter((issue) => issue.severity === "error"), []);
  const state = createSandGameState(draftToLevel(draft, 1));
  assert.equal(state.result, null);
  assert.equal(state.phase, "READY");
  assert.ok(state.remainingCells > 0);
  assert.ok(state.queue.length > 0);
});

// ---- validation ----------------------------------------------------------

test("an empty picture is an error and nothing else is reported", () => {
  const issues = validateDraft(createDraft("Empty", 6, 6));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
});

test("a colour painted but left out of the wheel is an error — it could never be cleared", () => {
  const draft = { ...solidDraft(), ammoQueue: ["blue" as const] };
  const issues = validateDraft(draft);
  const error = issues.find((issue) => issue.severity === "error" && issue.fix === "syncQueue");
  assert.ok(error, "a colour with no bullet makes the level unwinnable and must be an error");
  assert.match(error.message, /never be cleared/);
});

test("a colour queued but never painted is an error — that bullet has no target", () => {
  const draft = { ...solidDraft(), ammoQueue: [...coloursUsed(solidDraft()), "purple" as const] };
  const issues = validateDraft(draft);
  const error = issues.find((issue) => issue.severity === "error" && /nothing to shoot/.test(issue.message));
  assert.ok(error);
});

test("syncQueueToPicture repairs both directions and keeps the chosen order", () => {
  const base = solidDraft();
  const scrambled: LevelDraft = { ...base, ammoQueue: ["yellow", "purple"] };
  const fixed = syncQueueToPicture(scrambled);
  assert.deepEqual(fixed.ammoQueue[0], "yellow", "an order already chosen survives the repair");
  assert.deepEqual([...fixed.ammoQueue].sort(), [...coloursUsed(base)].sort());
  assert.deepEqual(validateDraft(fixed).filter((issue) => issue.severity === "error"), []);
});

test("a duplicated colour in the wheel is only a warning", () => {
  const draft = syncQueueToPicture(solidDraft());
  const doubled = { ...draft, ammoQueue: [...draft.ammoQueue, draft.ammoQueue[0]] };
  const issues = validateDraft(doubled);
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
  assert.ok(issues.some((issue) => issue.severity === "warning" && /twice/.test(issue.message)));
});

test("floating sand is flagged, and settling the draft clears the flag", () => {
  const floating = syncQueueToPicture({
    ...createDraft("Floating", 6, 6),
    rows: ["RRR...", "......", "......", "......", "......", "GGGGGG"],
  });
  const before = validateDraft(floating);
  assert.ok(before.some((issue) => issue.fix === "settle"), "sand in mid-air has to be called out");

  const settled = settleDraft(floating);
  assert.ok(!validateDraft(settled).some((issue) => issue.fix === "settle"));

  // Settling moves sand without inventing or losing any.
  assert.equal(countPaintedCells(settled), countPaintedCells(floating));
  assert.deepEqual(coloursUsed(settled), coloursUsed(floating));
  const level = draftToLevel(settled, 1);
  const { bodies } = parseSandLevel(level);
  assert.ok(runGrainSettle(bodies, level.frame).steps.every((step) => step.kind !== "GRAIN_PASS"));
});

test("a settled draft is already at rest, so settling again changes nothing", () => {
  const once = settleDraft(syncQueueToPicture({
    ...createDraft("Twice", 6, 6),
    rows: ["..RR..", "......", "..GG..", "......", "......", "YYYYYY"],
  }));
  assert.deepEqual(settleDraft(once).rows, once.rows);
});

test("a shot budget below one is an error", () => {
  assert.ok(validateDraft({ ...solidDraft(), shotLimit: 0 })
    .some((issue) => issue.severity === "error" && /budget/.test(issue.message)));
});

// ---- analysis ------------------------------------------------------------

test("the shipped level measures the way its comment claims", () => {
  const analysis = analyseLevel(sandBloom);
  assert.ok(analysis.strongShots !== null, "strong play has to be able to clear the shipped level");
  assert.ok(
    analysis.strongShots <= sandBloom.shotLimit - 3,
    `strong play needs ${analysis.strongShots} of ${sandBloom.shotLimit} — no room to misplay`,
  );
  assert.ok(analysis.carelessWins < analysis.carelessRuns, "careless play must not win every time");
  assert.equal(analysis.verdict, "good");
});

test("analysis suggests a budget that leaves strong play real slack", () => {
  const analysis = analyseLevel(sandBloom);
  assert.ok(analysis.suggestedShotLimit !== null);
  assert.ok(analysis.strongShots !== null);
  assert.ok(analysis.suggestedShotLimit > analysis.strongShots);
});

test("an impossible budget is reported as unclearable rather than merely hard", () => {
  const analysis = analyseLevel({ ...sandBloom, shotLimit: 1 });
  assert.equal(analysis.strongShots, null);
  assert.equal(analysis.verdict, "unclearable");
  assert.equal(analysis.suggestedShotLimit, null);
});

test("a generous budget makes careless play win every time, and that is called out", () => {
  const analysis = analyseLevel({ ...sandBloom, shotLimit: 200 });
  assert.equal(analysis.carelessWins, analysis.carelessRuns);
  assert.equal(analysis.verdict, "too-easy");
});

test("the play models are deterministic — the same level analyses the same way twice", () => {
  assert.deepEqual(playStrong(sandBloom), playStrong(sandBloom));
  assert.deepEqual(playCareless(sandBloom, 42), playCareless(sandBloom, 42));
  assert.deepEqual(analyseLevel(sandBloom), analyseLevel(sandBloom));
});

// ---- export --------------------------------------------------------------

test("an exported level spreads the shared policy instead of restating it", () => {
  const code = draftToTypeScript({ ...solidDraft(), name: "My Test Level" }, 4);
  assert.match(code, /\.\.\.RADIUS_GAMEPLAY,/);
  assert.match(code, /export const myTestLevel: SandLevelConfig = \{/);
  assert.match(code, /id: 4,/);
  assert.match(code, /name: "My Test Level",/);
  assert.match(code, /frame: \{ width: 12, height: 12 \},/);
  // None of the policy fields should be written out by hand.
  for (const field of ["shotRule", "settlePolicy", "ammoRule", "adjacencyMode", "cannonConfigRef"]) {
    assert.ok(!code.includes(`${field}:`), `${field} belongs to RADIUS_GAMEPLAY, not to a level`);
  }
});

test("an exported level round-trips: its rows and queue are the draft's", () => {
  const draft = { ...solidDraft(), name: "Round Trip" };
  const code = draftToTypeScript(draft, 2);
  for (const row of draft.rows) assert.ok(code.includes(`"${row}"`), `row ${row} missing from export`);
  for (const color of draft.ammoQueue) assert.ok(code.includes(`"${color}"`));
  assert.ok(code.includes(`pixelScale: ${effectivePixelScale(draft)},`));
});

test("a name that is not a valid identifier still exports as one", () => {
  assert.match(draftToTypeScript({ ...solidDraft(), name: "  ??!  " }, 1), /export const untitled:/);
  assert.match(draftToTypeScript({ ...solidDraft(), name: "3 Sand Bloom!" }, 1), /export const 3SandBloom:|export const sandBloom:/);
});

test("a name with a quote cannot break out of the generated string", () => {
  const code = draftToTypeScript({ ...solidDraft(), name: 'He said "hi"' }, 1);
  assert.ok(code.includes('name: "He said \\"hi\\""'), "quotes have to be escaped in the emitted source");
});

// ---- the shipped level stays a valid draft target -------------------------

test("the built-in level list is what the game and editor both start from", () => {
  // Two hand-authored levels (1: FTUE, 2: the falling-sand consequence) —
  // everything past that is authored and shipped from the editor now.
  assert.ok(BUILT_IN_LEVELS.includes(defaultLevel));
  assert.ok(BUILT_IN_LEVELS.includes(secondConsequence));
  assert.equal(BUILT_IN_LEVELS.length, 2);
  assert.deepEqual(BUILT_IN_LEVELS.map((level) => level.id), [1, 2], "ids are what the HUD shows");
});
