import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditWeakPointRoutes, parseLevelSheet } from "../app/game/level-format.ts";
import { TUTORIAL_CHAPTERS } from "../app/game/tutorial-levels.ts";
import {
  TUTORIAL_AIM_DISTANCE,
  TUTORIAL_CHAPTER_COUNT,
  TUTORIAL_COPY,
  TUTORIAL_ROTATE_DISTANCE,
  isTutorialChapterComplete,
  tutorialScrimVisible,
  tutorialStepCount,
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
  assert.deepEqual(progress, { chapter: 0, step: 0, rotateDistance: 0, scrimHidden: false });

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
    scrimHidden: false,
  });
  // Reaching for the cannon before the rotate step is done must not clear the
  // dim: the ring is still explaining the gesture the player has not made.
  assert.strictEqual(reduceTutorialProgress(progress, { type: "AIM_TOUCHED" }), progress);

  progress = reduceTutorialProgress(progress, { type: "MODEL_ROTATED", distance: 1 });
  assert.equal(progress.step, 1, "rotation may accumulate across several pointer moves");

  // Recentring is taught right after turning, which is the only point at which
  // the cluster is crooked and the player has a reason to want it square.
  assert.strictEqual(
    reduceTutorialProgress(progress, { type: "AIM_DRAGGED", distance: TUTORIAL_AIM_DISTANCE }),
    progress,
    "aiming cannot skip the recentre step",
  );
  // The dim stays up here: this step is about the cluster, not the cannon.
  assert.strictEqual(reduceTutorialProgress(progress, { type: "AIM_TOUCHED" }), progress);
  assert.equal(tutorialScrimVisible(progress), true);
  progress = reduceTutorialProgress(progress, { type: "MODEL_RESET" });
  assert.equal(progress.step, 2);

  assert.strictEqual(
    reduceTutorialProgress(progress, { type: "AIM_DRAGGED", distance: TUTORIAL_AIM_DISTANCE - 1 }),
    progress,
    "a tap or tiny drag must not complete the aiming step",
  );

  // The dim goes on the touch itself, before any drag distance, and the step
  // still waits for a real drag.
  assert.equal(tutorialScrimVisible(progress), true);
  progress = reduceTutorialProgress(progress, { type: "AIM_TOUCHED" });
  assert.equal(progress.step, 2, "touching the cannon is not progress on its own");
  assert.equal(progress.scrimHidden, true);
  assert.equal(tutorialScrimVisible(progress), false);

  progress = reduceTutorialProgress(progress, {
    type: "AIM_DRAGGED",
    distance: TUTORIAL_AIM_DISTANCE,
  });
  assert.equal(progress.step, 3);
  // Aiming and firing are one gesture: the dim must not come back between them.
  assert.equal(tutorialScrimVisible(progress), false);
  progress = reduceTutorialProgress(progress, { type: "SHOT_FIRED" });
  assert.equal(progress.step, tutorialStepCount(0));
  assert.strictEqual(
    reduceTutorialProgress(progress, { type: "MODEL_ROTATED", distance: 999 }),
    progress,
    "a completed lesson is stable until the player continues",
  );
});

test("the sort lesson reads its three cards on taps, then hands the board over", () => {
  // Gating each beat behind its own shot meant the card explaining the reserve
  // only arrived once a cluster was already sitting in it. All three are read
  // first now, and the tap that leaves the last card clears the dim for play.
  let progress = createTutorialProgress(1);
  assert.equal(tutorialStepCount(1), 4);

  for (const step of [0, 1, 2]) {
    assert.equal(progress.step, step);
    assert.equal(tutorialScrimVisible(progress), true, `card ${step} needs the dim`);
    // A card is read, not played: the events a shot would raise do nothing here.
    for (const ignored of ["SORT_PROGRESS", "BATCH_STORED", "BATCH_AUTOFILLED", "SHOT_FIRED", "LEVEL_WON"]) {
      assert.strictEqual(
        reduceTutorialProgress(progress, { type: ignored }),
        progress,
        `card ${step} advanced on ${ignored}`,
      );
    }
    progress = reduceTutorialProgress(progress, { type: "TAP_ADVANCED" });
  }

  assert.equal(progress.step, 3, "three taps walk the three cards");
  assert.equal(progress.scrimHidden, true, "the last tap clears the dim for play");
  assert.equal(tutorialScrimVisible(progress), false);
  assert.equal(isTutorialChapterComplete(progress), false, "the board still has to be cleared");

  // No colour is locked any more: the board's own blockers force the order.
  for (const step of [0, 1, 2, 3]) assert.equal(tutorialAllowedColor({ ...progress, step }), null);

  assert.strictEqual(reduceTutorialProgress(progress, { type: "TAP_ADVANCED" }), progress, "no fourth card");
  progress = reduceTutorialProgress(progress, { type: "LEVEL_WON" });
  assert.equal(isTutorialChapterComplete(progress), true, "clearing the board is what finishes it");
});

