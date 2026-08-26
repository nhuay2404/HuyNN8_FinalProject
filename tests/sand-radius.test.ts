import assert from "node:assert/strict";
import test from "node:test";
import { sandBloom } from "../app/game/sand-levels.ts";
import {
  ammoRemaining,
  cellKey,
  cellsInRadius,
  countCells,
  createSandGameState,
  currentAmmo,
  findSplitBodies,
  isConnected,
  parseSandLevel,
  resolveShot,
  runGrainSettle,
} from "../app/game/sand-rules.ts";
import type { SandBody, SandColor, SandGameState } from "../app/game/sand-types.ts";

const LEVEL = sandBloom;
const RADIUS = LEVEL.sortRadius!;
const { bodies: START } = parseSandLevel(LEVEL);

function boardKey(bodies: SandBody[]) {
  return bodies
    .map((body) => `${body.color}:${body.cells.map((c) => `${c.x},${c.y}`).sort().join("|")}`)
    .sort()
    .join(";");
}

function colorGrid(bodies: SandBody[]) {
  const grid = new Map<string, SandColor>();
  for (const body of bodies) for (const cell of body.cells) grid.set(cellKey(cell.x, cell.y), body.color);
  return grid;
}

function ownerOf(bodies: SandBody[], x: number, y: number) {
  return bodies.find((body) => body.cells.some((cell) => cell.x === x && cell.y === y));
}

/** Aim the disc that takes the most of the bullet in hand. A strong player's line. */
function bestShot(state: SandGameState, color: SandColor) {
  // Centres are limited to cells that hold sand. Empty air inside the frame is
  // a legal centre too (see the empty-air test below), but landing on a grain
  // of the colour in hand is what a strong line does, so that is what this
  // model plays.
  let best: { x: number; y: number; take: number } | null = null;
  for (const body of state.bodies) {
    for (const cell of body.cells) {
      const take = cellsInRadius(state.bodies, cell, RADIUS, color).length;
      if (take > 0 && (!best || take > best.take)) best = { x: cell.x, y: cell.y, take };
    }
  }
  return best;
}

function playGreedy() {
  let state = createSandGameState(LEVEL);
  const turns: Array<{ color: SandColor; took: number; queue: SandColor[] }> = [];
  while (!state.result && turns.length < 200) {
    const color = currentAmmo(LEVEL, state)!;
    const target = bestShot(state, color);
    if (!target) break;
    const owner = ownerOf(state.bodies, target.x, target.y)!;
    const resolution = resolveShot(LEVEL, state, { bodyId: owner.id, x: target.x, y: target.y });
    turns.push({ color, took: resolution.removed.length, queue: [...resolution.state.queue] });
    state = resolution.state;
  }
  return { state, turns };
}

// ---- the picture ---------------------------------------------------------

test("the level parses into the picture that was drawn, and fills the frame", () => {
  const { issues } = parseSandLevel(LEVEL);
  assert.deepEqual(issues, []);
  assert.equal(LEVEL.rows.length, LEVEL.frame.height);
  for (const row of LEVEL.rows) assert.equal(row.length, LEVEL.frame.width);
  assert.equal(countCells(START), LEVEL.frame.width * LEVEL.frame.height);
  assert.equal(new Set(START.map((body) => body.color)).size, 4);
});

test("the opening board is already settled, so the drawing is what the player sees", () => {
  // runGrainSettle always closes with one bookkeeping REINDEX, even when nothing
  // moved, so "already at rest" means no GRAIN_PASS was needed.
  assert.ok(runGrainSettle(START, LEVEL.frame).steps.every((step) => step.kind !== "GRAIN_PASS"));
});

test("the level is wired to the radius rules, not the whole-body ones", () => {
  assert.equal(LEVEL.shotRule, "RADIUS_SORT_TEMP");
  assert.equal(LEVEL.ammoRule, "CYCLE_UNTIL_COLOR_CLEARED_TEMP");
  assert.ok(LEVEL.shotLimit !== null, "difficulty is the shot budget, so there has to be one");
  assert.ok(RADIUS > 0);
});

