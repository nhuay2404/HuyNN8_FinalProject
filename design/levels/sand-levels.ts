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
  ".............MY.............",
  "............MMMY............",
  "............MMMY............",
  "...........MMMMYY...........",
  "..........MMMMMYYY..........",
  "..........MMMMMYYY..........",
  ".........MMMMMYYNYY.........",
  "........MMMMMYYYYYYY........",
  "........MMNMMYYYYYYY........",
  ".......MMMMMMYYYYYYYY.......",
  ".......MMMMMMYYYYYYYY.......",
  "......MMMMMMMYYYYYYYYY......",
  ".....MMMMMMMMMYYYYYNYYY.....",
  ".....MMMMMMMMMYYYYYYYYY.....",
  "....MMMNMMMMMMMYYYYYYYYY....",
  "...MMMMMMMMMMMMYYYYYYYYYY...",
  "...MMMMMMMMMMMMYYYYYNYYYY...",
  "..MMMMMMMMMMMMMYYYYYYYYYYY..",
  ".MMMMMMMMMMMMMMYYYYYYYYYYYY.",
  ".MMMMMMMMNMMMMYYYYYYYYYYYYY.",
  "MMMMMMMMMMMMMNNYYNYYYYYYYYYY",
  "MMMMMMMMMMMMMNNYYYYYYYYYYYYY",
  "MMMMMMMMMMMMNNNNYYYYYYYYYYYY",
  "MMMMMMMMMMMMNNNNYYYYYYYYYYYY",
  "MMMMMMMMMMMNNNNNNYYYYYYYYYYY",
  "MMMMMMMMMMMNNNNNNYYYYYYYYYYY",
  "MMMMMMMMMMNNNNNNNNYYYYYYYYYY",
  "MMMMMMMMMMNNNNNNNNYYYYYYYYYY",
  "MMMMMMMMMNNNNNNNNNNYYYYYYYYY",
  "MMMMMMMMMNNNNNNNNNNYYYYYYYYY",
  "MMMMMMMMNNNNNNNNNNNNYYYYYYYY",
  "MMMMMMMMNNNNNNNNNNNNYYYYYYYY",
];

export const fourthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 4,
  name: "Level 4",

  frame: { width: 28, height: 32 },
  rows: ICE_CREAM_CONE_PICTURE,

  ammoQueue: ["pink", "yellow", "brown"],

  sortRadius: 4.25,
  // Measured with analyseLevel: strong play clears in 21; careless play
  // (a random cell of the colour in hand) wins all 8 sampled runs at this
  // budget — generous on purpose, this level teaches a cost, not a fail.
  shotLimit: 27,
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
  "..............GG..............",
  ".............RGGG.............",
  ".............RGGG.............",
  "............RRGGGG............",
  "...........RRRRGGGG...........",
  "...........RRRRGGGG...........",
  "..........RRRRRGGGGG..........",
  "..........RRRRRGGGGG..........",
  ".........RRRRRRGGGGGG.........",
  "........RRRRRRRGGGGGGG........",
  "........RRRRRRRGGGGGGG........",
  ".......RRRRRRRRGGGGGGGG.......",
  "......RRRRRRRRRGGGGGGGGG......",
  "......RRRRRRRRRGGGGGGGGG......",
  ".....RRRRRRRRRRGGGGGGGGGG.....",
  "....RRRRRRRRRRRGGGGGGGGGGG....",
  "....RRRRRRRRRRRGGGGGGGGGGG....",
  "...RRRRRRRRRRRRYYYYYYYYYYYY...",
  "...BBBBBBBBBBBBYYYYYYYYYYYY...",
  "..BBBBBBBBBBBBBYYYYYYYYYYYYY..",
  ".BBBBBBBBBBBBBBYYYYYYYYYYYYYY.",
  ".BBBBBBBBBBBBBBYYYYYYYYYYYYYY.",
  "BBBBBBBBBBBBBBBYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBRRRYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBRRRYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBRRRYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBYYYYYYYYYYYYYYY",
];

export const fifthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 5,
  name: "Level 5",

  frame: { width: 30, height: 34 },
  rows: BALLOONS_PICTURE,

  ammoQueue: ["red", "blue", "green", "yellow"],

  sortRadius: 4.53,
  // Measured with analyseLevel: strong play clears in 24; careless play wins
  // 7 of 8 sampled runs at this budget.
  shotLimit: 33,
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
  "..............GG..............",
  ".............GGGG.............",
  ".............GGGG.............",
  "............GGGGGG............",
  "...........GGGGGGGG...........",
  "..........GGGGGGGGGG..........",
  "..........GGGGGGGGGG..........",
  ".........GGGGGGGGGGGG.........",
  "........YYYYYYYYYYYYYY........",
  ".......YYYYYYYYYYYYYYYY.......",
  ".......YYYYYYYYYYYYYYYY.......",
  "......YYYYYYYYYYYYYYYYYY......",
  ".....YYYYYYYYYYYYYYYYYYYY.....",
  "....YYYYYYYYYYYYYYYYYYYYYY....",
  "....YYYYYYYYYYYYYYYYYYYYYY....",
  "...YYYYYYYYYYYYYYYYYYYYYYYY...",
  "..OOOOOOOOOOOOOOOOOOOOOOOOOO..",
  ".OOOOOOOOOOOOOOOOOOOOOOOOOOOO.",
  ".OOOOOOOOOOOOOOOOOOOOOOOOOOOO.",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
];

