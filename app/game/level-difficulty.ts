// A cheap, heuristic difficulty score for the editor's level list — NOT the
// solver-backed "Measure difficulty" panel (`level-analysis.ts`), which plays
// the real strong/careless models but only makes sense to run one level at a
// time (it is not free). This one scores every draft off its authored shape
// alone, so the whole list can be ranked at a glance without running the game
// against any of them.
//
// Five criteria, equally weighted, each folded to 0–1 before they are
// averaged — the author's own list of what makes a board harder:
//   - how big the board is
//   - how many colours are in play
//   - how interleaved those colours are (one clean blob per colour vs.
//     scattered into many separate regions)
//   - how tight the shot budget is against the amount of picture to clear
//   - how small the sorting radius is relative to the board

// Value imports carry the ".ts" extension — this file is now reachable from
// `node --test` too (via `economy.ts` -> `sand-rules.ts`), which resolves
// relative specifiers exactly as given rather than guessing at extensions.
import { draftToLevel, MAX_HEIGHT, MAX_WIDTH } from "./level-drafts.ts";
import { parseSandLevel } from "./sand-rules.ts";
import { SAND_COLORS } from "./sand-types.ts";
import type { LevelDraft } from "./level-drafts.ts";
import type { SandLevelConfig } from "./sand-types.ts";

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Regions-per-colour past this point counts as maximally interleaved.
 * 1 region/colour (every colour drawn as one solid blob) is the floor at 0;
 * this is the ceiling, past which more fragmentation stops adding difficulty.
 */
const INTERLEAVE_CAP = 6;

/** Shots-per-region at or below this reads as the tightest budget there is. */
const AMMO_TIGHT_RATIO = 1;
/** Shots-per-region at or above this reads as fully generous — 0 difficulty. */
const AMMO_COMFORT_RATIO = 4;

/**
 * Radius-to-board-span ratio at or above this reads as fully generous.
 * A disc a third of the board's shorter side across already reaches most of
 * a typical region in one bite.
 */
const RADIUS_COMFORT_RATIO = 0.35;

export type DifficultyBreakdown = {
  /** Bigger board. */
  size: number;
  /** More colours in the picture. */
  colors: number;
  /** Those colours split into more separate regions instead of solid blobs. */
  interleaving: number;
  /** Fewer shots than the picture's regions call for. */
  ammo: number;
  /** A sorting disc that is a small fraction of the board. */
  radius: number;
};

export type DifficultyLabel = "easy" | "medium" | "hard" | "very-hard";

export type DifficultyResult = {
  /** 0–100, the five factors above averaged and rounded. */
  score: number;
  breakdown: DifficultyBreakdown;
  label: DifficultyLabel;
};

export function difficultyLabel(score: number): DifficultyLabel {
  if (score < 25) return "easy";
  if (score < 50) return "medium";
  if (score < 75) return "hard";
  return "very-hard";
}

/**
 * Score any playable level shape against the five criteria above.
 *
 * Reads the picture through `parseSandLevel` — the same 4-connected body
 * split the game itself plays under — so "how interleaved" means exactly
 * what it would mean once this level is shot at, not a separate guess at it.
 * Safe on a draft mid-edit: `parseSandLevel` records shape problems as
 * issues rather than throwing, so a temporarily malformed picture still
 * scores something rather than breaking the list.
 *
 * Takes a `SandLevelConfig` directly rather than a `LevelDraft` — the shared
 * core both `computeDifficulty` (editor drafts) and the gold-reward formula
 * (`economy.ts`, shipped levels) score against, so a level scores the same
 * whether it is still being drawn or already playable. Width/height come
 * from `level.frame` rather than a draft's own fields, everything else is
 * read straight off the level.
 */
export function computeLevelDifficulty(level: SandLevelConfig): DifficultyResult {
  const { bodies } = parseSandLevel(level);
  const colorCount = new Set(bodies.map((body) => body.color)).size;
  const regionCount = bodies.length;

  const size = clamp01((level.frame.width * level.frame.height) / (MAX_WIDTH * MAX_HEIGHT));
  const colors = clamp01(colorCount / SAND_COLORS.length);

  const bodiesPerColor = colorCount > 0 ? regionCount / colorCount : 1;
  const interleaving = clamp01((bodiesPerColor - 1) / (INTERLEAVE_CAP - 1));

  const shotsPerRegion = level.shotLimit / Math.max(1, regionCount);
  const ammo = clamp01(
    (AMMO_COMFORT_RATIO - shotsPerRegion) / (AMMO_COMFORT_RATIO - AMMO_TIGHT_RATIO),
  );

  const boardSpan = Math.max(1, Math.min(level.frame.width, level.frame.height));
  const radiusRatio = level.sortRadius / boardSpan;
  const radius = clamp01(1 - radiusRatio / RADIUS_COMFORT_RATIO);

  const breakdown: DifficultyBreakdown = { size, colors, interleaving, ammo, radius };
  const score = Math.round(
    ((breakdown.size + breakdown.colors + breakdown.interleaving + breakdown.ammo + breakdown.radius) / 5) * 100,
  );
  return { score, breakdown, label: difficultyLabel(score) };
}

/** Score one editor draft — joins it to `RADIUS_GAMEPLAY` first (`draftToLevel`), since a draft alone is not a playable shape. */
export function computeDifficulty(draft: LevelDraft): DifficultyResult {
  return computeLevelDifficulty(draftToLevel(draft, 0));
}
