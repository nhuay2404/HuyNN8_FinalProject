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

/**
 * Levels 4-10 — from the 30-level beatchart (design/levels/beatchart), which
 * plans each level as a `{shape, colours, ammoQueue, width, height,
 * fill_ratio, sortRadius, shotLimit, ...}` row. Every row assumes a true
 * silhouette (fill_ratio ~0.7, i.e. real empty background around the shape),
 * which is exactly what `GRAIN_FALL_TEMP` cannot hold at rest — see
 * `STAR_LEVEL_PICTURE`'s doc comment above. So every shape below is drawn the
 * same way: a wide-base, narrow-top MOUND envelope (the one silhouette shape
 * this engine's gravity can hold without collapsing, `DEFAULT_LEVEL_PICTURE`'s
 * own trick, generalised to a smooth dome by tapering across most of the
 * canvas instead of just the top few rows) sized to land close to the
 * beatchart's own fill_ratio, with the actual icon — cone, balloons, rainbow,
 * trophy, note, fish, sunrise — drawn in colour *inside* that envelope.
 *
 * `shotLimit` on every one of these is re-measured against the actual drawn
 * shape with `analyseLevel` (app/game/level-analysis.ts), not copied from the
 * beatchart's own estimate — the beatchart's min_shots_est assumed a leaner
 * true-silhouette shape than the solid mound these are drawn as, so the real
 * number needed here runs higher. Chosen so careless play (`playCareless`,
 * 8 sampled runs) clears roughly as often as the beatchart's own
 * losable/not-losable call for that level: 8/8 for the three "Không" rows
 * (4, 6, 10) and a real chance of failure for the "CÓ" rows (5, 7, 8, 9),
 * tightening further for level 9's SPIKE.
 *
 * Not carried over from the beatchart: the "+5 shots" fail-safety offer it
 * describes for level 8 is a new UI/economy feature, not a level-content
 * change, and isn't built here.
 */

/**
 * Level 4 — a two-flavour ice cream cone with sprinkles. Beatchart row 4
 * ("Kem ốc quế"): teaches that a miscoloured hit (`NO_MATCH`) spends a shot
 * while an empty-air shot (`MISS`) is free — both rules already exist in the
 * engine (`missAmmoPolicy`), this level is where the player first feels the
 * asymmetry. The scattered brown sprinkle dots (in the doc-comment sense also
 * a stand-in for the beatchart's "interleave nhích lên 2") are what makes
 * brown the one colour worth a careful shot instead of a careless one.
 */
const ICE_CREAM_CONE_PICTURE = [
  ".......MY.......",
  ".......MM.......",
  "......MMMY......",
  ".....MMMYNY.....",
  ".....MMYYYY.....",
  "....MMMYYYYY....",
  "...MMMMYYYYYY...",
  "...MMMMMYYYYY...",
  "..MMMMMMMYYYYY..",
  "..MMMMMMMYYNYY..",
  ".MMMMMMMMYYYYYY.",
  "MMMMMMMNNYYYYYYY",
  "MMMMMMMNNYYYYYYY",
  "MMMMMMNNNNYYYYYY",
  "MMMMMMNNNNYYYYYY",
  "MMMMMMNNNNYYYYYY",
  "MMMMMNNNNNNYYYYY",
  "MMMMMNNNNNNYYYYY",
];

export const fourthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 4,
  name: "Level 4",

  frame: { width: 16, height: 18 },
  rows: ICE_CREAM_CONE_PICTURE,

  ammoQueue: ["pink", "yellow", "brown"],

  sortRadius: 2.43,
  // Measured with analyseLevel: strong play clears in 17; careless play
  // (a random cell of the colour in hand) wins all 8 sampled runs at this
  // budget — generous on purpose, this level teaches a cost, not a fail.
  shotLimit: 24,
  pixelScale: 5,

  notes: "Ice cream cone (beatchart row 4). Teaches NO_MATCH costs a shot, "
    + "MISS is free — the sprinkles are the one colour worth aiming at "
    + "carefully instead of firing wherever the cone's flavour happens to be.",
};

/**
 * Level 5 — four balloons clustered together (Voronoi-tiled, no gaps between
 * them), one trailing off with a stray string of its own. Beatchart row 5
 * ("Bóng bay"): the first four-colour level — reading which of four progress
 * bars is closest to done, and choosing shots accordingly, is the whole
 * lesson.
 */
const BALLOONS_PICTURE = [
  ".......GG.......",
  ".......GG.......",
  "......RRGG......",
  ".....RRRGGG.....",
  ".....RRRGGG.....",
  "....RRRRGGGG....",
  "...RRRRRGGGGG...",
  "...RRRRRGGGGG...",
  "..RRRRRRGGGGGG..",
  "..RRRRRRYYYYYY..",
  ".BBBBBBBYYYYYYY.",
  ".BBBBBBBYYYYYYY.",
  "BBBBBBBBYYYYYYYY",
  "BBBBBBBBYYYYYYYY",
  "BBBBBBBBYYYYYYYY",
  "BBBBBBBBYYYYYYYY",
  "BBBBBBBRRYYYYYYY",
  "BBBBBBBBYYYYYYYY",
];

export const fifthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 5,
  name: "Level 5",

  frame: { width: 16, height: 18 },
  rows: BALLOONS_PICTURE,

  ammoQueue: ["red", "blue", "green", "yellow"],

  sortRadius: 2.42,
  // Measured with analyseLevel: strong play clears in 20; careless play wins
  // 7 of 8 sampled runs at this budget.
  shotLimit: 27,
  pixelScale: 5,

  notes: "Four balloons clustered together (beatchart row 5). First "
    + "four-colour level — reading four progress bars at once is the lesson.",
};

