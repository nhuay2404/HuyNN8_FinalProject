// The deterministic half of the game. No three.js, no DOM, no clock.
//
// Everything a shot does to the board is decided here and handed to the
// renderer as an ordered list of steps. That is what makes "cùng một state và
// cùng một shot phải cho cùng một kết quả" (§9) something the tests can prove
// rather than something the animation happens to do.

import type {
  BoosterType,
  CellCoord,
  SandBody,
  SandColor,
  SandFrame,
  SandGameState,
  SandKey,
  SandLevelConfig,
  SettleOutcome,
  SettleStep,
  WindDirection,
  WindPhase,
  WindZone,
} from "./sand-types";
// A value import, not a type one, so it needs the extension the test runner
// resolves with — this file is executed by node directly, not only bundled.
import { SAND_COLORS } from "./sand-types.ts";

/** The picture's alphabet. One letter per colour keeps an authored row readable. */
export const SAND_COLOR_BY_LETTER: Record<string, SandColor> = {
  R: "red",
  G: "green",
  Y: "yellow",
  B: "blue",
  P: "purple",
  O: "orange",
};

/**
 * The key's letter. Not a colour, so it never collides with the palette.
 *
 * `K` was free: the sand palette is R G Y B P O, and lower case is spoken for
 * by locked sand.
 */
export const KEY_LETTER = "K";

/** Locked sand is the colour's letter in lower case — `y` is frozen yellow. */
export function isLockedLetter(letter: string) {
  return letter !== letter.toUpperCase() && SAND_COLOR_BY_LETTER[letter.toUpperCase()] !== undefined;
}

/** ORTHOGONAL_4. Corner contact is not contact — Open Decisions 1 and 2. */
const ORTHOGONAL_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Slide order when a body cannot drop straight down.
 *
 * LEFT_FIRST_TEMP as a global rule (Open Decisions 4 and 5). It has to be a
 * fixed order rather than "whichever looks nicer": the whole solvability
 * argument for a level rests on the player being able to predict where a body
 * lands.
 */
const SLIDE_ORDER: ReadonlyArray<-1 | 1> = [-1, 1];

export function cellKey(x: number, y: number) {
  return `${x},${y}`;
}

export function occupancyOf(bodies: SandBody[]) {
  const map = new Map<string, string>();
  for (const body of bodies) {
    for (const cell of body.cells) map.set(cellKey(cell.x, cell.y), body.id);
  }
  return map;
}

export function countCells(bodies: SandBody[]) {
  return bodies.reduce((total, body) => total + body.cells.length, 0);
}

