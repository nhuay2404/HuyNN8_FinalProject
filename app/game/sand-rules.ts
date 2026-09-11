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
  SandFreezeTrigger,
  SandGameState,
  SandKey,
  SandLevelConfig,
  SettleOutcome,
  SettleStep,
} from "./sand-types";
// A value import, not a type one, so it needs the extension the test runner
// resolves with — this file is executed by node directly, not only bundled.
import { SAND_COLORS } from "./sand-types.ts";
import {
  addBoosterCharges as addWalletBoosterCharges,
  getBoosterCount,
  spendBoosterCharge as spendWalletBoosterCharge,
} from "./economy.ts";
import { seededUnit } from "./sand-color.ts";

/** The picture's alphabet. One letter per colour keeps an authored row readable. */
export const SAND_COLOR_BY_LETTER: Record<string, SandColor> = {
  R: "red",
  G: "green",
  Y: "yellow",
  B: "blue",
  P: "purple",
  O: "orange",
  C: "cyan",
  M: "pink",
  L: "lime",
  N: "brown",
  // `S`/`D` rather than the conventional `W`/`K` for white/black — both of
  // those letters were already spoken for (`WALL_LETTER`, `KEY_LETTER`)
  // before white and black joined the palette.
  S: "white",
  D: "black",
  // The six added past the original 12 — see `LETTER_BY_SAND_COLOR`
  // (level-drafts.ts), the forward direction of this exact same mapping.
  A: "grass",
  T: "teal",
  U: "skyblue",
  I: "indigo",
  F: "magenta",
  E: "crimson",
  // A third batch — `H J Q V X Z` is what was left of the alphabet once the
  // eighteen letters above plus `KEY_LETTER`/`WALL_LETTER` (K/W) were spoken
  // for. See `SAND_COLORS` (sand-types.ts) for why these six colours.
  H: "darkbrown",
  J: "violet",
  Q: "navy",
  V: "emerald",
  X: "rust",
  Z: "mint",
};

/**
 * The key's letter. Not a colour, so it never collides with the palette.
 *
 * `K` was free: the sand palette is R G Y B P O C M L N, and lower case is
 * spoken for by locked sand.
 */
export const KEY_LETTER = "K";

/**
 * Wall Obstacle's letter. `W` was free for the same reason `K` was.
 *
 * Not a colour and not sand at all — unlike locked sand (a colour, just
 * frozen and eventually freeable), a wall cell has no colour, is never
 * handed to the ammo wheel, is never freed by anything, and never moves.
 * It is simply a permanent hole in the board that sand rests against the
 * way it rests against the floor.
 */
export const WALL_LETTER = "W";

/**
 * Freeze Map trigger's letter. Every letter of the alphabet is spoken for by
 * `SAND_COLOR_BY_LETTER` plus `KEY_LETTER`/`WALL_LETTER`, so this reaches
 * outside it — a single, otherwise-unused symbol works exactly the same way
 * a letter does: `parseSandLevel` only ever compares a cell's mark against
 * these constants and the colour map, never assumes it is one letter wide.
 *
 * Not a colour and not sand: like a wall, it has no colour and is never
 * handed to the ammo wheel. Unlike a wall it is one-shot — the moment a
 * shot's disc reaches it, whatever colour that shot carried, it is spent and
 * gone for the rest of the level. See `freeze-map-mechanic.md`.
 */
