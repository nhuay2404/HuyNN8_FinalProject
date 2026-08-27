import { RADIUS_GAMEPLAY, type SandLevelConfig } from "./sand-types.ts";

// Every level that ships in the build. The level editor at `/editor` writes
// drafts to the browser instead; exporting one from there produces a block in
// exactly the shape below, to paste in and add to `BUILT_IN_LEVELS`.
//
// A level carries only its own content — picture, wheel of colours, disc reach,
// budget, resolution. Every rule it plays under lives in `RADIUS_GAMEPLAY`.

/** Drawn top row first, one letter per cell. R G Y B P O, `.` for empty. */
const BLOOM_PICTURE = [
  "YYYYYYYYYYYY",
  "YYYGGYYGGYYY",
  "YYGBBGGBBGYY",
  "YGBBBBBBBBGY",
  "GBBBBBBBBBBG",
  "GBBBBBBBBBBG",
  "YGBBBBBBBBGY",
  "YYGBBBBBBGYY",
  "YYYGBBBBGYYY",
  "YYYYGBBGYYYY",
  "YYYYYGGYYYYY",
  "OOYYYOOYYYOO",
  "OOOYOOOOYOOO",
  "OOOOOOOOOOOO",
];

/**
 * The reference level: fine sand, radius sorting, and a shot budget.
 *
 * A blue bloom rimmed in green, resting on an orange bed, in a field of yellow
 * sand. Four colours, drawn as organic masses rather than a mosaic — under the
 * radius rule a big soft region is a real target, because *where* you bite it
 * changes what falls.
 *
 * The picture fills the frame on purpose: an uneven skyline slumps on the very
 * first frame, and the player would never see what was authored. The editor
 * warns about this and can settle a drawing in place to fix it.
 *
 * The budget is measured, not guessed. Two play models run against the real
 * solver (see `analyseLevel`):
 *
 *   - strong play — always the disc that takes the most — clears in 19 shots
 *   - careless play — a random cell of the colour in hand — wins 8 times in 12
 *
 * 26 leaves a good player six shots of slack and still fails a lazy line a
 * third of the time.
 */
export const sandBloom: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 1,
  name: "Sand Bloom",

  frame: { width: 12, height: 14 },
  rows: BLOOM_PICTURE,

  // The starting rotation only. Under the cycling rule this list is a wheel,
  // not a budget: colours come round again until they are gone.
  ammoQueue: ["blue", "yellow", "orange", "green"],

  // In blueprint cells. Big enough that placement is a real decision, small
  // enough that no single shot can take a whole mass.
  sortRadius: 2.5,
  shotLimit: 26,

  // Measured: grain-by-grain settling stays cheap as the board grows, so 5x
  // keeps every shot's settle under ~40ms worst case at this size (60x70
  // pixels) while giving a real fine-sand canvas.
  pixelScale: 5,

  notes: "Radius sorting with a recycling queue; difficulty is the shot budget alone.",
};

/**
 * Lock & Key — the first of two levels that exist to try a mechanic out.
 *
 * A slab of purple hangs in mid-air, frozen: those are the lower-case letters
 * in the picture. Nothing can shoot it and it does not fall, so it is the one
 * fixed point in the frame. Above it sits a plug of yellow with the key resting
 * on top; take the yellow out and the key drops onto the slab, which opens on
 * contact and lets the purple pour to the floor.
 *
 * The `K` cells are `KEY_SPRITE` at scale 1 — a round bow, a neck and a
 * three-prong bit, because this key does not roll: it slides, and a flat
 * silhouette is what reads as skidding across sand instead of tumbling over
 * it. It never authors `keyFriction`, so it is maximally slippery by default —
 * it moves the instant a slope or a gust offers it a way down.
 *
 * The plug (cols3-8, 6 cells) sits a column in from the slab on each side
 * (cols2-9, 8 cells) — no partial overhang for the teeth to reason about by
 * hand, and the key's own bow overflows the plug by one column on the left,
 * same as before: a rigid body cell without support is still valid, it just
 * cannot be sand.
 */