/** Cells in scan order: bottom row first, left to right. Ids and steps depend on it. */
function sortCells(cells: CellCoord[]) {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function isConnected(cells: CellCoord[]) {
  if (cells.length <= 1) return true;
  const remaining = new Set(cells.map((cell) => cellKey(cell.x, cell.y)));
  const start = cells[0];
  const queue: CellCoord[] = [start];
  remaining.delete(cellKey(start.x, start.y));
  while (queue.length) {
    const cell = queue.pop()!;
    for (const [dx, dy] of ORTHOGONAL_4) {
      const key = cellKey(cell.x + dx, cell.y + dy);
      if (!remaining.has(key)) continue;
      remaining.delete(key);
      queue.push({ x: cell.x + dx, y: cell.y + dy });
    }
  }
  return remaining.size === 0;
}

/**
 * The cohesion invariant of §18, as a check anything may run.
 *
 * Returns the ids that broke it, so a test failure names the body instead of
 * only saying that something split.
 */
export function findSplitBodies(bodies: SandBody[]) {
  return bodies.filter((body) => !isConnected(body.cells)).map((body) => body.id);
}

// ---- Level loading ------------------------------------------------------

export type LevelIssue = { severity: "error" | "warning"; message: string };
export type ParsedLevel = {
  bodies: SandBody[];
  /** Cells the picture drew in lower case: sand that starts frozen. */
  locked: CellCoord[];
  /** One key per connected group of `K` cells. */
  keys: SandKey[];
  issues: LevelIssue[];
};

/**
 * Expand a level's blueprint by its `pixelScale`, once, before anything else
 * touches it.
 *
 * Every rule in this file — connectivity, the settle solver, the radius
 * disc — is generic over frame size, so nothing downstream has to know a
 * blueprint cell was ever anything other than one pixel. A blueprint region
 * becomes a solid `pixelScale × pixelScale` block of its colour: uniform
 * integer upscaling can only ever produce the same adjacency graph with more
 * pixels in it, so body count, merges and the measured shot counts for a
 * level are unchanged in kind by this step. `sortRadius` is authored in
 * blueprint cells and is scaled the same way, so a disc still covers the same
 * fraction of the picture it did on paper.
 *
 * The returned config has `pixelScale: 1` — it is already expanded, so it is
 * safe to feed straight into `parseSandLevel` or run through this function a
 * second time by mistake without doubling up.
 */
export function expandLevelForPixelBoard(level: SandLevelConfig): SandLevelConfig {
  const scale = level.pixelScale;
  if (scale <= 1) return { ...level, pixelScale: 1 };
  const rows = level.rows.flatMap((row) => {
    const wide = [...row].flatMap((letter) => Array.from({ length: scale }, () => letter)).join("");
    return Array.from({ length: scale }, () => wide);
  });
  return {
    ...level,
    frame: { width: level.frame.width * scale, height: level.frame.height * scale },
    rows,
    sortRadius: level.sortRadius * scale,
    // Wind is authored in blueprint cells like the disc is, so a gust carries
    // sand the same fraction of the way across the frame — and reaches the same
    // part of the picture — at any resolution.
    wind: level.wind ? { phases: level.wind.phases.map((phase) => scaleWindPhase(phase, scale)) } : level.wind,
    pixelScale: 1,
  };
}

function scaleWindPhase(phase: WindPhase, scale: number): WindPhase {
  return {
    ...phase,
    power: phase.power * scale,
    // Durations are real time and must not be scaled — only the geometry is.
    zone: phase.zone
      ? {
        x: phase.zone.x * scale,
        y: phase.zone.y * scale,
        width: phase.zone.width * scale,
        height: phase.zone.height * scale,
      }
      : null,
  };
}

/**
 * The authored picture becomes bodies by connected component.
 *
 * This answers Open Decision 15 by construction rather than by a rule: two
 * same-colour regions drawn touching are simply one body from the first frame,
 * because there is no representation in which they are two.
 */
export function parseSandLevel(level: SandLevelConfig): ParsedLevel {
  const issues: LevelIssue[] = [];
  const { width, height } = level.frame;
  const grid = new Map<string, SandColor>();
  const locked: CellCoord[] = [];
  const keyCells = new Set<string>();

  if (level.rows.length !== height) {
    issues.push({ severity: "error", message: `frame height is ${height} but ${level.rows.length} rows were written` });
  }
  level.rows.forEach((row, index) => {
    // Row 0 is the top of the picture, so it carries the highest y.
    const y = height - 1 - index;
    if (row.length !== width) {
      issues.push({ severity: "error", message: `row ${index} has ${row.length} cells, frame width is ${width}` });
    }
    [...row].forEach((letter, x) => {
      if (letter === ".") return;
      const inside = y >= 0 && y < height && x < width;
      if (letter === KEY_LETTER) {
        if (inside) keyCells.add(cellKey(x, y));
        return;
      }
      const color = SAND_COLOR_BY_LETTER[letter.toUpperCase()];
      if (!color) {
        issues.push({ severity: "error", message: `row ${index} column ${x}: "${letter}" is not a palette colour` });
        return;
      }
      if (!inside) return;
      grid.set(cellKey(x, y), color);
      if (isLockedLetter(letter)) locked.push({ x, y });
    });
  });

  const bodies: SandBody[] = [];
  const claimed = new Set<string>();
  // Scan top-down, left-to-right so a body's id comes from its topmost-leftmost
  // cell, which is unique to it and stable across runs.
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const key = cellKey(x, y);
      const color = grid.get(key);
      if (!color || claimed.has(key)) continue;
      const cells: CellCoord[] = [];
      const queue: CellCoord[] = [{ x, y }];
      claimed.add(key);
      while (queue.length) {
        const cell = queue.pop()!;
        cells.push(cell);
        for (const [dx, dy] of ORTHOGONAL_4) {
          const nextKey = cellKey(cell.x + dx, cell.y + dy);
          if (claimed.has(nextKey) || grid.get(nextKey) !== color) continue;
          claimed.add(nextKey);
          queue.push({ x: cell.x + dx, y: cell.y + dy });
        }
      }
      bodies.push({ id: `${color}-${x}-${y}`, color, cells: sortCells(cells) });
    }
  }

  const palette = new Set(bodies.map((body) => body.color));
  for (const color of level.ammoQueue) {
    if (!palette.has(color)) {
      issues.push({ severity: "warning", message: `the queue holds ${color} but the picture has none` });
    }
  }

  // One key per connected group of `K`, so a key drawn several cells across is
  // one object rather than a handful of them standing next to each other.
  const keys = groupCells([...keyCells].map(parseCellKey)).map((cells) => ({
    id: `key-${cells[0].x}-${cells[0].y}`,
    cells,
  }));
  if (locked.length && !keys.length) {
    issues.push({
      severity: "error",
      message: "the picture has locked sand but no key — that sand could never be freed",
    });
  }
  if (keys.length && !locked.length) {
    issues.push({ severity: "warning", message: "the picture has a key but nothing locked for it to open" });
  }
  return { bodies, locked, keys, issues };
}

function parseCellKey(key: string): CellCoord {
  const [x, y] = key.split(",");
  return { x: Number(x), y: Number(y) };
}