export const FREEZE_LETTER = "@";

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
  /** Cells the picture drew as `W` — see `WALL_LETTER`'s own comment. */
  walls: CellCoord[];
  /** One Freeze Map trigger per connected group of `@` cells. */
  freezeTriggers: SandFreezeTrigger[];
  /** One buried Freeze Map trigger per connected group of `@` cells on
   * `SandLevelConfig.hiddenFreezeRows` — see that field's own comment. */
  hiddenFreezeTriggers: SandFreezeTrigger[];
  /** One buried key per connected group of `K` cells on
   * `SandLevelConfig.hiddenKeyRows` — see that field's own comment. */
  hiddenKeys: SandKey[];
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
  const expandRows = (source: readonly string[]) =>
    source.flatMap((row) => {
      const wide = [...row].flatMap((letter) => Array.from({ length: scale }, () => letter)).join("");
      return Array.from({ length: scale }, () => wide);
    });
  return {
    ...level,
    frame: { width: level.frame.width * scale, height: level.frame.height * scale },
    rows: expandRows(level.rows),
    // Same uniform integer upscaling as `rows` above, and for the same
    // reason: a hidden trigger authored at blueprint size has to land on
    // the exact same expanded cells its covering sand does, or the two
    // grids drift apart the moment the board is drawn at real resolution.
    hiddenFreezeRows: level.hiddenFreezeRows ? expandRows(level.hiddenFreezeRows) : level.hiddenFreezeRows,
    // Same reasoning as hiddenFreezeRows just above.
    hiddenKeyRows: level.hiddenKeyRows ? expandRows(level.hiddenKeyRows) : level.hiddenKeyRows,
    sortRadius: level.sortRadius * scale,
    // Scripted FTUE targets are authored in the same blueprint grid as
    // `rows`, so they need the same uniform upscale to still land on the
    // right cells once the board itself is expanded.
    ftueFreezeTargets: level.ftueFreezeTargets?.map((t) => ({ x: t.x * scale, y: t.y * scale })),
    // Same reasoning as ftueFreezeTargets just above.
    ftueBoosterTargets: level.ftueBoosterTargets?.map((t) => ({ x: t.x * scale, y: t.y * scale })),
    // Same reasoning as ftueFreezeTargets just above.
    ftueChainSortTarget: level.ftueChainSortTarget
      ? { x: level.ftueChainSortTarget.x * scale, y: level.ftueChainSortTarget.y * scale }
      : level.ftueChainSortTarget,
    pixelScale: 1,
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
  const walls: CellCoord[] = [];
  const freezeCells = new Set<string>();

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
      if (letter === WALL_LETTER) {
        if (inside) walls.push({ x, y });
        return;
      }
      if (letter === FREEZE_LETTER) {
        if (inside) freezeCells.add(cellKey(x, y));
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

  // One trigger per connected group of `@`, same reasoning as the key above —
  // a trigger drawn several cells wide is one button, not several standing
  // next to each other.
  const freezeTriggers = groupCells([...freezeCells].map(parseCellKey)).map((cells) => ({
    id: `freeze-${cells[0].x}-${cells[0].y}`,
    cells,
  }));

  // `hiddenFreezeRows` is a second, independent grid over the same frame —
  // read the same top-first/y-flip way as `level.rows` above, but the only
  // letter that means anything on it is `@`; everything else (including an
  // actual sand letter, if one is ever accidentally drawn there) is just
  // ignored rather than raising an issue, since this grid was never meant to
  // hold anything but trigger markers.
  const hiddenFreezeCells = new Set<string>();
  (level.hiddenFreezeRows ?? []).forEach((row, index) => {
    const y = height - 1 - index;
    [...row].forEach((letter, x) => {
      if (letter !== FREEZE_LETTER) return;
      if (y >= 0 && y < height && x < width) hiddenFreezeCells.add(cellKey(x, y));
    });
  });
  const hiddenFreezeTriggers = groupCells([...hiddenFreezeCells].map(parseCellKey)).map((cells) => ({
    id: `hidden-freeze-${cells[0].x}-${cells[0].y}`,
    cells,
  }));

  // `hiddenKeyRows` is a second, independent grid over the same frame, read
  // exactly the same way as `hiddenFreezeRows` just above — only `K` means
  // anything on it, everything else is ignored rather than raising an issue.
  const hiddenKeyCells = new Set<string>();
  (level.hiddenKeyRows ?? []).forEach((row, index) => {
    const y = height - 1 - index;
    [...row].forEach((letter, x) => {
      if (letter !== KEY_LETTER) return;
      if (y >= 0 && y < height && x < width) hiddenKeyCells.add(cellKey(x, y));
    });
  });
  const hiddenKeys = groupCells([...hiddenKeyCells].map(parseCellKey)).map((cells) => ({
    id: `hidden-key-${cells[0].x}-${cells[0].y}`,
    cells,
  }));

  return { bodies, locked, keys, walls: sortCells(walls), freezeTriggers, hiddenFreezeTriggers, hiddenKeys, issues };
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
  /** Where a shot bit its hole, in case `settleWorldFromHole` can start
   * narrow instead of sweeping the whole frame every pass — see its own
   * comment. Ignored whenever there are keys on the board: a key can carry a
   * lock's whole region loose from anywhere, so only the plain, keyless case
   * gets to assume the cascade stays near the hole. */
  hint?: { x: number; y: number; radius: number },
  /**
   * Freeze Map is active for this settle: skip every SAND movement pass (no
   * `GRAIN_PASS`) and just leave the grid exactly as it sits — sand that just
   * lost its footing hangs there, including whatever a key's own unlock just
   * freed. A key's own physics is not part of what freeze holds — on
   * request, one already falling or rolling keeps doing so, and one that
   * reaches a lock still opens it (`KEY_MOVE`/`UNLOCK` both still run); see
   * `settleWorldKeysOnly`.
   */
  frozen?: boolean,
): SettleOutcome {
  const world = buildWorld(bodies, fixtures);
  const steps: SettleStep[] = [];
  if (!frozen) {
    // A hinted, keyless settle only ever has to watch the neighbourhood of
    // the hole a shot bit — see `settleWorldFromHole`'s own comment on why a
    // full-frame rescan every pass is wasted work there. Anything else (no
    // hint, or keys on the board that a lock could free from anywhere) gets
    // the unrestricted sweep, unchanged.
    if (hint && !fixtures.keys?.length) {
      settleWorldFromHole(world, frame, steps, hint);
    } else {
      settleWorld(world, frame, steps);
    }
  } else if (fixtures.keys?.length) {
    settleWorldKeysOnly(world, frame, steps);
  }
  return finishWorld(world, frame, steps, fixtures.freezeTriggers ?? []);
}

// ---- the settle world ----------------------------------------------------
// One mutable board that the settle loop and the key loop both work on, so a
// grain, a key and a lock can never disagree about what is where.

/** The parts of the board that are not plain falling sand. */
export type Fixtures = {
  locked?: CellCoord[];
  keys?: SandKey[];
  friction?: number;
  walls?: CellCoord[];
  freezeTriggers?: SandFreezeTrigger[];
};

/**
 * How many settle passes a key waits at `friction: 1` before a sideways roll
 * it could take is actually taken. `friction: 0` waits none — it rolls the
 * instant a slope offers it one, same as before friction existed.
 */
const FRICTION_MAX_WAIT_PASSES = 4;

/**
 * How many cells of coast a key can carry off the bottom of a slope, at most —
 * one per actual diagonal roll it took getting there (`keyMomentum`), capped
 * here so a very long slope does not send it skating clear across a flat
 * floor. Independent of `friction`: that only paces *how many passes* a roll
 * takes, never how many actual rolls happen, so two keys taking the same
 * slope at different friction values still arrive with the same momentum and
 * coast the same distance — see `keyPass`'s own comment.
 */
const KEY_COAST_MAX_CELLS = 3;

type World = {
  /** Every sand cell, frozen ones included — locked sand still fills its cell. */
  grid: Map<string, SandColor>;
  locked: Set<string>;
  /** Wall Obstacle cells — occupied, but never in `grid`: not sand, never
   * moves, never removed. See `WALL_LETTER`'s own comment. */
  walls: Set<string>;
  /** Freeze Map trigger cells still standing — occupied exactly like a wall
   * until a shot spends the trigger they belong to (outside this world;
   * `resolveShot` rebuilds fixtures with the spent one already gone before
   * the next settle ever sees it). */
  freezeTriggers: Set<string>;
  keys: Map<string, CellCoord[]>;
  /** Reverse index of `keys`, so occupancy is one lookup rather than a scan. */
  keyAt: Map<string, string>;
  /**
   * Passes a key has already waited toward its next sideways roll (`keyPass`).
   *
   * Reset the moment the key actually moves sideways, or falls straight down
   * instead of rolling.
   */
  keyRollWait: Map<string, number>;
  /**
   * Cells of coast a key has banked, one per diagonal roll it actually took
   * (capped at `KEY_COAST_MAX_CELLS`) — spent one at a time, in `keyCoastDir`,
   * once the slope it built the momentum on runs out. Reset to 0 the instant
   * the key free-falls straight down instead (a drop has no direction of its
   * own to coast in) or a coast step itself turns out to be blocked.
   */
  keyMomentum: Map<string, number>;
  /** Which way (`-1`/`1`) `keyMomentum`'s banked cells actually coast — the
   * direction of whichever diagonal roll most recently built it up. */
  keyCoastDir: Map<string, -1 | 1>;
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
  const walls = new Set((fixtures.walls ?? []).map((cell) => cellKey(cell.x, cell.y)));
  const freezeTriggers = new Set(
    (fixtures.freezeTriggers ?? []).flatMap((trigger) => trigger.cells.map((cell) => cellKey(cell.x, cell.y))),
  );
  return {
    grid,
    locked,
    walls,
    freezeTriggers,
    keys,
    keyAt,
    keyRollWait: new Map(),
    keyMomentum: new Map(),
    keyCoastDir: new Map(),
    friction: fixtures.friction ?? 0,
  };
}

function occupied(world: World, frame: SandFrame, x: number, y: number) {
  if (x < 0 || x >= frame.width || y < 0 || y >= frame.height) return true;
  const key = cellKey(x, y);
  return world.grid.has(key) || world.keyAt.has(key) || world.walls.has(key) || world.freezeTriggers.has(key);
}

/** The 8 neighbours of a cell — used only by `grainTarget`'s own cohesion
 * tie-break below, nowhere solvability-sensitive depends on this order. */
const EIGHT_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** How much of `color` already surrounds (x, y) — `grainTarget`'s cohesion
 * tie-break reads this off each candidate landing spot before choosing one. */
function sameColorNeighbourCount(world: World, x: number, y: number, color: SandColor): number {
  let count = 0;
  for (const [dx, dy] of EIGHT_NEIGHBOURS) {
    if (world.grid.get(cellKey(x + dx, y + dy)) === color) count += 1;
  }
  return count;
}

/**
 * Where the grain at (x, y) would fall this pass, or null if nothing gives.
 *
 * Straight down still wins outright whenever it is open — this only ever
 * chooses between the two diagonals, and only when *both* are open at once.
 * That case is exactly a freshly-opened gap wide enough for a grain to go
 * either way, which is also the one place today's flat LEFT_FIRST_TEMP rule
 * (SLIDE_ORDER, Open Decisions 4 and 5) used to scatter colours evenly
 * across a gap regardless of which side already held more of this grain's
 * own colour — the "sand doesn't stick to itself" look a wide shot's
 * collapse used to produce. Preferring whichever side already touches more
 * of the same colour keeps a clump reading as a clump through that collapse
 * without touching the single-candidate case SLIDE_ORDER's own solvability
 * argument is about: with only one side open, this still returns exactly
 * what it always did. Ties (including every single-colour board, where both
 * sides always score 0) keep the old left-first order, so nothing here
 * changes unless the two sides genuinely disagree on colour.
 */
function grainTarget(world: World, frame: SandFrame, x: number, y: number): CellCoord | null {
  if (!occupied(world, frame, x, y - 1)) return { x, y: y - 1 };
  const open: Array<-1 | 1> = [];
  for (const dx of SLIDE_ORDER) {
    if (occupied(world, frame, x + dx, y) || occupied(world, frame, x + dx, y - 1)) continue;
    open.push(dx);
  }
  if (open.length === 0) return null;
  if (open.length === 1) return { x: x + open[0], y: y - 1 };
  const color = world.grid.get(cellKey(x, y));
  if (color !== undefined) {
    const [left, right] = open;
    const leftScore = sameColorNeighbourCount(world, x + left, y - 1, color);
    const rightScore = sameColorNeighbourCount(world, x + right, y - 1, color);
    if (rightScore > leftScore) return { x: x + right, y: y - 1 };
  }
  return { x: x + open[0], y: y - 1 };
}

/** One pass of falling sand. Returns whether anything moved. */
function sandPass(world: World, frame: SandFrame, steps: SettleStep[]) {
  const moves: Array<{ from: CellCoord; to: CellCoord }> = [];
  for (let y = 1; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const from = cellKey(x, y);
      const color = world.grid.get(from);
      if (color === undefined || world.locked.has(from)) continue;
      const to = grainTarget(world, frame, x, y);
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

/** Bottom-up, left-to-right scan order — the order `sandPass`'s own nested
 * loop visits cells in, and the order a candidate queue has to stay sorted by
 * for `sandPassCandidates` to reproduce it exactly. */
function compareScanOrder(a: CellCoord, b: CellCoord): number {
  return a.y - b.y || a.x - b.x;
}

/** Insert `cell` into `queue` (kept sorted by `compareScanOrder`) at its
 * correct position, via binary search. */
function insertInScanOrder(queue: CellCoord[], cell: CellCoord) {
  let lo = 0;
  let hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareScanOrder(queue[mid], cell) < 0) lo = mid + 1;
    else hi = mid;
  }
  queue.splice(lo, 0, cell);
}

/**
 * `sandPass`, but only ever checking cells reachable from `candidates` —
 * still sorted and processed in `sandPass`'s own bottom-up, left-to-right
 * order, so a board with nothing to watch outside `candidates` settles into
 * exactly the same board, in exactly the same pass groupings, `sandPass`
 * itself would have (see `settleWorldFromHole`'s own comment for why that
 * grouping is not just cosmetic — a whole column has to read as falling
 * together, not as a wave crossing it one row at a time). A move can unblock
 * a cell `sandPass`'s single linear scan would still reach *this same pass*
 * (the row directly above, or a same-row neighbour further along the scan) —
 * those go back into the queue this function is still working through, via
 * `insertInScanOrder`; a move can only ever unblock something *behind* where
 * the scan already is (a moved grain's own new position, always one row
 * below where it just was) for those, and only those, does `sandPass` itself
 * wait for its next call — collected into the returned set instead.
 */
function sandPassCandidates(world: World, frame: SandFrame, steps: SettleStep[], candidates: Set<string>): Set<string> {
  const queue = [...candidates]
    .map(parseCellKey)
    .filter((cell) => cell.x >= 0 && cell.x < frame.width && cell.y >= 1 && cell.y < frame.height)
    .sort(compareScanOrder);
  const moves: Array<{ from: CellCoord; to: CellCoord }> = [];
  const visited = new Set<string>();
  const next = new Set<string>();
  let index = 0;
  while (index < queue.length) {
    const cell = queue[index];
    index += 1;
    const from = cellKey(cell.x, cell.y);
    if (visited.has(from)) continue;
    visited.add(from);
    const color = world.grid.get(from);
    if (color === undefined || world.locked.has(from)) continue;
    const to = grainTarget(world, frame, cell.x, cell.y);
    if (!to) continue;

    world.grid.delete(from);
    world.grid.set(cellKey(to.x, to.y), color);
    moves.push({ from: { x: cell.x, y: cell.y }, to });
    // `to` is always one row below `cell` — behind the scan wherever it
    // currently sits — so it always waits for the next pass, same as
    // `sandPass`'s own "moved once per pass" rule.
    next.add(cellKey(to.x, to.y));
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const neighbour = { x: cell.x + dx, y: cell.y + dy };
        if (neighbour.x < 0 || neighbour.x >= frame.width || neighbour.y < 1 || neighbour.y >= frame.height) continue;
        if (compareScanOrder(neighbour, cell) > 0) insertInScanOrder(queue, neighbour);
        else next.add(cellKey(neighbour.x, neighbour.y));
      }
    }
  }
  if (moves.length) steps.push({ kind: "GRAIN_PASS", moves });
  return next;
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
 * Free fall is never gated — only this, the sideways case, waits.
 * `"blocked"` is the only outcome that was never possible at all; both
 * `"waiting"` (a tick spent throttled) and `"moved"` (an actual shift) count
 * as "this key is still doing something" as far as `settleWorld` is
 * concerned, but `keyPass` needs to tell the two apart to know whether to
 * bank coast momentum for this roll.
 */
