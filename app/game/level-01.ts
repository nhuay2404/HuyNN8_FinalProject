import type { BlockColor, BlockSpec, LevelConfig } from "./types";

const rows: Array<{ y: number; z: number; colors: BlockColor[] }> = [
  { y: 2, z: 1, colors: ["red", "red", "red", "orange"] },
  { y: 1, z: 1, colors: ["blue", "blue", "blue", "blue"] },
  { y: 0, z: 1, colors: ["green", "green", "green", "green"] },
  { y: 2, z: 0, colors: ["purple", "purple", "purple", "orange"] },
  { y: 1, z: 0, colors: ["yellow", "yellow", "yellow", "yellow"] },
  { y: 0, z: 0, colors: ["red", "red", "red", "orange"] },
];

const blocks: BlockSpec[] = rows.flatMap((row) =>
  row.colors.map((color, x) => ({
    id: `block-${x}-${row.y}-${row.z}`,
    x,
    y: row.y,
    z: row.z,
    color,
    type: "normal",
  })),
);

export const level01: LevelConfig = {
  id: 1,
  name: "Prism 4x3x2",
  activeGoalSlots: 2,
  batchCapacity: 2,
  showGoalQueuePreview: false,
  allowSameColorActiveGoals: false,
  shotLimit: null,
  missCountsAsShot: true,
  continuousFire: true,

  // Confirmed by prototype playtesting: direct same-color contact on X/Y/Z
  // belongs to one cluster. Diagonal contact still does not connect blocks.
  adjacency: { x: true, y: true, z: true, zStatus: "CONFIRMED", diagonal: false },
  unsupportedBlocksRemainStatic: true,
  hiddenConnectedBlocksAreIncluded: true,
  postWinAutoClear: true,

  // TODO(design): Temporary policies for the three unresolved transactions.
  batchPriority: "OLDEST_FIRST_TEMP",
  resolutionOrder: "IMPACT_TIME_THEN_SHOT_ID_TEMP",
  overfillTransaction: "CREATE_EXCESS_THEN_ADVANCE_TEMP",
  claimedBlockCollision: "PASS_THROUGH_TEMP",
  postWinAutoClearPattern: "STABLE_CLUSTER_CADENCE_TEMP",

  // Goal totals match the block inventory exactly, including per color.
  goals: [
    { id: "goal-red-6", color: "red", target: 6 },
    { id: "goal-green-4", color: "green", target: 4 },
    { id: "goal-yellow-4", color: "yellow", target: 4 },
    { id: "goal-blue-4", color: "blue", target: 4 },
    { id: "goal-purple-3", color: "purple", target: 3 },
    { id: "goal-orange-3", color: "orange", target: 3 },
  ],
  blocks,
};