test("the Weak Point lesson steps on its own events and unveils the board on the catch", () => {
  const expectedEvents = ["WEAK_POINT_CLEARED", "RAINBOW_HIT", "BYPASS_USED"];
  const allowedColors = ["red", null, "blue", null];
  let progress = createTutorialProgress(2);

  for (const [step, expectedType] of expectedEvents.entries()) {
    assert.equal(tutorialAllowedColor(progress), allowedColors[step]);
    const futureType = expectedEvents[(step + 1) % expectedEvents.length];
    assert.strictEqual(
      reduceTutorialProgress(progress, { type: futureType }),
      progress,
      `step ${step} accepted ${futureType}`,
    );
    // Reading cards is not how this lesson moves.
    assert.strictEqual(reduceTutorialProgress(progress, { type: "TAP_ADVANCED" }), progress);
    progress = reduceTutorialProgress(progress, { type: expectedType });
    assert.equal(progress.step, step + 1);
    // Catching the target is the reward beat, so the dim goes at once rather
    // than sitting over the fireworks and the armed banner.
    assert.equal(progress.scrimHidden, expectedType === "RAINBOW_HIT" || step > 1);
  }
  assert.equal(tutorialAllowedColor(progress), allowedColors.at(-1));

  const controlsDone = { ...createTutorialProgress(0), step: tutorialStepCount(0) };
  const sortChapter = nextTutorialChapter(controlsDone);
  assert.deepEqual(sortChapter, createTutorialProgress(1));
  const weakPointChapter = nextTutorialChapter({ ...sortChapter, step: tutorialStepCount(1) });
  assert.deepEqual(weakPointChapter, createTutorialProgress(2));
  assert.equal(
    nextTutorialChapter({ ...weakPointChapter, step: tutorialStepCount(2) }),
    null,
    "the final lesson returns to the campaign instead of inventing a fourth chapter",
  );
});

