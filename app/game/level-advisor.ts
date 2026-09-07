// Turns the numbers the editor already measures — the heuristic breakdown
// (`level-difficulty.ts`), the solver's verdict (`level-analysis.ts`), and
// this level's place in the difficulty curve next to its neighbours — into
// plain-language editing advice. Not a model call: every suggestion here
// traces back to one specific number crossing one specific, named threshold,
// so a suggestion can always be explained by pointing at the number that
// triggered it.
import type { LevelDraft } from "./level-drafts.ts";
import type { DifficultyResult } from "./level-difficulty.ts";
import type { LevelAnalysis } from "./level-analysis.ts";

export type SuggestionSeverity = "info" | "warning";

export type Suggestion = {
  /** Stable across re-renders of the same trigger, for React's `key`. */
  id: string;
  severity: SuggestionSeverity;
  text: string;
  /** Present only when the fix is a single field flip a button can make. */
  apply?: (draft: LevelDraft) => LevelDraft;
  applyLabel?: string;
};

/** Above this, a picture's colours read as scattered rather than solid blobs. */
const INTERLEAVING_THRESHOLD = 0.75;
/** Above this on *both* axes at once, radius and ammo are each near their tightest. */
const STACKED_TIGHT_THRESHOLD = 0.85;
/** Colour count reads as "many" past this heuristic share of the palette. */
const CROWDED_COLORS_THRESHOLD = 0.7;
/** Board reads as "small" below this heuristic share of the max board size. */
const SMALL_BOARD_THRESHOLD = 0.3;
/** A jump or drop in score past this, level to level, breaks a smooth ramp. */
const PROGRESSION_JUMP_THRESHOLD = 20;

export type AdviseLevelInput = {
  result: DifficultyResult;
  /** Null until "Measure difficulty" has actually been run for this level. */
  analysis: LevelAnalysis | null;
  /** This level's heuristic score minus the previous level's, in list order — null for the first level. */
  prevScore: number | null;
};

export function adviseLevel({ result, analysis, prevScore }: AdviseLevelInput): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (analysis?.verdict === "unclearable") {
    suggestions.push({
      id: "unclearable",
      severity: "warning",
      text: "Strong play couldn't clear this board at all — check that every locked colour has a "
        + "key that can actually reach it, and that no colour is fully boxed in by Wall Obstacles.",
    });
  }

  if (result.breakdown.interleaving > INTERLEAVING_THRESHOLD) {
    suggestions.push({
      id: "interleaving",
      severity: "warning",
      text: `This picture's colours are split into many small, separate patches `
        + `(${Math.round(result.breakdown.interleaving * 100)}% mixing) — if that wasn't deliberate, `
        + `merging same-colour cells into fewer solid blobs will read more clearly without touching the palette.`,
    });
  }

  if (
    result.breakdown.radius > STACKED_TIGHT_THRESHOLD
    && result.breakdown.ammo > STACKED_TIGHT_THRESHOLD
  ) {
    suggestions.push({
      id: "stacked-tight",
      severity: "warning",
      text: "Both the sorting radius and the shot budget are near their tightest here — stacking two "
        + "hard axes at once can feel unfair. Consider easing one of them.",
    });
  }

  if (
    result.breakdown.colors > CROWDED_COLORS_THRESHOLD
    && result.breakdown.size < SMALL_BOARD_THRESHOLD
  ) {
    suggestions.push({
      id: "crowded-colors",
      severity: "info",
      text: "Many colours are crammed onto a small board — a bigger frame (or one fewer colour) "
        + "would give each colour room to read.",
    });
  }

  if (prevScore !== null) {
    const delta = result.score - prevScore;
    if (delta > PROGRESSION_JUMP_THRESHOLD) {
      suggestions.push({
        id: "progression-up",
        severity: "warning",
        text: `This level jumps sharply in difficulty from the one before it (+${delta}) — consider `
          + `easing this one, or hardening the previous level, to keep the ramp smooth.`,
      });
    } else if (delta < -PROGRESSION_JUMP_THRESHOLD) {
      suggestions.push({
        id: "progression-down",
        severity: "info",
        text: `This level drops well below the one before it (${delta}) — fine as an intentional `
          + `breather, but worth confirming that's deliberate.`,
      });
    }
  }

  return suggestions;
}
