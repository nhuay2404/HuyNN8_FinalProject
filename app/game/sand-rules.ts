// The deterministic half of the game. No three.js, no DOM, no clock.
//
// Everything a shot does to the board is decided here and handed to the
// renderer as an ordered list of steps. That is what makes "cùng một state và
// cùng một shot phải cho cùng một kết quả" (§9) something the tests can prove
// rather than something the animation happens to do.

import type {
  CellCoord,
  SandBody,
  SandColor,
  SandFrame,
  SandGameState,
  SandLevelConfig,
  SettleOutcome,
  SettleStep,
} from "./sand-types";

/** The picture's alphabet. One letter per colour keeps an authored row readable. */
export const SAND_COLOR_BY_LETTER: Record<string, SandColor> = {
  R: "red",
  G: "green",
  Y: "yellow",
  B: "blue",
  P: "purple",
  O: "orange",
};

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
export type ParsedLevel = { bodies: SandBody[]; issues: LevelIssue[] };

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
      const color = SAND_COLOR_BY_LETTER[letter.toUpperCase()];
      if (!color) {
        issues.push({ severity: "error", message: `row ${index} column ${x}: "${letter}" is not a palette colour` });
        return;
      }
      if (y >= 0 && y < height && x < width) grid.set(cellKey(x, y), color);
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
  return { bodies, issues };
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
export function runGrainSettle(bodies: SandBody[], frame: SandFrame): SettleOutcome {
  const grid = new Map<string, SandColor>();
  for (const body of bodies) {
    for (const cell of body.cells) grid.set(cellKey(cell.x, cell.y), body.color);
  }

  const steps: SettleStep[] = [];
  for (let pass = 0; pass < frame.width * frame.height; pass += 1) {
    const moves: Array<{ from: CellCoord; to: CellCoord }> = [];
    for (let y = 1; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const from = cellKey(x, y);
        const color = grid.get(from);
        if (color === undefined) continue;

        let to: CellCoord | null = null;
        if (!grid.has(cellKey(x, y - 1))) {
          to = { x, y: y - 1 };
        } else {
          for (const dx of SLIDE_ORDER) {
            const nx = x + dx;
            if (nx < 0 || nx >= frame.width) continue;
            if (grid.has(cellKey(nx, y)) || grid.has(cellKey(nx, y - 1))) continue;
            to = { x: nx, y: y - 1 };
            break;
          }
        }
        if (!to) continue;

        grid.delete(from);
        grid.set(cellKey(to.x, to.y), color);
        moves.push({ from: { x, y }, to });
      }
    }
    if (!moves.length) break;
    steps.push({ kind: "GRAIN_PASS", moves });
  }

  const settled: SandBody[] = [];
  const claimed = new Set<string>();
  for (let y = frame.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const key = cellKey(x, y);
      const color = grid.get(key);
      if (color === undefined || claimed.has(key)) continue;
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
  return { bodies: settled, steps };
}

/** The cells a radius shot of `color` would sort out, centred on one cell. */
export function cellsInRadius(
  bodies: SandBody[],
  center: CellCoord,
  radius: number,
  color: SandColor,
) {
  const found: CellCoord[] = [];
  const limit = radius * radius;
  for (const body of bodies) {
    if (body.color !== color) continue;
    for (const cell of body.cells) {
      const dx = cell.x - center.x;
      const dy = cell.y - center.y;
      if (dx * dx + dy * dy <= limit) found.push({ x: cell.x, y: cell.y });
    }
  }
  return sortCells(found);
}

// ---- Game state ---------------------------------------------------------

export function createSandGameState(level: SandLevelConfig): SandGameState {
  const { bodies } = parseSandLevel(level);
  return {
    phase: "READY",
    bodies,
    queue: [...level.ammoQueue],
    shotsUsed: 0,
    remainingCells: countCells(bodies),
    result: null,
  };
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

/** Where a projectile landed: which body, and which cell of it. */
export type ShotHit = { bodyId: string; x: number; y: number };

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
function advanceQueue(queue: SandColor[], bodies: SandBody[]): SandColor[] {
  const [spent, ...rest] = queue;
  if (spent === undefined) return queue;
  const remaining = new Set(bodies.map((body) => body.color));
  const recycled = remaining.has(spent) ? [...rest, spent] : rest;
  return recycled.filter((color) => remaining.has(color));
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
function settleAfterRemoval(level: SandLevelConfig, bodies: SandBody[]) {
  const settle = runGrainSettle(bodies, level.frame);
  return { settle, steps: settle.steps };
}
/**
 * One shot, start to finish.
 *
 * `hit` is null when the projectile left the frame or struck the frame itself.
 * Under MISS_IS_FREE_TEMP that costs nothing, so a level can never be lost to a
 * slip of the thumb — §39.9, and reversible the day aiming is meant to carry
 * risk.
 */
export function resolveShot(
  level: SandLevelConfig,
  state: SandGameState,
  hit: ShotHit | null,
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

  const hitBody = hit ? state.bodies.find((body) => body.id === hit.bodyId) ?? null : null;
  if (!hit || !hitBody) return { ...idle, state: { ...state, phase: "READY" } };

  const spend = (bodies: SandBody[]): Pick<SandGameState, "queue" | "shotsUsed"> => ({
    queue: advanceQueue(state.queue, bodies),
    shotsUsed: state.shotsUsed + 1,
  });

  // A radius shot is aimed at a place, not at a region: it takes every matching
  // grain inside the disc, across as many bodies as the disc happens to touch,
  // and only the part of each that falls inside it. A shot that lands on sand
  // of the wrong colour is not a special case — the disc simply finds none of
  // its own colour in reach, and NO_MATCH covers it.
  const removed = cellsInRadius(state.bodies, { x: hit.x, y: hit.y }, level.sortRadius, ammo);
  if (!removed.length) {
    const missed = { ...state, ...spend(state.bodies) };
    return { ...idle, state: withResult(level, missed), outcome: "NO_MATCH", hitBody };
  }
  const taken = new Set(removed.map((cell) => cellKey(cell.x, cell.y)));
  const left = state.bodies
    .map((body) => ({ ...body, cells: body.cells.filter((cell) => !taken.has(cellKey(cell.x, cell.y))) }))
    .filter((body) => body.cells.length);
  const { settle, steps } = settleAfterRemoval(level, left);
  const sorted: SandGameState = {
    ...state,
    bodies: settle.bodies,
    ...spend(settle.bodies),
    remainingCells: countCells(settle.bodies),
  };
  return { state: withResult(level, sorted), outcome: "SORTED", hitBody, removed, settle, steps };
}