// ---- what a radius shot takes --------------------------------------------

test("the disc holds every matching cell inside it and nothing outside it", () => {
  const grid = colorGrid(START);
  const center = { x: 5, y: 8 };
  const taken = cellsInRadius(START, center, RADIUS, "blue");
  const takenKeys = new Set(taken.map((cell) => cellKey(cell.x, cell.y)));
  for (const cell of taken) {
    assert.equal(grid.get(cellKey(cell.x, cell.y)), "blue", "the disc took a cell of the wrong colour");
    const distance = Math.hypot(cell.x - center.x, cell.y - center.y);
    assert.ok(distance <= RADIUS + 1e-9, `took a cell ${distance.toFixed(2)} away, radius is ${RADIUS}`);
  }
  for (const [key, color] of grid) {
    if (color !== "blue" || takenKeys.has(key)) continue;
    const [x, y] = key.split(",").map(Number);
    assert.ok(
      Math.hypot(x - center.x, y - center.y) > RADIUS,
      `left a Blue cell at ${key} that was inside the disc`,
    );
  }
});

test("a shot takes part of a region, not the whole of it", () => {
  const state = createSandGameState(LEVEL);
  const color = currentAmmo(LEVEL, state)!;
  const target = bestShot(state, color)!;
  const owner = ownerOf(state.bodies, target.x, target.y)!;
  const resolution = resolveShot(LEVEL, state, { bodyId: owner.id, x: target.x, y: target.y });
  assert.equal(resolution.outcome, "SORTED");
  assert.ok(resolution.removed.length > 0);
  assert.ok(
    resolution.removed.length < owner.cells.length,
    "under the radius rule a single shot must not be able to take a whole region",
  );
  assert.equal(resolution.state.remainingCells, state.remainingCells - resolution.removed.length);
});

test("the disc reaches across regions, taking matching cells from each", () => {
  // Two Green blobs sit either side of the bloom's rim; a disc between them
  // takes from both, which a whole-body shot could never do.
  const state = createSandGameState(LEVEL);
  let found = false;
  for (let y = 0; y < LEVEL.frame.height && !found; y += 1) {
    for (let x = 0; x < LEVEL.frame.width && !found; x += 1) {
      const taken = cellsInRadius(state.bodies, { x, y }, RADIUS, "green");
      if (!taken.length) continue;
      const owners = new Set(taken.map((cell) => ownerOf(state.bodies, cell.x, cell.y)!.id));
      if (owners.size > 1) found = true;
    }
  }
  assert.ok(found, "no disc on this board reaches two separate regions of one colour");
});

test("a shot that finds none of its colour in range still costs a shot and moves no sand", () => {
  const state = createSandGameState(LEVEL);
  const ammo = currentAmmo(LEVEL, state)!;
  // The bottom corner is solid Orange, so an opening Blue bullet finds nothing.
  const corner = ownerOf(state.bodies, 0, 0)!;
  assert.notEqual(corner.color, ammo);
  const resolution = resolveShot(LEVEL, state, { bodyId: corner.id, x: 0, y: 0 });
  assert.equal(resolution.outcome, "NO_MATCH");
  assert.deepEqual(resolution.removed, []);
  assert.equal(boardKey(resolution.state.bodies), boardKey(state.bodies));
  assert.equal(resolution.state.shotsUsed, 1, "a dud still comes out of the budget");
});

