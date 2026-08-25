// Data model for 3D Sand Cannon Sort.
//
// The split the concept insists on runs right through this file: everything
// here is grid logic on a single X/Y plane. Nothing in it knows that a cell is
// drawn as a pixel on a 2D canvas, and nothing in the renderer is allowed to
// decide what a cell *is*. Z exists in the scene for the frame, the cannon and
// perspective only — never as a second layer of puzzle.

/** Palette letters used by the authored picture: R G Y B P O — see SAND_COLOR_BY_LETTER. */
export type SandColor = "red" | "green" | "yellow" | "blue" | "purple" | "orange";

export const SAND_COLORS: readonly SandColor[] = [
  "red",
  "green",
  "yellow",
  "blue",
  "purple",
  "orange",
];

export type CellCoord = { x: number; y: number };

/**
 * One connected region of sand of a single colour.
 *
 * Under the radius rule a shot takes only the matching grains inside a disc,
 * so a body is not what a shot removes — it is the unit the settle solver and
 * the win check reason about, re-derived from the grid after every shot.
 */
export type SandBody = {
  id: string;
  color: SandColor;
  cells: CellCoord[];
};

/** x runs LEFT -> RIGHT, y runs BOTTOM -> TOP. y = 0 rests on the frame floor. */
export type SandFrame = {
  width: number;
  height: number;
};

/**
 * Every rule the radius gameplay fixes, in one place.
 *
 * These were once per-level switches, back when three different gameplays were
 * being compared side by side. Only the radius one survived, so they are all
 * constants now — but they are still named rather than inlined, because each
 * one is an answer to an Open Decision in `sand_cannon_concept.md` that the
 * designer has not finally signed off. Changing a design decision is changing
 * one line here, and a level file stays free of eight lines of boilerplate that
 * would be identical on every level.
 *
 * TODO(design): every `_TEMP` below is an Open Decision from PHẦN XI, not a
 * settled rule.
 */
export type RadiusGameplayPolicy = {
  /** Open Decision 1 & 2: edge contact only. Corner contact neither connects nor merges. */
  adjacencyMode: "ORTHOGONAL_4";
  /**
   * Open Decision 3, answered at the loose end: cohesion is dropped entirely
   * and the board settles grain by grain, the way a falling-sand toy does. The
   * radius rule punches holes through the middle of a region, and under a
   * cohesive solver the sand above a fresh hole hangs there as an arch — which
   * reads as a bug rather than as sand.
   */
  settlePolicy: "GRAIN_FALL_TEMP";
  /** Open Decision 4 & 5: a global rule, and left wins. */
  slideTieBreak: "LEFT_FIRST_TEMP";
  /** Open Decision 6 & 7: a shot that never touches sand costs nothing. */
  missAmmoPolicy: "MISS_IS_FREE_TEMP";
  /** Open Decision 12: authored data must never present a colour with no target. */
  deadBulletPolicy: "VALIDATOR_ONLY_TEMP";
  /**
   * A hit takes only the matching grains inside a disc around the impact, so
   * the question is *where* on a mass to bite rather than *which* mass.
   *
   * NOTE: this contradicts §5 of the concept document, which confirms that a
   * correct-colour hit clears the whole connected body and says outright that
   * it must not clear "một bán kính quanh impact". This is a deliberate,
   * signed-off departure to chase the market sand-sort feel — not an oversight.
   */
  shotRule: "RADIUS_SORT_TEMP";
  /**
   * A bullet whose colour still has sand anywhere goes back to the end of the
   * queue; a colour that has just been finished leaves the queue for good. So
   * ammo is never the pressure and a dead bullet can never be handed out —
   * `shotLimit` is the whole budget.
   */
  ammoRule: "CYCLE_UNTIL_COLOR_CLEARED_TEMP";
  /** Open Decision 9. Three is enough to plan two turns out without a spreadsheet. */
  nextPreviewCount: number;
  /** §20: the cannon keeps the pre-pivot prototype's control and ballistics. */
  cannonConfigRef: string;
};