test("each lesson has an exact, isolated presentation contract", () => {
  assert.equal(TUTORIAL_CHAPTER_COUNT, 3);
  // Chapters are different lengths on purpose: the sort lesson reads three cards
  // and then hands the board over, which is a fourth step.
  assert.deepEqual([0, 1, 2].map(tutorialStepCount), [4, 4, 3]);
  // Marks show from lesson one and no lesson ever lets an unmarked face break a
  // cluster. A tutorial that taught "any face works" for two lessons and then
  // revealed marks was teaching a rule the player had to unlearn.
  assert.deepEqual(
    [0, 1, 2].map(tutorialPresentation),
    [
      {
        showGoals: false,
        showReserve: false,
        showWeakPoints: true,
        showRainbow: false,
        allowAnyBlockFace: false,
      },
      {
        showGoals: true,
        showReserve: true,
        showWeakPoints: true,
        showRainbow: false,
        allowAnyBlockFace: false,
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
  for (const chapter of [0, 1, 2]) {
    assert.equal(tutorialPresentation(chapter).allowAnyBlockFace, false, `chapter ${chapter} must not free-fire`);
    assert.equal(tutorialPresentation(chapter).showWeakPoints, true, `chapter ${chapter} must show its marks`);
  }

  assert.equal(TUTORIAL_COPY.length, TUTORIAL_CHAPTER_COUNT);
  const glyphs = new Set([
    "rotate", "recenter", "drag", "release", "goal", "reserve", "autosort", "mark", "rainbow", "bypass",
  ]);
  const focuses = new Set(["model", "cannon", "sky", "goals", "reserve"]);
  for (const [chapter, steps] of TUTORIAL_COPY.entries()) {
    assert.equal(steps.length, tutorialStepCount(chapter), `chapter ${chapter} copy count`);
    for (const step of steps) {
      assert.ok(glyphs.has(step.glyph), `${step.caption}: unknown glyph ${step.glyph}`);
      // A null focus is a step with nothing to point at: the board is the player's now.
      assert.ok(step.focus === null || focuses.has(step.focus), `${step.caption}: unknown focus ${step.focus}`);
      assert.ok(["tap", "event"].includes(step.advance), `${step.caption}: unknown advance ${step.advance}`);
      // The on-screen label is a name for the picture. Four words is the cap:
      // past that it stops being a label and becomes the wall of text this
      // redesign removed.
      const words = step.caption.trim().split(/\s+/);
      assert.ok(words.length >= 2 && words.length <= 4, `${step.caption}: ${words.length} words on screen`);
      assert.ok(step.caption.trim().length <= 24, `${step.caption}: too long to sit in a pill`);
      // The sentence still exists, but only for assistive tech.
      assert.ok(step.described.trim().length > step.caption.length, `${step.caption}: needs a spoken form`);
      assert.equal("title" in step, false, "the coach card's heading is gone");
      assert.equal("body" in step, false, "the coach card's paragraph is gone");
      assert.equal("hint" in step, false, "the separate hint pill is gone");
    }
  }
  assert.deepEqual(
    TUTORIAL_COPY[0].map((step) => step.gesture),
    ["rotate", "hold", "aim", "aim"],
    "only the controls lesson draws gesture coaching",
  );
  assert.ok(TUTORIAL_COPY.slice(1).flat().every((step) => step.gesture === null));
  // Each lesson points somewhere real, and the sort lesson points at the two
  // pieces of HUD it is actually about.
  // Recentring points at the cluster, not the rig: it is the cluster that moves.
  assert.deepEqual(TUTORIAL_COPY[0].map((step) => step.focus), ["model", "model", "cannon", "cannon"]);
  // The fourth card of the sort lesson points at nothing: the dim is gone by
  // then and the whole board is the player_S to work with.
  assert.deepEqual(TUTORIAL_COPY[1].map((step) => step.focus), ["goals", "reserve", "goals", null]);
  assert.deepEqual(TUTORIAL_COPY[1].map((step) => step.advance), ["tap", "tap", "tap", "event"]);
  // Every other lesson is played, not read.
  assert.ok([...TUTORIAL_COPY[0], ...TUTORIAL_COPY[2]].every((step) => step.advance === "event"));
  // Only the two aiming steps drop the dim on touch.
  assert.deepEqual(
    TUTORIAL_COPY.flat().filter((step) => step.dimDropsOnAimTouch).map((step) => step.caption),
    ["Drag to aim", "Release to fire"],
  );
  assert.deepEqual(TUTORIAL_COPY[2].map((step) => step.focus), ["model", "sky", "model"]);
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
  // Every lesson's blocks carry marks, because every lesson claims by mark.
  assert.equal(controls.rainbow.targetCount, 0);
  assert.equal(sortBatch.rainbow.targetCount, 0);
  for (const level of [controls, sortBatch, weakPointRainbow]) {
    assert.ok(level.weakPoints.length > 0, `${level.name} has no mark to aim at`);
    for (const block of level.blocks) {
      const cluster = level.blocks.filter((other) => other.color === block.color);
      assert.ok(
        cluster.some((member) => level.weakPoints.some((point) => point.blockId === member.id)),
        `${level.name}: the ${block.color} cluster has no marked face`,
      );
    }
  }
  // The lesson that teaches rotating hides one mark round the back, so the
  // gesture has something to find.
  assert.ok(
    controls.weakPoints.some((point) => point.face === "NZ"),
    "the controls lesson needs a mark that rotating reveals",
  );
  assert.ok(
    controls.weakPoints.some((point) => point.face === "PZ"),
    "the controls lesson also needs a mark facing the player",
  );
  // Blue's only mark faces away, which is what the bypass is for.
  assert.deepEqual(
    weakPointRainbow.weakPoints.filter((point) => point.blockId === "block-0-0-0").map((point) => point.face),
    ["NX"],
  );
  assert.deepEqual(sortBatch.blocks.map((block) => block.color), ["red", "blue", "red"]);
  assert.equal(sortBatch.reserveBlocks, 1);
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

  state = resolveCluster(level, state, {
    color: "blue",
    count: 1,
    shotIndex: 2,
    remainingBlockCount: 1,
  });
  assert.equal(state.activeGoals[0]?.color, "red", "Blue is still off-goal");
  assert.deepEqual(state.batches.map((batch) => [batch.color, batch.count]), [["blue", 1]]);
  assert.equal(parkedBlockCount(state), 1);

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
  // The cards are read before any of this, so what closes the lesson is the
  // board being clear.
  for (let card = 0; card < 3; card += 1) progress = reduceTutorialProgress(progress, { type: "TAP_ADVANCED" });
  progress = reduceTutorialProgress(progress, { type: "LEVEL_WON" });
  assert.equal(isTutorialChapterComplete(progress), true);
});

test("the sort board cannot be played in an order that skips the reserve", () => {
  // The lesson promises three things happen. Red, Red, Blue would deliver only
  // two: the goal would already have opened for Blue, so nothing would ever park.
  // The far Red sits behind Blue to make that order impossible.
  const level = TUTORIAL_CHAPTERS[1].level;
  const audit = auditWeakPointRoutes(level.blocks, level.weakPoints);
  const colorsIn = (wave) => (wave ?? []).map((index) => audit.clusterColors[index]).sort();

  assert.equal(audit.clusterColors.length, 3, "two separate Reds and one Blue");
  assert.deepEqual(colorsIn(audit.waves[0]), ["blue", "red"], "one Red and Blue open the board");
  assert.deepEqual(colorsIn(audit.waves[1]), ["red"], "the other Red waits behind Blue");
  assert.deepEqual(audit.unreachableClusterIndices, []);

  // Red is a two-block goal split across two clusters, so it cannot complete in
  // one claim — which is what leaves a window where Blue has no goal to go to.
  const redGoal = level.goals.filter((goal) => goal.color === "red");
  assert.deepEqual(redGoal.map((goal) => goal.target), [2]);
  assert.equal(level.blocks.filter((block) => block.color === "red").length, 2);
  assert.equal(level.activeGoalSlots, 1, "only one goal is open, so Blue has nowhere to go at first");
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
  // Scoped to the lesson that actually locks a colour. The sort lesson returns
  // null from tutorialAllowedColor, and a predicate comparing every colour to
  // null refuses every claim — the board would look playable and not be.
  assert.match(ui, /canClaimColor: engineTutorialChapter === 2/);
  assert.ok(ui.includes("tutorialAllowedColor(tutorialProgressRef.current) === color"));
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
  assert.match(css, /\.tutorial-exit \{[^}]*pointer-events: auto/);
  assert.match(css, /\.tutorial-next \{[^}]*pointer-events: auto/);

  // The scrim is the ring's own spread shadow, so the circle is a real hole in
  // the dim rather than a lighter patch painted over a cover.
  assert.match(css, /\.tutorial-spot \{[\s\S]*?box-shadow: 0 0 0 2000px rgba\(4,7,26,\.72\)/);
  // The hole takes the shape of what it reveals: a circle over the 3D scene, a
  // rounded bar over the reserve tray. A circle wide enough to hold that tray
  // swallowed the goal cards above it.
  assert.match(css, /\.tutorial-spot \{[\s\S]*?border-radius: var\(--spot-round\)/);
  assert.match(css, /\.tutorial-spot \{[\s\S]*?width: var\(--spot-w\); height: var\(--spot-h\)/);
  assert.match(ui, /round: "50%"/, "scene focuses stay circular");
  assert.match(ui, /round: "24px"/, "element focuses trace the element");
  // The card is placed off the measured ring, above or below it.
  assert.match(css, /\.tutorial-cue\.is-below \{[^}]*top: calc\(var\(--spot-y\) \+ var\(--spot-h\) \/ 2/);
  assert.match(css, /\.tutorial-cue\.is-above \{[^}]*top: calc\(var\(--spot-y\) - var\(--spot-h\) \/ 2/);
  assert.match(css, /\.tutorial-cue-arrow \{/, "the cue needs an arrow pointing back at the ring");
  // The old blocking chrome must not come back.
  for (const dead of [".tutorial-header", ".tutorial-coach", ".tutorial-hint", ".tutorial-step-dots"]) {
    assert.equal(css.includes(dead), false, `${dead} should be gone from the stylesheet`);
  }
  // The HUD is no longer pushed down to clear a lesson banner.
  assert.doesNotMatch(css, /\.game-frame\.is-tutorial:not\(\.is-tutorial-no-hud\) \.hud-top/);

  // The spotlight is measured against live boxes, not authored as fixed pixels.
  assert.match(ui, /const \[tutorialSpot, setTutorialSpot\] = useState<TutorialSpot \| null>/);
  // Focuses that are real elements are looked up and measured; only the flying
  // Rainbow band is a fraction of the scene, because nothing there has a box.
  assert.match(ui, /goals: "\.goal-section",[\s\S]{0,400}?reserve: "\.batch-section",[\s\S]{0,400}?cannon: "\.aim-zone",/);
  assert.match(ui, /frame\.querySelector\(TUTORIAL_ELEMENT_FOCUS\[tutorialFocus\]\)/);
  assert.match(ui, /getBoundingClientRect\(\)/);
  assert.match(ui, /className="tutorial-spot"/);
  // The cluster's ring comes from a real projection of its bounding box. A
  // fraction of the canvas height was wrong by ~70px, because the camera does
  // not frame the cluster in the middle of the scene.
  assert.match(ui, /engineRef\.current\?\.modelScreenBounds\(\)/);
  assert.match(engine, /modelScreenBounds\(\): \{ left: number; top: number; width: number; height: number \} \| null/);
  assert.match(engine, /\.project\(this\.camera\)/);
  assert.match(ui, /<TutorialGlyph name=\{tutorialStepCopy\.glyph\} \/>/);
  assert.match(ui, /aria-label=\{`Step \$\{tutorialProgress\.step \+ 1\} of \$\{tutorialStepTotal\}\./);
  // The dim is a rule in the tutorial module, not a condition rebuilt in the UI.
  assert.match(ui, /const tutorialShowsScrim = tutorialMode && tutorialScrimVisible\(tutorialProgress\)/);
  // A card that is read absorbs the tap, so reading it cannot double as a shot.
  assert.match(ui, /className="tutorial-tap-catcher"/);
  assert.match(ui, /dispatchTutorial\(\{ type: "TAP_ADVANCED" \}\)/);
  assert.match(css, /\.tutorial-tap-catcher \{[^}]*pointer-events: auto/);
  // Clearing the board is what ends the sort lesson.
  assert.match(ui, /dispatchTutorial\(\{ type: "LEVEL_WON" \}\)/);
  // The lesson asks for a target and one arrives, rather than a seeded wait.
  assert.match(ui, /rainbowFirstSpawnSeconds: engineTutorialChapter === 2 \? 0\.35 : undefined/);
  assert.match(engine, /firstSpawnSeconds: this\.options\.rainbowFirstSpawnSeconds/);

  // Hold-to-recentre. Counted off the frame clock, not a timer, so a press stops
  // counting down while a dialog has the game paused.
  assert.match(engine, /const MODEL_HOLD_MS = \d+;/);
  assert.match(engine, /const MODEL_HOLD_SLOP = \d+;/);
  assert.doesNotMatch(engine, /setTimeout\([^)]*recentre/i);
  assert.match(engine, /if \(this\.modelHoldDueAt !== null && performance\.now\(\) >= this\.modelHoldDueAt\)/);
  // Movement past the slop disarms it, so a turn and a press never both fire.
  assert.match(engine, /> MODEL_HOLD_SLOP\)[\s\S]{0,80}?this\.cancelModelHold\(\)/);
  // The gesture ends before the swing starts: a finger still resting on the glass
  // would otherwise cancel the very motion it just asked for.
  assert.match(engine, /this\.clearModelGesture\(\);[\s\S]{0,40}?this\.recentreModel\(\);/);
  // Reported even when the cluster was already square, or the lesson would stall
  // on a press that quietly did nothing.
  assert.match(engine, /onInteraction\?\.\(\{ type: "MODEL_RESET" \}\);[\s\S]{0,200}?angleTo\(this\.defaultModelOrientation\)/);
  // The ring the player watches is timed off the same constant the engine counts.
  assert.match(engine, /--hold-ms/);
  assert.match(css, /\.model-input-zone\.is-holding::after \{[\s\S]*?animation: model-hold-fill var\(--hold-ms/);
  // The touch itself drops the dim, so it is emitted before pointer capture can
  // throw and take the rest of the handler with it.
  assert.match(engine, /onInteraction\?\.\(\{ type: "AIM_TOUCHED" \}\);[\s\S]{0,200}?this\.aimStart\.set/);
  // Pictograms are drawn, not fetched and not emoji.
  assert.match(ui, /function TutorialGlyph\(\{ name \}: \{ name: TutorialGlyphName \}\)/);
  assert.doesNotMatch(ui, /tutorial-coach|tutorial-header/);
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
    "Find the mark",
    "No match waits",
    "Hit the rainbow",
    "tutorial-layer",
    "tutorial-spot",
    "tutorial-cue-arrow",
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