test("a shot into empty air inside the frame still sorts what the disc reaches", () => {
  // One shot first: this level starts with a full frame, and the gap over the
  // pile — the place this test is about — only exists once sand has come out.
  const opening = createSandGameState(LEVEL);
  const first = bestShot(opening, currentAmmo(LEVEL, opening)!)!;
  const state = resolveShot(LEVEL, opening, {
    bodyId: ownerOf(opening.bodies, first.x, first.y)!.id,
    x: first.x,
    y: first.y,
  }).state;
  const ammo = currentAmmo(LEVEL, state)!;
  const filled = new Set(state.bodies.flatMap((body) => body.cells.map((cell) => cellKey(cell.x, cell.y))));
  // Somewhere over the pile: no sand under the crosshair, but the colour in
  // hand within the disc. That is the shot the ring promises and it has to pay.
  let air: { x: number; y: number } | null = null;
  for (let y = LEVEL.frame.height - 1; y >= 0 && !air; y -= 1) {
    for (let x = 0; x < LEVEL.frame.width; x += 1) {
      if (filled.has(cellKey(x, y))) continue;
      if (!cellsInRadius(state.bodies, { x, y }, RADIUS, ammo).length) continue;
      air = { x, y };
      break;
    }
  }
  assert.ok(air, "no empty square has the colour in hand in reach");

  const expected = cellsInRadius(state.bodies, air, RADIUS, ammo);
  const resolution = resolveShot(LEVEL, state, { bodyId: null, x: air.x, y: air.y });
  assert.equal(resolution.outcome, "SORTED");
  assert.equal(resolution.hitBody, null, "there was no body under the impact, and the result says so");
  assert.deepEqual(resolution.removed, expected, "the disc takes exactly what it reaches from that place");
  assert.equal(resolution.state.shotsUsed, state.shotsUsed + 1);
});

test("a shot that reaches no sand at all costs nothing", () => {
  const state = createSandGameState(LEVEL);
  const resolution = resolveShot(LEVEL, state, null);
  assert.equal(resolution.outcome, "MISS");
  assert.equal(resolution.state.shotsUsed, 0);
});

// ---- what the board does afterwards --------------------------------------

test("a shot that cuts a region in two leaves two whole bodies, and says so", () => {
  const state = createSandGameState(LEVEL);
  // The bloom is one wide Blue mass; a disc through its waist parts it.
  const bloom = state.bodies.find((body) => body.color === "blue")!;
  const resolution = resolveShot(LEVEL, state, { bodyId: bloom.id, x: 5, y: 9 });
  assert.equal(resolution.outcome, "SORTED");
  assert.deepEqual(findSplitBodies(resolution.state.bodies), []);
  for (const body of resolution.state.bodies) assert.ok(isConnected(body.cells), `${body.id} is in pieces`);
  assert.ok(
    resolution.steps.some((step) => step.kind === "GRAIN_PASS"),
    "the sand above the hole has to pour into it",
  );
  assert.equal(
    resolution.steps.at(-1)?.kind,
    "REINDEX",
    "the new body labels are only true once the pouring is over, so they come last",
  );
});

test("every body is whole after every shot of a full playthrough", () => {
  const { turns, state } = playGreedy();
  assert.ok(turns.length > 0);
  assert.deepEqual(findSplitBodies(state.bodies), []);

  let live = createSandGameState(LEVEL);
  while (!live.result) {
    const color = currentAmmo(LEVEL, live)!;
    const target = bestShot(live, color);
    if (!target) break;
    const owner = ownerOf(live.bodies, target.x, target.y)!;
    const resolution = resolveShot(LEVEL, live, { bodyId: owner.id, x: target.x, y: target.y });
    assert.deepEqual(findSplitBodies(resolution.state.bodies), [], "a shot left a body in pieces");
    for (const body of resolution.state.bodies) {
      for (const cell of body.cells) {
        assert.ok(cell.x >= 0 && cell.x < LEVEL.frame.width, "a cell left the frame sideways");
        assert.ok(cell.y >= 0 && cell.y < LEVEL.frame.height, "a cell left the frame vertically");
      }
    }
    live = resolution.state;
  }
});

