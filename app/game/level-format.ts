// Extension spelled out because this module is both bundled and imported
// straight into Node by work/sync-levels.mjs and the tests, and Node will not
// resolve an extensionless TypeScript specifier.
import { RAINBOW_TARGET_DEFAULTS } from "./rainbow-hook.ts";
import type {
  BlockColor,
  BlockSpec,
  GoalSpec,
  LevelConfig,
  RainbowConfig,
  WeakPointFace,
  WeakPointSpec,
} from "./types";

// One level is one row of a tab separated sheet, so a designer can keep all 50
// levels in a spreadsheet and change a single line to change a single level.
// `layers` holds one character per block: layers are separated by `|` along the
// depth axis, rows inside a layer by `/` from the top row down, and `.` marks an
// empty cell.
//
// A colour code is a plain block; case is ignored, so a sheet written for the
// retired barrel mechanic still reads as the shape its author drew.
export const COLOR_CODES: Record<string, BlockColor> = {
  R: "red",
  G: "green",
  Y: "yellow",
  B: "blue",
  P: "purple",
  O: "orange",
};

export const COLOR_CODE_OF: Record<BlockColor, string> = {
  red: "R",
  green: "G",
  yellow: "Y",
  blue: "B",
  purple: "P",
  orange: "O",
};

export const SHEET_COLUMNS = [
  "level",
  "name",
  "dims",
  "layers",
  "goal_order",
  "goal_split",
  "goal_slots",
  "batch_blocks",
  "shot_limit",
  "weak_points",
  "rainbow_target_count",
  "rainbow_spawn_gap",
  "rainbow_target_duration",
  "notes",
] as const;

export const HOOK_LEVEL_DEFAULTS = {
  rainbowTargetCount: RAINBOW_TARGET_DEFAULTS.targetCount,
  rainbowSpawnGapSeconds: RAINBOW_TARGET_DEFAULTS.spawnGapSeconds,
  rainbowTargetDurationSeconds: RAINBOW_TARGET_DEFAULTS.targetDurationSeconds,
} as const;

// Everything a level does not spell out comes from here, so a row only carries
// what makes that level different.
const LEVEL_DEFAULTS = {
  activeGoalSlots: 2,
  // Blocks the player may keep parked at once. 8 is the smallest budget that
  // leaves every line winnable under the retired two-slot rule; the floor is
  // the level's biggest cluster, checked in buildLevel.
  reserveBlocks: 8,
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

export type LevelSheetIssue = {
  row: number;
  level: string;
  severity: "error" | "warning";
  message: string;
};
export type LevelSheetResult = { levels: LevelConfig[]; issues: LevelSheetIssue[] };

type RowCells = Record<string, string>;

function splitSheetLines(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line, index) => ({ line, row: index + 1 }))
    .filter((entry) => entry.line.trim().length > 0 && !entry.line.startsWith("#"));
}