function rollKey(
  world: World,
  frame: SandFrame,
  id: string,
  dx: number,
  dy: number,
  steps: SettleStep[],
): "moved" | "waiting" | "blocked" {
  if (!keyCanMove(world, frame, id, dx, dy)) return "blocked";
  const wait = Math.round(world.friction * FRICTION_MAX_WAIT_PASSES);
  const soFar = (world.keyRollWait.get(id) ?? 0) + 1;
  if (soFar <= wait) {
    world.keyRollWait.set(id, soFar);
    return "waiting";
  }
  world.keyRollWait.set(id, 0);
  moveKey(world, frame, id, dx, dy, steps);
  return "moved";
}

/**
 * Which side, if either, a key resting on a dead-flat stretch should roll
 * toward — on request ("trên slope như này nó phải trượt xuống"): a key
 * reads as a rigid rolling object, not a grain that only ever reacts to its
 * own immediate footprint, so a multi-cell-wide tread (a staircase-shaped
 * Wall Obstacle at real pixel resolution is exactly this — each "step" of
 * the visual slope is several cells wide, not the single-cell-per-row
 * diagonal `keyPass`'s own immediate-diagonal check alone can follow) should
 * not read as solid ground just because the very next cell over happens to
 * be level.
 *
 * Walks outward cell by cell in each direction (`SLIDE_ORDER`'s own
 * left-first tie-break) only as long as the row at the key's own height
 * stays clear the whole way — the same "no teleporting past an obstacle"
 * rule every other key move already keeps, just checked one cell at a time
 * instead of in a single jump — and returns the first direction where doing
 * so reaches a cell it could actually drop from. `null` means neither side
 * ever opens up: the key is on genuinely flat, enclosed ground (the common
 * case — resting embedded in ordinary sand, where the very next cell over is
 * already solid sand and this returns immediately), not stuck mid-slope.
 */
function findSlopeDrop(world: World, frame: SandFrame, id: string): -1 | 1 | null {
  // Checked on both sides before deciding anything — see below for why a
  // side that finds one is not automatically taken.
  const openSides: Array<-1 | 1> = [];
  for (const dir of SLIDE_ORDER) {
    for (let distance = 1; distance <= frame.width; distance += 1) {
      const dx = dir * distance;
      if (!keyCanMove(world, frame, id, dx, 0)) break;
      if (keyCanMove(world, frame, id, dx, -1)) {
        openSides.push(dir);
        break;
      }
    }
  }
  // Exactly one open side is a slope: there is a real downhill, and the
  // other direction is genuinely blocked (more high ground, not just the
  // opposite face of the same narrow perch). Both sides open is the
  // opposite case — a key balanced dead centre on a support narrower than
  // its own footprint (a single pillar, a lock's own narrow ledge) reads as
  // symmetric on this exact check, with no side more "downhill" than the
  // other, and — on request, `tests/sand-mechanics.test.ts`'s own "a key is
  // rigid" case — that is a rest to keep, not a coin flip to break by
  // picking `SLIDE_ORDER`'s tie-break as if it meant something physical here.
  return openSides.length === 1 ? openSides[0] : null;
}