test("the same board and the same shot resolve identically, twice", () => {
  const state = createSandGameState(LEVEL);
  const bloom = state.bodies.find((body) => body.color === "blue")!;
  const hit = { bodyId: bloom.id, x: 5, y: 9 };
  const first = resolveShot(LEVEL, state, hit);
  const second = resolveShot(LEVEL, state, hit);
  assert.equal(boardKey(first.state.bodies), boardKey(second.state.bodies));
  assert.deepEqual(first.steps, second.steps);
  assert.deepEqual(first.removed, second.removed);
});

/**
 * The renderer animates the step list — REINDEX included. If replaying it by
 * hand did not land on the same board, the grains would end up labelled as
 * bodies they are not part of, and the next fall would move the wrong ones.
 */
test("replaying the step list by hand reproduces the settled board", () => {
  const state = createSandGameState(LEVEL);
  const bloom = state.bodies.find((body) => body.color === "blue")!;
  const resolution = resolveShot(LEVEL, state, { bodyId: bloom.id, x: 5, y: 9 });

  const taken = new Set(resolution.removed.map((cell) => cellKey(cell.x, cell.y)));
  const live = new Map<string, { x: number; y: number; bodyId: string; color: SandColor }>();
  for (const body of state.bodies) {
    for (const cell of body.cells) {
      const key = cellKey(cell.x, cell.y);
      if (taken.has(key)) continue;
      live.set(key, { x: cell.x, y: cell.y, bodyId: body.id, color: body.color });
    }
  }

  for (const step of resolution.steps) {
    if (step.kind === "REINDEX") {
      for (const entry of step.assignment) {
        const cell = live.get(cellKey(entry.x, entry.y));
        assert.ok(cell, "a REINDEX step named a cell that is not on the board");
        cell.bodyId = entry.bodyId;
      }
      continue;
    }
    for (const move of step.moves) {
      const cell = live.get(cellKey(move.from.x, move.from.y));
      assert.ok(cell, "a GRAIN_PASS move named a cell that is not on the board");
      live.delete(cellKey(move.from.x, move.from.y));
      cell.x = move.to.x;
      cell.y = move.to.y;
      live.set(cellKey(cell.x, cell.y), cell);
    }
  }

  const rebuilt = new Map<string, SandBody>();
  for (const cell of live.values()) {
    const body = rebuilt.get(cell.bodyId) ?? { id: cell.bodyId, color: cell.color, cells: [] };
    body.cells.push({ x: cell.x, y: cell.y });
    rebuilt.set(cell.bodyId, body);
  }
  assert.equal(boardKey([...rebuilt.values()]), boardKey(resolution.state.bodies));
});

test("settling re-derives bodies, so a region cut in two comes back as two", () => {
  // Nothing here can move — the pieces already rest on the floor — so what is
  // being checked is purely the relabelling the settle does at the end.
  const cut: SandBody = {
    id: "blue-cut",
    color: "blue",
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }],
  };
  const settled = runGrainSettle([cut], { width: 6, height: 2 });
  assert.equal(settled.bodies.length, 2, "two separated halves are two bodies");
  for (const body of settled.bodies) assert.ok(isConnected(body.cells));
  assert.deepEqual(findSplitBodies(settled.bodies), []);

  const whole = runGrainSettle(START, LEVEL.frame);
  assert.equal(boardKey(whole.bodies), boardKey(START), "a board already at rest comes back unchanged");
});

// ---- the cycling queue ---------------------------------------------------

test("a bullet whose colour is still on the board goes to the back of the queue", () => {
  const state = createSandGameState(LEVEL);
  const color = currentAmmo(LEVEL, state)!;
  const target = bestShot(state, color)!;
  const owner = ownerOf(state.bodies, target.x, target.y)!;
  const after = resolveShot(LEVEL, state, { bodyId: owner.id, x: target.x, y: target.y }).state;
  assert.equal(after.queue.at(-1), color, "the spent colour should be waiting at the end");
  assert.equal(after.queue.length, state.queue.length, "nothing is finished yet, so nothing leaves the wheel");
  assert.equal(after.queue[0], state.queue[1], "and the next bullet steps up");
});

