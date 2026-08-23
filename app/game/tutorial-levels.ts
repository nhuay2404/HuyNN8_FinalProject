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
  weakPoints: [],
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
  weakPoints: [],
  rainbow: { targetCount: 0, spawnGapSeconds: 0, targetDurationSeconds: 0 },
  goals: [
    { id: "tutorial-sort-red", color: "red", target: 2 },
    { id: "tutorial-sort-blue", color: "blue", target: 1 },
  ],
  blocks: [
    // Red is deliberately split by Blue. One Red teaches direct sort, Blue
    // teaches the reserve, and the second Red opens Blue so that batch flies.
    block(0, 0, 0, "red"),
    block(1, 0, 0, "blue"),
    block(2, 0, 0, "red"),
  ],
};

const weakPointRainbowLevel: LevelConfig = {
  ...COMMON_RULES,
  id: 9003,
  name: "Tutorial — Weak Point & Rainbow Climax",
  reserveBlocks: 2,
  weakPoints: [
    { id: "tutorial-weak-red", blockId: "block-0-1-0", x: 0, y: 1, z: 0, face: "PZ" },
    { id: "tutorial-weak-blue", blockId: "block-0-0-0", x: 0, y: 0, z: 0, face: "NX" },
  ],
  // The engine holds these targets inactive until the Weak Point lesson is
  // done. Three forgiving attempts keep the campaign's authored 7s duration.
  rainbow: { targetCount: 3, spawnGapSeconds: 2, targetDurationSeconds: 7 },
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