/**
 * One pass of falling keys — same rule as a grain, applied to the whole
 * shape, plus two things a grain does not do. First, it coasts a little once
 * a slope runs out, rather than snapping still on the very pass the ground
 * turns flat: each actual diagonal (or slope) roll banks one cell of
 * momentum (`world.keyMomentum`, capped at `KEY_COAST_MAX_CELLS`), spent one
 * cell per pass once neither gravity nor a fresh diagonal has anywhere left
 * to take it, tapering off instead of stopping dead. Second — the newer of
 * the two — a key stuck on a stretch with no *immediate* diagonal still
 * keeps looking for one further along the same row before it actually rests
 * (`findSlopeDrop`, on request); a grain never does either.
 */
function keyPass(world: World, frame: SandFrame, steps: SettleStep[]) {
  let moved = false;
  // Lowest key first, so one resting on another does not jump through it.
  const order = [...world.keys.keys()].sort((a, b) => lowestY(world, a) - lowestY(world, b));
  for (const id of order) {
    if (moveKey(world, frame, id, 0, -1, steps)) {
      // Free fall, not a roll — friction never gated it, so it owes no wait,
      // and a straight drop has no sideways direction of its own to coast in.
      world.keyRollWait.set(id, 0);
      world.keyMomentum.set(id, 0);
      moved = true;
      continue;
    }
    let rolled = false;
    for (const dx of SLIDE_ORDER) {
      const result = rollKey(world, frame, id, dx, -1, steps);
      if (result === "blocked") continue;
      rolled = true;
      if (result === "moved") {
        const banked = Math.min(KEY_COAST_MAX_CELLS, (world.keyMomentum.get(id) ?? 0) + 1);
        world.keyMomentum.set(id, banked);
        world.keyCoastDir.set(id, dx);
      }
      break;
    }
    if (rolled) {
      moved = true;
      continue;
    }

    // Neither straight down nor an immediate diagonal is open, but the
    // ground is not necessarily flat — see `findSlopeDrop`'s own comment.
    // Throttled by the same friction wait every other roll respects
    // (`rollKey`), and banks momentum the same way a diagonal roll does, so
    // reaching the slope's actual edge (where the ordinary diagonal case
    // above takes back over) never stutters.
    const slopeDir = findSlopeDrop(world, frame, id);
    if (slopeDir !== null) {
      const result = rollKey(world, frame, id, slopeDir, 0, steps);
      if (result !== "blocked") {
        moved = true;
        if (result === "moved") {
          const banked = Math.min(KEY_COAST_MAX_CELLS, (world.keyMomentum.get(id) ?? 0) + 1);
          world.keyMomentum.set(id, banked);
          world.keyCoastDir.set(id, slopeDir);
        }
        continue;
      }
    }

    // The slope (or whatever it was rolling on) has run out — neither
    // gravity nor a fresh diagonal has anywhere left to take it. A key that
    // built up some roll still coasts a few more cells across the flat
    // before it truly stops, spending its banked momentum one cell per pass.
    const momentum = world.keyMomentum.get(id) ?? 0;
    const coastDir = world.keyCoastDir.get(id);
    if (momentum > 0 && coastDir !== undefined && moveKey(world, frame, id, coastDir, 0, steps)) {
      world.keyMomentum.set(id, momentum - 1);
      moved = true;
      continue;
    }
    world.keyMomentum.set(id, 0);
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

/**
 * `settleWorld`, but for a frozen board: on request, Freeze Map holds the
 * sand itself in place (no `sandPass`) while a key's own physics keeps
 * running exactly as it would unfrozen — one already rolling or falling does
 * not stop dead, and one that reaches a lock still opens it. Sand a key's own
 * unlock just freed is sand like any other, so it still hangs exactly where
 * it lands rather than falling — only `sandPass` itself is what freeze holds
 * back, not the grid it operates on.
 */
function settleWorldKeysOnly(world: World, frame: SandFrame, steps: SettleStep[]) {
  const limit = frame.width * frame.height;
  for (let pass = 0; pass < limit; pass += 1) {
    const keys = keyPass(world, frame, steps);
    const unlocked = unlockPass(world, steps);
    if (!keys && !unlocked) break;
  }
}

/**
 * `settleWorld`, but for a keyless board where only the neighbourhood of one
 * shot's hole can possibly still be moving — see `runGrainSettle`'s `hint`.
 *
 * A full `sandPass` rescans every cell of the frame whether or not anything
 * near it changed, which is what a solid, fully-packed picture (Level 2/3's
 * "drawn as a solid rectangle" style — see their own doc comments in
 * sand-levels.ts) pays for on every single shot: dozens of passes, each one
 * a pass over the *whole* board, purely to re-confirm that sand nowhere near
 * the hole never moved. `sandPassCandidates` instead only ever looks at
 * cells `settleWorldFromHole` already has reason to suspect could move —
 * seeded from the hole itself, then grown pass by pass from whatever the
 * previous pass actually touched. Locks and keys still run unrestricted
 * (`keyPass`/`unlockPass` take no bounds), which is exactly why this path is
 * only ever taken on a board with no keys at all — see `runGrainSettle`.
 */
function settleWorldFromHole(
  world: World,
  frame: SandFrame,
  steps: SettleStep[],
  hint: { x: number; y: number; radius: number },
) {
  const limit = frame.width * frame.height;
  // Seeded from just the hole itself — not the whole column above it. Nothing
  // above the hole is a candidate yet; each pass's own `sandPassCandidates`
  // is what carries the frontier upward, one row at a time, exactly as far as
  // it turns out to actually be needed.
  let active = new Set<string>();
  const minX = Math.max(0, Math.floor(hint.x - hint.radius));
  const maxX = Math.min(frame.width - 1, Math.ceil(hint.x + hint.radius));
  const minY = Math.max(1, Math.floor(hint.y - hint.radius));
  const maxY = Math.min(frame.height - 1, Math.ceil(hint.y + hint.radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) active.add(cellKey(x, y));
  }
  for (let pass = 0; pass < limit && active.size; pass += 1) {
    active = sandPassCandidates(world, frame, steps, active);
  }
}

/** Re-derive bodies from the settled grid and close the step list. */
function finishWorld(
  world: World,
  frame: SandFrame,
  steps: SettleStep[],
  freezeTriggers: SandFreezeTrigger[],
): SettleOutcome {
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
    walls: sortCells([...world.walls].map(parseCellKey)),
    // Never spent by a settle (see `freezeTriggers`'s own comment on
    // `World`) — passed straight through rather than rebuilt from
    // `world.freezeTriggers`, which would lose each trigger's own id.
    freezeTriggers,
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

/** Corner neighbours added to `ORTHOGONAL_4` — Chain Sort's own adjacency
 * rule, used nowhere else in this file (every body/settle/unlock rule stays
 * `ORTHOGONAL_4`-only). */
const DIAGONAL_4 = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Chain Sort's own reach (booster-radius-prism-spec.md §2.1): every cell of
 * `color` connected to the impact cell through any of the eight neighbours
 * around it — `ORTHOGONAL_4` plus `DIAGONAL_4` — not just the four
 * `ORTHOGONAL_4` every other rule in this file (body-splitting, settling,
 * unlocking) uses. Two same-colour grains that only touch corner-to-corner
 * are two separate bodies under every other rule in the game; this is the
 * one exception, on request ("grain pixel nằm xéo cũng sort được").
 *
 * `frozen` is left out of the flood the same way `cellsInRadius` leaves it
 * out of the disc: locked sand is invisible to a sweep rather than a wall
 * the flood stops at, so it simply never joins (and never interrupts) the
 * chain — a loose cell just past a lock is reached exactly as if the lock
 * were not there.
 *
 * Returns nothing at all when the impact cell itself is not a live, matching
 * grain — the same "nothing to take" a radius shot gets centred on empty air
 * with nothing in reach; there is no radius here to reach past bare ground
 * with, so a whiffed cell just returns empty rather than searching around it.
 */
export function cellsByFloodFill(
  bodies: SandBody[],
  center: CellCoord,
  color: SandColor,
  frozen?: ReadonlySet<string>,
): CellCoord[] {
  const grid = new Map<string, CellCoord>();
  for (const body of bodies) {
    if (body.color !== color) continue;
    for (const cell of body.cells) {
      const key = cellKey(cell.x, cell.y);
      if (frozen?.has(key)) continue;
      grid.set(key, cell);
    }
  }
  const startKey = cellKey(center.x, center.y);
  if (!grid.has(startKey)) return [];
  const visited = new Set<string>([startKey]);
  // A fresh `{x,y}`, not `center` itself — same "always hand back a plain
  // coordinate, never whatever extra fields the caller's own object happened
  // to carry" contract `cellsInRadius` keeps for every cell it returns.
  const queue: CellCoord[] = [{ x: center.x, y: center.y }];
  const found: CellCoord[] = [];
  while (queue.length) {
    const cell = queue.pop()!;
    found.push(cell);
    for (const [dx, dy] of [...ORTHOGONAL_4, ...DIAGONAL_4]) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      const key = cellKey(next.x, next.y);
      if (visited.has(key) || !grid.has(key)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return sortCells(found);
}

/**
 * The Freeze Map trigger the crosshair is directly over, or null.
 *
 * An exact cell match, not a disc reach (on request: "chỉ khi crosshair nhắm
 * vào Freeze thì nó mới kích hoạt được") — a shot that merely sweeps past a
 * trigger on its way to sand nearby no longer arms it; the impact point
 * itself (`hit.x`/`hit.y`, always an integer cell — see `handleImpact`'s own
 * `center`) has to land on one of the trigger's own cells. Colour-blind on
 * purpose either way — a trigger is not sand, so `matchColor` never applies
 * to it (§3 of the mechanic doc: "bắn trúng nó bằng bất kỳ màu đạn nào").
 */
export function triggerAtCell(
  triggers: readonly SandFreezeTrigger[],
  cell: CellCoord,
): SandFreezeTrigger | null {
  for (const trigger of triggers) {
    for (const triggerCell of trigger.cells) {
      if (triggerCell.x === cell.x && triggerCell.y === cell.y) return trigger;
    }
  }
  return null;
}

/**
 * How many shots a Freeze Map trigger freezes the board for when a level
 * does not say otherwise — see `SandLevelConfig.freezeDuration`.
 */
export const DEFAULT_FREEZE_DURATION = 5;

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
 * A little slack past `effectiveSortRadius`, added only where a shot
 * actually resolves (`resolveShot`) and never to the number the ring/lift
 * preview are drawn from — on request, the disc a shot sweeps should reach
 * a bit past what the ring promises, not exactly match it, so a grain
 * sitting just outside the drawn edge still gets swept up instead of the
 * ring reading as a stricter boundary than it looks. A flat cell fraction
 * rather than a multiplier, so it stays a small, constant margin rather than
 * ballooning at Radius Overcharge's already-doubled reach — kept small
 * enough that a level's shot budget still means something (see
 * sand-radius.test.ts's own "careless play loses" difficulty check).
 * Exported only so tests can build the same oracle `resolveShot` actually
 * resolves against; the renderer never touches it.
 */
export const SORT_RADIUS_FORGIVENESS = 0.15;

/**
 * How many charges of `type` are left — spec §4.
 *
 * Used to be a flat `Infinity` for both boosters, with a comment noting that
 * "the day this becomes finite (spent from a currency or a level grant),
 * each booster gets its own real number here". `economy.ts`'s wallet is that
 * real number now — bought in the Shop, spent one per boosted shot in
 * `SandCannonEngine.fire()`. Delegated rather than inlined so `sand-rules.ts`
 * stays the deterministic, DOM-free half of the game (see the file's header
 * comment) while the actual persistence lives with the rest of the player's
 * economy.
 */
export function getBoosterCharges(type: BoosterType): number {
  return getBoosterCount(type);
}

/**
 * Spends one charge of `type` — called from `SandCannonEngine.fire()` at
 * spec §7.1's "consumed the instant it leaves the barrel", never at arm
 * time: arming only checks `getBoosterCharges`, so a level restarted after
 * arming but before firing loses nothing (the engine that had it armed is
 * torn down whole; a fresh one starts unarmed).
 */
export function spendBoosterCharge(type: BoosterType): void {
  spendWalletBoosterCharge(type);
}

/**
 * Hands one charge of `type` back to the real wallet — called from
 * `SandCannonEngine` when a boosted shot missed, came up `NO_MATCH`, or the
 * attempt it was spent on ended in `FAIL` (see `refundBoosterCharge`/
 * `refundBoostersOnFail` there for the exact rules). Same delegate-to-economy
 * shape as `spendBoosterCharge` just above.
 */
export function addBoosterCharges(type: BoosterType, amount: number): void {
  addWalletBoosterCharges(type, amount);
}

// ---- Game state ---------------------------------------------------------

export function createSandGameState(level: SandLevelConfig): SandGameState {
  const { bodies, locked, keys, walls, freezeTriggers, hiddenFreezeTriggers, hiddenKeys } = parseSandLevel(level);
  const frozen = new Set(locked.map((cell) => cellKey(cell.x, cell.y)));
  // A colour that starts entirely locked is authored into the wheel — it has to
  // be, or it could never be shot once freed — but it must not be *handed out*
  // until a key has opened it. `level.ammoQueue` itself no longer sets the
  // opening order (see `fillQueue`'s own comment) — it is still what the
  // level editor validates every board colour against.
  const filled = fillQueue(level, [], {}, 0, bodies, frozen, 0);
  return {
    phase: "READY",
    bodies,
    queue: filled.queue,
    ammoPity: filled.ammoPity,
    ammoSeed: filled.ammoSeed,
    shotsUsed: 0,
    remainingCells: countCells(bodies),
    locked,
    keys,
    walls,
    freezeTriggers,
    hiddenFreezeTriggers,
    hiddenKeys,
    freezeShotsRemaining: 0,
    // A fresh copy every attempt (restart included) — the level's own
    // declared allotment, never carried over or shared with the real
    // wallet. `undefined` when the level doesn't force charges at all, so
    // the engine's own fallback-to-wallet check stays a plain `?? `.
    boosterChargesOverride: level.forcedBoosterCharges ? { ...level.forcedBoosterCharges } : undefined,
    result: null,
  };
}

/** The board's non-sand furniture, in the shape the solver wants it. */
export function fixturesOf(level: SandLevelConfig, state: SandGameState): Fixtures {
  return {
    locked: state.locked,
    keys: state.keys,
    walls: state.walls,
    freezeTriggers: state.freezeTriggers,
    friction: level.keyFriction ?? 0,
  };
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

type AmmoDraw = Pick<SandGameState, "queue" | "ammoPity" | "ammoSeed">;

/**
 * A colour whose remaining sand sits this far below the average of
 * everything still shootable — see `drawAmmo`'s own comment for what this
 * changes about how often it can come up. Half the average, not some fixed
 * grain count: what counts as "barely any left" scales with the board, so a
 * tiny level and a huge one both get the same *relative* read on which
 * colour is the thin one.
 */
const SCARCE_COLOR_SHARE = 0.5;
/**
 * How many other draws a scarce colour must sit out before it is allowed to
 * repeat. 2 — drawn, skipped, skipped, eligible again — reads as "spaced a
 * few bullets apart", the least this could be while still being more than
 * the "sits right next to itself" a plain uniform draw allowed.
 */
const SCARCE_COLOR_MIN_GAP = 2;

/**
 * Total live cells per colour, across every body — frozen cells count too:
 * a slab still waiting on its key is still part of how much of that colour
 * the picture actually holds, even while none of it can be shot yet.
 */
function cellCountsByColor(bodies: SandBody[]): Partial<Record<SandColor, number>> {
  const counts: Partial<Record<SandColor, number>> = {};
  for (const body of bodies) counts[body.color] = (counts[body.color] ?? 0) + body.cells.length;
  return counts;
}

/**
 * One random pick from `shootable` — uniform among whichever of them are
 * actually eligible this draw — plus the pity/seed state the *next* draw
 * needs. Every candidate not picked has waited one draw longer, `pity` says
 * so, and `seededUnit` is what turns `seed` into this draw's pick, so the
 * same state always produces the same one (§9, this file's header comment).
 *
 * `scarce` names which colours are thin enough on the board that a plain
 * uniform draw could hand two of them out right next to each other — fine
 * for a colour with sand to spare, but a rare one repeating immediately
 * reads as the wheel wasting the only two bullets worth anything on the
 * same tiny patch. A scarce colour is filtered out until it has sat out
 * `SCARCE_COLOR_MIN_GAP` draws (`pity` already counts exactly that), so it
 * still comes up often — insurance (`drainOverdue`) still forces it through
 * same as any other colour — just never twice in a row. Filtering down to
 * nothing (every remaining colour is scarce and still sitting out its gap)
 * falls back to the full list rather than a draw with nowhere to pick from.
 *
 * No insurance logic here on purpose — see `drainOverdue`, `fillQueue`'s
 * other half. A single draw can only ever clear one colour's wait to zero,
 * so if two colours are already overdue in the same call this one has no way
 * to save both; keeping the two halves separate is what lets `fillQueue`
 * drain every overdue colour first, however many there are, before spending
 * a real draw here.
 */
function drawAmmo(
  shootable: readonly SandColor[],
  pity: Partial<Record<SandColor, number>>,
  seed: number,
  scarce: ReadonlySet<SandColor>,
) {
  const nextSeed = seed + 1;
  const eligible = shootable.filter((color) => !scarce.has(color) || (pity[color] ?? 0) >= SCARCE_COLOR_MIN_GAP);
  const pool = eligible.length ? eligible : shootable;
  const color = pool[Math.min(pool.length - 1, Math.floor(seededUnit(nextSeed) * pool.length))];
  const nextPity: Partial<Record<SandColor, number>> = {};
  for (const candidate of shootable) {
    nextPity[candidate] = candidate === color ? 0 : (pity[candidate] ?? 0) + 1;
  }
  return { color, pity: nextPity, seed: nextSeed };
}

/** Insurance threshold: a colour passed over this many draws in a row is forced through the next one. */
const AMMO_PITY_LIMIT = 3;

/**
 * Forces through every colour already sitting at the insurance limit,
 * oldest-waiting first — not just one.
 *
 * A plain draw only ever resolves a single colour's wait, but more than one
 * colour can reach the limit on the very same call (three colours can easily
 * end up tied at "passed over twice" after a couple of draws, and the next
 * draw pushes all of them to the limit together) — capping this at one
 * forced pick per call is exactly what let a second colour slide past the
 * limit to 4, 5 draws waited and so on. Draining the whole backlog here,
 * with no seed spent and no *other* colour's clock advanced by the draining
 * itself, is what keeps the limit an actual ceiling instead of a rough
 * average.
 */
function drainOverdue(
  shootable: readonly SandColor[],
  pity: Partial<Record<SandColor, number>>,
): { colors: SandColor[]; pity: Partial<Record<SandColor, number>> } {
  let nextPity = pity;
  const colors: SandColor[] = [];
  while (true) {
    const overdue = shootable.filter((color) => (nextPity[color] ?? 0) >= AMMO_PITY_LIMIT);
    if (!overdue.length) break;
    overdue.sort((a, b) => (nextPity[b] ?? 0) - (nextPity[a] ?? 0));
    const color = overdue[0];
    colors.push(color);
    nextPity = { ...nextPity, [color]: 0 };
  }
  return { colors, pity: nextPity };
}

/**
 * Tops `queue` back up to the full lookahead (the loaded round plus
 * `nextPreviewCount` behind it) with fresh random draws, after dropping
 * anything left over for a colour that has just been finished.
 *
 * Nothing "returns" a specific colour to a specific spot the way the old
 * round-robin queue did — every currently shootable colour is eligible for
 * every open slot, so the same colour can now come up back-to-back, and
 * `drawAmmo`'s insurance rule is what keeps one from vanishing for good
 * instead of a fixed rotation doing it. Called with an already-shifted
 * `queue` from `resolveShot`'s `spend`, or with an empty one from
 * `createSandGameState` — either way this is what makes sure the player
 * always sees a full preview, never a partial one trailing off into nothing
 * just because the board only holds a couple of colours.
 *
 * `previousShootable`, when given, is the shootable set from *before* this
 * shot — any colour missing from it that is shootable now just had its lock
 * opened this turn, and goes straight into the queue rather than waiting on
 * a lucky roll or three turns of insurance: a key freeing sand is a big
 * enough moment that the wheel offering it back is immediate, the same
 * guarantee the old round-robin queue made. `createSandGameState` has no
 * "before" to compare against, so it omits this and leaves the opening
 * queue to a plain draw.
 */
function fillQueue(
  level: SandLevelConfig,
  queue: SandColor[],
  pity: Partial<Record<SandColor, number>>,
  seed: number,
  bodies: SandBody[],
  frozen: ReadonlySet<string>,
  /** How many shots have already been fired by the time the queue THIS CALL
   * returns starts being loaded from — 0 at `createSandGameState`, otherwise
   * `state.shotsUsed + 1` (this shot has already been counted as spent by
   * the time its own `spend()` closure calls this). What lets
   * `applyForcedOpeningQueue` know which absolute shot index each returned
   * slot corresponds to. */
  shotsUsedAfter: number,
  previousShootable?: ReadonlySet<SandColor>,
): AmmoDraw {
  const shootable = shootableColors(bodies, frozen);
  const shootableSet = new Set(shootable);
  const kept = queue.filter((color) => shootableSet.has(color));
  if (previousShootable) {
    for (const color of shootable) {
      if (!previousShootable.has(color) && !kept.includes(color)) kept.push(color);
    }
  }
  // Computed once per call, off the same `bodies` snapshot every draw below
  // shares — a shot resolves before the next `fillQueue` call, never in the
  // middle of this one, so which colours count as scarce cannot change
  // partway through filling the queue back up.
  const counts = cellCountsByColor(bodies);
  const totalCells = shootable.reduce((sum, color) => sum + (counts[color] ?? 0), 0);
  const averageCells = shootable.length ? totalCells / shootable.length : 0;
  const scarce = new Set(shootable.filter((color) => (counts[color] ?? 0) < averageCells * SCARCE_COLOR_SHARE));

  let nextPity = pity;
  let nextSeed = seed;
  const target = 1 + level.nextPreviewCount;

  // Insurance always goes first, however many colours it takes to clear the
  // backlog, and gets re-checked after every single regular draw below —
  // one plain draw can itself push some other colour to the limit, and
  // leaving that for "next call" is exactly what let a second overdue colour
  // slide past it. Draining to a fixpoint before ever drawing again is what
  // keeps the limit an actual ceiling. This can overshoot `target` by a
  // colour or two on a rare unlucky call, which just means the preview
  // briefly shows a little more than the usual 3 ahead rather than ever
  // dropping that promise.
  while (true) {
    const drained = drainOverdue(shootable, nextPity);
    nextPity = drained.pity;
    if (drained.colors.length) {
      kept.push(...drained.colors);
      continue;
    }
    if (kept.length >= target || shootable.length === 0) break;
    const drawn = drawAmmo(shootable, nextPity, nextSeed, scarce);
    kept.push(drawn.color);
    nextPity = drawn.pity;
    nextSeed = drawn.seed;
  }
  return { queue: applyForcedOpeningQueue(level, kept, shotsUsedAfter, shootableSet), ammoPity: nextPity, ammoSeed: nextSeed };
}

/**
 * Overrides the front of `queue` with `level.forcedOpeningQueue`, wherever
 * the two overlap — `queue[i]` corresponds to absolute shot index
 * `shotsUsedAfter + i`, so a slot only gets forced while that index still
 * falls inside the forced array; once every forced index has been fired
 * past, every later call leaves the wheel to `fillQueue`'s own random draw
 * again, for good. A forced colour that is not actually `shootable` right
 * now (nothing shootable of its own, thanks to a lock the picture opens
 * later, say) is left as the natural draw instead — this exists to make a
 * scripted demo's targets predictable, not to ever hand out a dead bullet.
 */
function applyForcedOpeningQueue(
  level: SandLevelConfig,
  queue: SandColor[],
  shotsUsedAfter: number,
  shootableSet: ReadonlySet<SandColor>,
): SandColor[] {
  const forced = level.forcedOpeningQueue;
  if (!forced?.length) return queue;
  let changed = false;
  const next = queue.map((color, i) => {
    const absoluteIndex = shotsUsedAfter + i;
    const pinned = absoluteIndex < forced.length ? forced[absoluteIndex] : undefined;
    if (!pinned || !shootableSet.has(pinned) || pinned === color) return color;
    changed = true;
    return pinned;
  });
  return changed ? next : queue;
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
 * A landed shot that leaves this little (or less) of the level's own starting
 * sand behind is close enough to call finished. Per feedback: 1-2% of a
 * picture left over reads as a rounding error the player did nothing wrong
 * to avoid, not a real miss — see `resolveShot`'s own use of this, which is
 * what actually sweeps the leftover away rather than just excusing it.
 */
const WIN_LENIENCY_FRACTION = 0.02;

function isForgivableLeftover(level: SandLevelConfig, remainingCells: number): boolean {
  if (remainingCells <= 0) return false;
  const startingCells = countCells(parseSandLevel(level).bodies);
  return remainingCells <= Math.max(1, Math.round(startingCells * WIN_LENIENCY_FRACTION));
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
function settleAfterRemoval(
  level: SandLevelConfig,
  bodies: SandBody[],
  fixtures: Fixtures,
  /** Cells this shot disturbed — the sand it removed, plus (when it also
   * spent a Freeze Map trigger) the cells that trigger used to occupy. Either
   * source opens new empty space the cascade below might start from. */
  disturbed: CellCoord[],
  frozen: boolean,
  /** Force the unhinted, whole-frame `settleWorld` sweep regardless of how
   * small `disturbed` is — set only on the shot that just unfroze the board
   * (see that call site's own comment): sand anywhere could have gone
   * unsupported during however many shots the board sat frozen, not just
   * near this one shot's own disturbance, so the ordinary hole-hinted pass
   * below is not enough to find it all. */
  fullSweep: boolean = false,
) {
  // The hole a radius shot bites is one contiguous disc, so its own bounding
  // box (plus a little slack for the fall's own sideways roll) is where every
  // bit of the cascade it triggers actually starts — see `runGrainSettle`'s
  // `hint` and `settleWorldFromHole`'s own comment. A big, mostly-static
  // board (a solid Level 2/3 picture) would otherwise pay for a full-frame
  // rescan on every settle pass just to confirm the far side never moved.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const cell of disturbed) {
    if (cell.x < minX) minX = cell.x;
    if (cell.x > maxX) maxX = cell.x;
    if (cell.y < minY) minY = cell.y;
    if (cell.y > maxY) maxY = cell.y;
  }
  const hint = fullSweep || disturbed.length === 0
    ? undefined
    : {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        radius: Math.max(maxX - minX, maxY - minY) / 2 + 1,
      };
  const settle = runGrainSettle(bodies, level.frame, fixtures, hint, frozen);
  return { settle, steps: settle.steps };
}

/**
 * Splits `hiddenFreezeTriggers` into the ones fully uncovered by `bodies`
 * (every one of their own cells now empty of sand) and the ones still
 * buried — see `SandGameState.hiddenFreezeTriggers`'s own comment. Called
 * after every settle that could have changed what covers one, so a trigger
 * reveals itself the instant its last covering grain is gone (on request:
 * "hiện ra ngay khi cát che bị dọn sạch"), not on some later shot that
 * happens to notice.
 */
function revealHiddenFreezeTriggers(
  bodies: SandBody[],
  hiddenFreezeTriggers: SandFreezeTrigger[],
): { revealed: SandFreezeTrigger[]; stillHidden: SandFreezeTrigger[] } {
  if (!hiddenFreezeTriggers.length) return { revealed: [], stillHidden: hiddenFreezeTriggers };
  const occupied = new Set<string>();
  for (const body of bodies) {
    for (const cell of body.cells) occupied.add(cellKey(cell.x, cell.y));
  }
  const revealed: SandFreezeTrigger[] = [];
  const stillHidden: SandFreezeTrigger[] = [];
  for (const trigger of hiddenFreezeTriggers) {
    const uncovered = trigger.cells.every((cell) => !occupied.has(cellKey(cell.x, cell.y)));
    (uncovered ? revealed : stillHidden).push(trigger);
  }
  return { revealed, stillHidden };
}

/**
 * `revealHiddenFreezeTriggers`, but for `SandGameState.hiddenKeys` — same
 * all-or-nothing "every cell now empty" check, so a hidden key only actually
 * starts falling/rolling once every last covering grain is gone. The
 * cell-by-cell peek the picture shows well before that (on request — see
 * `hiddenKeyRows`'s own comment) is purely `SandCannonEngine`'s own render
 * pass reading the same `bodies`/`hiddenKeys` this checks; it never needed
 * its own reveal step here.
 */
function revealHiddenKeys(
  bodies: SandBody[],
  hiddenKeys: SandKey[],
): { revealed: SandKey[]; stillHidden: SandKey[] } {
  if (!hiddenKeys.length) return { revealed: [], stillHidden: hiddenKeys };
  const occupied = new Set<string>();
  for (const body of bodies) {
    for (const cell of body.cells) occupied.add(cellKey(cell.x, cell.y));
  }
  const revealed: SandKey[] = [];
  const stillHidden: SandKey[] = [];
  for (const key of hiddenKeys) {
    const uncovered = key.cells.every((cell) => !occupied.has(cellKey(cell.x, cell.y)));
    (uncovered ? revealed : stillHidden).push(key);
  }
  return { revealed, stillHidden };
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

  // Read before this shot changes anything — a colour missing here that is
  // shootable again after `spend` just had its lock opened this turn, see
  // `fillQueue`'s `previousShootable` parameter.
  const frozenLocked = frozenSet(state);
  const previousShootable = new Set(shootableColors(state.bodies, frozenLocked));

  // A radius shot is aimed at a place, not at a region: it takes every matching
  // grain inside the disc, across as many bodies as the disc happens to touch,
  // and only the part of each that falls inside it. The place may be empty air
  // — the disc still reaches down from it. A shot that finds none of its colour
  // in reach is not a special case; NO_MATCH covers it.
  //
  // The disc itself reaches a little past `effectiveSortRadius` — see
  // `SORT_RADIUS_FORGIVENESS`'s own comment — while the ring drawn for this
  // same shot (the renderer's own call to `effectiveSortRadius`) stays
  // exactly what it always was, so only what a shot actually sweeps grew.
  // Chain Sort ignores the disc entirely — it has its own reach
  // (`cellsByFloodFill`, booster-radius-prism-spec.md §2.1), not a bigger or
  // colour-blind version of the same one every other shot (boosted or not)
  // still uses.
  const removed = booster === "chainSort"
    ? cellsByFloodFill(state.bodies, { x: hit.x, y: hit.y }, ammo, frozenLocked)
    : cellsInRadius(
      state.bodies,
      { x: hit.x, y: hit.y },
      effectiveSortRadius(level, booster) + SORT_RADIUS_FORGIVENESS,
      ammo,
      frozenLocked,
      { matchColor: booster !== "prismShot" },
    );

  // Freeze Map: an exact hit on the trigger's own cell, entirely independent
  // of `removed`/the sand disc above — see `triggerAtCell`'s own comment for
  // why this is no longer radius-based.
  const hitTrigger = triggerAtCell(state.freezeTriggers, { x: hit.x, y: hit.y });
  const wasFrozen = state.freezeShotsRemaining > 0;
  // A trigger only actually fires if Freeze isn't already running — reached
  // while already frozen, it does nothing and is NOT spent (see
  // `SandGameState.freezeTriggers`'s own comment), so a shot fired at an
  // already-active effect costs nothing but its own ordinary outcome.
  const activatedFreeze = hitTrigger !== null && !wasFrozen;
  const nextFreezeTriggers = activatedFreeze
    ? state.freezeTriggers.filter((trigger) => trigger.id !== hitTrigger!.id)
    : state.freezeTriggers;
  const freezeShotsAfter = activatedFreeze
    ? (level.freezeDuration ?? DEFAULT_FREEZE_DURATION)
    : wasFrozen
      ? Math.max(0, state.freezeShotsRemaining - 1)
      : 0;
  // Gravity is locked for exactly the shots that leave the board frozen
  // *afterward* (`freezeShotsAfter > 0`), not the ones where it merely
  // started the shot frozen. That makes two things true from the same
  // check: the trigger-hitting shot is itself the first frozen one (count
  // starts at full the instant the disc reaches the trigger, so
  // `freezeShotsAfter` is already > 0 for it) — and, on request, the LAST
  // frozen shot (the one that ticks `freezeShotsRemaining` down to 0) is the
  // one that unfreezes it: sand settles immediately on that same shot
  // instead of sitting locked one shot longer, waiting for the next one to
  // notice the count already hit 0.
  const frozenThisShot = freezeShotsAfter > 0;

  const spend = (
    bodies: SandBody[],
    stillFrozen: ReadonlySet<string>,
  ): Pick<SandGameState, "queue" | "ammoPity" | "ammoSeed" | "shotsUsed" | "freezeShotsRemaining"> => ({
    ...fillQueue(level, state.queue.slice(1), state.ammoPity, state.ammoSeed, bodies, stillFrozen, state.shotsUsed + 1, previousShootable),
    shotsUsed: state.shotsUsed + 1,
    freezeShotsRemaining: freezeShotsAfter,
  });

  // The shot that ticks `freezeShotsRemaining` down to 0 unfreezes the WHOLE
  // board, not just wherever this one shot happened to land — over however
  // many shots the board sat frozen, sand elsewhere could have lost its own
  // support any number of times with gravity switched off, and none of that
  // ever got a chance to fall. A localised, hole-hinted settle (the ordinary
  // case, `settleAfterRemoval`'s own ` hint`) only ever re-checks the
  // neighbourhood of THIS shot's disturbance, so it would leave every other
  // orphaned pocket hanging in place forever — exactly the "cát đứng yên
  // chứ không chịu sụp xuống hết" bug this is fixing. `fullSweep: true`
  // below is what forces the unhinted, whole-frame `settleWorld` pass
  // instead, on this shot only.
  const justUnfroze = wasFrozen && freezeShotsAfter === 0;

  if (!removed.length) {
    // Freeze starts the instant its trigger is hit, so a shot that only
    // spent the trigger (found no sand of its own colour) never has
    // anything left to settle — the board was already frozen for this same
    // shot, before anything could fall. But a shot that only ticks the
    // count down to 0 (still no sand of its own colour in reach) is exactly
    // `justUnfroze`, and still has to run the same whole-frame settle the
    // matched-shot path below runs, or nothing anywhere on the board would
    // ever fall for it either.
    const fixtures: Fixtures = { ...fixturesOf(level, state), freezeTriggers: nextFreezeTriggers };
    const { settle, steps } = justUnfroze
      ? settleAfterRemoval(level, state.bodies, fixtures, [], false, true)
      : { settle: null, steps: [] };
    const stillFrozen = settle ? new Set(settle.locked.map((cell) => cellKey(cell.x, cell.y))) : frozenLocked;
    // Only the full-board settle above (`justUnfroze`) can have changed what
    // covers a hidden trigger — an ordinary NO_MATCH with nothing removed
    // and no settle leaves every cell exactly as it was.
    const { revealed, stillHidden } = settle
      ? revealHiddenFreezeTriggers(settle.bodies, state.hiddenFreezeTriggers)
      : { revealed: [] as SandFreezeTrigger[], stillHidden: state.hiddenFreezeTriggers };
    // Same reasoning as the hidden-trigger reveal just above, for
    // `hiddenKeys` — only the full-board settle above (`justUnfroze`) can
    // have changed what covers one.
    const { revealed: revealedKeys, stillHidden: stillHiddenKeys } = settle
      ? revealHiddenKeys(settle.bodies, state.hiddenKeys)
      : { revealed: [] as SandKey[], stillHidden: state.hiddenKeys };
    const missed = {
      ...state,
      ...(settle ? { bodies: settle.bodies, locked: settle.locked, keys: settle.keys, walls: settle.walls } : {}),
      ...spend(settle?.bodies ?? state.bodies, stillFrozen),
      keys: [...(settle?.keys ?? state.keys), ...revealedKeys],
      freezeTriggers: [...(settle?.freezeTriggers ?? nextFreezeTriggers), ...revealed],
      hiddenFreezeTriggers: stillHidden,
      hiddenKeys: stillHiddenKeys,
    };
    return { ...idle, state: withResult(level, missed), outcome: "NO_MATCH", hitBody, settle, steps };
  }
  const taken = new Set(removed.map((cell) => cellKey(cell.x, cell.y)));
  const left = state.bodies
    .map((body) => ({ ...body, cells: body.cells.filter((cell) => !taken.has(cellKey(cell.x, cell.y))) }))
    .filter((body) => body.cells.length);
  const fixtures: Fixtures = { ...fixturesOf(level, state), freezeTriggers: nextFreezeTriggers };
  const { settle, steps } = settleAfterRemoval(level, left, fixtures, removed, frozenThisShot, justUnfroze);
  const stillFrozen = new Set(settle.locked.map((cell) => cellKey(cell.x, cell.y)));
  // On request ("freeze bị che sau lớp cát" — a trigger buried under sand
  // reveals itself the instant every one of its own cells is uncovered):
  // this shot just removed sand and possibly cascaded more of it, so any
  // hidden trigger could have just lost its last covering grain.
  const { revealed, stillHidden } = revealHiddenFreezeTriggers(settle.bodies, state.hiddenFreezeTriggers);
  // Same reasoning as the hidden-trigger reveal just above, for `hiddenKeys`.
  const { revealed: revealedKeys, stillHidden: stillHiddenKeys } = revealHiddenKeys(settle.bodies, state.hiddenKeys);
  let sorted: SandGameState = {
    ...state,
    bodies: settle.bodies,
    ...spend(settle.bodies, stillFrozen),
    remainingCells: countCells(settle.bodies),
    locked: settle.locked,
    keys: [...settle.keys, ...revealedKeys],
    walls: settle.walls,
    freezeTriggers: [...settle.freezeTriggers, ...revealed],
    hiddenFreezeTriggers: stillHidden,
    hiddenKeys: stillHiddenKeys,
  };

  // A landed shot that spends the last bullet is allowed to sweep away a tiny
  // (`WIN_LENIENCY_FRACTION`) leftover along with whatever it actually hit,
  // rather than losing to it. Folded into `removed` below rather than just
  // deleted from the data: that is what puts these grains through the same
  // clear-flash-and-spray the shot's own hit gets, instead of having them
  // blink out of existence with nothing on screen to explain where they went.
  // Scoped to a shot that hit something on purpose — a `NO_MATCH` miss stays
  // a miss, since the engine's own miss animation has no clear beat to fold
  // this into.
  let forgiven: CellCoord[] = [];
  if (sorted.shotsUsed >= level.shotLimit && isForgivableLeftover(level, sorted.remainingCells)) {
    forgiven = sorted.bodies.flatMap((body) => body.cells);
    sorted = { ...sorted, bodies: [], locked: [], remainingCells: 0 };
  }

  return { state: withResult(level, sorted), outcome: "SORTED", hitBody, removed: [...removed, ...forgiven], settle, steps };
}