export const sixthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 6,
  name: "Level 6",

  frame: { width: 30, height: 34 },
  rows: RAINBOW_PICTURE,

  ammoQueue: ["red", "orange", "yellow", "green"],

  sortRadius: 4.53,
  // Measured with analyseLevel: strong play clears in 22; careless play wins
  // all 8 sampled runs at this budget — generous, matching the beatchart's
  // own "Không" (not realistically losable) call for this row.
  shotLimit: 37,
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
  "...............YY...............",
  "..............YYYY..............",
  "..............YYYY..............",
  ".............YYYYYY.............",
  "............YYYYYYYY............",
  "...........YYYYYYYYYY...........",
  "...........GGGGGGGGGG...........",
  "..........GGGGGGGGGGGG..........",
  ".........GGGGGGGGGGGGGG.........",
  "........YYYYYYYYYYYYYYYY........",
  "........YYYYYYYYYYYYYYYY........",
  ".......YYYYYYYYYYYYYYYYYY.......",
  "......BBYYYYYYYYYYYYYYYYBB......",
  ".....BBBYYYYYYYYYYYYYYYYBBB.....",
  ".....BBBBYYYYYYYYYYYYYYBBBB.....",
  "....BBBBYYYYYYYYYYYYYYYYBBBB....",
  "...BBBBBYYYYYYYYYYYYYYYYBBBBB...",
  "..BBBBBYYYYYYYYYYYYYYYYYYBBBBB..",
  ".YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY.",
  ".YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY.",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYNYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYNNNYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYNYYYYYYYYYYYYYYYY",
  "YYYYYYYYNNNYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYNNNYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYNNNYYYYYYYYYYYNYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYNNNYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYNYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
];

export const seventhLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 7,
  name: "Level 7",

  frame: { width: 32, height: 36 },
  rows: TROPHY_PICTURE,

  ammoQueue: ["yellow", "brown", "blue", "green"],

  sortRadius: 4.82,
  // Measured with analyseLevel: strong play clears in 23; careless play wins
  // 5 of 8 sampled runs at this budget — a real chance of failure, matching
  // the beatchart's own "CÓ" (losable) call for this row.
  shotLimit: 31,
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
  "...............BB...............",
  "..............BBBB..............",
  "..............BBBB..............",
  ".............BBBBBB.............",
  "............BBBBBBBB............",
  "...........BBBBBBBCCC...........",
  "...........BBBBBBBCCC...........",
  "..........BBBBBBBBCCCB..........",
  ".........BBBBBBBBBCCCBB.........",
  "........BBBBBBBBBBCCCBBY........",
  "........BBBBBBBBBBCCCBBB........",
  ".......BBBBBBBBBBBCCCBBBB.......",
  "......BBBBBBBBBBBBCCCBBBBB......",
  ".....BBBBBBBBBBBBBCCCBBBBBB.....",
  ".....BBBBBBBBBBBBBCCCBBBBBY.....",
  "....BBBBBBBBBBBBBBCCCBBBBBBY....",
  "...BBBBBBBBBBBBBBBCCCBBBBBBBB...",
  "..BBBBBBBBBBBBBBBBCCCBBYBBBBBB..",
  ".BBBBBBBBBBBBBBBBBCCCBYYYBBBBBB.",
  ".BBBBBBBBBBBBBBBBBCCCBBYBBBBBBB.",
  "BBBBBBBBBBBBBBBBBBCCCBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBCCCBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBCCCBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBCCCBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBCCCBBBBBBBBBBB",
  "BBBBBBBBBBBPPPPPBBCCCBBBBBBBBBBB",
  "BBBBBBBBBPPPPPPPPPCCCBBBBBBBBBBB",
  "BBBBBBBBPPPPPPPPPPPCCBBBBBBBBBBB",
  "BBBBBBBBPPPPPPPPPPPCCBBBBBBBBBBB",
  "BBBBBBBPPPPPPPPPPPPPCBBBBBBBBBBB",
  "BBBBBBBBPPPPPPPPPPPBBBBBBBBBBBBB",
  "BBBBBBBBPPPPPPPPPPPBBBBBBBBBBBBB",
  "BBBBBBBBBPPPPPPPPPBBBBBBBBBBBBBB",
  "BBBBBBBBBBBPPPPPBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
];

