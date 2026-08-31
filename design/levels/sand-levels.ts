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

  sortRadius: 2,
  shotLimit: 12,
  pixelScale: 5,

  ftueGesture: true,

  notes: "The default level: this build's FTUE. One colour only, on purpose — "
    + "see ftueGesture. A board that is almost impossible to fail.",
};

/**
 * Level 2 — the second consequence: sand does not just vanish where you hit
 * it, whatever was resting on top of it falls to fill the gap. Level 1 only
 * ever taught "shoot to clear"; every shot there ate into a solid, single-
 * colour pile, so a grain quietly dropping one row into the dent it just made
 * never reads as a separate event. This level exists to make that same
 * physics — always on, never a special case — visible as its own thing, once.
 *
 * The picture, bottom to top: three rows of green floor, two rows of yellow
 * sitting directly on it (the plug), then a blue mound sitting directly on
 * the yellow, tapering up the same one-column-per-side way `DEFAULT_LEVEL_PICTURE`
 * does. `ammoQueue`'s first colour is yellow, so the very first shot — aimed
 * anywhere near the middle of that wide, hard-to-miss yellow band — punches a
 * hole straight through the plug, and the blue sitting on the breached
 * section has nothing left under it but the gap. It drops into the yellow's
 * old place on camera, on the very first shot: the board visibly reshapes
 * itself, cause (the shot) and effect (the drop) in the same spot, no caption
 * required.
 *
 * Taper-stability note, worth keeping next to the picture it explains: under
 * `GRAIN_FALL_TEMP` a grain rolls diagonally off an edge whenever the
 * diagonal-down cell is empty, not only when the cell directly below it is —
 * a resting block behaves like real loose sand, not a rigid brick, so a
 * vertical wall face erodes into a slope. That means two consecutive rows can
 * never share a width narrower than the full frame: row(y-1) has to extend at
 * least one column further out than row(y) on *each* side, or that row's own
 * edge column finds its diagonal-down neighbour sitting in empty space and
 * slides into it before the player ever sees the picture as drawn. Only rows
 * that already run edge-to-edge can repeat a width, because there is no
 * further-out column inside the frame left for them to erode into. Verified
 * with `runGrainSettle` directly (zero `GRAIN_PASS` steps) rather than by eye.
 */
const SECOND_LEVEL_PICTURE = [
  "..........",
  "...BBBB...",
  "..BBBBBB..",
  ".BBBBBBBB.",
  "BBBBBBBBBB",
  "YYYYYYYYYY",
  "YYYYYYYYYY",
  "GGGGGGGGGG",
  "GGGGGGGGGG",
  "GGGGGGGGGG",
];

export const secondConsequence: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 2,
  name: "Level 2",

  frame: { width: 10, height: 10 },
  rows: SECOND_LEVEL_PICTURE,

  // Yellow first and only yellow lives in the plug, so the opening bullet is
  // guaranteed to be the one that triggers the collapse.
  ammoQueue: ["yellow", "blue", "green"],

  sortRadius: 2.5,
  // Measured with analyseLevel: strong play clears in 9, careless play (a
  // random cell of the colour in hand) wins 7 of 8 sampled runs at this
  // budget — five shots of slack for a strong line, same "good" verdict the
  // difficulty measurer itself would report.
  shotLimit: 14,
  pixelScale: 5,

  notes: "Teaches that sand above a cleared plug falls to fill the gap — the "
    + "yellow band is deliberately wide and loaded first so the first shot "
    + "demonstrates it.",
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
export const BUILT_IN_LEVELS: SandLevelConfig[] = [defaultLevel, secondConsequence, ...EDITOR_LEVELS];