test("a colour that has just been finished leaves the queue for good", () => {
  const { turns, state } = playGreedy();
  assert.equal(state.result?.kind, "WIN");
  assert.deepEqual(state.queue, [], "an empty board means every colour has left the wheel");

  // Somewhere along the run a colour ran out; from that turn on it is gone.
  const shrinks = turns.filter((turn, index) => index > 0 && turn.queue.length < turns[index - 1].queue.length);
  assert.ok(shrinks.length >= 3, "with four colours, at least three should drop out before the last one");
  for (const turn of turns) {
    assert.equal(new Set(turn.queue).size, turn.queue.length, "a colour must not sit in the wheel twice");
  }
});

test("the queue never hands out a bullet with nothing left to shoot — §39.3", () => {
  let state = createSandGameState(LEVEL);
  while (!state.result) {
    const color = currentAmmo(LEVEL, state)!;
    assert.ok(
      state.bodies.some((body) => body.color === color),
      `the wheel offered ${color} with none of it on the board`,
    );
    const target = bestShot(state, color);
    assert.ok(target, `${color} is on the board but no disc reaches it`);
    const owner = ownerOf(state.bodies, target.x, target.y)!;
    state = resolveShot(LEVEL, state, { bodyId: owner.id, x: target.x, y: target.y }).state;
  }
});

// ---- difficulty is the shot budget ---------------------------------------

test("the budget is the loss condition, and it is reached only after the last shot settles", () => {
  // Burn the whole budget on the frame's Orange floor with the wrong bullets
  // where possible; whatever happens, the run must end on the budget.
  let state = createSandGameState(LEVEL);
  for (let shot = 0; shot < LEVEL.shotLimit!; shot += 1) {
    assert.equal(state.result, null, `the run ended early, at shot ${shot + 1}`);
    const color = currentAmmo(LEVEL, state)!;
    const cell = state.bodies.flatMap((body) => (body.color === color ? [] : body.cells))[0];
    const owner = ownerOf(state.bodies, cell.x, cell.y)!;
    state = resolveShot(LEVEL, state, { bodyId: owner.id, x: cell.x, y: cell.y }).state;
  }
  assert.deepEqual(state.result, { kind: "FAIL", reason: "OUT_OF_SHOTS" });
  assert.equal(state.phase, "FAIL");
  assert.equal(ammoRemaining(LEVEL, state), 0);
});

test("strong play clears the frame with shots to spare", () => {
  const { state, turns } = playGreedy();
  assert.equal(state.result?.kind, "WIN");
  assert.equal(state.remainingCells, 0);
  assert.ok(
    turns.length <= LEVEL.shotLimit! - 3,
    `a strong line needs ${turns.length} of ${LEVEL.shotLimit} shots — no room to misplay`,
  );
});

test("the budget is tight enough that careless play loses", () => {
  // Aim at a random cell of the colour in hand instead of the best disc. If
  // this always wins, the shot limit is decoration rather than difficulty.
  const run = (seed: number) => {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let state = createSandGameState(LEVEL);
    while (!state.result) {
      const color = currentAmmo(LEVEL, state)!;
      const targets = state.bodies.filter((body) => body.color === color).flatMap((body) => body.cells);
      if (!targets.length) break;
      const cell = targets[Math.floor(rnd() * targets.length)];
      const owner = ownerOf(state.bodies, cell.x, cell.y)!;
      state = resolveShot(LEVEL, state, { bodyId: owner.id, x: cell.x, y: cell.y }).state;
    }
    return state.result?.kind === "WIN";
  };
  const wins = Array.from({ length: 12 }, (_, index) => run(index * 977 + 13)).filter(Boolean).length;
  assert.ok(wins >= 2, `careless play won ${wins}/12 — the level is unfair, not hard`);
  assert.ok(wins <= 11, `careless play won ${wins}/12 — the shot budget is not doing any work`);
});
