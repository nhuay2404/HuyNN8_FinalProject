import { RADIUS_GAMEPLAY, type SandLevelConfig } from "../../app/game/sand-types.ts";

// Everything below `BUILT_IN_LEVELS` used to be the shipped level roster.
// That roster has been cleared down to the hand-authored levels on purpose —
// the level editor at `/editor` is where the rest are authored and shipped
// from now on.
//
// `sandBloom` and `lockAndKey` — the two mechanic-test fixtures that used to
// live in this file — have moved to tests/level-fixtures.ts. They were never
// part of the roster (`BUILT_IN_LEVELS` never included them) and never
// reachable by a player; keeping them in the same file as the real levels
// just meant every reader of "the level roster" had to hold two unplayable
// levels in their head to find the two real ones. Same exact definitions,
// same tests exercising them (tests/sand-radius.test.ts, sand-mechanics.test.ts,
// sand-boosters.test.ts, sand-pixel-board.test.ts, level-editor.test.ts) —
// only the file changed.

/**
 * The single default level — this build's FTUE. One colour, one mound, one
 * lesson: aim and fire. A second colour (or a lock, or wind) would be a
 * second thing to learn before the player has learned the first, so this
 * picture deliberately has nothing else in it. See `ftueGesture` on the config
 * below for how that lesson is taught (a hand/drag glyph over the joystick,
 * not a text overlay — SandGame.tsx renders it, sand-types.ts documents the
 * field). Same silhouette as the old two-tone default (mound over a floor),
 * just poured from one colour instead of two.
 *
 * Every step in from the full-width base narrows by exactly one column on
 * each side (w4 → w6 → w8 → w10), never repeats a width, and only the
 * full-width rows repeat — see the taper-stability note on `SECOND_LEVEL_PICTURE`
 * below for why a repeated sub-full width is the one shape `GRAIN_FALL_TEMP`
 * cannot hold still (this row count used to repeat w8 once and slumped six
 * grains on load, invisibly enough that nobody had flagged it before).
 */
const DEFAULT_LEVEL_PICTURE = [
  "..........",
  "...BBBB...",
  "..BBBBBB..",
  ".BBBBBBBB.",
  "BBBBBBBBBB",
  "BBBBBBBBBB",
  "BBBBBBBBBB",
  "BBBBBBBBBB",
  "BBBBBBBBBB",
  "BBBBBBBBBB",
];

export const defaultLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 1,
  name: "Level 1",

  frame: { width: 10, height: 10 },
  rows: DEFAULT_LEVEL_PICTURE,

  ammoQueue: ["blue"],

  // No queue preview and no shot budget: the one lesson here is aim-and-fire,
  // so nothing else about ammo should be visible or able to fail the player.
  // `nextPreviewCount: 0` overrides RADIUS_GAMEPLAY's default just for this
  // level — the HUD's upcoming-shots strip only renders when it has entries
  // (see `.shots-upcoming` in SandGame.tsx), so 0 hides it outright rather
  // than showing a row of repeated blue dots that would just be a queue
  // widget teaching nothing (the whole wheel is one colour anyway).
  nextPreviewCount: 0,

  sortRadius: 2,
  // Infinity is the sanctioned "no limit" value — see its doc comment on
  // `SandLevelConfig.shotLimit` in sand-types.ts.
  shotLimit: Infinity,
  pixelScale: 5,

  ftueGesture: true,

  notes: "The default level: this build's FTUE. One colour only, on purpose — "
    + "see ftueGesture. No ammo queue shown and no shot budget: the only "
    + "thing this level teaches is aim-and-fire, so nothing else about ammo "
    + "should be visible or able to fail the player.",
};

/**
 * Level 2 — introduces the ammo queue: a five-point star, in three colours,
 * so the upcoming-shots strip (`.shots-upcoming` in SandGame.tsx, hidden on
 * Level 1 via `nextPreviewCount: 0`) has something worth previewing for the
 * first time. No shot budget yet — `shotLimit: Infinity` — because the point
 * here is reading the queue and planning around it, not surviving it; a
 * budget would teach two lessons in one level.
 *
 * Drawn solid rather than as a star-shaped silhouette on purpose: the star
 * only exists as a colour pattern (yellow) against a sky-and-ground
 * background (blue/green), the same trick `sandBloom`'s flower uses
 * (tests/level-fixtures.ts) — every one of the 17x16 cells is filled, so
 * there is no overhang for `GRAIN_FALL_TEMP` to erode and nothing to verify
 * with `runGrainSettle` beyond the zero `GRAIN_PASS` a fully solid rectangle
 * already guarantees. A real star *silhouette* (empty background around a
 * five-point outline) cannot stand on its own under grain-fall physics — the
 * notches between its points are unsupported overhangs — so the shape lives
 * in colour, not in the outline of what is filled.
 */