// Excel rarely produces real tab-separated files: "Save As CSV" writes commas,
// and on a Vietnamese/European Windows install it writes semicolons instead
// (the regional list separator), while a straight drag-and-drop of a .tsv
// stays tab-separated. Reading whichever the header line actually uses means
// a designer never has to think about the difference.
function detectDelimiter(headerLine: string): string {
  const candidates: string[] = ["\t", ",", ";"];
  const counts = candidates.map((delimiter) => ({
    delimiter,
    count: headerLine.split(delimiter).length - 1,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].delimiter : "\t";
}

// Comma/semicolon rows need RFC4180-style quote handling: goal_order and
// goal_split already use commas as their own inner separator (e.g. "R,G,B"),
// so Excel wraps that cell in double quotes when it saves as CSV. A plain
// `.split(delimiter)` would tear that one cell into several columns.
function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t");

  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === "\"") {
        if (line[i + 1] === "\"") { current += "\""; i += 1; } else inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseDims(raw: string) {
  const match = /^(\d+)\s*x\s*(\d+)\s*x\s*(\d+)$/i.exec(raw.trim());
  if (!match) return null;
  const dims = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  if (dims.x < 1 || dims.y < 1 || dims.z < 1) return null;
  return dims;
}

function parseBlocks(raw: string, dims: { x: number; y: number; z: number }, report: (message: string) => void) {
  const layers = raw.trim().split("|");
  if (layers.length !== dims.z) {
    report(`layers has ${layers.length} layers but dims says ${dims.z}`);
    return [];
  }

  const blocks: BlockSpec[] = [];
  const seen = new Set<string>();
  layers.forEach((layer, z) => {
    const rows = layer.split("/");
    if (rows.length !== dims.y) {
      report(`layer z=${z} has ${rows.length} rows but dims says ${dims.y}`);
      return;
    }
    rows.forEach((rowText, rowIndex) => {
      const cells = rowText.trim();
      if (cells.length !== dims.x) {
        report(`layer z=${z} row ${rowIndex + 1} has ${cells.length} cells but dims says ${dims.x}`);
        return;
      }
      // The first row written is the top row, so it maps to the highest y.
      const y = dims.y - 1 - rowIndex;
      for (let x = 0; x < cells.length; x += 1) {
        const raw = cells[x];
        const code = raw.toUpperCase();
        if (code === ".") continue;
        const color = COLOR_CODES[code];
        if (!color) {
          report(`colour code "${raw}" is not valid (use R G Y B P O or .)`);
          continue;
        }
        const key = `${x},${y},${z}`;
        if (seen.has(key)) {
          report(`two blocks share the position ${key}`);
          continue;
        }
        seen.add(key);
        blocks.push({
          id: `block-${x}-${y}-${z}`,
          x, y, z, color,
          type: "normal",
        });
      }
    });
  });
  return blocks;
}

// Face adjacency on all three axes, matching the engine's cluster rule for the
// levels this format produces (every level here confirms z adjacency).
const FACE_NEIGHBORS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;

function sameColorClusters(blocks: BlockSpec[]) {
  const at = new Map(blocks.map((block) => [`${block.x},${block.y},${block.z}`, block]));
  const seen = new Set<string>();
  const clusters: BlockSpec[][] = [];

  for (const start of blocks) {
    if (seen.has(start.id)) continue;
    seen.add(start.id);
    const queue = [start];
    const cluster: BlockSpec[] = [];
    while (queue.length) {
      const block = queue.shift()!;
      cluster.push(block);
      for (const [dx, dy, dz] of FACE_NEIGHBORS) {
        const neighbor = at.get(`${block.x + dx},${block.y + dy},${block.z + dz}`);
        if (!neighbor || neighbor.color !== block.color || seen.has(neighbor.id)) continue;
        seen.add(neighbor.id);
        queue.push(neighbor);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

// A single claim is never split across the reserve, so a level whose biggest
// cluster does not fit the reserve budget carries a legal move that can never
// be played. Measured here, at author time, next to checkGoalWindows.
function largestClusterSize(blocks: BlockSpec[]) {
  return Math.max(0, ...sameColorClusters(blocks).map((cluster) => cluster.length));
}

function countColors(blocks: BlockSpec[]) {
  const counts = new Map<BlockColor, number>();
  for (const block of blocks) counts.set(block.color, (counts.get(block.color) ?? 0) + 1);
  return counts;
}

function parseColorOrder(raw: string, counts: Map<BlockColor, number>, report: (message: string) => void) {
  const present = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([color]) => color);
  if (!raw.trim()) return present;

  const order: BlockColor[] = [];
  for (const token of raw.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    const color = COLOR_CODES[token.toUpperCase()];
    if (!color) {
      report(`goal_order has an unknown colour code: "${token}"`);
      continue;
    }
    if (!counts.has(color)) {
      report(`goal_order names ${color} but this level has no blocks of that colour`);
      continue;
    }
    if (order.includes(color)) {
      report(`goal_order names ${color} twice`);
      continue;
    }
    order.push(color);
  }
  for (const color of present) {
    if (!order.includes(color)) report(`goal_order is missing ${color}`);
  }
  return order;
}

function parseSplits(raw: string, counts: Map<BlockColor, number>, report: (message: string) => void) {
  const splits = new Map<BlockColor, number[]>();
  if (!raw.trim()) return splits;

  for (const entry of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    const [codeText, partsText] = entry.split(":");
    const color = COLOR_CODES[(codeText ?? "").trim().toUpperCase()];
    if (!color) {
      report(`goal_split has an unknown colour code: "${entry}"`);
      continue;
    }
    const inventory = counts.get(color);
    if (inventory === undefined) {
      report(`goal_split splits ${color} but this level has no blocks of that colour`);
      continue;
    }
    const parts = (partsText ?? "").split("+").map((part) => Number(part.trim()));
    if (!parts.length || parts.some((part) => !Number.isInteger(part) || part < 1)) {
      report(`goal_split "${entry}" must look like R:4+2 with positive integers`);
      continue;
    }
    const total = parts.reduce((sum, part) => sum + part, 0);
    if (total !== inventory) {
      report(`goal_split ${color} adds up to ${total} but the level has ${inventory} blocks of that colour`);
      continue;
    }
    splits.set(color, parts);
  }
  return splits;
}

// Goals are never typed by hand: the sheet says which colors come first and how
// to slice them, and the targets come from counting the blocks. That keeps the
// "every color's goals equal its block inventory" rule impossible to break.
function buildGoals(order: BlockColor[], counts: Map<BlockColor, number>, splits: Map<BlockColor, number[]>) {
  const queues = order.map((color) => ({ color, parts: [...(splits.get(color) ?? [counts.get(color) ?? 0])] }));
  const goals: GoalSpec[] = [];
  const usedIds = new Map<string, number>();

  // One part per color per pass, so a split color lands apart in the queue
  // instead of twice in a row.
  while (queues.some((queue) => queue.parts.length > 0)) {
    for (const queue of queues) {
      const target = queue.parts.shift();
      if (target === undefined) continue;
      const base = `goal-${queue.color}-${target}`;
      const seen = (usedIds.get(base) ?? 0) + 1;
      usedIds.set(base, seen);
      goals.push({ id: seen === 1 ? base : `${base}-${seen}`, color: queue.color, target });
    }
  }
  return goals;
}

function parsePositiveInteger(raw: string, label: string, report: (message: string) => void) {
  if (!raw.trim()) return null;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1) {
    report(`${label} must be an integer of 1 or more`);
    return null;
  }
  return value;
}

function parseNonNegativeInteger(raw: string, label: string, report: (message: string) => void) {
  if (!raw.trim()) return null;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0) {
    report(`${label} must be an integer of 0 or more`);
    return null;
  }
  return value;
}

function parsePositiveNumber(raw: string, label: string, report: (message: string) => void) {
  if (!raw.trim()) return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) {
    report(`${label} must be a number greater than 0`);
    return null;
  }
  return value;
}

const WEAK_POINT_FACES = new Set<WeakPointFace>(["PX", "NX", "PY", "NY", "PZ", "NZ"]);
const WEAK_POINT_FACE_STEPS: Record<WeakPointFace, readonly [number, number, number]> = {
  PX: [1, 0, 0],
  NX: [-1, 0, 0],
  PY: [0, 1, 0],
  NY: [0, -1, 0],
  PZ: [0, 0, 1],
  NZ: [0, 0, -1],
};

export type WeakPointRouteAudit = Readonly<{
  clusterColors: readonly BlockColor[];
  pointCounts: readonly number[];
  /** Clusters that become reachable together after the preceding waves leave. */
  waves: readonly (readonly number[])[];
  unreachableClusterIndices: readonly number[];
}>;

// Reachability is a property of the authored faces, not the current camera.
// A cluster becomes playable when at least one of its Weak Points faces empty
// space or a cluster that an earlier wave could already remove.
export function auditWeakPointRoutes(blocks: BlockSpec[], weakPoints: WeakPointSpec[]): WeakPointRouteAudit {
  const clusters = sameColorClusters(blocks);
  const clusterIndexByBlock = new Map<string, number>();
  clusters.forEach((cluster, clusterIndex) => {
    for (const block of cluster) clusterIndexByBlock.set(block.id, clusterIndex);
  });
  const blockAt = new Map(blocks.map((block) => [`${block.x}.${block.y}.${block.z}`, block]));
  const pointsByCluster = clusters.map(() => [] as WeakPointSpec[]);
  for (const point of weakPoints) {
    const clusterIndex = clusterIndexByBlock.get(point.blockId);
    if (clusterIndex !== undefined) pointsByCluster[clusterIndex].push(point);
  }

  const cleared = new Set<number>();
  const waves: number[][] = [];
  for (;;) {
    const nextWave: number[] = [];
    clusters.forEach((_, clusterIndex) => {
      if (cleared.has(clusterIndex)) return;
      const reachable = pointsByCluster[clusterIndex].some((point) => {
        const [dx, dy, dz] = WEAK_POINT_FACE_STEPS[point.face];
        const coveringBlock = blockAt.get(`${point.x + dx}.${point.y + dy}.${point.z + dz}`);
        if (!coveringBlock) return true;
        const coveringCluster = clusterIndexByBlock.get(coveringBlock.id);
        return coveringCluster !== undefined && cleared.has(coveringCluster);
      });
      if (reachable) nextWave.push(clusterIndex);
    });
    if (!nextWave.length) break;
    waves.push(nextWave);
    nextWave.forEach((clusterIndex) => cleared.add(clusterIndex));
  }

  return {
    clusterColors: clusters.map((cluster) => cluster[0].color),
    pointCounts: pointsByCluster.map((points) => points.length),
    waves,
    unreachableClusterIndices: clusters.map((_, index) => index).filter((index) => !cleared.has(index)),
  };
}

function checkWeakPointPacing(
  blocks: BlockSpec[],
  weakPoints: WeakPointSpec[],
  goals: GoalSpec[],
  activeGoalSlots: number,
  warn: (message: string) => void,
) {
  const audit = auditWeakPointRoutes(blocks, weakPoints);
  const openingClusters = audit.waves[0] ?? [];
  const openingColors = new Set(openingClusters.map((index) => audit.clusterColors[index]));
  for (const color of new Set(goals.slice(0, activeGoalSlots).map((goal) => goal.color))) {
    if (!openingColors.has(color)) {
      warn(`weak-point pacing: opening goal ${color} has no immediately reachable cluster`);
    }
  }

  if (audit.unreachableClusterIndices.length) {
    const labels = audit.unreachableClusterIndices
      .map((index) => `${audit.clusterColors[index]} cluster ${index + 1}`)
      .join(", ");
    warn(`HIGH-RISK weak-point blocker cycle leaves ${labels} unreachable without a Rainbow bypass`);
  }
}

function parseWeakPoints(
  raw: string,
  dims: { x: number; y: number; z: number },
  blocks: BlockSpec[],
  report: (message: string) => void,
  warn: (message: string) => void,
) {
  const blockAt = new Map(blocks.map((block) => [`${block.x}.${block.y}.${block.z}`, block]));
  const seen = new Set<string>();
  const weakPoints: WeakPointSpec[] = [];
  const entries = raw.trim() ? raw.split("~") : [];

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    const match = /^(-?\d+)\.(-?\d+)\.(-?\d+):([^:]+)$/.exec(entry);
    if (!match) {
      report(`weak_points entry "${entry}" must look like x.y.z:FACE`);
      continue;
    }

    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);
    const faceText = match[4].trim();
    const coordinate = `${x}.${y}.${z}`;

    if (x < 0 || x >= dims.x || y < 0 || y >= dims.y || z < 0 || z >= dims.z) {
      report(`weak_points coordinate ${coordinate} is outside dims ${dims.x}x${dims.y}x${dims.z}`);
      continue;
    }
    if (!WEAK_POINT_FACES.has(faceText as WeakPointFace)) {
      report(`weak_points face "${faceText}" is not valid (use PX NX PY NY PZ or NZ)`);
      continue;
    }

    const face = faceText as WeakPointFace;
    const key = `${coordinate}:${face}`;
    if (seen.has(key)) {
      report(`weak_points declares ${key} more than once`);
      continue;
    }
    seen.add(key);

    const block = blockAt.get(coordinate);
    if (!block) {
      report(`weak_points ${key} points to an empty cell, not an active block`);
      continue;
    }
    weakPoints.push({
      id: `weak-point-${block.id}-${face.toLowerCase()}`,
      blockId: block.id,
      x,
      y,
      z,
      face,
    });

    // A point authored on a face that directly touches another live cube is
    // physically covered at round start. This can be intentional spatial
    // routing (the covering block may leave first), so keep the row playable
    // and surface a warning instead of treating it as malformed data.
    const [dx, dy, dz] = WEAK_POINT_FACE_STEPS[face];
    const coveringCoordinate = `${x + dx}.${y + dy}.${z + dz}`;
    const coveringBlock = blockAt.get(coveringCoordinate);
    if (coveringBlock?.color === block.color) {
      warn(
        `HIGH-RISK weak_points ${key} faces same-color cell ${coveringCoordinate} inside its own FACE_6 cluster; `
        + "this point is inaccessible, so the cluster needs another reachable Weak Point",
      );
    } else if (coveringBlock) {
      warn(
        `weak_points ${key} faces occupied cell ${coveringCoordinate} and may be inaccessible until that block is removed`,
      );
    }
  }

  const pointCountByBlock = new Map<string, number>();
  for (const point of weakPoints) {
    pointCountByBlock.set(point.blockId, (pointCountByBlock.get(point.blockId) ?? 0) + 1);
  }
  for (const cluster of sameColorClusters(blocks)) {
    const count = cluster.reduce((sum, block) => sum + (pointCountByBlock.get(block.id) ?? 0), 0);
    if (count >= 1 && count <= 3) continue;
    const anchor = cluster[0];
    report(
      `same-color FACE_6 ${anchor.color} cluster containing ${anchor.x}.${anchor.y}.${anchor.z} has ${count} Weak Points; expected 1 to 3`,
    );
  }
  return weakPoints;
}

