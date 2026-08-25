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

export const BUILT_IN_LEVELS: SandLevelConfig[] = [sandBloom];