const STAR_LEVEL_PICTURE = [
  "BBBBBBBBBBBBBBBBB",
  "BBBBBBBBYBBBBBBBB",
  "BBBBBBBYYYBBBBBBB",
  "BBBBBBBYYYBBBBBBB",
  "BBBBBBYYYYYBBBBBB",
  "BBYYYYYYYYYYYYYBB",
  "BBYYYYYYYYYYYYYBB",
  "BBBYYYYYYYYYYYBBB",
  "BBBBYYYYYYYYYBBBB",
  "BBBBBYYYYYYYBBBBB",
  "BBBBBYYYYYYYBBBBB",
  "BBBBYYYYYYYYYBBBB",
  "GGGGYYYGGGYYYGGGG",
  "GGGGYGGGGGGGYGGGG",
  "GGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGG",
];

export const secondConsequence: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 2,
  name: "Level 2",

  frame: { width: 17, height: 16 },
  rows: STAR_LEVEL_PICTURE,

  // The wheel of colours, not a fixed opening order — see `ammoQueue`'s own
  // comment in sand-types.ts. Star first: it is the shape the level is named
  // for and the smallest region, so it clears early.
  ammoQueue: ["yellow", "blue", "green"],

  sortRadius: 3,
  // No budget: see this level's own doc comment above.
  shotLimit: Infinity,
  pixelScale: 5,

  notes: "Introduces the ammo queue preview (three colours, star/sky/ground) "
    + "with no shot budget yet — one new lesson at a time.",
};

/**
 * Level 3 — introduces the shot budget. Level 1 taught aim-and-fire with no
 * queue and no budget; Level 2 added the queue preview with still no budget;
 * this is the first level that can actually be lost to running out of shots.
 *
 * A house — roof, walls, sky — in the same solid-rectangle-of-colour style as
 * `STAR_LEVEL_PICTURE` above, for the same reason: every one of the 15x14
 * cells is filled, so the silhouette is trivially at rest under
 * `GRAIN_FALL_TEMP` and the house shape lives entirely in colour (orange
 * roof, yellow walls, blue sky) rather than in an outline with empty space
 * around it.
 */
const THIRD_LEVEL_PICTURE = [
  "BBBBBBBOBBBBBBB",
  "BBBBBBOOOBBBBBB",
  "BBBBBOOOOOBBBBB",
  "BBBBOOOOOOOBBBB",
  "BBBOOOOOOOOOBBB",
  "BBOOOOOOOOOOOBB",
  "BBBYYYYYYYYYBBB",
  "BBBYYYYYYYYYBBB",
  "BBBYYYYYYYYYBBB",
  "BBBYYYYYYYYYBBB",
  "BBBYYYYYYYYYBBB",
  "BBBYYYYYYYYYBBB",
  "BBBYYYYYYYYYBBB",
  "BBBYYYYYYYYYBBB",
];

export const thirdLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 3,
  name: "Level 3",

  frame: { width: 15, height: 14 },
  rows: THIRD_LEVEL_PICTURE,

  ammoQueue: ["orange", "yellow", "blue"],

  sortRadius: 2.5,
  // Measured with analyseLevel (app/game/level-analysis.ts): strong play
  // clears in 20, careless play (a random cell of the colour in hand) wins 6
  // of 8 sampled runs at this budget — six shots of slack for a strong line,
  // the "good" verdict the difficulty measurer itself reports.
  shotLimit: 26,
  pixelScale: 5,

  notes: "Introduces the shot budget — the first level that can actually be "
    + "lost to running out of shots, now that Level 1/2 have taught "
    + "aim-and-fire and the ammo queue separately.",
};

// ==== Editor-shipped levels ====

// Regenerated in full every time a level is shipped from `/editor` (the
// "Ship to sand-levels.ts" button, via `npm run level-writer`) — this array
// always mirrors the editor's current level list exactly, so a level deleted
// in the editor disappears from here on the next ship rather than lingering.
// Hand edits inside this block are overwritten on the next ship; edit the
// level in the editor instead.
export const EDITOR_LEVELS: SandLevelConfig[] = [];
// ==== End editor-shipped levels ====

/**
 * What the game and the level editor both start from, and — via `playables`
 * in SandGame.tsx — what the Gallery and the level-switcher both list in
 * full. Every level meant for a player to actually reach belongs in this
 * array.
 */
export const BUILT_IN_LEVELS: SandLevelConfig[] = [defaultLevel, secondConsequence, thirdLevel, ...EDITOR_LEVELS];
