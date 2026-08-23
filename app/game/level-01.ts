import type { BlockColor, BlockSpec, LevelConfig, WeakPointSpec } from "./types";

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

// One point per cluster. The two opening goal colours are immediately readable;
// every other point is revealed by the preceding goal route, without cycles.
const weakPoints: WeakPointSpec[] = [
  { id: "weak-point-block-1-2-0-ny", blockId: "block-1-2-0", x: 1, y: 2, z: 0, face: "NY" },
  { id: "weak-point-block-3-2-1-ny", blockId: "block-3-2-1", x: 3, y: 2, z: 1, face: "NY" },
  { id: "weak-point-block-1-1-0-ny", blockId: "block-1-1-0", x: 1, y: 1, z: 0, face: "NY" },
  { id: "weak-point-block-1-0-0-pz", blockId: "block-1-0-0", x: 1, y: 0, z: 0, face: "PZ" },
  { id: "weak-point-block-3-0-0-pz", blockId: "block-3-0-0", x: 3, y: 0, z: 0, face: "PZ" },
  { id: "weak-point-block-0-2-1-pz", blockId: "block-0-2-1", x: 0, y: 2, z: 1, face: "PZ" },
  { id: "weak-point-block-2-1-1-nz", blockId: "block-2-1-1", x: 2, y: 1, z: 1, face: "NZ" },
  { id: "weak-point-block-0-0-1-pz", blockId: "block-0-0-1", x: 0, y: 0, z: 1, face: "PZ" },
];

export const level01: LevelConfig = {
  id: 1,
  name: "Prism 4x3x2",
  activeGoalSlots: 2,
  reserveBlocks: 8,
  showGoalQueuePreview: false,
  allowSameColorActiveGoals: false,
  shotLimit: null,
  missCountsAsShot: true,
  continuousFire: true,
  weakPoints,
  rainbow: { targetCount: 3, spawnGapSeconds: 12, targetDurationSeconds: 7 },

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