/**
 * Level 6 — a stack of four horizontal bands. Beatchart row 6 ("Cầu vồng"):
 * uses gravity as a tool rather than a hazard — the bottom band is both the
 * biggest and the cheapest to clear (nothing sits under it to catch), so a
 * player who shoots low first gets every band above it sliding down for free.
 */
const RAINBOW_PICTURE = [
  ".......GG.......",
  ".......GG.......",
  "......GGGG......",
  ".....GGGGGG.....",
  "....YYYYYYYY....",
  "....YYYYYYYY....",
  "...YYYYYYYYYY...",
  "..YYYYYYYYYYYY..",
  ".OOOOOOOOOOOOOO.",
  ".OOOOOOOOOOOOOO.",
  "OOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOO",
  "RRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRR",
];

export const sixthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 6,
  name: "Level 6",

  frame: { width: 16, height: 18 },
  rows: RAINBOW_PICTURE,

  ammoQueue: ["red", "orange", "yellow", "green"],

  sortRadius: 2.42,
  // Measured with analyseLevel: strong play clears in 22; careless play wins
  // all 8 sampled runs at this budget — generous, matching the beatchart's
  // own "Không" (not realistically losable) call for this row.
  shotLimit: 31,
  pixelScale: 5,

  notes: "Four stacked bands (beatchart row 6) — shooting the bottom band "
    + "first lets gravity carry every band above it down for free.",
};

/**
 * Level 7 — a gold trophy: a yellow cup with a green laurel band and two blue
 * handles, standing on three small, separate flecks of tarnish. Beatchart
 * row 7 ("Cúp vàng"): the three disconnected brown clusters are deliberately
 * thin and scattered — a colour spread that thin makes every shot at it a
 * shot that could easily miss most of what it was aimed at.
 */
const TROPHY_PICTURE = [
  ".......YY.......",
  "......YYY.......",
  ".....YYYYY......",
  ".....GGGGGG.....",
  "....YYYYYYYY....",
  "...YYYYYYYYY....",
  "..BBYYYYYYYYB...",
  "..BBYYYYYYYYBB..",
  ".BBYYYYYYYYYBBB.",
  "YYYYYYYYYYYYYYY.",
  "YYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYY",
  "YYYYYYYNYYYYYYYY",
  "YYYYNYYYYYYYYYYY",
  "YYYYNYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYY",
];

export const seventhLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 7,
  name: "Level 7",

  frame: { width: 16, height: 18 },
  rows: TROPHY_PICTURE,

  ammoQueue: ["yellow", "brown", "blue", "green"],

  sortRadius: 2.41,
  // Measured with analyseLevel: strong play clears in 19; careless play wins
  // 4 of 8 sampled runs at this budget — a real chance of failure, matching
  // the beatchart's own "CÓ" (losable) call for this row.
  shotLimit: 24,
  pixelScale: 5,

  notes: "Gold trophy (beatchart row 7) — three separate, thin flecks of "
    + "brown tarnish are the colour a careless shot most often wastes.",
};

/**
 * Level 8 — a music note: a purple notehead, a cyan stem, three small yellow
 * sparkle accents, on a blue background. Beatchart row 8 ("Nốt nhạc"): the
 * first level that can actually be lost — a real test of aim-and-fire, the
 * ammo queue and a real shot budget together, all three taught separately by
 * levels 1/2/3-10 so far.
 *
 * Not built here: the beatchart's "+5 shots" fail-safety offer for this row
 * is a new UI/economy feature, not level content — see this file's own note
 * above `fourthLevel`.
 */
const MUSIC_NOTE_PICTURE = [
  ".......BB.......",
  "......BBB.......",
  ".....BBBBC......",
  ".....BBBBCB.....",
  "....BBBBBCBY....",
  "...BBBBBBCBB....",
  "..BBBBBBBCBBB...",
  "..BBBBBBBCBBBY..",
  ".BBBBBBBBCBBBBB.",
  "BBBBBBBBBCBYBBB.",
  "BBBBBBBBBCBBBBBB",
  "BBBBBBBBBCBBBBBB",
  "BBBBBPPPBCBBBBBB",
  "BBBBPPPPPCBBBBBB",
  "BBBPPPPPPPBBBBBB",
  "BBBBPPPPPBBBBBBB",
  "BBBBBPPPBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
];

export const eighthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 8,
  name: "Level 8",

  frame: { width: 16, height: 18 },
  rows: MUSIC_NOTE_PICTURE,

  ammoQueue: ["purple", "cyan", "yellow", "blue"],

  sortRadius: 2.41,
  // Measured with analyseLevel: strong play clears in 18; careless play wins
  // 5 of 8 sampled runs at this budget — a real chance of failure, matching
  // the beatchart's own "CÓ" (losable) call for this row.
  shotLimit: 25,
  pixelScale: 5,

  notes: "Music note (beatchart row 8) — the first level that can actually "
    + "be lost, combining aim-and-fire, the ammo queue and a real shot "
    + "budget for the first time.",
};

/**
 * Level 9 — a fish, nose up: a cyan head with one eye, a scaled body
 * (yellow/green/cyan checker), and an orange tail split by a thin blue fork.
 * Beatchart row 9 ("Con cá"), the SPIKE that closes this arc: five colours
 * and the highest interleaving yet — the scale checker is deliberately made
 * of many small same-colour patches sitting close together, which the radius
 * rule turns into a real one-shot payoff for whoever aims well (a shot need
 * not stay inside a single body's boundary to take a colour), and a real
 * punishment for whoever does not.
 */
