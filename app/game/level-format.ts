import type { BlockColor, BlockSpec, GoalSpec, LevelConfig } from "./types";

// One level is one row of a tab separated sheet, so a designer can keep all 50
// levels in a spreadsheet and change a single line to change a single level.
// `layers` holds one character per block: layers are separated by `|` along the
// depth axis, rows inside a layer by `/` from the top row down, and `.` marks an
// empty cell.
//
// An UPPERCASE colour code is a plain block. A lowercase code is the same
// colour wrapped in a barrel shell, so a shape stays readable as a grid while
// still saying which cells are covered (draft §1). A wrapped cluster carries
// one layer unless `barrel_layers` raises it.
export const MAX_BARREL_LAYERS = 3;
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
  "barrel_layers",
  "links",
  "goal_order",
  "goal_split",
  "goal_slots",
  "batch_slots",
  "shot_limit",
  "notes",
] as const;

// Everything a level does not spell out comes from here, so a row only carries
// what makes that level different.
const LEVEL_DEFAULTS = {
  activeGoalSlots: 2,
  batchCapacity: 2,
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

export type LevelSheetIssue = { row: number; level: string; message: string };
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
          report(`colour code "${raw}" is not valid (use R G Y B P O, lowercase for a barrel, or .)`);
          continue;
        }
        const key = `${x},${y},${z}`;
        if (seen.has(key)) {
          report(`two blocks share the position ${key}`);
          continue;
        }
        seen.add(key);
        // Lowercase means the same colour with a barrel shell over it.
        const wrapped = raw !== code;
        blocks.push({
          id: `block-${x}-${y}-${z}`,
          x, y, z, color,
          type: "normal",
          ...(wrapped ? { barrelLayers: 1 } : {}),
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

// A link is authored as one cell of each cluster, so the sheet stays short. The
// blocks are expanded here, at author time, which also means a link that points
// at the wrong cell is caught by the build instead of at play time.
function clusterAt(blocks: BlockSpec[], x: number, y: number, z: number) {
  const at = new Map(blocks.map((block) => [`${block.x},${block.y},${block.z}`, block]));
  const start = at.get(`${x},${y},${z}`);
  if (!start) return null;

  const cluster: BlockSpec[] = [];
  const seen = new Set([start.id]);
  const queue = [start];
  while (queue.length) {
    const block = queue.shift()!;
    cluster.push(block);
    for (const [dx, dy, dz] of FACE_NEIGHBORS) {
      const neighbor = at.get(`${block.x + dx},${block.y + dy},${block.z + dz}`);
      if (!neighbor || neighbor.color !== start.color || seen.has(neighbor.id)) continue;
      // A barrel shell separates what is underneath it, so a cluster never
      // straddles the boundary between covered and uncovered blocks.
      if (Boolean(neighbor.barrelLayers) !== Boolean(start.barrelLayers)) continue;
      seen.add(neighbor.id);
      queue.push(neighbor);
    }
  }
  return cluster;
}

function parseCoordinate(raw: string) {
  const parts = raw.trim().split(".");
  if (parts.length !== 3) return null;
  const [x, y, z] = parts.map((part) => Number(part));
  if (![x, y, z].every((value) => Number.isInteger(value) && value >= 0)) return null;
  return { x, y, z };
}

// `barrel_layers` deepens a wrapped cluster, written as `x.y.z:n` and
// separated by `;`. One entry sets the whole cluster it points at, so the count
// can never disagree between blocks under the same shell.
function applyBarrelLayers(raw: string, blocks: BlockSpec[], report: (message: string) => void) {
  if (!raw.trim()) return;

  for (const entry of raw.split(";").map((part) => part.trim()).filter(Boolean)) {
    const [cellText, countText] = entry.split(":");
    const coordinate = parseCoordinate(cellText ?? "");
    if (!coordinate) {
      report(`barrel_layers "${entry}" must look like 0.0.0:3`);
      continue;
    }
    const count = Number((countText ?? "").trim());
    if (!Number.isInteger(count) || count < 1 || count > MAX_BARREL_LAYERS) {
      report(`barrel_layers "${entry}" needs a layer count from 1 to ${MAX_BARREL_LAYERS}`);
      continue;
    }
    const cluster = clusterAt(blocks, coordinate.x, coordinate.y, coordinate.z);
    if (!cluster) {
      report(`barrel_layers "${entry}" points at an empty cell`);
      continue;
    }
    if (!cluster.every((block) => block.barrelLayers)) {
      report(`barrel_layers "${entry}" points at a cluster with no barrel; write it lowercase in layers first`);
      continue;
    }
    for (const block of cluster) block.barrelLayers = count;
  }
}

// `links` holds one entry per pair, written as `x.y.z>x.y.z` and separated by
// `;`. Dots and semicolons keep the whole cell comma-free, so a sheet saved as
// CSV never needs quoting around it.
function applyLinks(raw: string, blocks: BlockSpec[], report: (message: string) => void) {
  if (!raw.trim()) return;

  let linkIndex = 0;
  for (const entry of raw.split(";").map((part) => part.trim()).filter(Boolean)) {
    const sides = entry.split(">");
    if (sides.length !== 2) {
      report(`links "${entry}" must look like 0.0.0>3.2.1`);
      continue;
    }
    const coordinates = sides.map((side) => parseCoordinate(side));
    if (coordinates.some((coordinate) => !coordinate)) {
      report(`links "${entry}" has an invalid coordinate; it must be three integers like 0.0.0`);
      continue;
    }
    const clusters = coordinates.map((coordinate) => clusterAt(blocks, coordinate!.x, coordinate!.y, coordinate!.z));
    const missing = clusters.findIndex((cluster) => !cluster);
    if (missing >= 0) {
      report(`links "${entry}" points at the empty cell ${sides[missing].trim()}`);
      continue;
    }
    const [first, second] = clusters as BlockSpec[][];
    if (first.some((block) => second.some((candidate) => candidate.id === block.id))) {
      report(`links "${entry}" points at the same cluster twice`);
      continue;
    }
    const alreadyLinked = [...first, ...second].find((block) => block.linkGroup);
    if (alreadyLinked) {
      report(`links "${entry}" reuses a cluster that is already linked (block ${alreadyLinked.id}); a cluster can only be in one pair`);
      continue;
    }
    linkIndex += 1;
    const group = `link-${linkIndex}`;
    for (const block of [...first, ...second]) block.linkGroup = group;
  }
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

function buildLevel(cells: RowCells, report: (message: string) => void): LevelConfig | null {
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
  if (!blocks.length) {
    // A shape error already explains the empty result; saying it twice only
    // makes the list harder to read.
    if (!shapeProblems) report("this level has no blocks");
    return null;
  }

  applyBarrelLayers(cells.barrel_layers ?? "", blocks, report);
  applyLinks(cells.links ?? "", blocks, report);
  const counts = countColors(blocks);
  const order = parseColorOrder(cells.goal_order ?? "", counts, report);
  const splits = parseSplits(cells.goal_split ?? "", counts, report);
  const goals = buildGoals(order, counts, splits);
  const activeGoalSlots = parsePositiveInteger(cells.goal_slots ?? "", "goal_slots", report) ?? LEVEL_DEFAULTS.activeGoalSlots;
  const batchCapacity = parsePositiveInteger(cells.batch_slots ?? "", "batch_slots", report) ?? LEVEL_DEFAULTS.batchCapacity;
  const shotLimit = parsePositiveInteger(cells.shot_limit ?? "", "shot_limit", report);
  checkGoalWindows(goals, activeGoalSlots, report);

  return {
    ...LEVEL_DEFAULTS,
    id: levelNumber,
    name: (cells.name ?? "").trim() || `Level ${levelNumber}`,
    activeGoalSlots,
    batchCapacity,
    shotLimit,
    goals,
    blocks,
  };
}

export function parseLevelSheet(text: string): LevelSheetResult {
  const issues: LevelSheetIssue[] = [];
  const entries = splitSheetLines(text);
  if (!entries.length) {
    issues.push({ row: 0, level: "-", message: "the sheet is empty" });
    return { levels: [], issues };
  }

  const delimiter = detectDelimiter(entries[0].line);
  const header = splitDelimitedLine(entries[0].line, delimiter).map((cell) => cell.trim().toLowerCase());
  for (const required of ["level", "dims", "layers"]) {
    if (!header.includes(required)) {
      issues.push({ row: entries[0].row, level: "-", message: `the header row is missing the "${required}" column` });
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
    const report = (message: string) => issues.push({ row: entry.row, level: label, message });
    const issuesBefore = issues.length;

    const level = buildLevel(cells, report);
    // A row with any problem is left out entirely: half a level would still load
    // and play, just not the level the designer wrote.
    if (!level || issues.length > issuesBefore) continue;

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
  return `row ${issue.row} (level ${issue.level}): ${issue.message}`;
}
