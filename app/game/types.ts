import type * as THREE from "three";

export type BlockColor = "red" | "green" | "yellow" | "blue" | "purple" | "orange";

export type GoalSpec = { id: string; color: BlockColor; target: number };

export type BlockSpec = {
  id: string;
  x: number;
  y: number;
  z: number;
  color: BlockColor;
  type: "normal";
  // How many barrel layers wrap this block, 1 to MAX_BARREL_LAYERS. Each
  // breaking event peels one layer, and the block underneath can only be
  // claimed once every layer is gone (draft §1.3). Absent means no barrel.
  barrelLayers?: number;
  // Blocks sharing a link group belong to clusters that are destroyed together
  // (draft §2.1). Every block of both linked clusters carries the same group.
  linkGroup?: string;
};

export type LevelConfig = {
  id: number;
  name: string;
  activeGoalSlots: number;
  batchCapacity: number;
  showGoalQueuePreview: false;
  allowSameColorActiveGoals: false;
  shotLimit: number | null;
  missCountsAsShot: true;
  continuousFire: true;
  adjacency: { x: true; y: true; z: boolean; zStatus: "UNCONFIRMED" | "CONFIRMED"; diagonal: false };
  unsupportedBlocksRemainStatic: true;
  hiddenConnectedBlocksAreIncluded: true;
  postWinAutoClear: true;

  // These choices remain open in the document. Keep them visible as temporary
  // prototype policies instead of silently turning them into official rules.
  batchPriority: "OLDEST_FIRST_TEMP";
  resolutionOrder: "IMPACT_TIME_THEN_SHOT_ID_TEMP";
  overfillTransaction: "CREATE_EXCESS_THEN_ADVANCE_TEMP";
  claimedBlockCollision: "PASS_THROUGH_TEMP";
  postWinAutoClearPattern: "STABLE_CLUSTER_CADENCE_TEMP";
  goals: GoalSpec[];
  blocks: BlockSpec[];
};

export type GoalState = GoalSpec & { current: number };
export type BatchState = {
  id: string;
  sourceShotId: number;
  color: BlockColor;
  count: number;
  createdAt: number;
};

// One batch emptying into one goal. The engine plays a flight for each of these
// before applying it, so a cascade is watched step by step instead of the board
// jumping to its end state.
export type BatchTransfer = {
  batchId: string;
  goalId: string;
  goalSlot: number;
  color: BlockColor;
  count: number;
  goalFromCount: number;
};

export type GameResult = null | {
  kind: "WIN" | "FAIL";
  allClear: boolean;
  reason?: string;
};

export type GameState = {
  phase: GamePhase;
  activeGoals: Array<GoalState | null>;
  nextGoalIndex: number;
  batches: BatchState[];
  shotIndex: number;
  remainingBlockCount: number;
  postWinClearing: boolean;
  result: GameResult;
  lastEvents: string[];
};

export type GamePhase = "PLAYING" | "AIMING" | "PAUSED" | "WIN" | "FAIL";

export type ClusterResult = {
  color: BlockColor;
  count: number;
  shotIndex: number;
  remainingBlockCount: number;
};

export type BlockRuntime = BlockSpec & {
  active: boolean;
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  // Layers still standing. Zero means the block is exposed and claimable; the
  // authored count in `barrelLayers` stays untouched so a restart rebuilds it.
  barrelLeft: number;
  // The shell drawn around the block, removed when the last layer breaks.
  barrelShell?: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
};