const FISH_PICTURE = [
  ".......CC.......",
  ".......CC.......",
  "......CCCB......",
  ".....CCCCCC.....",
  ".....CCCCCC.....",
  "....CCCCCCCC....",
  "...YGCYGYGCYG...",
  "...GCYGCGCYGC...",
  "..GCYGCYCYGCYG..",
  ".CYGCYGCGCYGCYG.",
  "CYGCYGCYCYGCYGCY",
  "YGCYGCYGYGCYGCYG",
  "GCYGCYGCGCYGCYGC",
  "CYGCYGCYCYGCYGCY",
  "OOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOO",
];

export const ninthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 9,
  name: "Level 9",

  frame: { width: 16, height: 18 },
  rows: FISH_PICTURE,

  ammoQueue: ["cyan", "blue", "orange", "yellow", "green"],

  sortRadius: 2.4,
  // Measured with analyseLevel: strong play clears in 26; careless play wins
  // 5 of 8 sampled runs at this budget — the spike closing this arc.
  shotLimit: 36,
  pixelScale: 5,

  notes: "Fish, nose up (beatchart row 9) — the spike closing this arc: five "
    + "colours and the densest scale-pattern interleaving yet.",
};

/**
 * Level 10 — sunrise over the sea: three big bands, orange sky, yellow glow,
 * blue sea. Beatchart row 10 ("Bình minh trên biển"): a breather after the
 * spike — three large, single-body regions with no interleaving at all, easy
 * on purpose.
 */
const SUNRISE_PICTURE = [
  "..........OO..........",
  ".........OOOO.........",
  ".........OOOO.........",
  "........OOOOOO........",
  ".......OOOOOOOO.......",
  "......OOOOOOOOOO......",
  ".....OOOOOOOOOOO......",
  ".....OOOOOOOOOOOO.....",
  "....YYYYYYYYYYYYYY....",
  "...YYYYYYYYYYYYYYYY...",
  "..YYYYYYYYYYYYYYYYYY..",
  "..YYYYYYYYYYYYYYYYYY..",
  ".YYYYYYYYYYYYYYYYYYYY.",
  "YYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBB",
];

export const tenthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 10,
  name: "Level 10",

  frame: { width: 22, height: 24 },
  rows: SUNRISE_PICTURE,

  ammoQueue: ["orange", "yellow", "blue"],

  sortRadius: 3.29,
  // Measured with analyseLevel: strong play clears in 22; careless play wins
  // all 8 sampled runs at this budget — the breather closing this run of
  // levels, matching the beatchart's own "Không" (not realistically losable)
  // call for this row.
  shotLimit: 30,
  pixelScale: 5,

  notes: "Sunrise over the sea (beatchart row 10) — three large, single-body "
    + "bands with no interleaving, a breather after level 9's spike.",
};

/**
 * Levels 11-20 — arc 2 of the beatchart: Wall Obstacle. See
 * app/game/sand-rules.ts's own doc comment on `WALL_LETTER` for what a wall
 * cell is (permanent, colourless, never sand, never counted toward the win)
 * and app/game/sand-types.ts's on `SandGameState.walls` for how it behaves
 * physically. Same drawing convention as levels 4-10 above: every picture is
 * a fully solid rectangle (colour bands, sometimes side by side instead of
 * stacked), so it is trivially at rest — a wall punched into it is still a
 * permanent hole, just one that never had to fight gravity to begin with.
 *
 * The radius disc has no notion of a wall standing in its way — `resolveShot`
 * (sand-rules.ts) takes cells by plain distance, walls included in that
 * distance the same as everywhere else — so a wall changes what holds sand
 * up and what a picture looks like, never what a shot can reach. Every
 * `shotLimit` below is measured the same way as levels 4-10: analyseLevel's
 * `carelessWins` (8 sampled runs) tuned to roughly track this arc's own
 * difficulty curve, tightening toward level 19's spike and opening back up
 * for the two breathers (18 and 20).
 */
const GARDEN_FENCE_PICTURE = [
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GWWWGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GWWWGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
];

export const eleventhLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 11,
  name: "Level 11",

  frame: { width: 34, height: 38 },
  rows: GARDEN_FENCE_PICTURE,

  ammoQueue: ["green", "brown", "yellow"],

  sortRadius: 5.1,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 39,
  pixelScale: 1,

  notes: "Wall Obstacle debuts (beatchart row 11) — a small 3x2 wall block tucked in a dead corner, changing nothing about how the level solves. The point is just letting the eye register that a permanent, colourless cell exists before anything depends on it.",
};

const GARDEN_MAZE_PICTURE = [
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "RRRRRRRRRRRRRRRRRRBBBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRRRBBBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRWWWWBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRRRBBBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRRRBBBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRRRBBBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRRRBBBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRRRBBBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRRRBBBBBBBBBBBBBBBBBB",
];

export const twelfthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 12,
  name: "Level 12",

  frame: { width: 36, height: 40 },
  rows: GARDEN_MAZE_PICTURE,

  ammoQueue: ["red", "yellow", "blue"],

  sortRadius: 5.38,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 35,
  pixelScale: 1,

  notes: "A wall column genuinely divides the frame into a red half and a blue half (beatchart row 12) — gapped top and bottom so sand still settles freely on both sides; a shot just has to land on whichever side it means to clear.",
};

const HIDDEN_PICTURE_PICTURE = [
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBWWWWWWBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBWWWWWWBB",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYWWWWWWYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYWWWWWWYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
];

export const thirteenthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 13,
  name: "Level 13",

  frame: { width: 36, height: 40 },
  rows: HIDDEN_PICTURE_PICTURE,

  ammoQueue: ["cyan", "blue", "yellow", "pink"],

  sortRadius: 5.38,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 48,
  pixelScale: 1,

  notes: "Two small wall blocks each sit over a corner of one colour's band (beatchart row 13) — the covered sand is still there and still clears once its band is shot, the wall just means the picture never shows all of it at once.",
};