const LOCK_PICTURE = [
  "............",
  "............",
  "...KKKKK....",
  "..KKKKKKK...",
  "...KKKKK....",
  ".....K......",
  "...KKKKK....",
  "...K.K.K....",
  "...YYYYYY...",
  "..pppppppp..",
  "..pppppppp..",
  "..pppppppp..",
  "............",
  "............",
  "GGGGGGGGGGGG",
  "OOOOOOOOOOOO",
  "OOOOOOOOOOOO",
];

export const lockAndKey: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 2,
  name: "Lock & Key",

  frame: { width: 12, height: 17 },
  rows: LOCK_PICTURE,

  ammoQueue: ["yellow", "green", "orange", "purple"],

  sortRadius: 2.5,
  shotLimit: 24,
  pixelScale: 5,

  notes: "Mechanic test: frozen sand hanging in the frame, opened by a falling key.",
};

/**
 * Crosswind — the second mechanic level.
 *
 * A mound built of one-cell steps, which is the only shape falling sand holds
 * still in, so every gust has somewhere to push grains and the change is
 * visible rather than theoretical.
 *
 * The weather is a three-phase loop, written to show what the loop is for
 * rather than to be the fairest possible level:
 *
 *   1. a long push right across the whole frame — the mound walks downwind
 *   2. a short, hard shove back left, but only through the upper half, so the
 *      peak is knocked back while the base it stands on is not
 *   3. a soft right-hand drift, again everywhere
 *
 * `power` and `zone` are in blueprint cells like `sortRadius`, and are scaled
 * with the board by `expandLevelForPixelBoard`. The durations are real time and
 * are not scaled.
 */
const CROSSWIND_PICTURE = [
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  ".....BB.....",
  "....GGGG....",
  "...GGGGGG...",
  "..YYYYYYYY..",
  ".YYYYYYYYYY.",
  "OOOOOOOOOOOO",
  "OOOOOOOOOOOO",
  "OOOOOOOOOOOO",
];

export const crosswind: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 3,
  name: "Crosswind",

  frame: { width: 12, height: 14 },
  rows: CROSSWIND_PICTURE,

  ammoQueue: ["blue", "green", "yellow", "orange"],

  sortRadius: 2.5,
  shotLimit: 30,
  pixelScale: 5,

  wind: {
    phases: [
      { direction: "right", durationMs: 2600, cooldownMs: 3600, power: 1, zone: null },
      // Upper half only: y counts up from the floor, so this starts at row 7.
      { direction: "left", durationMs: 1400, cooldownMs: 3000, power: 2, zone: { x: 0, y: 7, width: 12, height: 7 } },
      { direction: "right", durationMs: 1800, cooldownMs: 4200, power: 1, zone: null },
    ],
  },

  notes: "Mechanic test: a looping wind pattern that reshapes the board between shots.",
};

export const BUILT_IN_LEVELS: SandLevelConfig[] = [sandBloom, lockAndKey, crosswind];

export const newLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 2,
  name: "New level",

  frame: { width: 12, height: 14 },
  rows: [
    "PPPPPPPPPPPP",
    "PPPOOOOOPPPP",
    "POOPPPPOOPPP",
    "POPPPPPPOOPP",
    "POPPPPPPOOPP",
    "POPPPPPPOPPP",
    "POPPPPPOOPPP",
    "POOPPPOOPPPP",
    "PPOOOOOPPPPP",
    "PPPOOBBPPPPP",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "YYYYYYYYYYYY",
    "BBBBBBBBBBBB",
  ],

  // The starting rotation only — under the cycling rule this is a wheel, not a
  // budget: colours come round again until they are gone.
  ammoQueue: ["blue", "purple", "yellow", "orange"],

  sortRadius: 2.5,
  shotLimit: 20,

  // 12 x 14 blueprint at 5x = 4,200 simulated pixels.
  pixelScale: 5,
};
