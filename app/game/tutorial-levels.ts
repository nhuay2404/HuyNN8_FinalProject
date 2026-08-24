import type { BlockSpec, LevelConfig } from "./types";

export type TutorialChapterId = "controls" | "sort-batch" | "weakpoint-rainbow";

export type TutorialChapter = Readonly<{
  id: TutorialChapterId;
  eyebrow: string;
  title: string;
  level: LevelConfig;
}>;

const COMMON_RULES = {
  activeGoalSlots: 1,
  showGoalQueuePreview: false,
  allowSameColorActiveGoals: false,
  shotLimit: null,
  missCountsAsShot: true,
  continuousFire: true,
  adjacency: { x: true, y: true, z: true, zStatus: "CONFIRMED", diagonal: false },
  unsupportedBlocksRemainStatic: true,
  hiddenConnectedBlocksAreIncluded: true,
  postWinAutoClear: true,
  batchPriority: "OLDEST_FIRST_TEMP",
  resolutionOrder: "IMPACT_TIME_THEN_SHOT_ID_TEMP",
  overfillTransaction: "CREATE_EXCESS_THEN_ADVANCE_TEMP",
  claimedBlockCollision: "PASS_THROUGH_TEMP",
  postWinAutoClearPattern: "STABLE_CLUSTER_CADENCE_TEMP",
} as const;

function block(x: number, y: number, z: number, color: BlockSpec["color"]): BlockSpec {
  return { id: `block-${x}-${y}-${z}`, x, y, z, color, type: "normal" };
}

const controlsLevel: LevelConfig = {
  ...COMMON_RULES,
  id: 9001,
  name: "Tutorial — Cannon & Camera",
  reserveBlocks: 2,
  // Marks exist from the very first lesson. The camera sits on +z, so a PZ face
  // is the one facing the player and an NZ face is round the back.
  weakPoints: [
    // The yellow pair is the front row: this is the shot the lesson asks for.
    { id: "tutorial-controls-front-a", blockId: "block-0-0-1", x: 0, y: 0, z: 1, face: "PZ" },
    { id: "tutorial-controls-front-b", blockId: "block-1-0-1", x: 1, y: 0, z: 1, face: "PZ" },
    // Red sits a row higher than the front pair, so its own front face is clear.
    { id: "tutorial-controls-top-a", blockId: "block-0-1-0", x: 0, y: 1, z: 0, face: "PZ" },
    { id: "tutorial-controls-top-b", blockId: "block-1-1-0", x: 1, y: 1, z: 0, face: "PZ" },
    // Blue hides behind the yellow pair, so its mark is on the back face. That
    // is what gives the rotate step something to find instead of asking for a
    // gesture with nothing behind it.
    { id: "tutorial-controls-back-a", blockId: "block-0-0-0", x: 0, y: 0, z: 0, face: "NZ" },
    { id: "tutorial-controls-back-b", blockId: "block-1-0-0", x: 1, y: 0, z: 0, face: "NZ" },
  ],
  rainbow: { targetCount: 0, spawnGapSeconds: 0, targetDurationSeconds: 0 },
  goals: [
    { id: "tutorial-controls-red", color: "red", target: 2 },
    { id: "tutorial-controls-blue", color: "blue", target: 2 },
    { id: "tutorial-controls-yellow", color: "yellow", target: 2 },
  ],
  blocks: [
    block(0, 1, 0, "red"), block(1, 1, 0, "red"),
    block(0, 0, 0, "blue"), block(1, 0, 0, "blue"),
    block(0, 0, 1, "yellow"), block(1, 0, 1, "yellow"),
  ],
};

const sortBatchLevel: LevelConfig = {
  ...COMMON_RULES,
  id: 9002,
  name: "Tutorial — Sort & Reserve",
  reserveBlocks: 1,
  // Every mark faces the player: this lesson is about where a cluster goes, and
  // making it also a hunt for a face would bury that.
  weakPoints: [
    { id: "tutorial-sort-red-front", blockId: "block-0-1-1", x: 0, y: 1, z: 1, face: "PZ" },
    { id: "tutorial-sort-blue", blockId: "block-0-0-1", x: 0, y: 0, z: 1, face: "PZ" },
    // Behind Blue, so it opens up only once Blue has been taken.
    { id: "tutorial-sort-red-back", blockId: "block-0-0-0", x: 0, y: 0, z: 0, face: "PZ" },
  ],
  rainbow: { targetCount: 0, spawnGapSeconds: 0, targetDurationSeconds: 0 },
  goals: [
    { id: "tutorial-sort-red", color: "red", target: 2 },
    { id: "tutorial-sort-blue", color: "blue", target: 1 },
  ],
  // The cards promise three things happen; the board has to make all three
  // unavoidable in whatever order the player picks.
  //
  // Red is two separate one-block clusters, so it cannot finish in a single
  // claim, and the second one sits behind Blue. That leaves no way to reach the
  // end without claiming Blue while Red is still short — which is exactly the
  // moment no goal is open for Blue and it has to wait in the reserve. Red,
  // Red, Blue would have shown only two of the three beats: the goal would
  // already have opened for Blue and nothing would ever have parked.
  blocks: [
    block(0, 1, 1, "red"),
    block(0, 0, 1, "blue"),
    block(0, 0, 0, "red"),
  ],
};

const weakPointRainbowLevel: LevelConfig = {
  ...COMMON_RULES,
  id: 9003,
  name: "Tutorial — Weak Point & Rainbow Climax",
  reserveBlocks: 2,
  weakPoints: [
    // Red carries a mark on both of its blocks so the "hit the mark" step is
    // winnable without precision aiming.
    { id: "tutorial-weak-red", blockId: "block-0-1-0", x: 0, y: 1, z: 0, face: "PZ" },
    { id: "tutorial-weak-red-b", blockId: "block-1-1-0", x: 1, y: 1, z: 0, face: "PZ" },
    // Blue's only mark is on its far side on purpose: that is what makes the
    // bypass worth having rather than a shortcut for a shot already available.
    { id: "tutorial-weak-blue", blockId: "block-0-0-0", x: 0, y: 0, z: 0, face: "NX" },
  ],
  // The engine holds these targets inactive until the Weak Point lesson is done.
  // Three attempts, because a missed shot must not stall the lesson — but spaced
  // far enough apart that only one is ever on screen. At a 2s gap against a 7s
  // duration they overlapped, and a lesson about catching one target became three
  // of them crowding each other.
  rainbow: { targetCount: 3, spawnGapSeconds: 9, targetDurationSeconds: 7 },
  goals: [
    { id: "tutorial-hook-red", color: "red", target: 2 },
    { id: "tutorial-hook-blue", color: "blue", target: 2 },
  ],
  blocks: [
    block(0, 1, 0, "red"), block(1, 1, 0, "red"),
    block(0, 0, 0, "blue"), block(1, 0, 0, "blue"),
  ],
};

export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  { id: "controls", eyebrow: "Lesson 1 of 3", title: "Cannon & 3D model", level: controlsLevel },
  { id: "sort-batch", eyebrow: "Lesson 2 of 3", title: "Sort & reserve", level: sortBatchLevel },
  { id: "weakpoint-rainbow", eyebrow: "Lesson 3 of 3", title: "Weak Point & Rainbow Climax", level: weakPointRainbowLevel },
];