const RIVER_BANKS_PICTURE = [
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNRRRRRRRRRRRRRRRRRRR",
  "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
  "CCCCCCCCCCCCCCCCCCCYYYYYYYYYYYYYYYYYYY",
];

export const fourteenthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 14,
  name: "Level 14",

  frame: { width: 38, height: 42 },
  rows: RIVER_BANKS_PICTURE,

  ammoQueue: ["brown", "red", "cyan", "yellow"],

  sortRadius: 5.66,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 38,
  pixelScale: 1,

  notes: "A full-width wall strip splits the frame into an upper half and a lower half (beatchart row 14) — each half carries its own two colours and has to be cleared on its own terms, not by leaning on shots meant for the other.",
};

const ZEN_GARDEN_PICTURE = [
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOWWWWWOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOWWWWWOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOWWWWWOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNWWWWNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNWWWWNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNWWWWNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
];

export const fifteenthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 15,
  name: "Level 15",

  frame: { width: 38, height: 42 },
  rows: ZEN_GARDEN_PICTURE,

  ammoQueue: ["red", "yellow", "green", "orange", "brown"],

  sortRadius: 5.66,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 57,
  pixelScale: 1,

  notes: "Three scattered wall clusters at once (beatchart row 15), five colours — nothing to memorise as a single obstacle any more, just a board to actually plan a route across.",
};

const ISOLATED_ISLE_PICTURE = [
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "YYYYYYYYYYYYYYYYWYYYYYYYWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWWYYYYYYYWWYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYWWYYYYYYYYYWWYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYWWYYYYYYYYYYYWWYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWYYYYYYYYYYYWWWYYYYYYYYYYY",
  "YYYYYYYYYYYYWWYYYYYYYYYYYYYWWYYYYYYYYYYY",
  "YYYYYYYYYYYYWWYYYYYYYYYYYYYWWYYYYYYYYYYY",
  "YYYYYYYYYYYYWWYYYYYYYYYYYYYWWYYYYYYYYYYY",
  "YYYYYYYYYYYYWWYYYYYYYYYYYYYWWYYYYYYYYYYY",
  "GGGGGGGGGGGGWWGGGGGGGGGGGGGWWGGGGGGGGGGG",
  "GGGGGGGGGGGGWWGGGGGGGGGGGGGWWGGGGGGGGGGG",
  "GGGGGGGGGGGGWWGGGGGGGGGGGGGWWGGGGGGGGGGG",
  "GGGGGGGGGGGGGWWGGGGGGGGGGGWWGGGGGGGGGGGG",
  "GGGGGGGGGGGGGWWWGGGGGGGGGWWWGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWWWGGGGGGGWWWGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGWWWWWWWWWWWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGWWWWWWWGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
];

export const sixteenthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 16,
  name: "Level 16",

  frame: { width: 40, height: 44 },
  rows: ISOLATED_ISLE_PICTURE,

  ammoQueue: ["brown", "yellow", "green", "cyan", "blue"],

  sortRadius: 5.95,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 59,
  pixelScale: 1,

  notes: "A wall ring nearly encloses the yellow/green band (beatchart row 16), one gap left open on purpose — wide enough for the level's own sortRadius to still reach through, verified against the actual disc rather than assumed.",
};

const THREE_ISLANDS_PICTURE = [
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBWWWWBBBBBBBBBBWWWWBBBBBBBBBBBB",
  "BBBBBBBBBBBBWWWWBBBBBBBBBBWWWWBBBBBBBBBBBB",
  "BBBBBBBBBBBBWWWWBBBBBBBBBBWWWWBBBBBBBBBBBB",
  "BBBBBBBBBBBBWWWWBBBBBBBBBBWWWWBBBBBBBBBBBB",
  "BBBBBBBBBBBBWWWWBBBBBBBBBBWWWWBBBBBBBBBBBB",
  "BBBBBBBBBBBBWWWWBBBBBBBBBBWWWWBBBBBBBBBBBB",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYWWWWYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYWWWWYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYWWWWYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYWWWWYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYWWWWYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYWWWWYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYWWWWYYYYYYYYYYYY",
  "YYYYYYYYYYYYWWWWYYYYYYYYYYWWWWYYYYYYYYYYYY",
  "GGGGGGGGGGGGWWWWGGGGGGGGGGWWWWGGGGGGGGGGGG",
  "GGGGGGGGGGGGWWWWGGGGGGGGGGWWWWGGGGGGGGGGGG",
  "GGGGGGGGGGGGWWWWGGGGGGGGGGWWWWGGGGGGGGGGGG",
  "GGGGGGGGGGGGWWWWGGGGGGGGGGWWWWGGGGGGGGGGGG",
  "GGGGGGGGGGGGWWWWGGGGGGGGGGWWWWGGGGGGGGGGGG",
  "GGGGGGGGGGGGWWWWGGGGGGGGGGWWWWGGGGGGGGGGGG",
  "GGGGGGGGGGGGWWWWGGGGGGGGGGWWWWGGGGGGGGGGGG",
  "GGGGGGGGGGGGWWWWGGGGGGGGGGWWWWGGGGGGGGGGGG",
  "PPPPPPPPPPPPWWWWPPPPPPPPPPWWWWPPPPPPPPPPPP",
  "PPPPPPPPPPPPWWWWPPPPPPPPPPWWWWPPPPPPPPPPPP",
  "PPPPPPPPPPPPWWWWPPPPPPPPPPWWWWPPPPPPPPPPPP",
  "PPPPPPPPPPPPWWWWPPPPPPPPPPWWWWPPPPPPPPPPPP",
  "PPPPPPPPPPPPWWWWPPPPPPPPPPWWWWPPPPPPPPPPPP",
  "PPPPPPPPPPPPWWWWPPPPPPPPPPWWWWPPPPPPPPPPPP",
  "PPPPPPPPPPPPWWWWPPPPPPPPPPWWWWPPPPPPPPPPPP",
  "PPPPPPPPPPPPWWWWPPPPPPPPPPWWWWPPPPPPPPPPPP",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
];