/** The one policy every level in this build runs under. */
export const RADIUS_GAMEPLAY: RadiusGameplayPolicy = {
  adjacencyMode: "ORTHOGONAL_4",
  settlePolicy: "GRAIN_FALL_TEMP",
  slideTieBreak: "LEFT_FIRST_TEMP",
  missAmmoPolicy: "MISS_IS_FREE_TEMP",
  deadBulletPolicy: "VALIDATOR_ONLY_TEMP",
  shotRule: "RADIUS_SORT_TEMP",
  ammoRule: "CYCLE_UNTIL_COLOR_CLEARED_TEMP",
  nextPreviewCount: 3,
  cannonConfigRef: "prototype-classic-cannon",
};

/**
 * A level is the policy above plus its own content — the picture, the wheel of
 * colours, the reach of a shot and the budget. That is all an author writes,
 * and all the level editor produces.
 */
export type SandLevelConfig = RadiusGameplayPolicy & {
  id: number;
  name: string;
  frame: SandFrame;
  /** Rows top-first, one letter per cell, `.` for empty. Bodies are the connected components. */
  rows: string[];
  /**
   * The starting rotation only. Under the cycling rule this list is a wheel,
   * not a budget: colours come round again until they are gone.
   *
   * Every colour in the picture must appear here or it can never be shot at,
   * and every colour here must appear in the picture or the opening bullet has
   * no target. The level editor enforces both.
   */
  ammoQueue: SandColor[];
  /** Radius of the sorting disc, in blueprint cells. Scaled with the board. */
  sortRadius: number;
  /** Total shots allowed. This is where the difficulty of a level lives. */
  shotLimit: number;
  /**
   * How many simulation pixels one authored blueprint cell expands into, in
   * both axes. The board that ships is a real 2D pixel canvas, and this is
   * its only resolution knob — everything is authored at a small, readable
   * blueprint size and expanded once at load, via `expandLevelForPixelBoard`.
   *
   * Uniform integer upscaling cannot change the puzzle: a blueprint region
   * becomes a solid pixelScale×pixelScale block of the same colour, so body
   * count, adjacency and merges are identical in kind, just built of more,
   * smaller pixels. `sortRadius` is expressed in blueprint cells and is scaled
   * by this factor along with everything else, so its reach stays the same
   * fraction of the picture.
   */
  pixelScale: number;
  notes?: string;
};

export type SandPhase =
  | "READY"
  | "PROJECTILE_FLYING"
  | "HIT_RESOLUTION"
  | "SETTLING"
  | "MERGING"
  | "WIN"
  | "FAIL";

export type SandResult = null | { kind: "WIN" } | { kind: "FAIL"; reason: "OUT_OF_SHOTS" };

export type SandGameState = {
  phase: SandPhase;
  bodies: SandBody[];
  /**
   * The bullets still to come, front first.
   *
   * A list rather than an index into the level, because a spent bullet can come
   * back to the end of it and a finished colour leaves it altogether.
   */
  queue: SandColor[];
  /** Bullets spent. Against `shotLimit`, this is the number that matters. */
  shotsUsed: number;
  /** Cells still in the frame. Win is this reaching zero. */
  remainingCells: number;
  result: SandResult;
};

/**
 * One atomic thing the board does while settling.
 *
 * The solver returns these as an ordered list instead of only a final board,
 * because §24 asks for sand that flows rather than teleports: the renderer
 * replays the same steps the logic took, so what the player watches is the
 * actual resolution and not an animation invented alongside it.
 */
export type SettleStep =
  /**
   * One pass of grain-by-grain settling: every grain that could move this tick,
   * moved. Batched into a single step on purpose — a column draining fourteen
   * rows should be fourteen beats of sand pouring, not two hundred separate
   * nudges. The moves are ordered, and replaying them in order is what
   * reproduces the pass.
   */
  | { kind: "GRAIN_PASS"; moves: Array<{ from: CellCoord; to: CellCoord }> }
  /**
   * Re-labels which body each cell belongs to, and moves nothing.
   *
   * Bodies are re-derived from the settled grid, so the labels only become true
   * once the pouring is over. The renderer is told once, at the end.
   */
  | { kind: "REINDEX"; assignment: Array<{ x: number; y: number; bodyId: string }> };

export type SettleOutcome = {
  bodies: SandBody[];
  steps: SettleStep[];
};