/** Split a loose set of cells into its ORTHOGONAL_4 connected groups. */
export function groupCells(cells: CellCoord[]): CellCoord[][] {
  const remaining = new Map(cells.map((cell) => [cellKey(cell.x, cell.y), cell]));
  const groups: CellCoord[][] = [];
  // Highest y first, then leftmost, so a group's identity comes from a corner
  // that does not depend on the order the cells were collected in.
  for (const start of sortCells(cells).reverse()) {
    const startKey = cellKey(start.x, start.y);
    if (!remaining.has(startKey)) continue;
    remaining.delete(startKey);
    const group: CellCoord[] = [];
    const queue: CellCoord[] = [start];
    while (queue.length) {
      const cell = queue.pop()!;
      group.push(cell);
      for (const [dx, dy] of ORTHOGONAL_4) {
        const nextKey = cellKey(cell.x + dx, cell.y + dy);
        const next = remaining.get(nextKey);
        if (!next) continue;
        remaining.delete(nextKey);
        queue.push(next);
      }
    }
    groups.push(sortCells(group));
  }
  return groups;
}

/**
 * Settle the board grain by grain rather than body by body.
 *
 * A grain drops straight down when it can, and otherwise rolls off a slope —
 * left before right, so the result stays perfectly predictable. Rolling also
 * needs the cell *beside* the grain to be open, which is what stops a grain
 * squeezing through the diagonal seam between two others.
 *
 * One pass moves every grain that can move once, and the pass is one step. The
 * board is scanned from the floor up so a grain that has just landed is not
 * moved twice in the same pass, which is what keeps a draining column reading as
 * a column rather than as one grain teleporting to the bottom.
 *
 * Bodies are re-derived at the end: with cohesion gone there is nothing to
 * preserve, and same-colour regions that have come to touch are simply one
 * component, so merging needs no separate pass here.
 */
export function runGrainSettle(
  bodies: SandBody[],
  frame: SandFrame,
  fixtures: Fixtures = {},
): SettleOutcome {
  const world = buildWorld(bodies, fixtures);
  const steps: SettleStep[] = [];
  settleWorld(world, frame, steps);
  return finishWorld(world, frame, steps);
}

/**
 * One gust, then everything it disturbed falling back to rest.
 *
 * A gust is not a second physics: it slides loose grains sideways `strength`
 * times and then hands the board straight back to the same settle loop. So sand
 * blown off a ledge falls exactly the way sand always falls, and a level with
 * wind stays as predictable as one without — the only new thing is *when* the
 * board changes, which is the point of the mechanic.
 *
 * Locked sand does not move: it is the one thing in the frame the weather
 * cannot argue with, which is what makes it a landmark to aim a key at.
 */
export function runWindGust(
  bodies: SandBody[],
  frame: SandFrame,
  direction: WindDirection,
  strength: number,
  fixtures: Fixtures = {},
  zone: WindZone | null = null,
): SettleOutcome {
  const world = buildWorld(bodies, fixtures);
  const steps: SettleStep[] = [];
  const step = direction === "left" ? -1 : 1;
  for (let gust = 0; gust < Math.max(0, Math.round(strength)); gust += 1) {
    if (!windPass(world, frame, step, zone, steps)) break;
  }
  // The settle is NOT zoned. Wind reaches where it reaches, but gravity is the
  // whole frame's — sand blown to the edge of a zone still falls out of it.
  settleWorld(world, frame, steps);
  return finishWorld(world, frame, steps);
}

/** Whether a cell is inside a phase's reach. No zone means the whole frame. */
function inZone(zone: WindZone | null, x: number, y: number) {
  if (!zone) return true;
  return x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height;
}

// ---- the settle world ----------------------------------------------------
// One mutable board that the settle loop, the key loop and the wind pass all
// work on, so a grain, a key and a lock can never disagree about what is where.

/** The parts of the board that are not plain falling sand. */
export type Fixtures = { locked?: CellCoord[]; keys?: SandKey[]; friction?: number };

/**
 * How many settle passes a key waits at `friction: 1` before a sideways roll
 * it could take is actually taken. `friction: 0` waits none — it rolls the
 * instant a slope or a gust offers it one, same as before friction existed.
 */
const FRICTION_MAX_WAIT_PASSES = 4;

type World = {
  /** Every sand cell, frozen ones included — locked sand still fills its cell. */
  grid: Map<string, SandColor>;
  locked: Set<string>;
  keys: Map<string, CellCoord[]>;
  /** Reverse index of `keys`, so occupancy is one lookup rather than a scan. */
  keyAt: Map<string, string>;
  /**
   * Passes a key has already waited toward its next sideways roll.
   *
   * Shared between the natural roll (`keyPass`) and being blown (`windPass`) on
   * purpose: both are "sliding sideways", and a key's resistance to one is its
   * resistance to the other. Reset the moment the key actually moves sideways,
   * or falls straight down instead of rolling.
   */
  keyRollWait: Map<string, number>;
  friction: number;
};