const RETIRED_COLUMNS: Array<[string, string]> = [
  ["barrel_layers", "the barrel mechanic was removed"],
  ["links", "the link mechanic was removed"],
  ["batch_slots", "renamed to batch_blocks, and it now counts blocks rather than slots"],
  ["round_time", "the round timer was removed; a round has no time limit"],
  ["rainbow_trigger", "Rainbow Targets are scheduled from a seed, not from a countdown threshold"],
  ["rainbow_reward_sec", "a Rainbow Target hit arms one weak-point bypass instead of banking seconds"],
  ["rainbow_paths", "target flight paths are generated from a seed, not authored"],
];

// An unknown column would otherwise be ignored in silence, and a cell the
// parser never looks at falls back to a default with no warning at all. A sheet
// still carrying a retired column is far more likely to be stale than
// deliberate, so say so instead of quietly changing what it means.
function reportRetiredColumns(cells: RowCells, report: (message: string) => void) {
  for (const [name, why] of RETIRED_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(cells, name)) {
      report(`the "${name}" column is no longer read: ${why}`);
    }
  }
}

function checkGoalWindows(goals: GoalSpec[], slots: number, report: (message: string) => void) {
  // The engine keeps `slots` goals open at once and they always come from a
  // window of consecutive goals, so a repeated color inside one window would
  // crash the level the moment that window opens.
  for (let start = 0; start + slots <= goals.length; start += 1) {
    const window = goals.slice(start, start + slots);
    const colors = new Set(window.map((goal) => goal.color));
    if (colors.size !== window.length) {
      report(`goals ${start + 1}..${start + slots} open two of the same colour at once; change goal_order`);
      return;
    }
  }
}