export const seventeenthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 17,
  name: "Level 17",

  frame: { width: 42, height: 46 },
  rows: THREE_ISLANDS_PICTURE,

  ammoQueue: ["red", "blue", "yellow", "green", "purple", "orange"],

  sortRadius: 6.23,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 58,
  pixelScale: 1,

  notes: "Six colours, two wall columns splitting the frame into three vertical zones (beatchart row 17) — the most planning this arc has asked for yet.",
};

const RAINDROP_PICTURE = [
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
];

export const eighteenthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 18,
  name: "Level 18",

  frame: { width: 38, height: 42 },
  rows: RAINDROP_PICTURE,

  ammoQueue: ["cyan", "blue", "green", "yellow"],

  sortRadius: 5.66,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 51,
  pixelScale: 1,

  notes: "Breather before the arc's spike (beatchart row 18) — a small wall block sits in the open, decorative rather than in the way, and the budget is generous on purpose.",
};

const SQUID_PICTURE = [
  "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPPPPWWWWWWPPPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPPPWWWWWWWWWPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPWWWWPPPPWWWWPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPWWPPPPPPPPWWWPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPWWPPPPPPPPPPWWPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPWWPPPPPPPPPPPWWPPPPPPPPPPPPPPPPPPPPP",
  "CCCCCWWCCCCCCCCCCCCWWCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCWWCCCCCCCCCCCCWWCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCWWCCCCCCCCCCCCWWCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCWWCCCCCCCCCCCCWWCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCWWWCCCCCCCCCCCWWCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCWWCCCCCCCCCCWWCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCWWWCCCCCCCCWWWCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCWWWCCCCCCWWWCCCCCCCCCCCCCCCCCCCCCCC",
  "NNNNNNNNWWNNNNNNWWNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYWWWWWWYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYWWWWWWYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYWWWWWWYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYWWWWWWYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRWWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "BBBWWWWWBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBWWWWWBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
];

export const nineteenthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 19,
  name: "Level 19",

  frame: { width: 42, height: 48 },
  rows: SQUID_PICTURE,

  ammoQueue: ["purple", "cyan", "brown", "yellow", "red", "blue"],

  sortRadius: 6.38,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 59,
  pixelScale: 1,

  notes: "The spike that closes arc 2 (beatchart row 19): six colours and every wall trick this arc taught at once — a corner block, a near-isolating ring, and a pair of small blockers layered together.",
};

const RAINBOW_AFTER_RAIN_PICTURE = [
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
];

export const twentiethLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 20,
  name: "Level 20",

  frame: { width: 44, height: 50 },
  rows: RAINBOW_AFTER_RAIN_PICTURE,

  ammoQueue: ["blue", "green", "yellow", "red"],

  sortRadius: 6.66,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 52,
  pixelScale: 1,

  notes: "Breather closing arc 2 (beatchart row 20) — the biggest canvas yet, only four colours, one small decorative wall opened by the very first shot.",
};

/**
 * Levels 21-30 — arc 3 of the beatchart: Lock & Key. The mechanic itself
 * (KEY_LETTER, lockedLetter, `unlockPass`) already existed and was already
 * tested (tests/sand-mechanics.test.ts, the `lockAndKey` fixture) — nothing
 * new needed building here, unlike Wall Obstacle for arc 2 above.
 *
 * Every lock/key shaft below follows the same pattern, worth stating once
 * rather than in every level's own notes:
 *
 * - A key never starts floating over empty space, and a plug never starts
 *   floating under one either — both would simply fall on their own before
 *   the player ever fires a shot, which is not "the picture is already at
 *   rest", it is a picture about to visibly collapse. Every key instead
 *   starts resting on a solid column of ordinary (shootable) sand, which
 *   itself sits directly on the lock; the key sinks down as the player
 *   clears that column, shot by shot, until it finally touches the lock.
 * - That column is walled on both sides with Wall Obstacle for its whole
 *   height (used here as a structural guide, not a puzzle element the way
 *   arc 2 uses it). A radius shot carves a circle, not a column — without
 *   the rails, nothing stops `keyPass` (sand-rules.ts) from rolling the key
 *   sideways the instant an opened cell beside it is more attractive than
 *   waiting on the cell directly below, and a key that drifts even one
 *   column off centre can end up nowhere near its own lock.
 * - A key opens WHATEVER locked cell it touches — `unlockPass` has no notion
 *   of "which key is for which lock". So on any level with more than one
 *   lock (25, 27, 29), a key that is meant to wait for an earlier lock to
 *   open never rests on a locked cell directly: it rests on an ordinary sand
 *   buffer that itself sits on the earlier lock, and only once that whole
 *   stack (lock, then buffer) has been thawed and shot away does it have
 *   anywhere left to fall.
 *
 * Every `shotLimit` is measured the same way as arcs 1 and 2: analyseLevel's
 * `carelessWins` (8 sampled runs) tuned to track this arc's own difficulty
 * curve, tightening toward level 29's three-lock spike and opening back up
 * for the two breathers (28 and 30).
 */
const LOCK_PICTURE = [
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYKKKKKKYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYKKKKKKYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYWGGGGGGWYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYWGGGGGGWYYYYYYYYYYYYYY",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGWGGGGGGWGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGppppppGGGGGGGGGGGGGGG",
  "OOOOOOOOOOOOOOOppppppOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOppppppOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOppppppOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOppppppOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
];