function buildWorld(bodies: SandBody[], fixtures: Fixtures): World {
  const grid = new Map<string, SandColor>();
  for (const body of bodies) {
    for (const cell of body.cells) grid.set(cellKey(cell.x, cell.y), body.color);
  }
  const locked = new Set<string>();
  for (const cell of fixtures.locked ?? []) {
    const key = cellKey(cell.x, cell.y);
    // A lock on a cell no sand occupies is not a lock, it is a stray mark.
    if (grid.has(key)) locked.add(key);
  }
  const keys = new Map<string, CellCoord[]>();
  const keyAt = new Map<string, string>();
  for (const key of fixtures.keys ?? []) {
    keys.set(key.id, key.cells.map((cell) => ({ ...cell })));
    for (const cell of key.cells) keyAt.set(cellKey(cell.x, cell.y), key.id);
  }
  return { grid, locked, keys, keyAt, keyRollWait: new Map(), friction: fixtures.friction ?? 0 };
}

function occupied(world: World, frame: SandFrame, x: number, y: number) {
  if (x < 0 || x >= frame.width || y < 0 || y >= frame.height) return true;
  const key = cellKey(x, y);
  return world.grid.has(key) || world.keyAt.has(key);
}

/** One pass of falling sand. Returns whether anything moved. */
function sandPass(world: World, frame: SandFrame, steps: SettleStep[]) {
  const moves: Array<{ from: CellCoord; to: CellCoord }> = [];
  for (let y = 1; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const from = cellKey(x, y);
      const color = world.grid.get(from);
      if (color === undefined || world.locked.has(from)) continue;

      let to: CellCoord | null = null;
      if (!occupied(world, frame, x, y - 1)) {
        to = { x, y: y - 1 };
      } else {
        for (const dx of SLIDE_ORDER) {
          if (occupied(world, frame, x + dx, y) || occupied(world, frame, x + dx, y - 1)) continue;
          to = { x: x + dx, y: y - 1 };
          break;
        }
      }
      if (!to) continue;

      world.grid.delete(from);
      world.grid.set(cellKey(to.x, to.y), color);
      moves.push({ from: { x, y }, to });
    }
  }
  if (!moves.length) return false;
  steps.push({ kind: "GRAIN_PASS", moves });
  return true;
}

/** Whether every cell of key `id` would land somewhere legal at (dx, dy). */
function keyCanMove(world: World, frame: SandFrame, id: string, dx: number, dy: number) {
  const cells = world.keys.get(id);
  if (!cells) return false;
  const own = new Set(cells.map((cell) => cellKey(cell.x, cell.y)));
  return cells.every((cell) => {
    const tx = cell.x + dx;
    const ty = cell.y + dy;
    // The key sliding into its own trailing cell is not a collision.
    return own.has(cellKey(tx, ty)) || !occupied(world, frame, tx, ty);
  });
}

/** Shift one whole key by (dx, dy), unconditionally — the caller has already checked it fits. */
function moveKey(world: World, frame: SandFrame, id: string, dx: number, dy: number, steps: SettleStep[]) {
  if (!keyCanMove(world, frame, id, dx, dy)) return false;
  const cells = world.keys.get(id)!;
  for (const cell of cells) world.keyAt.delete(cellKey(cell.x, cell.y));
  const moved = cells.map((cell) => ({ x: cell.x + dx, y: cell.y + dy }));
  world.keys.set(id, moved);
  for (const cell of moved) world.keyAt.set(cellKey(cell.x, cell.y), id);
  steps.push({ kind: "KEY_MOVE", keyId: id, dx, dy });
  return true;
}

/**
 * A sideways move a key is allowed to take, throttled by `world.friction`.
 *
 * Free fall is never gated — only this, the sideways case, waits. Returns
 * `true` for both an actual move and a tick spent waiting, because either one
 * is "this key is still doing something" as far as `settleWorld` is concerned;
 * only a move that was never possible at all returns `false`.
 */
function rollKey(world: World, frame: SandFrame, id: string, dx: number, dy: number, steps: SettleStep[]) {
  if (!keyCanMove(world, frame, id, dx, dy)) return false;
  const wait = Math.round(world.friction * FRICTION_MAX_WAIT_PASSES);
  const soFar = (world.keyRollWait.get(id) ?? 0) + 1;
  if (soFar <= wait) {
    world.keyRollWait.set(id, soFar);
    return true;
  }
  world.keyRollWait.set(id, 0);
  moveKey(world, frame, id, dx, dy, steps);
  return true;
}

