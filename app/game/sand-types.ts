// Data model for 3D Sand Cannon Sort.
//
// The split the concept insists on runs right through this file: everything
// here is grid logic on a single X/Y plane. Nothing in it knows that a cell is
// drawn as a pixel on a 2D canvas, and nothing in the renderer is allowed to
// decide what a cell *is*. Z exists in the scene for the frame, the cannon and
// perspective only — never as a second layer of puzzle.

/**
 * Palette letters used by the authored picture: R G Y B P O C M L N.
 *
 * The same letter in lower case is that colour LOCKED, and `K` is a key cell —
 * see `SAND_COLOR_BY_LETTER` and `KEY_LETTER`. Both survive
 * `expandLevelForPixelBoard` untouched, because expansion only ever repeats
 * letters.
 */
export type SandColor =
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "purple"
  | "orange"
  | "cyan"
  | "pink"
  | "lime"
  | "brown";

export const SAND_COLORS: readonly SandColor[] = [
  "red",
  "green",
  "yellow",
  "blue",
  "purple",
  "orange",
  "cyan",
  "pink",
  "lime",
  "brown",
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

// ---- boosters -------------------------------------------------------------
// See booster-radius-prism-spec.md. Two one-shot buffs the player arms ahead
// of a shot; the shot itself is unaware of them beyond the extra argument
// `resolveShot` takes — everything else about a boosted shot is normal.

/**
 * The two booster kinds. Mutually exclusive by design (spec §3): a session
 * only ever has at most one of these armed at a time, never both.
 */
export type BoosterType = "radiusOvercharge" | "prismShot";

export const BOOSTER_TYPES: readonly BoosterType[] = ["radiusOvercharge", "prismShot"];

/**
 * A key, as the rigid pixel sprite it is drawn as.
 *
 * Keys do not settle grain by grain the way sand does. A key that scattered
 * into its own pixels the first time it fell would stop reading as an object,
 * and the mechanic is about an object arriving somewhere — so the whole shape
 * moves or nothing does.
 */
export type SandKey = {
  id: string;
  cells: CellCoord[];
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
  /** Open Decision 9. Two is enough to plan the next turn without crowding the HUD. */
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
  nextPreviewCount: 2,
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
   * Declares the level's wheel of colours — not a fixed opening order. The
   * queue a player actually sees is drawn at random (`fillQueue`/`drawAmmo`
   * in sand-rules.ts), never from this list's order directly.
   *
   * Every colour in the picture must appear here or it can never be shot at,
   * and every colour here must appear in the picture or nothing is ever there
   * to draw. The level editor enforces both.
   */
  ammoQueue: SandColor[];
  /** Radius of the sorting disc, in blueprint cells. Scaled with the board. */
  sortRadius: number;
  /**
   * Total shots allowed. This is where the difficulty of a level lives.
   *
   * `Infinity` is the sanctioned way to author "no limit" — every runtime
   * check (`withResult`'s fail condition, `ammoRemaining`'s countdown) is
   * ordinary arithmetic against this field, and a real number can never
   * reach or exceed `Infinity`, so the fail branch simply never fires. The
   * HUD (`SandGame.tsx`) renders that case as "∞" rather than the literal
   * word "Infinity".
   */
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
  /**
   * How strongly a key resists rolling sideways, 0–1. Absent or 0 rolls the
   * instant a slope offers it a way down; 1 waits several settle passes
   * between rolls, which reads as heavier. Only sideways movement is
   * slowed — a key still falls straight down at full speed, the way real
   * friction only ever acts along a contact surface, never against gravity
   * itself.
   */
  keyFriction?: number;
  /**
   * Boosters this level cannot be cleared without — spec §5. A hard level
   * (chương 4–5) may need a shot with `radiusOvercharge` or `prismShot` armed
   * as the load-bearing move, not just as help.
   *
   * Nothing reads this yet: this build has no brute-force solvability check
   * to exempt (see CHANGELOG-prototype.md §16 for the rule this would have
   * overridden) — it is a data flag only, ready for a future solver/validator
   * to widen its search with rather than misreport the level as unsolvable.
   */
  requiresBooster?: BoosterType[];
  notes?: string;
  /**
   * The first-time-user overlay shown once, the first time this level is
   * opened from the home screen. `title` is the one-line lesson the level
   * teaches; `steps` are read top to bottom as short, concrete instructions
   * rather than lore. Absent on a level that introduces nothing new.
   *
   * Seen-state lives in the browser (`sand-cannon:v1:tutorials-seen`), keyed
   * by `id`, so it is shown again if the level's id ever changes — which is
   * the right failure mode: a renumbered level is, as far as a returning
   * player's local storage is concerned, a level they have not opened yet.
   */
  tutorial?: {
    title: string;
    steps: string[];
  };
  /**
   * The gesture-taught FTUE, for a level whose one and only lesson is "drag to
   * aim, release to fire" — mutually exclusive with `tutorial` in spirit (a
   * level should not need both a wall-of-text overlay and a show-don't-tell
   * one), though nothing enforces that.
   *
   * Unlike `tutorial`, this is not a modal the player reads and dismisses: it
   * draws a looping hand/drag glyph directly over the joystick pad — the real
   * control, not an illustration of it — and disappears the instant the player
   * makes their own first touch on it (`AIM_TOUCHED`), handing off to the real
   * thing rather than asking for a second tap to close a dialog. It also hides
   * the booster tray for the whole level: a level teaching exactly one control
   * should not show a second one nobody has explained yet. The ammo badge
   * (count and loaded colour) stays up regardless — that is the one piece of
   * state a shot changes, and hiding it would make "how many are left" a
   * mystery rather than a lesson.
   *
   * Unlike `tutorial`, this is not "shown once, ever": `startPlaying` in
   * SandGame.tsx opens it every time this level starts play, with no
   * once-per-session or once-ever bookkeeping to skip it. A dismiss that
   * costs zero clicks can afford to repeat itself; a wall-of-text modal
   * cannot.
   */
  ftueGesture?: boolean;
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
  /**
   * How many draws in a row each shootable colour has been passed over since
   * it last came up — resets to 0 the instant `drawAmmo` (sand-rules.ts)
   * draws it again. A colour absent from this map has never been passed
   * over (either it was just drawn, or the board has never offered it
   * before). Drives the "insurance" rule: a colour left waiting 3 draws is
   * forced onto the 4th, so the randomised queue can still repeat a colour
   * back-to-back without ever burying another one for good.
   */
  ammoPity: Partial<Record<SandColor, number>>;
  /**
   * Advances by one every time `drawAmmo` actually rolls the dice (a forced
   * insurance pick spends no roll). Turned into that draw's pick via
   * `seededUnit` (sand-color.ts) rather than `Math.random`, so the queue
   * looks random to a player but — same state in, same draw out — stays
   * exactly reproducible from the state alone (see this file's own header
   * comment on §9).
   */
  ammoSeed: number;
  /** Bullets spent. Against `shotLimit`, this is the number that matters. */
  shotsUsed: number;
  /** Cells still in the frame. Win is this reaching zero. */
  remainingCells: number;
  /**
   * The cells still frozen, as a subset of the cells in `bodies`.
   *
   * Locked sand is sand: it has a colour, it fills a cell, it holds other sand
   * up and it counts toward the win. It just cannot fall and cannot be shot
   * out — which is exactly why a locked region hangs in mid-air.
   */
  locked: CellCoord[];
  /** The keys still in the frame. Each opens the first lock it touches. */
  keys: SandKey[];
  /**
   * Wall Obstacle cells — never sand, never counted toward the win, never
   * freed by anything. A permanent hole in the board: sand rests against one
   * the way it rests against the floor, a shot's radius disc never reaches
   * one (it is not in `bodies` for `cellsInRadius` to find), and it never
   * moves, so unlike `locked`/`keys` this list is fixed for the level's whole
   * life — set once in `createSandGameState` and never touched again.
   */
  walls: CellCoord[];
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
  | { kind: "REINDEX"; assignment: Array<{ x: number; y: number; bodyId: string }> }
  /**
   * A key shifting by one cell, as a whole.
   *
   * A delta rather than a cell list: the renderer already knows where the key
   * is, and a key is rigid, so one pair of numbers says everything that
   * happened to it.
   */
  | { kind: "KEY_MOVE"; keyId: string; dx: number; dy: number }
  /**
   * A key reached a lock. The whole locked region thaws at once and the key is
   * spent — `cells` is what stopped being frozen, so the renderer can flash
   * exactly the sand that just came free.
   */
  | { kind: "UNLOCK"; keyId: string; cells: CellCoord[] };

export type SettleOutcome = {
  bodies: SandBody[];
  steps: SettleStep[];
  /** What is still frozen once everything has come to rest. */
  locked: CellCoord[];
  /** The keys that have not been spent. */
  keys: SandKey[];
  /** Wall Obstacle cells, unchanged — carried through rather than recomputed,
   * since nothing a settle does can ever move or remove one. */
  walls: CellCoord[];
};