export const twentyFirstLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 21,
  name: "Level 21",

  frame: { width: 36, height: 42 },
  rows: LOCK_PICTURE,

  ammoQueue: ["orange", "green", "yellow", "purple"],

  sortRadius: 5.53,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 44,
  pixelScale: 1,

  notes: "Lock & Key debuts (beatchart row 21) — a single lock, a single key, a straight drop once its plug is cleared.",
};

const GIFT_BOX_PICTURE = [
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRKKKKKKRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRKKKKKKRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRWRRRRRRWRRRRRRRRRRRRRRR",
  "YYYYYYYYYYYYYYYWRRRRRRWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWRRRRRRWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWRRRRRRWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWRRRRRRWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWRRRRRRWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWRRRRRRWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWRRRRRRWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWRRRRRRWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBWYYYYYYWBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBWYYYYYYWBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBmmmmmmBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBmmmmmmBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBmmmmmmBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBmmmmmmBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBmmmmmmBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
];

export const twentySecondLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 22,
  name: "Level 22",

  frame: { width: 38, height: 44 },
  rows: GIFT_BOX_PICTURE,

  ammoQueue: ["blue", "yellow", "red", "pink"],

  sortRadius: 5.81,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 46,
  pixelScale: 1,

  notes: "A two-stage drop (beatchart row 22): two different-coloured plug segments stacked above the lock, so the key only reaches it once BOTH colours have been cleared, in either order.",
};

const TREASURE_CHEST_PICTURE = [
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNKKKKKKNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNKKKKKKNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNWNNNNNNWNNNNNNNNNNNNNNN",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "OOOOOOOOOOOOOOOWNNNNNNWOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOWNNNNNNWOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOObbbbbbOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOObbbbbbOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOObbbbbbOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOObbbbbbOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOObbbbbbOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
];

export const twentyThirdLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 23,
  name: "Level 23",

  frame: { width: 38, height: 44 },
  rows: TREASURE_CHEST_PICTURE,

  ammoQueue: ["orange", "yellow", "brown", "blue"],

  sortRadius: 5.81,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 45,
  pixelScale: 1,
  keyFriction: 0.2,

  notes: "The key itself eases down under friction (beatchart row 23, keyFriction 0.2) as the column beneath it clears — a visibly heavier, more deliberate descent than level 21's instant drop.",
};

const DOUBLE_DOOR_PICTURE = [
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRKKKKKKRRRRRRRRRRRRRRRRKKKKKKRRRRRR",
  "RRRRRRKKKKKKRRRRRRRRRRRRRRRRKKKKKKRRRRRR",
  "RRRRRWRRRRRRWRRRRRRRRRRRRRRWNNNNNNWRRRRR",
  "RRRRRWRRRRRRWRRRRRRRRRRRRRRWNNNNNNWRRRRR",
  "RRRRRWRRRRRRWRRRRRRRRRRRRRRWNNNNNNWRRRRR",
  "RRRRRWRRRRRRWRRRRRRRRRRRRRRWNNNNNNWRRRRR",
  "RRRRRWRRRRRRWRRRRRRRRRRRRRRWNNNNNNWRRRRR",
  "RRRRRWRRRRRRWRRRRRRRRRRRRRRWNNNNNNWRRRRR",
  "YYYYYWRRRRRRWYYYYYYYYYYYYYYWNNNNNNWYYYYY",
  "YYYYYWRRRRRRWYYYYYYYYYYYYYYWNNNNNNWYYYYY",
  "YYYYYWRRRRRRWYYYYYYYYYYYYYYWNNNNNNWYYYYY",
  "YYYYYWRRRRRRWYYYYYYYYYYYYYYWNNNNNNWYYYYY",
  "YYYYYWRRRRRRWYYYYYYYYYYYYYYWNNNNNNWYYYYY",
  "YYYYYWRRRRRRWYYYYYYYYYYYYYYWNNNNNNWYYYYY",
  "YYYYYWRRRRRRWYYYYYYYYYYYYYYWNNNNNNWYYYYY",
  "YYYYYWRRRRRRWYYYYYYYYYYYYYYWNNNNNNWYYYYY",
  "YYYYYWRRRRRRWYYYYYYYYYYYYYYWNNNNNNWYYYYY",
  "YYYYYYccccccYYYYYYYYYYYYYYYYccccccYYYYYY",
  "YYYYYYccccccYYYYYYYYYYYYYYYYccccccYYYYYY",
  "YYYYYYccccccYYYYYYYYYYYYYYYYccccccYYYYYY",
  "GGGGGGccccccGGGGGGGGGGGGGGGGccccccGGGGGG",
  "GGGGGGccccccGGGGGGGGGGGGGGGGccccccGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
];

export const twentyFourthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 24,
  name: "Level 24",

  frame: { width: 40, height: 46 },
  rows: DOUBLE_DOOR_PICTURE,

  ammoQueue: ["green", "yellow", "red", "brown", "cyan"],

  sortRadius: 6.1,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 53,
  pixelScale: 1,

  notes: "Two fully independent locks (beatchart row 24) — either can be opened first, in any order, each in its own rail-walled shaft.",
};

const SAFE_PICTURE = [
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYKKKKKKYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYKKKKKKYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYWNNNNNNWYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBBBBBWNNNNNNWBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBWNNNNNNWBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBWNNNNNNWBBBBBBBBBBBBBBB",
  "BBBBBBBBBWKKKKKKWBBWNNNNNNWBBBBBBBBBBBBBBB",
  "BBBBBBBBBWKKKKKKWBBWNNNNNNWBBBBBBBBBBBBBBB",
  "BBBBBBBBBWOOOOOOWOOWNNNNNNWBBBBBBBBBBBBBBB",
  "BBBBBBBBBWOOOOOOWOOWNNNNNNWBBBBBBBBBBBBBBB",
  "BBBBBBBBBWOOOOOOWOOWNNNNNNWBBBBBBBBBBBBBBB",
  "BBBBBBBBBBppppppppppppppppBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBppppppppppppppppBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBppppppppppppppppBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBppppppppppppppppBBBBBBBBBBBBBBBB",
  "OOOOOOOOOOppppppppppppppppOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOyyyyyyyyyyyyyyyyOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOyyyyyyyyyyyyyyyyOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOyyyyyyyyyyyyyyyyOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOyyyyyyyyyyyyyyyyOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOyyyyyyyyyyyyyyyyOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
];