/** One pass of falling keys — same rule as a grain, applied to the whole shape. */
function keyPass(world: World, frame: SandFrame, steps: SettleStep[]) {
  let moved = false;
  // Lowest key first, so one resting on another does not jump through it.
  const order = [...world.keys.keys()].sort((a, b) => lowestY(world, a) - lowestY(world, b));
  for (const id of order) {
    if (moveKey(world, frame, id, 0, -1, steps)) {
      // Free fall, not a roll — friction never gated it, so it owes no wait.
      world.keyRollWait.set(id, 0);
      moved = true;
      continue;
    }
    for (const dx of SLIDE_ORDER) {
      if (rollKey(world, frame, id, dx, -1, steps)) {
        moved = true;
        break;
      }
    }
  }
  return moved;
}

function lowestY(world: World, id: string) {
  const cells = world.keys.get(id) ?? [];
  return cells.reduce((low, cell) => Math.min(low, cell.y), Number.POSITIVE_INFINITY);
}

/**
 * A key touching a lock opens it, and is spent doing so.
 *
 * The whole connected region of frozen sand thaws, not the one cell that was
 * touched: a lock is a thing in the picture, and half of it coming loose would
 * read as the key having missed.
 */
function unlockPass(world: World, steps: SettleStep[]) {
  let opened = false;
  for (const [id, cells] of [...world.keys]) {
    let touched: string | null = null;
    for (const cell of cells) {
      for (const [dx, dy] of ORTHOGONAL_4) {
        const key = cellKey(cell.x + dx, cell.y + dy);
        if (world.locked.has(key)) { touched = key; break; }
      }
      if (touched) break;
    }
    if (!touched) continue;

    const region: CellCoord[] = [];
    const queue = [touched];
    world.locked.delete(touched);
    while (queue.length) {
      const current = parseCellKey(queue.pop()!);
      region.push(current);
      for (const [dx, dy] of ORTHOGONAL_4) {
        const next = cellKey(current.x + dx, current.y + dy);
        if (!world.locked.has(next)) continue;
        world.locked.delete(next);
        queue.push(next);
      }
    }
    for (const cell of cells) world.keyAt.delete(cellKey(cell.x, cell.y));
    world.keys.delete(id);
    steps.push({ kind: "UNLOCK", keyId: id, cells: sortCells(region) });
    opened = true;
  }
  return opened;
}

/**
 * One sideways shove. Grains at the downwind edge move first, or they jam.
 *
 * A grain is moved when it *starts* inside the zone. Being carried one cell
 * past the edge is what a zone boundary should look like — a wall that sand
 * piles up against would be a wall, not weather.
 */
function windPass(
  world: World,
  frame: SandFrame,
  step: -1 | 1,
  zone: WindZone | null,
  steps: SettleStep[],
) {
  const moves: Array<{ from: CellCoord; to: CellCoord }> = [];
  const columns = Array.from({ length: frame.width }, (_, index) =>
    step === 1 ? frame.width - 1 - index : index);
  for (let y = 0; y < frame.height; y += 1) {
    for (const x of columns) {
      if (!inZone(zone, x, y)) continue;
      const from = cellKey(x, y);
      const color = world.grid.get(from);
      if (color === undefined || world.locked.has(from)) continue;
      if (occupied(world, frame, x + step, y)) continue;
      world.grid.delete(from);
      world.grid.set(cellKey(x + step, y), color);
      moves.push({ from: { x, y }, to: { x: x + step, y } });
    }
  }
  // Keys are blown too — a key parked on a ledge would otherwise be the one
  // thing in the frame the weather could not reach. A key counts as inside the
  // zone if any part of it is: half a key in the wind still catches it.
  // Gated by the same friction a natural roll is: a heavier key resists wind
  // exactly as much as it resists a slope, because both are sideways.
  let keysMoved = false;
  for (const [id, cells] of [...world.keys]) {
    if (!cells.some((cell) => inZone(zone, cell.x, cell.y))) continue;
    if (rollKey(world, frame, id, step, 0, steps)) keysMoved = true;
  }
  if (moves.length) steps.push({ kind: "GRAIN_PASS", moves });
  return moves.length > 0 || keysMoved;
}

/**
 * Run sand, keys and locks to a standstill.
 *
 * The three are interleaved rather than run one after another because they feed
 * each other: sand falling lets a key drop, a key dropping opens a lock, and an
 * opened lock is a new pile of sand with nothing holding it up.
 */
function settleWorld(world: World, frame: SandFrame, steps: SettleStep[]) {
  const limit = frame.width * frame.height;
  for (let pass = 0; pass < limit; pass += 1) {
    const sand = sandPass(world, frame, steps);
    const keys = keyPass(world, frame, steps);
    const unlocked = unlockPass(world, steps);
    if (!sand && !keys && !unlocked) break;
  }
}

