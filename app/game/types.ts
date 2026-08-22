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
};

export type LevelConfig = {
  id: number;
  name: string;
  activeGoalSlots: number;
  // How many claimed blocks may sit parked at once, counted in blocks rather
  // than in batch records: a batch of six costs six, not one.
  reserveBlocks: number;
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
};