export const eighthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 8,
  name: "Level 8",

  frame: { width: 32, height: 36 },
  rows: MUSIC_NOTE_PICTURE,

  ammoQueue: ["purple", "cyan", "yellow", "blue"],

  sortRadius: 4.82,
  // Measured with analyseLevel: strong play clears in 25; careless play wins
  // 5 of 8 sampled runs at this budget — a real chance of failure, matching
  // the beatchart's own "CÓ" (losable) call for this row.
  shotLimit: 30,
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
  "................CC................",
  "...............CCCC...............",
  "...............CCCC...............",
  "..............CCCCCC..............",
  ".............CCCCCCBB.............",
  ".............CCCCCCBB.............",
  "............CCCCCCCBBC............",
  "...........CCCCCCCCCCCC...........",
  "..........CCCCCCCCCCCCCC..........",
  "..........CCCCCCCCCCCCCC..........",
  ".........CCCCCCCCCCCCCCCC.........",
  "........CCCCCCCCCCCCCCCCCC........",
  "........GGCCYYGGCCYYGGCCYY........",
  ".......YGGCCYYGGCCYYGGCCYYG.......",
  "......GGCCYYGGCCYYGGCCYYGGCC......",
  "......GGCCYYGGCCYYGGCCYYGGCC......",
  ".....GCCYYGGCCYYGGCCYYGGCCYYG.....",
  "....GGCCYYGGCCYYGGCCYYGGCCYYGG....",
  "...GCCYYGGCCYYGGCCYYGGCCYYGGCCY...",
  "...GCCYYGGCCYYGGCCYYGGCCYYGGCCY...",
  "..CCYYGGCCYYGGCCYYGGCCYYGGCCYYGG..",
  ".GCCYYGGCCYYGGCCYYGGCCYYGGCCYYGGC.",
  ".CYYGGCCYYGGCCYYGGCCYYGGCCYYGGCCY.",
  "CCYYGGCCYYGGCCYYGGCCYYGGCCYYGGCCYY",
  "YYGGCCYYGGCCYYGGCCYYGGCCYYGGCCYYGG",
  "YYGGCCYYGGCCYYGGCCYYGGCCYYGGCCYYGG",
  "GGCCYYGGCCYYGGCCYYGGCCYYGGCCYYGGCC",
  "GGCCYYGGCCYYGGCCYYGGCCYYGGCCYYGGCC",
  "CCYYGGCCYYGGCCYYGGCCYYGGCCYYGGCCYY",
  "CCYYGGCCYYGGCCYYGGCCYYGGCCYYGGCCYY",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOBBOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOBBOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOBBOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOBBOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOBBOOOOOOOOOOOOOOOO",
  "OOOOOOOOOOOOOOOOBBOOOOOOOOOOOOOOOO",
];

export const ninthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 9,
  name: "Level 9",

  frame: { width: 34, height: 38 },
  rows: FISH_PICTURE,

  ammoQueue: ["cyan", "blue", "orange", "yellow", "green"],

  sortRadius: 5.1,
  // Measured with analyseLevel: strong play clears in 34; careless play wins
  // only 4 of 8 sampled runs at this budget — the spike closing this arc.
  shotLimit: 43,
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
  ".................OO.................",
  "................OOOO................",
  "...............OOOOOO...............",
  "..............OOOOOOOO..............",
  "..............OOOOOOOO..............",
  ".............OOOOOOOOOO.............",
  "............OOOOOOOOOOOO............",
  "...........OOOOOOOOOOOOOO...........",
  "..........OOOOOOOOOOOOOOOO..........",
  ".........OOOOOOOOOOOOOOOOOO.........",
  ".........OOOOOOOOOOOOOOOOOO.........",
  "........OOOOOOOOOOOOOOOOOOOO........",
  ".......OOOOOOOOOOOOOOOOOOOOOO.......",
  "......YYYYYYYYYYYYYYYYYYYYYYYY......",
  ".....YYYYYYYYYYYYYYYYYYYYYYYYYY.....",
  "....YYYYYYYYYYYYYYYYYYYYYYYYYYYY....",
  "...YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY...",
  "...YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY...",
  "..YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY..",
  ".YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY.",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
];

export const tenthLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: 10,
  name: "Level 10",

  frame: { width: 36, height: 40 },
  rows: SUNRISE_PICTURE,

  ammoQueue: ["orange", "yellow", "blue"],

  sortRadius: 5.38,
  // Measured with analyseLevel: strong play clears in 23; careless play wins
  // all 8 sampled runs at this budget — the breather closing this run of
  // levels, matching the beatchart's own "Không" (not realistically losable)
  // call for this row.
  shotLimit: 35,
  pixelScale: 5,

  notes: "Sunrise over the sea (beatchart row 10) — three large, single-body "
    + "bands with no interleaving, a breather after level 9's spike.",
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
  ...EDITOR_LEVELS,
];