/** Re-derive bodies from the settled grid and close the step list. */
function finishWorld(world: World, frame: SandFrame, steps: SettleStep[]): SettleOutcome {
  const settled: SandBody[] = [];
  const claimed = new Set<string>();
  for (let y = frame.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const key = cellKey(x, y);
      const color = world.grid.get(key);
      if (color === undefined || claimed.has(key)) continue;
      const cells: CellCoord[] = [];
      const queue: CellCoord[] = [{ x, y }];
      claimed.add(key);
      while (queue.length) {
        const cell = queue.pop()!;
        cells.push(cell);
        for (const [dx, dy] of ORTHOGONAL_4) {
          const nextKey = cellKey(cell.x + dx, cell.y + dy);
          if (claimed.has(nextKey) || world.grid.get(nextKey) !== color) continue;
          claimed.add(nextKey);
          queue.push({ x: cell.x + dx, y: cell.y + dy });
        }
      }
      settled.push({ id: `${color}-${x}-${y}`, color, cells: sortCells(cells) });
    }
  }

  // The labels only become true at the end, so the renderer is told once, after
  // the pouring it animated is over.
  if (settled.length) {
    steps.push({
      kind: "REINDEX",
      assignment: settled.flatMap((body) =>
        body.cells.map((cell) => ({ x: cell.x, y: cell.y, bodyId: body.id })),
      ),
    });
  }
  return {
    bodies: settled,
    steps,
    locked: sortCells([...world.locked].map(parseCellKey)),
    keys: [...world.keys].map(([id, cells]) => ({ id, cells: sortCells(cells) })),
  };
}

/**
 * The cells a radius shot of `color` would sort out, centred on one cell.
 *
 * `frozen` is left out of the answer entirely: locked sand is not a hard
 * target the disc fails against, it is sand the disc cannot see. A shot aimed
 * into a lock still takes every loose grain of its colour around it.
 *
 * `matchColor: false` is Prism Shot (booster-radius-prism-spec.md §2): the
 * disc takes every loose grain in reach regardless of colour, reusing this
 * same `frozen` exclusion rather than a second filter — a lock is still
 * invisible to the disc, prism or not.
 */
export function cellsInRadius(
  bodies: SandBody[],
  center: CellCoord,
  radius: number,
  color: SandColor,
  frozen?: ReadonlySet<string>,
  options?: { matchColor?: boolean },
) {
  const matchColor = options?.matchColor ?? true;
  const found: CellCoord[] = [];
  const limit = radius * radius;
  for (const body of bodies) {
    if (matchColor && body.color !== color) continue;
    for (const cell of body.cells) {
      if (frozen?.has(cellKey(cell.x, cell.y))) continue;
      const dx = cell.x - center.x;
      const dy = cell.y - center.y;
      if (dx * dx + dy * dy <= limit) found.push({ x: cell.x, y: cell.y });
    }
  }
  return sortCells(found);
}

/**
 * How far a shot reaches once `booster` is folded in.
 *
 * Radius Overcharge doubles `sortRadius` (spec §1) but is capped at the
 * frame's own diagonal (spec §7.3's open question, resolved conservatively):
 * past that, a bigger number buys nothing since no cell in the frame is
 * farther than that from any centre, so there is no reason to let a small
 * level's radius balloon into a number that only looks wrong in a debugger.
 * Shared between `resolveShot` and the renderer, so the ring drawn before a
 * shot and the disc the shot actually resolves against never disagree.
 */
export function effectiveSortRadius(level: SandLevelConfig, booster?: BoosterType | null): number {
  if (booster !== "radiusOvercharge") return level.sortRadius;
  const frameDiagonal = Math.hypot(level.frame.width, level.frame.height);
  return Math.min(level.sortRadius * 2, frameDiagonal);
}

/**
 * Unlimited for the whole current test phase (spec §4): every level in this
 * build can be replayed as many times as a hard level needs while boosters
 * are being tuned. A `Record` rather than one flat `Infinity` so the day this
 * becomes finite (spent from a currency or a level grant), each booster gets
 * its own real number here without touching `getBoosterCharges` or any of
 * its callers, which already treat the answer as a count that can run out.
 */
const BOOSTER_CHARGES_TEMP: Record<BoosterType, number> = {
  radiusOvercharge: Infinity,
  prismShot: Infinity,
};

/** How many charges of `type` are left — spec §4. */
export function getBoosterCharges(type: BoosterType): number {
  return BOOSTER_CHARGES_TEMP[type];
}

// ---- Game state ---------------------------------------------------------

export function createSandGameState(level: SandLevelConfig): SandGameState {
  const { bodies, locked, keys } = parseSandLevel(level);
  const frozen = new Set(locked.map((cell) => cellKey(cell.x, cell.y)));
  // A colour that starts entirely locked is authored into the wheel — it has to
  // be, or it could never be shot once freed — but it must not be *handed out*
  // until a key has opened it.
  const shootable = shootableColors(bodies, frozen);
  return {
    phase: "READY",
    bodies,
    queue: level.ammoQueue.filter((color) => shootable.includes(color)),
    shotsUsed: 0,
    remainingCells: countCells(bodies),
    locked,
    keys,
    result: null,
  };
}

