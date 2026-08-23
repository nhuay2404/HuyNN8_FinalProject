import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseLevelSheet } from "../app/game/level-format.ts";
import { TUTORIAL_CHAPTERS } from "../app/game/tutorial-levels.ts";
import {
  TUTORIAL_AIM_DISTANCE,
  TUTORIAL_CHAPTER_COUNT,
  TUTORIAL_COPY,
  TUTORIAL_ROTATE_DISTANCE,
  TUTORIAL_STEP_COUNT,
  createTutorialProgress,
  nextTutorialChapter,
  reduceTutorialProgress,
  tutorialAllowedColor,
  tutorialPresentation,
} from "../app/game/tutorial.ts";
import { createGameState, parkedBlockCount, resolveCluster } from "../app/game/rules.ts";

const uiUrl = new URL("../app/GamePrototype.tsx", import.meta.url);
const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const sheetUrl = new URL("../work/levels.tsv", import.meta.url);
const htmlUrl = new URL("../outputs/3d-cannon-sort.html", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

function inventory(items, colorOf) {
  const counts = new Map();
  for (const item of items) {
    const color = colorOf(item);
    counts.set(color, (counts.get(color) ?? 0) + ("target" in item ? item.target : 1));
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function normalizeLines(text) {
  return text.replaceAll("\r\n", "\n").trim();
}

test("the controls lesson advances only after meaningful rotate, aim and fire actions", () => {
  let progress = createTutorialProgress();
  assert.deepEqual(progress, { chapter: 0, step: 0, rotateDistance: 0 });

  // Future actions cannot skip the gesture being taught now.
  assert.strictEqual(reduceTutorialProgress(progress, { type: "SHOT_FIRED" }), progress);
  assert.strictEqual(
    reduceTutorialProgress(progress, { type: "AIM_DRAGGED", distance: TUTORIAL_AIM_DISTANCE }),
    progress,
  );

  progress = reduceTutorialProgress(progress, {
    type: "MODEL_ROTATED",
    distance: TUTORIAL_ROTATE_DISTANCE - 1,
  });
  assert.deepEqual(progress, {
    chapter: 0,
    step: 0,
    rotateDistance: TUTORIAL_ROTATE_DISTANCE - 1,
  });

  progress = reduceTutorialProgress(progress, { type: "MODEL_ROTATED", distance: 1 });
  assert.equal(progress.step, 1, "rotation may accumulate across several pointer moves");
  assert.strictEqual(
    reduceTutorialProgress(progress, { type: "AIM_DRAGGED", distance: TUTORIAL_AIM_DISTANCE - 1 }),
    progress,
    "a tap or tiny drag must not complete the aiming step",
  );

  progress = reduceTutorialProgress(progress, {
    type: "AIM_DRAGGED",
    distance: TUTORIAL_AIM_DISTANCE,
  });
  assert.equal(progress.step, 2);
  progress = reduceTutorialProgress(progress, { type: "SHOT_FIRED" });
  assert.equal(progress.step, TUTORIAL_STEP_COUNT);
  assert.strictEqual(
    reduceTutorialProgress(progress, { type: "MODEL_ROTATED", distance: 999 }),
    progress,
    "a completed lesson is stable until the player continues",
  );
});

test("sort and Weak Point lessons reject out-of-order events and expose only their current target", () => {
  const chapters = [
    {
      chapter: 1,
      expectedEvents: ["SORT_PROGRESS", "BATCH_STORED", "BATCH_AUTOFILLED"],
      allowedColors: ["red", "blue", "red", null],
    },
    {
      chapter: 2,
      expectedEvents: ["WEAK_POINT_CLEARED", "RAINBOW_HIT", "BYPASS_USED"],
      allowedColors: ["red", null, "blue", null],
    },
  ];

  for (const spec of chapters) {
    let progress = createTutorialProgress(spec.chapter);
    for (const [step, expectedType] of spec.expectedEvents.entries()) {
      assert.equal(tutorialAllowedColor(progress), spec.allowedColors[step]);
      const futureType = spec.expectedEvents[(step + 1) % spec.expectedEvents.length];
      assert.strictEqual(
        reduceTutorialProgress(progress, { type: futureType }),
        progress,
        `chapter ${spec.chapter}, step ${step} accepted ${futureType}`,
      );
      progress = reduceTutorialProgress(progress, { type: expectedType });
      assert.equal(progress.step, step + 1);
    }
    assert.equal(tutorialAllowedColor(progress), spec.allowedColors.at(-1));
  }

  const controlsDone = { ...createTutorialProgress(0), step: TUTORIAL_STEP_COUNT };
  const sortChapter = nextTutorialChapter(controlsDone);
  assert.deepEqual(sortChapter, createTutorialProgress(1));
  const weakPointChapter = nextTutorialChapter({ ...sortChapter, step: TUTORIAL_STEP_COUNT });
  assert.deepEqual(weakPointChapter, createTutorialProgress(2));
  assert.equal(
    nextTutorialChapter({ ...weakPointChapter, step: TUTORIAL_STEP_COUNT }),
    null,
    "the final lesson returns to the campaign instead of inventing a fourth chapter",
  );
});

test("each lesson has an exact, isolated presentation contract", () => {
  assert.equal(TUTORIAL_CHAPTER_COUNT, 3);
  assert.equal(TUTORIAL_STEP_COUNT, 3);
  assert.deepEqual(
    [0, 1, 2].map(tutorialPresentation),
    [
      {
        showGoals: false,
        showReserve: false,
        showWeakPoints: false,
        showRainbow: false,
        allowAnyBlockFace: true,
      },
      {
        showGoals: true,
        showReserve: true,
        showWeakPoints: false,
        showRainbow: false,
        allowAnyBlockFace: true,
      },
      {
        showGoals: false,
        showReserve: false,
        showWeakPoints: true,
        showRainbow: true,
        allowAnyBlockFace: false,
      },
    ],
  );

  assert.equal(TUTORIAL_COPY.length, TUTORIAL_CHAPTER_COUNT);
  for (const [chapter, steps] of TUTORIAL_COPY.entries()) {
    assert.equal(steps.length, TUTORIAL_STEP_COUNT, `chapter ${chapter} copy count`);
    for (const step of steps) {
      assert.ok(step.title.trim());
      assert.ok(step.body.trim());
      assert.ok(step.hint.trim());
    }
  }
  assert.deepEqual(
    TUTORIAL_COPY[0].map((step) => step.gesture),
    ["rotate", "aim", "aim"],
    "only the controls lesson draws gesture coaching",
  );
  assert.ok(TUTORIAL_COPY.slice(1).flat().every((step) => step.gesture === null));
});

test("tutorial configs are valid, focused scenes kept outside the campaign sheet", async () => {
  assert.deepEqual(
    TUTORIAL_CHAPTERS.map((chapter) => chapter.id),
    ["controls", "sort-batch", "weakpoint-rainbow"],
  );
  assert.deepEqual(TUTORIAL_CHAPTERS.map((chapter) => chapter.level.id), [9001, 9002, 9003]);

  for (const chapter of TUTORIAL_CHAPTERS) {
    const { level } = chapter;
    const state = createGameState(level);
    assert.equal(state.remainingBlockCount, level.blocks.length, `${chapter.id}: game state boots`);
    assert.equal(state.result, null);
    assert.equal(level.activeGoalSlots, 1, `${chapter.id}: one concept and one active goal`);
    assert.equal(new Set(level.blocks.map((block) => block.id)).size, level.blocks.length);
    assert.deepEqual(
      inventory(level.blocks, (block) => block.color),
      inventory(level.goals, (goal) => goal.color),
      `${chapter.id}: goal inventory`,
    );
    for (const point of level.weakPoints) {
      assert.ok(level.blocks.some((block) => block.id === point.blockId), `${chapter.id}: ${point.id}`);
    }
  }

  const [controls, sortBatch, weakPointRainbow] = TUTORIAL_CHAPTERS.map((chapter) => chapter.level);
  assert.equal(controls.weakPoints.length, 0);
  assert.equal(controls.rainbow.targetCount, 0);
  assert.equal(sortBatch.weakPoints.length, 0);
  assert.equal(sortBatch.rainbow.targetCount, 0);
  assert.deepEqual(sortBatch.blocks.map((block) => block.color), ["red", "blue", "red"]);
  assert.equal(sortBatch.reserveBlocks, 1);
  assert.equal(weakPointRainbow.weakPoints.length, 2);
  assert.equal(weakPointRainbow.rainbow.targetCount, 3);
  assert.equal(weakPointRainbow.rainbow.targetDurationSeconds, 7);

  const { levels, issues } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
  const campaignIds = new Set(levels.map((level) => level.id));
  for (const chapter of TUTORIAL_CHAPTERS) {
    assert.equal(
      campaignIds.has(chapter.level.id),
      false,
      `${chapter.id} must not become a selectable campaign level`,
    );
  }
});

test("the Sort and Reserve lesson performs the real goal, batch and auto-fill transaction", () => {
  const level = TUTORIAL_CHAPTERS[1].level;
  let state = createGameState(level);
  let progress = createTutorialProgress(1);

  state = resolveCluster(level, state, {
    color: "red",
    count: 1,
    shotIndex: 1,
    remainingBlockCount: 2,
  });
  assert.equal(state.activeGoals[0]?.color, "red");
  assert.equal(state.activeGoals[0]?.current, 1);
  assert.equal(parkedBlockCount(state), 0);
  progress = reduceTutorialProgress(progress, { type: "SORT_PROGRESS" });
  assert.equal(progress.step, 1);

  state = resolveCluster(level, state, {
    color: "blue",
    count: 1,
    shotIndex: 2,
    remainingBlockCount: 1,
  });
  assert.equal(state.activeGoals[0]?.color, "red", "Blue is still off-goal");
  assert.deepEqual(state.batches.map((batch) => [batch.color, batch.count]), [["blue", 1]]);
  assert.equal(parkedBlockCount(state), 1);
  progress = reduceTutorialProgress(progress, { type: "BATCH_STORED" });
  assert.equal(progress.step, 2);

  state = resolveCluster(level, state, {
    color: "red",
    count: 1,
    shotIndex: 3,
    remainingBlockCount: 0,
  });
  assert.equal(parkedBlockCount(state), 0, "the stored Blue block fills its newly opened Goal");
  assert.ok(state.activeGoals.every((goal) => goal === null));
  assert.equal(state.result?.kind, "WIN");
  assert.equal(state.result?.allClear, true);
  progress = reduceTutorialProgress(progress, { type: "BATCH_AUTOFILLED" });
  assert.equal(progress.step, TUTORIAL_STEP_COUNT);
});

test("the UI and engine wire lesson isolation to real rendering and interaction gates", async () => {
  const [ui, engine, css, packageSource] = await Promise.all([
    readFile(uiUrl, "utf8"),
    readFile(engineUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(packageUrl, "utf8"),
  ]);

  assert.match(packageSource, /tests\/tutorial\.test\.mjs/, "the explicit npm test list must include this suite");
  assert.match(ui, /type Screen = "hub" \| "playing" \| "tutorial"/);
  assert.match(ui, /const level = tutorialMode \? tutorialChapter\.level : campaignLevel/);
  assert.match(ui, /onClick=\{beginTutorial\}/);
  assert.match(ui, /\{tutorialMode && \([\s\S]*?className="tutorial-layer"/);

  // The DOM omits unrelated systems; it does not merely paint them transparent.
  assert.match(ui, /const showGoals = screen === "playing" \|\| tutorialView\?\.showGoals === true/);
  assert.match(ui, /const showReserve = screen === "playing" \|\| tutorialView\?\.showReserve === true/);
  assert.match(ui, /hidden=\{!showGoals && !showReserve\}/);
  assert.match(ui, /\{showGoals && state\.activeGoals\.some/);
  assert.match(ui, /\{showReserve && <section className=\{`batch-section/);
  assert.match(ui, /\{screen === "playing" && \([\s\S]*?role="toolbar"/);
  assert.match(ui, /\{screen === "playing" && state\.result && !state\.postWinClearing/);
  assert.match(ui, /const showClimaxFeedback = \(screen === "playing" \|\| \(tutorialMode && tutorialProgress\.chapter === 2\)\) && bypassArmed/);
  assert.match(ui, /\{showClimaxFeedback && !state\.result && <ClimaxFireworks/);

  assert.match(ui, /allowAnyBlockFace: engineTutorialView\?\.allowAnyBlockFace/);
  assert.match(ui, /canClaimColor: engineTutorialChapter !== null && engineTutorialChapter > 0/);
  assert.match(ui, /showWeakPoints: engineTutorialView\?\.showWeakPoints \?\? true/);
  assert.match(ui, /engineRef\.current\?\.setRainbowTargetsEnabled\(/);
  assert.match(ui, /tutorialProgress\.chapter === 2 && tutorialProgress\.step >= 1/);

  // Normal levels get the original defaults; only a tutorial opts into gates.
  assert.match(engine, /options: CannonSortEngineOptions = \{\}/);
  assert.match(engine, /this\.rainbowTargetsEnabled = options\.rainbowTargetsEnabled \?\? true/);
  assert.match(engine, /if \(this\.options\.showWeakPoints === false\) return/);
  assert.match(engine, /if \(this\.options\.canClaimColor && !this\.options\.canClaimColor\(cluster\[0\]\.color\)\)/);
  assert.match(engine, /const faceHit = this\.options\.allowAnyBlockFace \|\| authoredFaceHit/);
  assert.match(engine, /if \(this\.roundClockActive && this\.rainbowTargetsEnabled && !this\.state\.result\)/);
  for (const event of [
    "MODEL_ROTATED",
    "AIM_DRAGGED",
    "SHOT_FIRED",
    "WEAK_POINT_CLEARED",
    "RAINBOW_HIT",
    "BYPASS_USED",
  ]) {
    assert.ok(engine.includes(`type: "${event}"`), `engine does not emit ${event}`);
  }

  assert.match(css, /\.tutorial-layer \{[^}]*pointer-events: none/);
  assert.match(css, /\.tutorial-header button \{[^}]*pointer-events: auto/);
  assert.match(css, /\.tutorial-next \{[^}]*pointer-events: auto/);
  const tutorialMarkup = ui.slice(ui.indexOf("{tutorialMode && ("), ui.indexOf("<div className={`hud-top"));
  assert.doesNotMatch(tutorialMarkup, /<img\b|https?:\/\//, "tutorial coaching is code-native and offline-safe");
});

test("the canonical offline HTML contains all tutorials and the exact authored campaign sheet", async () => {
  const [html, sheet] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(sheetUrl, "utf8"),
  ]);

  for (const marker of [
    "Open the three-part tutorial",
    "Rotate the 3D model",
    "Store an unmatched block",
    "Catch a Rainbow Target",
    "tutorial-layer",
  ]) {
    assert.ok(
      html.includes(marker),
      `${marker} is missing from outputs/3d-cannon-sort.html; rebuild the stale offline artifact`,
    );
  }

  const embedded = html.match(
    /<script id="levels" type="text\/tab-separated-values">\r?\n([\s\S]*?)\r?\n<\/script>/,
  );
  assert.ok(embedded, "the standalone build lost its editable level sheet");
  assert.equal(normalizeLines(embedded[1]), normalizeLines(sheet), "offline and authored campaign levels drifted");

  const shellBeforeBundle = html.slice(0, html.lastIndexOf("<script>"));
  assert.doesNotMatch(
    shellBeforeBundle,
    /<(?:script|img|link)\b[^>]*(?:src|href)=["']https?:/i,
    "the offline shell must not fetch tutorial assets",
  );
});
