// Mechanic-test fixtures — not shipped levels, never in `BUILT_IN_LEVELS`, and
// not exported from `design/levels/sand-levels.ts` at all any more.
//
// These used to live in that file, flagged as fixtures a player could never
// reach. Living there anyway meant every reader of "the level roster" had to
// hold two unplayable levels in their head just to find the two real ones —
// asked to be rid of them, moving the exact same definitions here (nothing
// about their geometry changed) gets them out of the design file for good
// while keeping every test that exercises radius/lock-key mechanics against
// their exact, hand-tuned shape intact:
// tests/sand-radius.test.ts, tests/sand-mechanics.test.ts,
// tests/sand-boosters.test.ts, tests/sand-pixel-board.test.ts,
// tests/level-editor.test.ts.

import { RADIUS_GAMEPLAY, type SandLevelConfig } from "../app/game/sand-types.ts";

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
 * Sand Bloom — the reference radius-sort fixture: four colours, a cycling
 * wheel, and a budget that is measured, not guessed.
 *
 * A blue bloom rimmed in green, resting on an orange bed, in a field of yellow
 * sand. Four colours, drawn as organic masses rather than a mosaic — under the
 * radius rule a big soft region is a real target, because *where* you bite it
 * changes what falls.
 *
 * The picture fills the frame on purpose: an uneven skyline slumps on the very
 * first frame, and the player would never see what was authored.
 *
 * The budget is measured, not guessed. Two play models run against the real
 * solver (see `analyseLevel`):
 *
 *   - strong play — always the disc that takes the most — clears in 19 shots
 *   - careless play — a random cell of the colour in hand — wins 8 times in 12
 *
 * 26 leaves a good player six shots of slack and still fails a lazy line a
 * third of the time.
 *
 * `tests/sand-radius.test.ts` and `tests/sand-pixel-board.test.ts` assert on
 * this exact picture (four colours, specific cells like the Blue centre at
 * (5, 8) and the Orange corner at (0, 0)) — do not edit the rows without
 * checking those tests.
 */
export const sandBloom: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 2,
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

  notes: "Radius-sort fixture: recycling queue, difficulty is the shot budget alone.",
};

/**
 * Lock & Key — the frozen-sand-and-key mechanic fixture.
 *
 * A slab of purple hangs in mid-air, frozen: those are the lower-case letters
 * in the picture. Nothing can shoot it and it does not fall, so it is the one
 * fixed point in the frame. Above it sits a plug of yellow with the key resting
 * on top; take the yellow out and the key drops onto the slab, which opens on
 * contact and lets the purple pour to the floor.
 *
 * The `K` cells are `KEY_SPRITE` at scale 1 — a plain filled disc, because a
 * solid shape is the one silhouette that cannot read as broken. It never
 * authors `keyFriction`, so it is maximally slippery by default — it moves
 * the instant a slope or a gust offers it a way down.
 *
 * The plug (cols3-8, 6 cells) sits a column in from the slab on each side
 * (cols2-9, 8 cells) — no partial overhang to reason about by hand, and the
 * key's own disc overflows the plug by one column on each side: a rigid body
 * cell without support is still valid, it just cannot be sand.
 *
 * `tests/sand-mechanics.test.ts` and `tests/sand-boosters.test.ts` assert on
 * this exact picture (e.g. shooting the plug at (5, 8), the floor at (0, 0))
 * — do not edit the rows without checking those tests.
 */
const LOCK_PICTURE = [
  "............",
  "............",
  "....KKK.....",
  "...KKKKK....",
  "..KKKKKKK...",
  "..KKKKKKK...",
  "..KKKKKKK...",
  "...KKKKK....",
  "....KKK.....",
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

  id: 3,
  name: "Lock & Key",

  frame: { width: 12, height: 18 },
  rows: LOCK_PICTURE,

  ammoQueue: ["yellow", "green", "orange", "purple"],

  sortRadius: 2.5,
  shotLimit: 24,
  pixelScale: 5,

  notes: "Mechanic fixture: frozen sand hanging in the frame, opened by a falling key.",
};