/** The board's non-sand furniture, in the shape the solver wants it. */
export function fixturesOf(level: SandLevelConfig, state: SandGameState): Fixtures {
  return { locked: state.locked, keys: state.keys, friction: level.keyFriction ?? 0 };
}

/** Cell keys of everything frozen, for the lookups a shot and a redraw need. */
export function frozenSet(state: SandGameState) {
  return new Set(state.locked.map((cell) => cellKey(cell.x, cell.y)));
}

export function currentAmmo(_level: SandLevelConfig, state: SandGameState): SandColor | null {
  return state.queue[0] ?? null;
}

export function nextAmmo(level: SandLevelConfig, state: SandGameState) {
  return state.queue.slice(1, 1 + level.nextPreviewCount);
}

/**
 * The number the HUD counts down.
 *
 * Under a fixed queue it is how many bullets are left; under a shot limit the
 * queue recycles for as long as the board needs it, so the honest number is how
 * many shots the player still has.
 */
export function ammoRemaining(level: SandLevelConfig, state: SandGameState) {
  if (level.shotLimit !== null) return Math.max(0, level.shotLimit - state.shotsUsed);
  return state.queue.length;
}

export type ShotOutcome = "SORTED" | "NO_MATCH" | "MISS";

/**
 * Where a projectile landed.
 *
 * `bodyId` is null when the shot came down on empty air inside the frame — the
 * gap above the sand, or a hole a previous shot opened. That is a real place to
 * aim at, not a miss: the disc is centred there and sorts whatever it reaches,
 * so a player can shoot past the surface and still pull colour out from under
 * it.
 */
export type ShotHit = { bodyId: string | null; x: number; y: number };

export type ShotResolution = {
  state: SandGameState;
  outcome: ShotOutcome;
  /** The body the projectile physically landed on, whatever the disc then took. */
  hitBody: SandBody | null;
  /** Cells the shot took. Empty when the disc found none of its colour. */
  removed: CellCoord[];
  settle: SettleOutcome | null;
  /** The pouring, then the REINDEX that makes the new body labels true. */
  steps: SettleStep[];
};

/**
 * Advance the queue by one bullet.
 *
 * Under the cycling rule the colour goes back to the end while any of it is
 * still on the board, and a colour that has just been finished is dropped from
 * the queue wherever it sits — so the player is never handed a bullet with
 * nothing left to shoot at.
 */
function advanceQueue(
  queue: SandColor[],
  bodies: SandBody[],
  frozen: ReadonlySet<string>,
): SandColor[] {
  const [spent, ...rest] = queue;
  if (spent === undefined) return shootableColors(bodies, frozen);
  const shootable = new Set(shootableColors(bodies, frozen));
  const recycled = shootable.has(spent) ? [...rest, spent] : rest;
  const kept = recycled.filter((color) => shootable.has(color));
  // A colour that is entirely locked away is not gone, it is unreachable — and
  // it comes back the moment a key frees it, or the wheel would have dropped it
  // for good and left that sand unshootable.
  const returning = shootableColors(bodies, frozen).filter((color) => !kept.includes(color));
  return [...kept, ...returning];
}

/**
 * Colours the player could actually hit right now.
 *
 * A colour whose every grain is frozen is not on the wheel: handing out that
 * bullet would be exactly the dead bullet `deadBulletPolicy` exists to forbid.
 * Palette order, not board order, so the wheel is the same on every run.
 */
function shootableColors(bodies: SandBody[], frozen: ReadonlySet<string>): SandColor[] {
  const live = new Set<SandColor>();
  for (const body of bodies) {
    if (body.cells.some((cell) => !frozen.has(cellKey(cell.x, cell.y)))) live.add(body.color);
  }
  return SAND_COLORS.filter((color) => live.has(color));
}

/**
 * Win first, then fail.
 *
 * §12 checks the empty board after the settle, and §13 only asks about the
 * budget once the final shot has fully resolved — so a last bullet that empties
 * the frame is a win, never a draw.
 */
function withResult(level: SandLevelConfig, state: SandGameState): SandGameState {
  if (state.remainingCells === 0) return { ...state, phase: "WIN", result: { kind: "WIN" } };
  if (state.shotsUsed >= level.shotLimit) {
    return { ...state, phase: "FAIL", result: { kind: "FAIL", reason: "OUT_OF_SHOTS" } };
  }
  return { ...state, phase: "READY", result: null };
}

/**
 * Settle a board a shot has bitten a hole in.
 *
 * Grain fall re-derives every body itself and ends on its own REINDEX, so there
 * is nothing to normalise first: the labels it hands back are already true of
 * the settled grid.
 */