function buildLevel(
  cells: RowCells,
  report: (message: string) => void,
  warn: (message: string) => void,
): LevelConfig | null {
  const levelNumber = parsePositiveInteger(cells.level ?? "", "level", report);
  const dims = parseDims(cells.dims ?? "");
  if (!dims) report(`dims "${cells.dims ?? ""}" must look like 4x3x2`);
  if (levelNumber === null || !dims) return null;

  let shapeProblems = 0;
  const reportShape = (message: string) => {
    shapeProblems += 1;
    report(message);
  };
  const blocks = parseBlocks(cells.layers ?? "", dims, reportShape);
  if (shapeProblems) return null;
  if (!blocks.length) {
    // A shape error already explains the empty result; saying it twice only
    // makes the list harder to read.
    if (!shapeProblems) report("this level has no blocks");
    return null;
  }

  reportRetiredColumns(cells, report);
  const counts = countColors(blocks);
  const order = parseColorOrder(cells.goal_order ?? "", counts, report);
  const splits = parseSplits(cells.goal_split ?? "", counts, report);
  const goals = buildGoals(order, counts, splits);
  const activeGoalSlots = parsePositiveInteger(cells.goal_slots ?? "", "goal_slots", report) ?? LEVEL_DEFAULTS.activeGoalSlots;
  const reserveBlocks = parsePositiveInteger(cells.batch_blocks ?? "", "batch_blocks", report) ?? LEVEL_DEFAULTS.reserveBlocks;
  const shotLimit = parsePositiveInteger(cells.shot_limit ?? "", "shot_limit", report);
  const weakPoints = parseWeakPoints(cells.weak_points ?? "", dims, blocks, report, warn);
  // Zero is a real authored value, not a mistake: the opening levels teach one
  // rule at a time, and a bonus target flying past during the first lesson is a
  // second thing to look at. Blank still means the default.
  const targetCount = parseNonNegativeInteger(cells.rainbow_target_count ?? "", "rainbow_target_count", report)
    ?? HOOK_LEVEL_DEFAULTS.rainbowTargetCount;
  const spawnGapSeconds = parsePositiveNumber(cells.rainbow_spawn_gap ?? "", "rainbow_spawn_gap", report)
    ?? HOOK_LEVEL_DEFAULTS.rainbowSpawnGapSeconds;
  const targetDurationSeconds = parsePositiveNumber(cells.rainbow_target_duration ?? "", "rainbow_target_duration", report)
    ?? HOOK_LEVEL_DEFAULTS.rainbowTargetDurationSeconds;
  const rainbow: RainbowConfig = { targetCount, spawnGapSeconds, targetDurationSeconds };
  checkGoalWindows(goals, activeGoalSlots, report);
  checkWeakPointPacing(blocks, weakPoints, goals, activeGoalSlots, warn);

  const biggestCluster = largestClusterSize(blocks);
  if (reserveBlocks < biggestCluster) {
    report(`batch_blocks is ${reserveBlocks} but the biggest cluster is ${biggestCluster} blocks, which could never be parked`);
  }

  return {
    ...LEVEL_DEFAULTS,
    id: levelNumber,
    name: (cells.name ?? "").trim() || `Level ${levelNumber}`,
    activeGoalSlots,
    reserveBlocks,
    shotLimit,
    weakPoints,
    rainbow,
    goals,
    blocks,
  };
}

