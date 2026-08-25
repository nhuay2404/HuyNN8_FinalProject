// Measuring a level instead of guessing at it.
//
// The shot budget IS the difficulty of a radius level, so picking a number for
// it by feel is picking the difficulty by feel. These two play models run
// against the real solver — the same `resolveShot` the game calls — and answer
// the only two questions that matter: how few shots does good play need, and
// does careless play actually lose?
//
// Both run at BLUEPRINT resolution, not the expanded pixel resolution. That is
// deliberate and sound: `expandLevelForPixelBoard` scales the picture and the
// disc by the same integer factor, so the disc covers the same fraction of the
// same picture and the puzzle is geometrically identical. Analysing the
// blueprint is a few hundred cells instead of a few thousand, which is what
// makes this fast enough to run interactively in the editor.

import { cellsInRadius, createSandGameState, currentAmmo, resolveShot } from "./sand-rules.ts";
import type { SandBody, SandColor, SandGameState, SandLevelConfig } from "./sand-types";

/** Every cell that holds sand, as a flat list — the only legal disc centres. */
function occupiedCells(bodies: SandBody[]) {
  return bodies.flatMap((body) => body.cells.map((cell) => ({ ...cell, body })));
}

/**
 * The disc that takes the most of the colour in hand.
 *
 * Centres are limited to cells that hold sand: a projectile can only ever
 * detonate where it hits a grain, so a disc centred on empty space is not a
 * shot the player could actually take.
 */
function bestShot(level: SandLevelConfig, state: SandGameState, color: SandColor) {
  let best: { x: number; y: number; bodyId: string; take: number } | null = null;
  for (const cell of occupiedCells(state.bodies)) {
    const take = cellsInRadius(state.bodies, cell, level.sortRadius, color).length;
    if (take > 0 && (!best || take > best.take)) {
      best = { x: cell.x, y: cell.y, bodyId: cell.body.id, take };
    }
  }
  return best;
}

export type PlayResult = {
  shots: number;
  won: boolean;
  /** Cells still on the board when the run ended. */
  remaining: number;
};

/**
 * Strong play: always the disc that takes the most.
 *
 * The shot count this returns is the floor a level can be cleared in by someone
 * reading the board well — the number a budget should sit comfortably above.
 */
export function playStrong(level: SandLevelConfig, shotCap = 200): PlayResult {
  let state = createSandGameState(level);
  let shots = 0;
  while (!state.result && shots < shotCap) {
    const color = currentAmmo(level, state);
    if (!color) break;
    const target = bestShot(level, state, color);
    if (!target) break;
    state = resolveShot(level, state, { bodyId: target.bodyId, x: target.x, y: target.y }).state;
    shots += 1;
  }
  return { shots, won: state.result?.kind === "WIN", remaining: state.remainingCells };
}

/**
 * Careless play: a random cell of the colour in hand, wherever it happens to be.
 *
 * Not a model of a bad player so much as a floor on effort — it still always
 * shoots the right colour. If this wins every time, the budget is decoration
 * rather than difficulty.
 */
export function playCareless(level: SandLevelConfig, seed: number, shotCap = 200): PlayResult {
  let random = seed;
  const next = () => ((random = (random * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let state = createSandGameState(level);
  let shots = 0;
  while (!state.result && shots < shotCap) {
    const color = currentAmmo(level, state);
    if (!color) break;
    const targets = state.bodies
      .filter((body) => body.color === color)
      .flatMap((body) => body.cells.map((cell) => ({ ...cell, bodyId: body.id })));
    if (!targets.length) break;
    const pick = targets[Math.floor(next() * targets.length)];
    state = resolveShot(level, state, { bodyId: pick.bodyId, x: pick.x, y: pick.y }).state;
    shots += 1;
  }
  return { shots, won: state.result?.kind === "WIN", remaining: state.remainingCells };
}

export type LevelAnalysis = {
  /** Shots a strong line needs, or null if it could not clear the board at all. */
  strongShots: number | null;
  /** Of `carelessRuns` sampled runs, how many cleared the frame inside the budget. */
  carelessWins: number;
  carelessRuns: number;
  /** Spare shots a strong line finishes with. Negative means the budget is impossible. */
  slack: number | null;
  /** A budget that leaves strong play the recommended slack. */
  suggestedShotLimit: number | null;
  verdict: "unclearable" | "too-easy" | "too-tight" | "good";
};

/** Slack a strong line should finish with: enough to misread a support once or twice. */
const RECOMMENDED_SLACK = 6;
const CARELESS_RUNS = 8;

export function analyseLevel(level: SandLevelConfig): LevelAnalysis {
  const strong = playStrong(level);
  const strongShots = strong.won ? strong.shots : null;

  let carelessWins = 0;
  for (let run = 0; run < CARELESS_RUNS; run += 1) {
    if (playCareless(level, run * 977 + 13).won) carelessWins += 1;
  }

  if (strongShots === null) {
    return {
      strongShots: null,
      carelessWins,
      carelessRuns: CARELESS_RUNS,
      slack: null,
      suggestedShotLimit: null,
      verdict: "unclearable",
    };
  }

  const slack = level.shotLimit - strongShots;
  const suggestedShotLimit = strongShots + RECOMMENDED_SLACK;
  const verdict = slack < 0
    ? "unclearable"
    : slack < 3
      ? "too-tight"
      : carelessWins === CARELESS_RUNS
        ? "too-easy"
        : "good";

  return { strongShots, carelessWins, carelessRuns: CARELESS_RUNS, slack, suggestedShotLimit, verdict };
}