function settleAfterRemoval(level: SandLevelConfig, bodies: SandBody[], fixtures: Fixtures) {
  const settle = runGrainSettle(bodies, level.frame, fixtures);
  return { settle, steps: settle.steps };
}
/**
 * One shot, start to finish.
 *
 * `hit` is null when the projectile left the frame or struck the frame itself.
 * Under MISS_IS_FREE_TEMP that costs nothing, so a level can never be lost to a
 * slip of the thumb — §39.9, and reversible the day aiming is meant to carry
 * risk.
 *
 * `booster` is whichever of Radius Overcharge / Prism Shot was armed for this
 * shot, already consumed by the caller the instant it left the barrel (spec
 * §7.1: a boosted shot spends its buff whether it hits or misses) — this
 * function only has to fold its effect into the one disc it resolves, never
 * track whether it is still active afterward.
 */
export function resolveShot(
  level: SandLevelConfig,
  state: SandGameState,
  hit: ShotHit | null,
  booster?: BoosterType | null,
): ShotResolution {
  const idle: ShotResolution = {
    state,
    outcome: "MISS",
    hitBody: null,
    removed: [],
    settle: null,
    steps: [],
  };
  const ammo = currentAmmo(level, state);
  if (state.result || ammo === null) return idle;

  // A hit with no body under it still counts: the shot landed inside the frame,
  // on air. Only a shot that never reached the frame at all is a miss.
  const hitBody = hit?.bodyId ? state.bodies.find((body) => body.id === hit.bodyId) ?? null : null;
  if (!hit) return { ...idle, state: { ...state, phase: "READY" } };

  const spend = (bodies: SandBody[], stillFrozen: ReadonlySet<string>): Pick<SandGameState, "queue" | "shotsUsed"> => ({
    queue: advanceQueue(state.queue, bodies, stillFrozen),
    shotsUsed: state.shotsUsed + 1,
  });

  // A radius shot is aimed at a place, not at a region: it takes every matching
  // grain inside the disc, across as many bodies as the disc happens to touch,
  // and only the part of each that falls inside it. The place may be empty air
  // — the disc still reaches down from it. A shot that finds none of its colour
  // in reach is not a special case; NO_MATCH covers it.
  const frozen = frozenSet(state);
  const radius = effectiveSortRadius(level, booster);
  const removed = cellsInRadius(state.bodies, { x: hit.x, y: hit.y }, radius, ammo, frozen, {
    matchColor: booster !== "prismShot",
  });
  if (!removed.length) {
    const missed = { ...state, ...spend(state.bodies, frozen) };
    return { ...idle, state: withResult(level, missed), outcome: "NO_MATCH", hitBody };
  }
  const taken = new Set(removed.map((cell) => cellKey(cell.x, cell.y)));
  const left = state.bodies
    .map((body) => ({ ...body, cells: body.cells.filter((cell) => !taken.has(cellKey(cell.x, cell.y))) }))
    .filter((body) => body.cells.length);
  const { settle, steps } = settleAfterRemoval(level, left, fixturesOf(level, state));
  const stillFrozen = new Set(settle.locked.map((cell) => cellKey(cell.x, cell.y)));
  const sorted: SandGameState = {
    ...state,
    bodies: settle.bodies,
    ...spend(settle.bodies, stillFrozen),
    remainingCells: countCells(settle.bodies),
    locked: settle.locked,
    keys: settle.keys,
  };
  return { state: withResult(level, sorted), outcome: "SORTED", hitBody, removed, settle, steps };
}

/**
 * A gust, as a resolved change to the state.
 *
 * Separate from `resolveShot` on purpose: wind is not a turn. It spends no
 * ammo, it can win a level (by burying nothing and clearing the last grain it
 * cannot — but a lock freed by a blown key can), and it can never lose one,
 * because the budget only moves when the player fires.
 */
export function resolveWind(
  level: SandLevelConfig,
  state: SandGameState,
  phase: WindPhase,
): ShotResolution {
  const idle: ShotResolution = {
    state,
    outcome: "MISS",
    hitBody: null,
    removed: [],
    settle: null,
    steps: [],
  };
  if (state.result) return idle;

  const settle = runWindGust(
    state.bodies,
    level.frame,
    phase.direction,
    phase.power,
    fixturesOf(level, state),
    phase.zone,
  );
  if (!settle.steps.some((step) => step.kind !== "REINDEX")) return idle;

  // A gust can blow a key into a lock, so the wheel has to be re-checked even
  // though no bullet was spent — the colour that just came free needs a bullet.
  const stillFrozen = new Set(settle.locked.map((cell) => cellKey(cell.x, cell.y)));
  const shootable = shootableColors(settle.bodies, stillFrozen);
  const blown: SandGameState = {
    ...state,
    bodies: settle.bodies,
    queue: [
      ...state.queue.filter((color) => shootable.includes(color)),
      ...shootable.filter((color) => !state.queue.includes(color)),
    ],
    remainingCells: countCells(settle.bodies),
    locked: settle.locked,
    keys: settle.keys,
  };
  return {
    state: withResult(level, blown),
    outcome: "SORTED",
    hitBody: null,
    removed: [],
    settle,
    steps: settle.steps,
  };
}