export function parseLevelSheet(text: string): LevelSheetResult {
  const issues: LevelSheetIssue[] = [];
  const entries = splitSheetLines(text);
  if (!entries.length) {
    issues.push({ row: 0, level: "-", severity: "error", message: "the sheet is empty" });
    return { levels: [], issues };
  }

  const delimiter = detectDelimiter(entries[0].line);
  const header = splitDelimitedLine(entries[0].line, delimiter).map((cell) => cell.trim().toLowerCase());
  const knownColumns = new Set<string>([
    ...SHEET_COLUMNS,
    ...RETIRED_COLUMNS.map(([name]) => name),
  ]);
  const seenHeaderColumns = new Set<string>();
  header.forEach((name, index) => {
    if (!name) {
      issues.push({
        row: entries[0].row,
        level: "-",
        severity: "error",
        message: `header column ${index + 1} is blank`,
      });
      return;
    }
    if (seenHeaderColumns.has(name)) {
      issues.push({
        row: entries[0].row,
        level: "-",
        severity: "error",
        message: `the header declares "${name}" more than once`,
      });
      return;
    }
    seenHeaderColumns.add(name);
    if (!knownColumns.has(name)) {
      issues.push({
        row: entries[0].row,
        level: "-",
        severity: "error",
        message: `the header column "${name}" is not recognized`,
      });
    }
  });
  for (const required of ["level", "dims", "layers"]) {
    if (!header.includes(required)) {
      issues.push({
        row: entries[0].row,
        level: "-",
        severity: "error",
        message: `the header row is missing the "${required}" column`,
      });
    }
  }
  if (issues.length) return { levels: [], issues };

  const levels: LevelConfig[] = [];
  const seenIds = new Map<number, number>();

  for (const entry of entries.slice(1)) {
    const values = splitDelimitedLine(entry.line, delimiter);
    const cells: RowCells = {};
    header.forEach((name, index) => {
      cells[name] = values[index] ?? "";
    });
    const label = (cells.level ?? "").trim() || "?";
    const report = (message: string) => issues.push({ row: entry.row, level: label, severity: "error", message });
    const warn = (message: string) => issues.push({ row: entry.row, level: label, severity: "warning", message });
    const errorsBefore = issues.filter((issue) => issue.severity === "error").length;

    const level = buildLevel(cells, report, warn);
    // A malformed row is left out entirely: half a level would still load and
    // play, just not the level the designer wrote. Reachability warnings are
    // advisory, because an occluding cluster can deliberately be cleared first.
    if (!level || issues.filter((issue) => issue.severity === "error").length > errorsBefore) continue;

    const duplicateRow = seenIds.get(level.id);
    if (duplicateRow !== undefined) {
      report(`level ${level.id} already exists on row ${duplicateRow}`);
      continue;
    }
    seenIds.set(level.id, entry.row);
    levels.push(level);
  }

  levels.sort((a, b) => a.id - b.id);
  return { levels, issues };
}

export function formatSheetIssue(issue: LevelSheetIssue) {
  return `${issue.severity} — row ${issue.row} (level ${issue.level}): ${issue.message}`;
}