export const twentyFifthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 25,
  name: "Level 25",

  frame: { width: 42, height: 48 },
  rows: SAFE_PICTURE,

  ammoQueue: ["orange", "blue", "yellow", "brown", "purple"],

  sortRadius: 6.38,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 52,
  pixelScale: 1,

  notes: "The first chained lock (beatchart row 25): key A arrives via its own independent shaft and opens lock A; only once that region is cleared does key B — which was waiting on an ordinary sand buffer directly above lock A, never touching the lock itself — have room to fall onto lock B beneath it. A key that touched a lock it wasn't meant to open yet would spend itself opening it early (unlockPass has no notion of 'whose' lock a key is for), which is exactly what the buffer prevents.",
};

const STONE_VAULT_PICTURE = [
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWWWWMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWWWWMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWWWWMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNKKKKKKNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNKKKKKKNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNWCCCCCCWNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNWCCCCCCWNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNWCCCCCCWNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNWCCCCCCWNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNWCCCCCCWNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNWCCCCCCWNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNWCCCCCCWNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNWCCCCCCWNNNNNNNNNNNNNNNNNN",
  "CCCCCCCCCCCCCCCCWCCCCCCWCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCWCCCCCCWCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCWCCCCCCWCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCWCCCCCCWCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCWCCCCCCWCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCWCCCCCCWCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCWCCCCCCWCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCWCCCCCCWCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCWCCCCCCWCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCrrrrrrCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCrrrrrrCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCrrrrrrCCCCCCCCCCCCCCCCCCC",
  "YYYYYYYYYYYYYYYYYrrrrrrYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYrrrrrrYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYWWWWWYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYWWWWWYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYWWWWWYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
];

export const twentySixthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 26,
  name: "Level 26",

  frame: { width: 42, height: 48 },
  rows: STONE_VAULT_PICTURE,

  ammoQueue: ["yellow", "cyan", "brown", "pink", "red"],

  sortRadius: 6.66,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 51,
  pixelScale: 1,
  keyFriction: 0.15,

  notes: "First real Wall + Lock&Key combination (beatchart row 26) — two decorative wall blocks share the picture with a friction-paced lock, neither interfering with the other.",
};

const DUNGEON_PICTURE = [
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBWWWWWBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWWWWWBB",
  "BBWWWWWBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWWWWWBB",
  "BBWWWWWBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWWWWWBB",
  "BBWWWWWBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWWWWWBB",
  "RRWWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRWWWWWRR",
  "RRWWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRWWWWWRR",
  "RRWWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRWWWWWRR",
  "RRWWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRWWWWWRR",
  "RRWWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRWWWWWRR",
  "RRWWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRWWWWWRR",
  "RRWWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRWWWWWRR",
  "RRWWWWWRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRWWWWWRR",
  "RRWWWWWRRRRRRRRRRRRRRKKKKKKRRRRRRRRRRWWWWWRR",
  "RRWWWWWRRRRRRRRRRRRRRKKKKKKRRRRRRRRRRWWWWWRR",
  "CCWWWWWCCCCCCCCCCCCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCWKKKKKKWCCWRRRRRRWCCCCCCCCCWWWWWCC",
  "YYYYYYYYYYWKKKKKKWYYWRRRRRRWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYWNNNNNNWNNWRRRRRRWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYWNNNNNNWNNWRRRRRRWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYWNNNNNNWNNWRRRRRRWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYyyyyyyyyyyyyyyyyYYYYYYYYYYYYYYYYY",
  "NNNNNNNNNNNyyyyyyyyyyyyyyyyNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNyyyyyyyyyyyyyyyyNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNyyyyyyyyyyyyyyyyNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNyyyyyyyyyyyyyyyyNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
];

export const twentySeventhLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 27,
  name: "Level 27",

  frame: { width: 44, height: 50 },
  rows: DUNGEON_PICTURE,

  ammoQueue: ["brown", "yellow", "cyan", "red", "blue", "green"],

  sortRadius: 6.94,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 60,
  pixelScale: 1,
  keyFriction: 0.2,

  notes: "A chained lock (same design as level 25) plus two wall clusters dividing the frame (beatchart row 27) — six colours, the most this arc has combined at once before its own spike.",
};

const MUSIC_BOX_PICTURE = [
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "YYYYYYYYYYYYYYYYYKKKKKKYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYKKKKKKYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYWYYYYYYWYYYYYYYYYYYYYYYY",
  "MMMMMMMMMMMMMMMMMmmmmmmMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMmmmmmmMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMmmmmmmMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMmmmmmmMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
];

export const twentyEighthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 28,
  name: "Level 28",

  frame: { width: 40, height: 46 },
  rows: MUSIC_BOX_PICTURE,

  ammoQueue: ["pink", "yellow", "cyan", "green"],

  sortRadius: 6.1,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 52,
  pixelScale: 1,

  notes: "Breather before the arc's biggest spike (beatchart row 28) — one small, easy lock, generous budget.",
};

const MOATED_CASTLE_PICTURE = [
  "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
  "PPWWWWWPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPWWWWWPP",
  "PPWWWWWPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPWWWWWPP",
  "PPWWWWWPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPWWWWWPP",
  "CCWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCCCCCCCCCCCKKKKKKCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCCCCCCCCCCCKKKKKKCCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCCCCCCCCCCWRRRRRRWCCCCWWWWWCC",
  "CCWWWWWCCCCCCCCCCCCCCCCCCCCCCWRRRRRRWCCCCWWWWWCC",
  "BBWWWWWBBBBBBBBBBBBWBBBBBBWBBWRRRRRRWBBBBWWWWWBB",
  "BBWWWWWBBBBBBBBBBBBWBBBBBBWBBWRRRRRRWBBBBWWWWWBB",
  "BBWWWWWBBBBBBBBBBBBWBBBBBBWBBWRRRRRRWBBBBWWWWWBB",
  "BBWWWWWBBBBBBBBBBBBWBBBBBBWBBWRRRRRRWBBBBWWWWWBB",
  "BBWWWWWBBBBBBBBBBBBWBBBBBBWBBWRRRRRRWBBBBWWWWWBB",
  "BBWWWWWBBWBBBBBBWBBWBBBBBBWBBWRRRRRRWBBBBWWWWWBB",
  "BBBBBBBBBWBBBBBBWBBWBBBBBBWBBWRRRRRRWBBBBBBBBBBB",
  "BBBBBBBBBWBBBBBBWBBWBBBBBBWBBWRRRRRRWBBBBBBBBBBB",
  "BBBBBBBBBWBBBBBBWBBWBBBBBBWBBWRRRRRRWBBBBBBBBBBB",
  "RRRRRRRRRWRRRRRRWRRWRRRRRRWRRWRRRRRRWRRRRRRRRRRR",
  "RRRRRRRRRWRRRRRRWRRWKKKKKKWRRWRRRRRRWRRRRRRRRRRR",
  "RRRRRRRRRWRRRRRRWRRWKKKKKKWRRWRRRRRRWRRRRRRRRRRR",
  "RRRRRRRRRWRRRRRRWRRWYYYYYYWRRWRRRRRRWRRRRRRRRRRR",
  "RRRRRRRRRWRRRRRRWRRWYYYYYYWRRWRRRRRRWRRRRRRRRRRR",
  "RRRRRRRRRWRRRRRRWRRWYYYYYYWRRWRRRRRRWRRRRRRRRRRR",
  "RRRRRRRRRWKKKKKKWRRRccccccccccccccccRRRRRRRRRRRR",
  "RRRRRRRRRWKKKKKKWRRRccccccccccccccccRRRRRRRRRRRR",
  "RRRRRRRRRWNNNNNNWRRRccccccccccccccccRRRRRRRRRRRR",
  "YYYYYYYYYWNNNNNNWYYYccccccccccccccccYYYYYYYYYYYY",
  "YYYYYYYYYWNNNNNNWYYYccccccccccccccccYYYYYYYYYYYY",
  "YYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYggggggggggggggggYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYppppppYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYppppppYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "NNNNNNNNNNppppppNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNppppppNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNppppppNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
];

export const twentyNinthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 29,
  name: "Level 29",

  frame: { width: 48, height: 54 },
  rows: MOATED_CASTLE_PICTURE,

  ammoQueue: ["brown", "yellow", "red", "blue", "cyan", "purple", "green"],

  sortRadius: 7.22,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 63,
  pixelScale: 1,
  keyFriction: 0.15,

  notes: "The peak of these 30 levels (beatchart row 29): a genuine three-lock chain, A frees B frees C, seven colours, plus two wall clusters dividing the frame — every mechanic this project has built, stacked at once.",
};

const CASTLE_FESTIVAL_PICTURE = [
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNKKKKKKNNNNNNNNNNNNNNNNNNNNNN",
  "NNNNNNNNNNNNNNNNNNNNNNKKKKKKNNNNNNNNNNNNNNNNNNNNNN",
  "OOOOOOOOOOOOOOOOOOOOOWOOOOOOWOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOWOOOOOOWOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOWOOOOOOWOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOWOOOOOOWOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOWOOOOOOWOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOWOOOOOOWOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOWOOOOOOWOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOWOOOOOOWOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOooooooOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOooooooOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOooooooOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOooooooOOOOOOOOOOOOOOOOOOOOOO",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYWWWWWYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYWWWWWYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYWWWWWYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
];

export const thirtiethLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 30,
  name: "Level 30",

  frame: { width: 50, height: 56 },
  rows: CASTLE_FESTIVAL_PICTURE,

  ammoQueue: ["yellow", "orange", "brown", "red", "blue"],

  sortRadius: 7.51,
  // Measured with analyseLevel (app/game/level-analysis.ts).
  shotLimit: 61,
  pixelScale: 1,

  notes: "Capstone (beatchart row 30) — a decorative lock and a decorative wall, opened and cleared almost immediately. The biggest canvas of the first 30 levels, meant to be finished and shown off, not fought.",
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
export const BUILT_IN_LEVELS: SandLevelConfig[] = [
  defaultLevel,
  secondConsequence,
  thirdLevel,
  fourthLevel,
  fifthLevel,
  sixthLevel,
  seventhLevel,
  eighthLevel,
  ninthLevel,
  tenthLevel,
  eleventhLevel,
  twelfthLevel,
  thirteenthLevel,
  fourteenthLevel,
  fifteenthLevel,
  sixteenthLevel,
  seventeenthLevel,
  eighteenthLevel,
  nineteenthLevel,
  twentiethLevel,
  twentyFirstLevel,
  twentySecondLevel,
  twentyThirdLevel,
  twentyFourthLevel,
  twentyFifthLevel,
  twentySixthLevel,
  twentySeventhLevel,
  twentyEighthLevel,
  twentyNinthLevel,
  thirtiethLevel,
  ...EDITOR_LEVELS,
];
