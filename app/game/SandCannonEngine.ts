import * as THREE from "three";
import { ChestStage, type ChestPhase } from "./chest-model.ts";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  disposeCostumeParts,
  getCannonToonRamp,
  getCostume,
  getCostumeThumbnails,
  getSelectedCostume,
  type CostumeDef,
  type CostumeFlavor,
  type CostumeId,
} from "./costumes";
import { haptic, hapticSandLanded } from "./haptics";
import { acquireRenderer, releaseRenderer } from "./renderer-pool";
import { sound, soundSandLanded, startAmbience, stopAmbience } from "./sound";
import {
  SAND_LIGHTNESS_JITTER,
  SAND_SATURATION_JITTER,
  darkenAndSaturate,
  freezeBevelRgb,
  jitterColor,
  keyBevelRgb,
  wallBevelRgb,
} from "./sand-color";
// Only the padlock: the key's shape is whatever cells the level authored, and
// this file draws them rather than deciding them.
import { PADLOCK_SPRITE, spriteCells, spriteHeight, spriteWidth } from "./sand-sprites";
import {
  cellKey,
  cellsByFloodFill,
  createSandGameState,
  currentAmmo,
  effectiveSortRadius,
  addBoosterCharges,
  frozenSet,
  getBoosterCharges,
  groupCells,
  expandLevelForPixelBoard,
  nextAmmo,
  parseSandLevel,
  resolveShot,
  spendBoosterCharge,
} from "./sand-rules";
import type {
  BoosterType,
  CellCoord,
  SandColor,
  SandFreezeTrigger,
  SandGameState,
  SandLevelConfig,
  SettleStep,
} from "./sand-types";

// The presentation half. Everything gameplay here is delegated to sand-rules:
// this file decides how a resolved shot LOOKS, never what it does.
//
// The board itself is a real 2D pixel canvas — one physical texture pixel per
// simulated grid cell, painted with a runtime `CanvasRenderingContext2D` and
// mapped onto a single flat plane inside the still-3D frame. That plane sits
// in world space like a picture in a recess: the frame, the cannon and the
// camera around it are exactly as before. The picture itself is not.
//
// The gameplay grid IS the pixel grid: `expandLevelForPixelBoard` upsamples a
// level's small authored blueprint into the real simulated resolution once,
// at load, and every rule after that — connectivity, the settle solver, the
// radius disc, win/lose — runs directly on those pixels. Nothing here fakes a
// finer look on top of a coarser truth.

// Second palette pass, sourced directly from the reference swatch board the
// designer sent (hex codes copied verbatim, not re-picked by eye). That board
// carries 11 swatches for the 10 gameplay colours; one (a peach/orange
// #EB8D62 close in hue to `orange` below) went unused. Every remaining swatch
// was assigned by hue order to keep neighbours on the wheel from crossing —
// e.g. the four cooler swatches (mint, azure, lavender-grey, violet) land on
// green/cyan/blue/purple in that same ascending order, since the board has no
// pure grass-green or pure sky-blue and this keeps the closest-hue swatch on
// each of the closest-hue roles rather than picking pairs independently.
export const SAND_COLOR_HEX: Record<SandColor, number> = {
  red: 0xff546c,
  green: 0x67e0ba,
  yellow: 0xf4d65e,
  blue: 0x9692b8,
  purple: 0xa28fea,
  orange: 0xf69509,
  cyan: 0x00a9f7,
  pink: 0xff97b2,
  lime: 0xc1ec35,
  brown: 0x998757,
  // Not from the designer's reference board above (it never had a white or a
  // black) — picked to match its register instead: a warm off-white rather
  // than flat #fff (which would read as a blown-out highlight, not sand),
  // a mid graphite grey rather than flat #000 (which would read as a hole/
  // shadow in the frame). Lightened and neutralised from an earlier, darker
  // and slightly purple-tinted pick per feedback that it read as too close
  // to black rather than grey — which also pushes it further from Wall
  // Obstacle's own near-black (`wallBevelRgb`, ./sand-color) than before,
  // not closer, so the two still never get confused for one another.
  white: 0xede7d9,
  black: 0x59565c,
  // The six below round the hue wheel out past the original 12 — grass and
  // sky blue fill the two gaps the reference board itself never had a
  // swatch for (see this const's own header comment), teal and indigo split
  // the wide cool-to-warm gaps either side of them further, and magenta/
  // crimson give the purple/pink cluster and the red cluster each a fully
  // saturated primary the softer originals (`purple`, `red`) deliberately
  // aren't.
  grass: 0x4fd07a,
  teal: 0x1fb6a6,
  skyblue: 0x3d9be0,
  indigo: 0x6c5ce0,
  magenta: 0xe0459e,
  crimson: 0xe8433f,
  // A third batch, past even the eighteen above — see `SAND_COLORS`
  // (sand-types.ts) for why these six specifically. Not sourced from the
  // designer's reference board (it stopped at 18); picked by hand to land in
  // the real gaps that board's own hues left and to add tone the first
  // eighteen had none of (`darkbrown` actually reads dark; `brown` above is
  // tan/khaki) rather than another mid-saturation pastel.
  darkbrown: 0x6b4021,
  violet: 0x9b4fd1,
  navy: 0x2f4b8f,
  emerald: 0x2fae5f,
  rust: 0xd1541f,
  mint: 0xb8f2dd,
};

/** `SAND_COLOR_HEX[color]`, unless `level.customPalette` overrides that one
 * slot for this specific level — see that field's own comment. Every render
 * site below reads through this instead of `SAND_COLOR_HEX` directly so a
 * Zen level's image-derived palette actually shows up on screen. */
function sandColorHex(level: SandLevelConfig, color: SandColor): number {
  return level.customPalette?.[color] ?? SAND_COLOR_HEX[color];
}

// ---- inherited cannon parameters ----------------------------------------
// §20 is explicit that this pivot does not get to invent cannon numbers. Every
// constant in this block is carried over unchanged from the pre-pivot
// prototype's cannon; nothing here was re-tuned for sand.
// (`FIXED_LAUNCH_SPEED` is the one deliberate exception — sped up per a later
// pacing pass, see its own comment.)
const PROJECTILE_RADIUS = 0.15;
const FIXED_STEP = 1 / 60;
/** Bumped up from the inherited 13.2 — per feedback the shot's own flight
 * read as too slow, and the ballistic solver re-aims every shot from scratch
 * (`solveAimAtScreenPoint`), so a faster muzzle speed still hits whatever the
 * crosshair is over, just with less hang time getting there. */
const FIXED_LAUNCH_SPEED = 19;
const SHOT_COOLDOWN_MS = 400;
/** How far the *visible knob* is allowed to travel from centre before it pins
 * to the edge of the pad. Purely cosmetic — keep `.aim-joystick`'s width/height
 * in `globals.css` at exactly double this, since that ring is the drawn size
 * of the same travel this clamps the knob to. The aim response itself does
 * not saturate here; see `JOYSTICK_RESPONSE_RADIUS`. */
const JOYSTICK_RADIUS = 64;
/** How far a drag actually has to travel before the aim response reaches full
 * strength. Deliberately bigger than `JOYSTICK_RADIUS`: a small pad stays easy
 * to glance at and fits in a thumb's natural range, but a small pad's worth of
 * pixels maps too few of them to a comfortable full sweep of aim power — every
 * physical millimetre of drag would swing the aim by too much. Spreading that
 * same 0-to-full response over a longer drag distance is what fixes it; the
 * knob itself just pins at the pad's edge (`JOYSTICK_RADIUS`) well before the
 * player has to stop pulling for the response to keep climbing. */
const JOYSTICK_RESPONSE_RADIUS = 256;
/**
 * `JOYSTICK_RESPONSE_RADIUS` is a fixed screen-pixel distance, but a
 * screen-filling picture (a large or near-square grid like an 80×90 level,
 * whose frame is fitted to use nearly all of both `FIT_WIDTH` and
 * `FIT_HEIGHT` at once — see `cursorForCurrentStick`) needs a drag close to
 * that full 256px to reach its own corners. On a narrow phone viewport that
 * distance can exceed the room a straight drag actually has before the
 * finger runs off the edge of the glass, so the aim reads as permanently
 * capped short of the picture's edge no matter how far the player drags —
 * worse the bigger the picture, since bigger pictures are exactly the ones
 * that need the full distance. Scaling the response radius down to a
 * fraction of the host's own (smaller) dimension keeps full response
 * reachable by a normal drag whatever the device or the level's size, while
 * leaving the original, more generous distance in place on anything roomy
 * enough to actually have it.
 */
const JOYSTICK_RESPONSE_RADIUS_SCREEN_FRACTION = 0.42;
const JOYSTICK_ARM_RADIUS = 18;
/**
 * Grace period for a drag that has wandered outside `host` (the rendered
 * picture-and-cannon scene — the closest thing on screen to "the sand frame"
 * a raw pointer position can be tested against without a per-frame 3D→screen
 * projection of the picture's exact corners). Leaving that area does not cancel
 * the shot on the spot — a thumb sliding past the edge mid-drag is normal touch
 * noise, and `.aim-zone` now spans the whole scene precisely so a drag can start
 * or wander anywhere on it. Only a drag that *stays* outside for this long reads
 * as the player having let go in spirit, so it is cancelled the same way lifting
 * the finger over dead centre is: no shot, cannon resets. Re-entering before the
 * timer fires cancels the timer, not just resets it — a brief overshoot costs
 * nothing.
 */
const AIM_OUTSIDE_ZONE_CANCEL_MS = 1700;
// Exported so the Settings HUD's own sensitivity slider clamps and scales
// against exactly the same range `setControlSensitivity` enforces, rather
// than a second copy of these numbers drifting out of sync with it.
export const MIN_CONTROL_SENSITIVITY = 0.5;
export const MAX_CONTROL_SENSITIVITY = 2;
const CANNON_NEUTRAL_YAW = 0;
const CANNON_NEUTRAL_ELEVATION = 0.24;
const CANNON_MAX_YAW = 0.54;
const CANNON_MIN_ELEVATION = -0.08;
const CANNON_MAX_ELEVATION = 1.08;
const GRAVITY = new THREE.Vector3(0, -9.5, 0);
const AIM_PREDICTION_DURATION = 2.2;
/** Sentinel `pointerId` for `runScriptedShot` — never issued by a real
 * PointerEvent, so real touches never match it in `onAimPointerMove`/`Up`. */
const SCRIPTED_AIM_POINTER_ID = -777;
/** Half of `.aim-crosshair`'s own footprint at its biggest (26px base ×
 * `is-target-valid`'s 1.08 scale ≈ 28px) — the crosshair is centred on its
 * screen position, so clamping that position to this margin from the edge is
 * what makes the icon's own outer edge exactly the limit: full aim reaches
 * until the icon touches the screen, never past it and never stopping short. */
const AIM_CURSOR_EDGE_MARGIN = 14;
const RECOIL_TRAVEL = 0.23;
/**
 * The picture frame's own flinch on impact — a light, quick kick, not the
 * barrel's recoil. `frameRecoil` decays at this rate per second (same shape
 * as `recoil` above); `FRAME_RECOIL_TILT` is the peak tilt in radians, and
 * `FRAME_RECOIL_PUSH` the peak backward nudge along Z, both scaled by how far
 * off-centre the hit landed — a dead-centre hit still nudges straight back,
 * an edge hit rocks the frame toward that edge as well.
 */
const FRAME_RECOIL_DECAY_PER_SECOND = 7.5;
const FRAME_RECOIL_TILT = 0.05;
const FRAME_RECOIL_PUSH = 0.05;
/**
 * Radius Overcharge's own screen shake, layered on top of `frameRecoil`
 * above rather than replacing it — see `radiusShakeAmplitude`'s own field
 * comment. `_TILT` is noticeably bigger than `FRAME_RECOIL_TILT` (on
 * request: "tranh rung mạnh hơn" — the picture shakes harder for this
 * booster specifically). `_DECAY_PER_SECOND` is an exponential rate, not a
 * linear one like `FRAME_RECOIL_DECAY_PER_SECOND`: linear decay stops dead
 * the instant it hits zero, which reads as a cut; exponential decay's own
 * shrinking step size is what makes the last few wobbles visibly smaller
 * than the ones before them, i.e. an actual slow-down rather than a shake at
 * constant strength that just switches off.
 */
const RADIUS_SHAKE_DECAY_PER_SECOND = 3.4;
const RADIUS_SHAKE_FREQUENCY_HZ = 10;
const RADIUS_SHAKE_TILT = 0.11;
/** Below this amplitude the wobble is visually zero — clamped here rather
 * than left to asymptote forever, since exponential decay never actually
 * reaches 0 on its own. */
const RADIUS_SHAKE_STOP_THRESHOLD = 0.01;

/**
 * The "come back and shoot" nudge for a player who has stopped touching the
 * aim zone mid-level — a nag, not a mechanic, so it only ever runs while
 * `canInteract()` is true and no pointer is already down (see
 * `updateIdleHint`).
 *
 * `IDLE_HINT_DELAY_SECONDS` is how long nothing has to happen before it
 * starts. The shake pattern after that is one loop of shake, pause, shake,
 * a longer pause, then repeat (`IDLE_SHAKE_CYCLE`, read in order) — two
 * short flinches read as "look here", a single one reads as a stray glitch,
 * and looping straight into another single flinch with no long rest reads as
 * the frame twitching continuously rather than nudging twice and waiting.
 * Each flinch sits about 4 seconds clear of the next (the pauses between
 * `shake: true` beats), the last one long enough to read as the loop
 * actually resting rather than just the next gap in the pattern.
 */
const IDLE_HINT_DELAY_SECONDS = 10;
const IDLE_SHAKE_CYCLE = [
  { shake: true, seconds: 0.4 },
  { shake: false, seconds: 4 },
  { shake: true, seconds: 0.4 },
  { shake: false, seconds: 7 },
];
const IDLE_SHAKE_CYCLE_SECONDS = IDLE_SHAKE_CYCLE.reduce((sum, beat) => sum + beat.seconds, 0);
/** Peak rotation of the idle shake, in radians — a gentle nudge, not a jolt: this has to read as "look here" from across the frame without startling anyone mid-decision. */
const IDLE_SHAKE_TILT = 0.012;
/** How many little left-right flinches happen within one `shake: true` beat above. */
const IDLE_SHAKE_HZ = 4.5;
/** How bright the current colour's outline pulses — see `redrawSand`'s highlight pass.
 * Slow enough to read as a breath (one full dim-bright-dim cycle every ~2.7s)
 * rather than a blink — a nag that stays calm instead of jittering for attention. */
const IDLE_HIGHLIGHT_HZ = 0.37;
/** The outline's brightest and dimmest points, as a fraction of the way to white.
 * The fade-in peaks at full solid white (1) so the "shoot here" beat actually
 * reads; the fade-out only settles to 30%, never disappearing, so the outline
 * stays visible as a calm, ever-present glow rather than blinking off. */
const IDLE_HIGHLIGHT_FLOOR = 0.3;
const IDLE_HIGHLIGHT_CEILING = 1;
/** Orthogonal only — matches `adjacencyMode: "ORTHOGONAL_4"`, so a border pixel here is a border of the same body the solver reasons about, not a diagonal artifact. */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/**
 * Raised from its original -1.78 (`.booster-hud`'s full-width bottom dock —
 * see globals.css — used to cover the base and turret, leaving only the
 * barrel poking out above it), then tuned by eye across several more rounds
 * of feedback — base deliberately settled down into the tray rather than
 * hovering just above it. `CHANGELOG-prototype.md` has the blow-by-blow if
 * a future value here looks surprising; the short version is that this
 * number has moved several times in both directions and eyeballing it live
 * against the actual dock is more reliable than reasoning about it in the
 * abstract. Paired with `CANNON_MODEL_SCALE` below: raising the rig without
 * shrinking it pushes the muzzle uncomfortably close to the picture.
 */
const CANNON_ROOT_POSITION = new THREE.Vector3(0, -0.3, 5.25);
// Exported for costumes.ts: a costume's muzzle ornament has to line up
// against the same source of truth the engine fires from, not a copy of it.
export const MUZZLE_Z = -2.18;
/**
 * Uniform shrink applied to the whole rig, base to muzzle. Scaled around
 * `cannonRoot`'s own local origin (roughly the base's vertical centre), so
 * the model shrinks toward that point from both ends rather than just
 * getting shorter at the top.
 *
 * Originally 0.8, just enough that the barrel's own raised reach at full
 * elevation stayed clear of `.booster-hud` when that was a small pill
 * floating between the picture and the cannon. Taken down further once that
 * tray became a full-width dock at the very bottom of the scene: the whole
 * body needed to clear it now, not just the barrel's swing, and raising the
 * rig (`CANNON_ROOT_POSITION`) without shrinking it would have crowded the
 * muzzle up against the picture instead.
 */
const CANNON_MODEL_SCALE = 0.68;

// ---- reward chest showcase -----------------------------------------------
// The reward screen's chest is a real 3D stage (`chest-model.ts` — the chest,
// the shaft of light out of its mouth, and the emeralds it throws), shown the
// same way the skin picker's cannon is: drawn by this engine's own renderer
// behind a transparent DOM screen, because the page keeps exactly one WebGL
// context and a second canvas for one overlay would eventually cost the game
// its own.
//
// Everything about how the chest BEHAVES lives in `ChestStage`; this file only
// decides where it stands, how it is framed, and when it gets a tick. The
// ground plane is the stage's own y=0, set low enough in frame that the patch
// of floor the stones land on is actually visible under it.
const CHEST_POSITION = new THREE.Vector3(0, 1.05, 5);
const CHEST_FOV = 43;

export type { ChestPhase } from "./chest-model.ts";

// ---- showcase (skin picker) ----------------------------------------------
// The picker's full-screen preview: the rig moves out to where the camera can
// see it up close, turns slowly and fires demo shots on a loop, so the skin a
// player is looking at is the rig a level will actually hand them — same
// groups (`cannonRoot`/`turret`/`barrelPivot`/`barrelVisual`), same
// `muzzleAnchor`, nothing about the rig itself is faked for the picker.
// Held well back from camera rather than pulled in close — real play's own
// rig sits far from camera too (at `CANNON_ROOT_POSITION`, distance ~9.8
// from the camera's (0,3.3,13.6), see its own `.set` call below), which is
// why its rings read as flat, nearly edge-on ellipses instead of full
// circles: an object subtends a much wider spread of angles across its own
// size up close than it does far away, and that spread — not the centre
// angle to it — is what makes rings look "rounder"/more face-on. Held up
// close, the way an earlier pass at this had it, the same rings widened
// into full circles (a wide-angle-lens close-up effect) no matter what
// angle they sat at. `SHOWCASE_FOV` is the other half of this: a distance
// this size would otherwise read as a speck at real play's 37°-44°
// (`resize()` below), so the showcase narrows the lens to re-magnify it
// back to a normal on-screen size — the same far-away-but-zoomed size a
// telephoto lens gives, without the up-close distortion a wide lens held
// near the subject has. Sits a little below the camera's own dead-centre
// line, not exactly level with it — the barrel points straight away from
// camera at rest (`SHOWCASE_YAW` below), all but invisible end-on until
// `SHOWCASE_SWAY` turns it into profile, and this small a downward tilt is
// what keeps the barrel's own length legible above the muzzle ring for the
// rest of that turn instead of just the ring hanging level with it.
const SHOWCASE_POSITION = new THREE.Vector3(0, 1.55, 5.88);
const SHOWCASE_SCALE = 0.85;
const SHOWCASE_FOV = 43;
// Exactly `CANNON_NEUTRAL_YAW`/`CANNON_NEUTRAL_ELEVATION` below, not a
// bespoke "product shot" angle for the picker — a turned/tilted rig reads
// as a different camera setup for the same cannon, not the cannon a player
// actually sees mid-play. That includes the straight-down-the-bore look
// (every ring lined up into one glowing tunnel instead of spread out into
// individual rings): that IS the real gameplay angle, looking from directly
// behind the cannon, not a framing mistake to steer away from.
const SHOWCASE_ELEVATION = CANNON_NEUTRAL_ELEVATION;
const SHOWCASE_YAW = CANNON_NEUTRAL_YAW;
/** Peak yaw, in radians, of the slow side-to-side turn
 * (`SHOWCASE_SWAY_SPEED` full cycles/second), added on top of
 * `SHOWCASE_YAW`. The picker's only motion now that dragging the rig is
 * gone — enough to swing the barrel out from directly-behind-it into
 * profile and back (see `SHOWCASE_POSITION`'s own comment on why that
 * straight-on view hides the barrel's length in the first place), without
 * reading as a spin the player did not ask for. */
const SHOWCASE_SWAY = 0.4;
const SHOWCASE_SWAY_SPEED = 0.35;
/** Seconds between demo shots — long enough that each one reads as its own
 * beat rather than a stutter of gunfire. */
const SHOWCASE_FIRE_INTERVAL = 1.5;
/** A demo shot never has anything to hit — the picker has no board — so it
 * simply ends in mid-air after this long and plays its landing effect there.
 * That is the thing being shown, not a miss. */
const SHOWCASE_SHOT_FLIGHT = 0.6;
const SHOWCASE_SHOT_SPEED = 9;

// ---- unlock celebration (skin picker) -------------------------------------
// Plays over the showcase rig the instant a new cannon is bought — see
// `playUnlockCelebration`. A full spin rather than the showcase's own gentle
// sway, so buying a skin visibly reads as a different moment from just
// browsing one.
const UNLOCK_SPIN_TURNS_PER_SECOND = 0.75;
const UNLOCK_GLOW_COLOR = 0xffdc75;

// ---- cannon entrance (home screen -> gameplay) ---------------------------
// The gun is hidden entirely on the home screen (`buildCannon`) so the
// picture is the only thing on screen while it turns. The moment the player
// taps Play, `startCannonEntrance` brings it on: the whole rig rises up from
// below the frame, and partway through, the turret drops onto the base from
// above and settles with a small overshoot — the last part snapping into
// place rather than the whole gun sliding in as one block.
const TURRET_REST_Y = 0.46;
const CANNON_RISE_DISTANCE = 3.4;
const CANNON_RISE_SECONDS = 0.8;
const TURRET_DROP_HEIGHT = 1.7;
const TURRET_DROP_SECONDS = 0.5;
const TURRET_DROP_DELAY_SECONDS = 0.34;

// ---- muzzle smoke -----------------------------------------------------
// A quick burst of round white puffs at the muzzle the instant a shot leaves
// it. Solid, not a glow — that's what the recoil flash and chamber halo are
// for — and built from several overlapping blobs rather than one sphere,
// since one sphere reads as a ball and several reads as a cloud.
const MUZZLE_SMOKE_PUFFS = 6;
const MUZZLE_SMOKE_MIN_LIFE = 0.26;
const MUZZLE_SMOKE_MAX_LIFE = 0.46;
const MUZZLE_SMOKE_SPREAD_RADIUS = 0.22;
const MUZZLE_SMOKE_FORWARD_REACH = 0.5;
const MUZZLE_SMOKE_MIN_SCALE = 0.16;
const MUZZLE_SMOKE_MAX_SCALE = 0.46;
const MUZZLE_SMOKE_OPACITY = 0.92;

// ---- sand spray ---------------------------------------------------------
// A burst of grains kicked loose at the point of impact, the instant a shot
// actually lands on sand (not on empty air). Reads as debris rather than
// smoke — small tumbling cubes tinted to the grain they came from, given the
// briefest hop and a small sideways jitter, then pulled straight back down
// hard (see `SAND_SPRAY_GRAVITY_SCALE`) — this is sand giving way and
// dropping, not an explosion scattering it outward.
// Pool ceiling — how many grains a single burst can ever use, when the shot
// clears a whole lot of sand at once. Actual count per burst scales with how
// much sand that shot actually sorted; see `spawnSandSpray`'s `count`.
const SAND_SPRAY_GRAINS = 18;
/** Below this many cleared cells, a burst still shows this many grains — a
 * one-cell clear still needs to read as an impact, not a single flying speck. */
const SAND_SPRAY_MIN_GRAINS = 3;
const SAND_SPRAY_LIFE_SECONDS = 1.1;
// A small sideways jitter only — enough for grains not to fall in perfect
// unison, not the outward burst a real explosion would have. This is sand
// giving way and dropping, not debris flying off an impact.
const SAND_SPRAY_JITTER_MIN_SPEED = 0.15;
const SAND_SPRAY_JITTER_MAX_SPEED = 0.45;
/** A brief hop, just enough to read as "knocked loose" before gravity — an
 * exaggerated version of this reads as an explosion, not a drop. */
const SAND_SPRAY_UP_SPEED = 0.55;
/** Pulled down several times harder than the shot's own ballistic gravity —
 * this is what actually sells "strong pull straight down" rather than a
 * lazy, floaty arc. Bumped again (3.2 -> 5) per feedback asking for a
 * stronger, faster drop overall. */
const SAND_SPRAY_GRAVITY_SCALE = 5;
// Chunky on purpose — small values here render as a couple of stray pixels
// and are effectively invisible against sand of their own colour.
const SAND_SPRAY_MIN_SCALE = 0.9;
const SAND_SPRAY_MAX_SCALE = 1.6;

// ---- sparkle bling (rune-cannon flavor: "magic", hero-cannon's own) ------
// One shared shard pool, two costumes' worth of colours drawn from it: the
// rune costume's faceted light (a burst at the muzzle, a thin trickle while
// a shot is in flight, and a burst again on impact) and the hero costume's
// own leaf-and-gold version of the same three beats — see
// `sparkleBlingColors`, the one place that decides which costume gets a
// burst at all and which palette it draws from. Shards leave the pool by
// shrinking, same as smoke — see `updateSparkles`. Also where a Prism Shot's
// own rainbow trail draws from (`spawnPrismTrail`); sized generously enough
// that its dense, long-lived shards don't round-robin over each other and
// cut the ribbon short, even with a bling trail alive at the same time.
const SPARKLE_POOL_SIZE = 100;
const SPARKLE_DRAG = 0.94;
/** Roughly how often the flight trail spawns a shard — not every tick, or a
 * shot's whole arc would be one continuous smear rather than a trail. */
const SPARKLE_TRAIL_INTERVAL = 0.03;
const SPARKLE_COLORS = [0xffffff, 0xffd54a, 0xff8ad8, 0x9fe8ff];
/** The Hero Cannon's own bling palette — the skin's own tunic green, gold
 * trim and gem teal (`costumes.ts`'s `buildHeroCannon`), so the shards read
 * as leaf-light and gold dust off the cannon's own gear rather than a second
 * coat of the rune costume's white/pink/blue magic. */
const HERO_SPARKLE_COLORS = [0x3fae5a, 0xf4c430, 0x2fd0c4];
/** The Frost Cannon's own bling palette (`costumes.ts`'s `buildFrostCannon`)
 * — icy white/blue/cyan, so the shards read as flung ice glinting rather than
 * the rune costume's warmer magic. */
const FROST_SPARKLE_COLORS = [0xffffff, 0xbdf3ff, 0x7fb8d8, 0xd8eefc];

// ---- the ammo the cannon is carrying ------------------------------------
// The HUD already names the bullet in hand, but the cannon itself said nothing
// about what it was loaded with. These give the model the same answer: a
// chamber in the breech holding the live round and lit by its colour, a band
// of that colour at the muzzle, and the preview queue rolling down a rail into
// the chamber as each shot is spent.
/**
 * Centre of the breech chamber, in barrel space.
 *
 * Forward of the cradle rather than behind it: the camera looks down the gun
 * from above and behind, and anything much further back than this falls off
 * the bottom of the view along with the rail feeding it.
 */
const CHAMBER_POSITION = new THREE.Vector3(0, 0.4, -0.62);
const CHAMBER_BALL_RADIUS = 0.19;
/** Breathing rate of the chamber glow, in cycles per second. */
const CHAMBER_GLOW_HZ = 1.5;
/** Wider than the bore at that point, or the band is buried inside the barrel. */
const MUZZLE_BAND_RADIUS = 0.42;

// ---- booster overlay ------------------------------------------------------
// booster-radius-prism-spec.md §6: a ring layered outside the chamber round
// and the muzzle band while a booster is armed, so the two colour systems —
// "what ammo is loaded" and "what buff is riding on it" — read as stacked
// rather than as one replacing the other.
/** Blue, per spec §6, for Radius Overcharge's overlay ring. Exported so the
 * HUD button drawn in `SandGame.tsx` uses this exact hue rather than a second
 * guess at "the blue". */
export const BOOSTER_RADIUS_RING_HEX = 0x27b5ff;
/**
 * Seven bands for Prism Shot's overlay ring — spec §6's "quang phổ" (spectrum)
 * language, reused from the retired Rainbow Target/Weak Point asset. The game's
 * own wheel only has six colours, so an indigo is inserted between blue and
 * purple to make a seventh band, rather than repeating one of the six.
 * Exported for the same reason as `BOOSTER_RADIUS_RING_HEX` above — one HUD
 * button reuses these colours too.
 */
export const PRISM_SPECTRUM_HEX = [0xff2541, 0xff750e, 0xffb70e, 0x31b950, 0x178ff3, 0x3950e3, 0x8338ed];
/** Gap between spectrum bands, as a fraction of one band's arc — enough that
 * seven flat-coloured wedges actually read as seven, not as one ring. */
const PRISM_BAND_GAP_RATIO = 0.08;
/** How large the Radius Overcharge projectile grows to by the time it
 * reaches the frame — 350% of its normal size, ramped up over the flight by
 * `updateProjectile` rather than matching the shot's actual reach (that read
 * as far too big once a level's own `sortRadius` grew past a modest size). */
const BOOSTER_PROJECTILE_SCALE = 3.5;
/** Full hue cycles per second for a Prism Shot bullet in flight. */
const PRISM_PROJECTILE_HUE_HZ = 1.4;
/** How often a Prism Shot drops a rainbow trail shard along its flight —
 * spec §6's "vệt cầu vồng", a streak of small colour-cycling shards left
 * behind the ball rather than the ball's own hue-cycle alone. Shorter than
 * `SPARKLE_TRAIL_INTERVAL` so the streak reads as one continuous ribbon
 * rather than a dotted line. */
const PRISM_TRAIL_INTERVAL = 0.016;
/** How much bigger the projectile's black rim (`buildProjectileOutline`'s
 * `BackSide` shell) sits than the ball's own scale — a fixed ratio, not a
 * fixed world size, since it rides as a child of the ball mesh and has to
 * stay proportionally the same rim whether Radius Overcharge has puffed the
 * ball up to `BOOSTER_PROJECTILE_SCALE` or not. */
const PROJECTILE_OUTLINE_SCALE = 1.22;

// ---- board presentation --------------------------------------------------
/** The painting is fitted into this opening whatever the authored grid is. */
const FIT_WIDTH = 5.4;
const FIT_HEIGHT = 6.15;
/**
 * How much of the viewport the picture is meant to fill — across, then down.
 *
 * These replace what used to be two hardcoded vertical FOVs picked off one
 * aspect threshold (44 below 0.62, 37 above). One FOV cannot serve two
 * aspects: at the narrowest one the picture nearly touched the sides, and on a
 * shorter, relatively wider window the SAME angle left it filling barely four
 * fifths of the width with a band of dead sky down both edges. `fitFov` below
 * solves for the angle instead, so the picture sits the same distance off the
 * edge whatever shape the window is.
 *
 * Under 1 on purpose: the picture is meant to come close to the edge, not to
 * run off it. The vertical figure is the tighter of the two because the frame
 * hangs well above the camera's own sightline (`FRAME_CENTER_Y`), so its top
 * edge is the thing that runs out of room first on a tall board.
 */
const FRAME_FILL_X = 0.9;
const FRAME_FILL_Y = 0.94;
/** How far the frame's own rails stand outside the picture opening, in cells.
 * Named because three places need the same number: the rails are built to it,
 * hit-testing allows for it, and the fit has to frame the OUTER edge — fitting
 * the picture alone puts the rails past where the fill was aimed. */
const FRAME_BORDER_CELLS = 0.62;
/** Bounds on what `fitFov` may return, so a freak window size cannot hand the
 * camera a degenerate lens. */
const FIT_FOV_MIN = 24;
const FIT_FOV_MAX = 52;

/**
 * Where the camera stands and what it looks at. Constants now rather than two
 * bare position/lookAt calls, because the fit below has to do geometry against
 * them — how far the picture plane is along the sightline, and where that line
 * has got to vertically by the time it reaches it — and neither answer may
 * drift from where the camera actually is.
 */
const CAMERA_POSITION = new THREE.Vector3(0, 3.3, 13.6);
const CAMERA_LOOK_AT = new THREE.Vector3(0, 1, -0.5);
/** Scratch for the fit, which runs on every resize. */
const FIT_FOV_SIGHT = new THREE.Vector3();
/** Raised from the pivot's original 1.95: leaves a band of open sky between
 * the frame's bottom edge and the cannon (CANNON_ROOT_POSITION, unmoved) for
 * `.booster-hud` to sit in. Pushed as high as it safely goes — past ~2.6 the
 * frame's own top edge starts clipping out of the camera's vertical FOV on
 * the narrowest aspect the resize() logic ever produces (portrait capped at
 * FIT_WIDTH-driven 430px wide against the 680px min-height, i.e. the FOV-37
 * branch), since the camera/lookAt below are fixed and never compensate. */
const FRAME_CENTER_Y = 2.6;
const SAND_PLANE_Z = -2.3;
/** Where the pixel plane sits inside the recess, as a fraction of one pixel's world size. */
const PLANE_LOCAL_Z_RATIO = 0.5;
/** Centre and depth of the frame's rear backing panel, as fractions of one pixel's world
 * size. `buildSand` reads these too, to park the back-facing picture just outside it. */
const BACKING_Z_RATIO = -0.72;
const BACKING_DEPTH_RATIO = 0.3;
/**
 * The frame's ordinary colours (wood-brown rails, cream backing/lip) versus
 * its Freeze Map colours (dark blue rails, blue-white backing/lip) — on
 * request, the icy look only applies while the board is actually frozen
 * (`this.state.freezeShotsRemaining > 0`), not for the level's whole life.
 * `syncFreezeVisuals`/`beginFreezeVisualsTransition` swap between these two
 * pairs (via an outward ripple, not an instant cut) as freeze state changes;
 * `buildFrame` just picks the starting one, instantly, with
 * `applyFreezeVisualsInstant`.
 */
const FRAME_RAIL_COLOR = 0xb98a5e;
const FRAME_RAIL_COLOR_FROZEN = 0x2c5f86;
const FRAME_INNER_COLOR = 0xd8c6a6;
const FRAME_INNER_COLOR_FROZEN = 0xdcedf7;
/** How long the frame's colour ripple takes to grow in or shrink away, in ms. */
const FRAME_FREEZE_TRANSITION_MS = 550;
/** How fast the picture turns on the home screen, one full turn per this many seconds. */
const IDLE_SPIN_SECONDS_PER_TURN = 10;
/** How long the picture takes to ease back to its authored, unrotated orientation once the
 * player taps Play. Gameplay stays paused for this stretch — a shot resolved mid-spin would
 * hit the wrong cell, since the aim math assumes frameRoot is unrotated. */
const SPIN_RETURN_SECONDS = 1;
/** How much smaller the picture sits on the home screen than it does during
 * play — shrunk so the frame's own right edge clears the daily-login button
 * floating over that corner of the hub (`.hub-gift-wrap` in globals.css;
 * with the frame at full size its edge sat right under it). Eases back to 1
 * over the same `SPIN_RETURN_SECONDS` stretch the picture's rotation already
 * eases back over once Play is tapped — see `updateFrameSpin`. */
const HUB_FRAME_SCALE = 0.74;

// ---- win reveal ------------------------------------------------------------
// The moment a level clears, before the "Frame cleared" card interrupts: a
// beat of stillness on the finished picture, then it takes a bow — one full
// turn (the same double-sided `frameRoot`/`sandMeshBack` pair the hub idle
// spin already turns, so the back reads correctly mid-turn too) — and holds
// at rest again so the player actually gets to look at what they just
// finished before the card covers it.
/** How long the picture sits still after the last shot before it starts
 * turning — the settle/clear beats (`CLEAR_DURATION_MS` etc.) are still
 * playing out under this, and a turn starting the instant WIN fires would
 * step on that rather than wait for it to read as finished. */
const WIN_REVEAL_DELAY_SECONDS = 0.5;
/** How long the picture's own turn takes — eased in and out
 * (`updateWinReveal`), so this is the turn's total duration, not a constant
 * speed. */
const WIN_REVEAL_SPIN_SECONDS = 1.1;
/** How long the finished picture holds at rest, turn already done, before
 * `SandGame.tsx` lets the "Frame cleared" card appear. */
const WIN_REVEAL_POST_HOLD_SECONDS = 0.6;
/**
 * Total time `SandGame.tsx` keeps the HUD hidden and the WIN result card off
 * screen once a level clears — the still beat, the turn, and the hold after
 * it, back to back. Lives here, next to the animation it is timing, rather
 * than as a guessed number duplicated in SandGame.tsx.
 */
export const WIN_REVEAL_HOLD_MS =
  (WIN_REVEAL_DELAY_SECONDS + WIN_REVEAL_SPIN_SECONDS + WIN_REVEAL_POST_HOLD_SECONDS) * 1000;

// SAND_SATURATION_JITTER / SAND_LIGHTNESS_JITTER live in ./sand-color, shared
// with the editor's preview so a level textures the same in both places.

// ---- settle pacing -------------------------------------------------------
// §24 wants sand that flows without turning into dead time, and Open Decision
// 17 asks how long is too long. Every cascade — whether it is a two-step
// settle or a forty-step collapse — is fitted into the same fixed window, so
// falling sand always reads at one consistent speed rather than crawling for
// big cascades and snapping for small ones. Nothing is ever skipped, just
// spread thinner across more steps.
// Cut down from an original 800 — per feedback the whole board's fall read as
// too slow ("tăng mạnh gravity"), and since every cascade is stretched (or
// squeezed) to fit this one window regardless of its own step count, shrinking
// it is the one knob that speeds up every cascade's fall at once.
const SETTLE_TOTAL_MS = 350;
// A cleared grain flashes solid white first, then vanishes — not a straight
// fade from its own colour, which read as sand quietly dimming rather than
// actually being sorted away. And it does not happen to every grain in the
// batch at once: each one gets its own random start delay inside the overall
// window, so the batch dissolves pixel by pixel — a scattered disintegration
// — rather than the whole cleared patch flashing and fading in lockstep.
const CLEAR_LOCAL_WHITEN_MS = 200;
const CLEAR_LOCAL_VANISH_MS = 100;
/** One grain's own whiten-then-vanish run, once its stagger delay elapses. */
const CLEAR_LOCAL_MS = CLEAR_LOCAL_WHITEN_MS + CLEAR_LOCAL_VANISH_MS;
/** Where a grain's own local run crosses from whitening into vanishing. */
const CLEAR_LOCAL_WHITEN_FRACTION = CLEAR_LOCAL_WHITEN_MS / CLEAR_LOCAL_MS;
/** Overall time the whole batch gets — every grain's delay + its own run
 * fits inside this, so the last straggler is always gone by the time it ends. */
const CLEAR_DURATION_MS = 700;
/** How widely grains' start times spread across the batch's overall window. */
const CLEAR_STAGGER_MS = CLEAR_DURATION_MS - CLEAR_LOCAL_MS;
const NO_MATCH_SHAKE_MS = 360;
/** A beat of stillness after the last grain lands, so the new board can be read. */
const SETTLE_TAIL_MS = 130;

/** How long the disc a radius shot swept stays readable after the impact. */
const SORT_RING_SECONDS = 0.5;
/** The hit flash's opacity the instant it spawns, before it fades over
 * `SORT_RING_SECONDS` — see `aimMaterial`'s own comment in `buildSortRings`
 * for why this went 0.9 -> 0.55 -> 0.8 across the tint feedback. */
const SORT_RING_PEAK_OPACITY = 0.8;
/** How far a shaking pixel is redrawn off its true column, in canvas pixels. */
const SHAKE_DRAW_OFFSET_PX = 1.6;

// ---- map mechanics -------------------------------------------------------
/**
 * How far frozen sand is drawn toward black.
 *
 * Darkening rather than tinting: the colour underneath still has to be
 * readable, because that colour is the bullet the wheel will hand out once the
 * lock opens. Shading it down says "out of play" while leaving the hue intact,
 * which a coloured wash would not.
 */
const LOCK_DARKEN = 0.62;
/** The padlock drawn on top of a locked region, and the smallest region worth one. */
const LOCK_ICON_RGB: readonly [number, number, number] = [236, 243, 255];
const LOCK_ICON_SHADOW_RGB: readonly [number, number, number] = [12, 10, 26];
/** The key's own gold — embossed into a coin by `keyBevelRgb` (./sand-color)
 * — plus a pale glint that orbits the disc as it moves, the one cue that
 * reads as "rolling" on a shape with no notch or seam to track otherwise.
 * No drop shadow (see `redrawSand`). */
const KEY_GLINT_RGB: readonly [number, number, number] = [255, 250, 214];
// ---- key idle sparkle ------------------------------------------------------
// A slow twinkle of warm-gold shards a settled key starts giving off once it
// has sat motionless a while — "I'm still here, still waiting on a lock" for
// a key that can otherwise sit buried in a picture's own colours. Reuses the
// costume sparkle pool (`spawnSparkles`) rather than a pool of its own —
// see `updateKeyIdleSparkle`.
/** How long a key must sit still, in real (`performance.now()`) milliseconds,
 * before it starts sparkling — long enough that a key still mid-fall or
 * mid-roll between settle passes never flickers one on and off. */
const KEY_IDLE_SPARKLE_DELAY_MS = 1500;
/** How often an idle key spawns a fresh little burst — a slow ambient
 * twinkle, not the sparkle bling's own dense one-shot burst. */
const KEY_IDLE_SPARKLE_INTERVAL_MS = 220;
/** The key's own warm gold (same register as `KEY_GLINT_RGB` above), fixed
 * regardless of the equipped cannon skin — this reads as light off the key
 * itself, so it never goes through `sparkleBlingColors()`. */
const KEY_IDLE_SPARKLE_COLORS = [0xfff2b8, 0xffd54a, 0xffe9a3];
// Wall Obstacle's colour — flat matte black, embossed at its own outline,
// colourless on purpose so it never reads as a sand colour the wheel might
// hand out — lives in `wallBevelRgb` (./sand-color), shared with
// `LevelEditor.tsx`'s own preview canvas so a wall looks the same in both.
const THAW_SECONDS = 0.5;
/** How quickly a grain eases up to full lift once the aim radius reaches it —
 * brisk, so the highlight reads as tracking the crosshair rather than lagging
 * behind it. See `PixelCell.lift` and `updateLiftBlocks`. */
const LIFT_RISE_SECONDS = 0.12;
/** Slower than the rise, so a grain the crosshair just drifted past fades
 * rather than snapping off — same "settle back down" feel as `THAW_SECONDS`. */
const LIFT_FALL_SECONDS = 0.22;
/** How far a fully-lifted grain pokes forward along local Z (toward the
 * camera, out of the painting — `+z` is the camera side of `frameRoot`, the
 * same axis a shot's own flight travels back along) — world units, on the
 * same scale as `this.cell`. Real depth, not a texture trick, per the ask
 * that this read as a Z-axis pop rather than the sand texture's own y-shift
 * the first version used. */
const LIFT_Z_DEPTH = 0.16;
/** The shadow quad's own tiny Z nudge above the flat sand plane — just
 * enough that it never z-fights with the texture it sits on, well short of
 * `LIFT_Z_DEPTH` so the lifted face always reads as further forward. */
const LIFT_SHADOW_Z_EPSILON = 0.004;
/** How much bigger than one cell the shadow quad grows at full lift — sized
 * so its corners peek out past the smaller, fully-forward face above it,
 * which is what reads as a thin shadow rimming the lifted grain rather than
 * a shadow-coloured cell in its own right. */
const LIFT_SHADOW_SCALE = 1.4;
/** How far the shadow quad's colour sits toward black — a shadow, not a
 * colour swap, so it stays a dark tint of the grain's own colour. */
const LIFT_SHADOW_DARKEN = 0.55;
/** How far the raised face itself sits toward black, on top of its own true
 * colour — the highlight is meant to read as a deeper, more raised shade of
 * the grain's colour, not a lighter/washed-out one. Much lighter than
 * `LIFT_SHADOW_DARKEN` so the face still reads as clearly closer to the
 * grain's own colour than the shadow rimming it. */
const LIFT_FACE_DARKEN = 0.35;
/** How far the raised face's saturation is pushed toward fully saturated, on
 * top of `LIFT_FACE_DARKEN` — darkening alone flattens a colour's hue, so
 * this keeps the lifted grain reading as a richer, more vivid version of
 * itself instead of just a dimmer one. See `darkenAndSaturate`. */
const LIFT_FACE_SATURATE = 0.3;
/** Never rotated — every lift-block instance faces the same way the flat
 * sand plane already does, so composing its matrix each frame only ever
 * needs a fresh position and scale. Shared rather than a `new THREE.Quaternion()`
 * per lifted cell per frame. */
const LIFT_IDENTITY_QUATERNION = new THREE.Quaternion();

export type SandEngineEvent =
  | { type: "AIM_TOUCHED" }
  | { type: "SHOT_FIRED"; color: SandColor }
  | { type: "SAND_SORTED"; color: SandColor; cells: number }
  | { type: "NO_MATCH"; ammo: SandColor }
  | { type: "MISS"; hitFrame: boolean }
  | { type: "UNLOCKED"; cells: number }
  | { type: "SETTLE_END" }
  /** A booster was just armed — waiting on the next shot to spend it. */
  | { type: "BOOSTER_ARMED"; booster: BoosterType }
  /** The armed booster was tapped a second time and cancelled before firing —
   * no shot spent, no charge spent. */
  | { type: "BOOSTER_DISARMED"; booster: BoosterType }
  /** A booster-charged shot just landed (on request: Radius Overcharge's
   * screen shake) — fired once per impact, from `handleImpact`, whichever
   * booster (if any) that specific shot spent. */
  | { type: "BOOSTER_IMPACT"; booster: BoosterType };

export type SandEngineCallbacks = {
  onState: (state: SandGameState) => void;
  onEvent?: (event: SandEngineEvent) => void;
  onFirstFrame?: () => void;
  /** Fires whenever the armed booster changes — armed, or spent the instant
   * a shot leaves the barrel. `null` means neither is armed. */
  onBoosterChange?: (armed: BoosterType | null) => void;
};

/** One simulated grain — one pixel of the board's canvas, one cell of the grid. */
type PixelCell = {
  x: number;
  y: number;
  color: SandColor;
  bodyId: string;
  /** Fixed at spawn, like every grain's tint in a real sand pile. */
  rgb: readonly [number, number, number];
  /** Milliseconds elapsed since this grain started dying, while it is. */
  dying: number | null;
  /** This grain's own random start delay within the batch's dissolve window
   * — see the comment above `CLEAR_LOCAL_WHITEN_MS`. Meaningless until dying. */
  dyingDelay: number;
  shake: number;
  /** Frozen: drawn as frost, cannot fall, cannot be shot out. */
  locked: boolean;
  /** 1 -> 0 right after a lock opened, so the sand that came free is seen to. */
  thaw: number;
  /** 0 -> 1 while this grain sits inside the shot the crosshair currently
   * reaches and would actually be swept (right colour, unlocked) — eased by
   * `step()` toward whatever `liftTarget` says each fixed step, drawn by
   * `updateLiftBlocks` as a small instanced quad in the grain's own true
   * colour that pops forward along Z in front of the flat sand texture, plus
   * a darker shadow quad rimming it, so sortable sand visibly pokes toward
   * the camera while aiming rather than just glowing in place. */
  lift: number;
};

type Projectile = {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  velocity: THREE.Vector3;
  previous: THREE.Vector3;
  time: number;
  color: SandColor;
  /** Whichever booster was armed when this round left the barrel — already
   * spent (spec §7.1), just riding along so `handleImpact` can hand it to
   * `resolveShot` once the flight ends. */
  booster: BoosterType | null;
  /** Radius Overcharge only: the scale the ball grows to by the time it
   * reaches the frame, computed once at launch by
   * `radiusBoosterMaxProjectileScale` — see `updateProjectile`'s growth
   * ramp. Undefined for every other shot, including a plain Prism Shot. */
  growTargetScale?: number;
};

type Beat =
  | { kind: "CLEAR"; cells: PixelCell[]; ms: number }
  | { kind: "SHAKE_AREA"; center: { x: number; y: number }; radius: number; ms: number }
  | { kind: "STEP"; step: SettleStep; ms: number }
  | { kind: "HOLD"; ms: number };

type BallisticSolution = { start: THREE.Vector3; velocity: THREE.Vector3 };

/** One round white blob in the muzzle smoke pool — see `spawnMuzzleSmoke`. */
type MuzzleSmokePuff = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  startScale: number;
  endScale: number;
};

/** One tumbling grain in the sand-spray pool — see `spawnSandSpray`. */
type SandSprayGrain = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  life: number;
};

/** One shard of magic light in the sparkle pool — see `spawnSparkles`. Unlit,
 * so it reads as light rather than as painted plastic, and it leaves by
 * shrinking the same way the smoke does. */
type SparkleShard = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  gravity: number;
  size: number;
  age: number;
  life: number;
};

/** One demo round fired by the skin picker's showcase — see `launchShowcaseShot`.
 * Deliberately not a `Projectile`: it has no colour, no collision and no
 * cooldown, because it must not be able to touch a level that is only paused
 * behind the picker. */
type ShowcaseShot = {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  velocity: THREE.Vector3;
  time: number;
  trailTicks: number;
};

export type ControlSensitivity = { aim: number };

/** Overshoots past 1 before settling back — used for the turret dropping onto
 * the cannon's base, so the last part of its entrance reads as snapping into
 * place rather than just arriving. */
function easeOutBack(t: number): number {
  const overshoot = 1.7;
  const c3 = overshoot + 1;
  const p = t - 1;
  return 1 + c3 * p ** 3 + overshoot * p ** 2;
}

export class SandCannonEngine {
  private readonly host: HTMLDivElement;
  private readonly aimZone: HTMLDivElement;
  private readonly crosshair: HTMLSpanElement;
  /** Already expanded to pixel resolution — the gameplay grid IS the pixel grid. */
  private readonly level: SandLevelConfig;
  private readonly callbacks: SandEngineCallbacks;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(37, 1, 0.1, 70);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly frameRoot = new THREE.Group();
  private readonly cannonRoot = new THREE.Group();
  private readonly turret = new THREE.Group();
  private readonly barrelPivot = new THREE.Group();
  private readonly barrelVisual = new THREE.Group();
  private readonly muzzleAnchor = new THREE.Object3D();
  private readonly resizeObserver: ResizeObserver;
  private readonly disposables: Array<{ dispose: () => void }> = [];

  /** Which skin the cannon is wearing, and what it built for it — see
   * `costumes.ts`. Not part of `disposables`: a costume can be swapped
   * while the engine keeps running, `setCostume` disposes its own parts. */
  private costume: CostumeDef = getCostume(getSelectedCostume());
  private costumeParts: THREE.Object3D[] = [];

  /** World size of one simulated pixel, fitted to the expanded grid. */
  private readonly cell: number;
  /** Pixels, not blueprint cells — already scaled by expandLevelForPixelBoard. */
  private readonly sortRadius: number;
  /** Shows the disc a radius shot would take, under the crosshair and at impact. */
  private aimRing: THREE.Mesh | null = null;
  private aimRingGlow: THREE.Mesh | null = null;
  private sortRing: THREE.Mesh | null = null;
  private sortRingAge = 0;
  /** How much bigger than its base geometry the current sortRing flash is
   * drawn — 2x (clamped) for a shot that resolved under Radius Overcharge, so
   * the flash marking what a boosted shot actually swept isn't sized for the
   * un-boosted disc. Applied on top of the settle-in animation each frame. */
  private sortRingScale = 1;

  /** Which booster, if any, is armed for the next shot — spec §3: at most one. */
  private armedBooster: BoosterType | null = null;
  /**
   * Real-wallet booster charges `fire()` has spent so far this attempt (one
   * entry per shot, oldest first) — never touched for a level that forces
   * its own scripted charge count (`boosterChargesOverride`), since those
   * reset to that level's own configured amount on every attempt anyway and
   * never need refunding this way.
   *
   * Two refund rules read this list:
   *  - A shot that turns out to be a miss (`handleMiss`) or a `NO_MATCH`
   *    (armed but landed on the wrong colour) refunds its OWN charge right
   *    away and removes it from here — "bắn trượt không tính là đã dùng".
   *  - A shot that ends the attempt in `FAIL` refunds every charge still
   *    left in this list and clears it — "thua thì vẫn được hoàn trả lại
   *    booster". A `WIN` never touches this list; it simply stops mattering
   *    once the engine is torn down for the next attempt.
   */
  private boostersSpentThisAttempt: BoosterType[] = [];
  /** Outer ring around the chambered round / muzzle band for each booster —
   * only one pair is ever visible at once, matching `armedBooster`. */
  private boosterChamberRadiusRing: THREE.Mesh | null = null;
  private boosterChamberPrismRing: THREE.Group | null = null;
  private boosterMuzzleRadiusRing: THREE.Mesh | null = null;
  private boosterMuzzlePrismRing: THREE.Group | null = null;

  /** The colour band at the muzzle: what this cannon is about to fire. */
  private muzzleBand: THREE.Mesh | null = null;
  /** The collar around the base — the same colour as the muzzle band, so the
   * cannon reads its own next shot from any angle, not just head-on. */
  private baseRing: THREE.Mesh | null = null;
  /** Whether the breech is holding a round — false between firing and resolution. */
  private chamberLoaded = true;
  /** The queue the model is currently showing, so a change can be spotted. */
  private ammoKey = "";
  private chamberAge = 0;

  private readonly sandCanvas: HTMLCanvasElement;
  private readonly sandContext: CanvasRenderingContext2D;
  private readonly sandImage: ImageData;
  private readonly sandTexture: THREE.CanvasTexture;
  private readonly sandMesh: THREE.Mesh;
  /** The same picture, facing the opposite way, so the frame is never blank
   * from behind while it turns on the home screen. */
  private readonly sandMeshBack: THREE.Mesh;
  /** One instance per currently-lifted grain, its true colour, popped forward
   * along Z in front of the flat sand texture — see `updateLiftBlocks`. */
  private liftFaceMesh: THREE.InstancedMesh | null = null;
  /** The darker, larger quad sitting just behind each `liftFaceMesh` instance
   * — its corners peek out past the smaller face above it, reading as a thin
   * shadow rimming the lifted grain. */
  private liftShadowMesh: THREE.InstancedMesh | null = null;
  /** Scratch objects `updateLiftBlocks` reuses every frame rather than
   * allocating fresh ones per lifted cell. */
  private readonly liftMatrix = new THREE.Matrix4();
  private readonly liftPosition = new THREE.Vector3();
  private readonly liftScale = new THREE.Vector3();
  private readonly liftColor = new THREE.Color();

  /** Live pixels by "x,y". Rebuilt on every settle step so lookups stay exact. */
  private cells = new Map<string, PixelCell>();
  private dying: PixelCell[] = [];
  /**
   * The keys on the board, by id, as the cells they currently cover.
   *
   * Whatever shape a level authors — a level file draws it as `K` cells like
   * any other fixture — this is that shape's live footprint, and it is what
   * `redrawSand` rasterises straight onto the sand canvas: a key is drawn the
   * same way sand is, not stood in for by a separate object.
   */
  private keys = new Map<string, CellCoord[]>();
  /** Wall Obstacle cells, fixed for the level's whole life — set once in
   * `buildSand` and never touched again, unlike `keys`/lock state above. */
  private walls: CellCoord[] = [];
  /** `this.walls`, as `cellKey` strings — `redrawSand`'s bevel pass does four
   * neighbour lookups per wall pixel every frame, so this is built once
   * alongside `this.walls` rather than re-derived from the array on every
   * single one of those lookups. */
  private wallSet = new Set<string>();
  /**
   * Freeze Map trigger cells still standing, flattened across every trigger
   * on the board. Unlike `walls` this is NOT fixed for the level's whole
   * life — `syncFreezeTriggers` rebuilds it from `this.state.freezeTriggers`
   * every time a shot resolves, since a trigger disappears the instant a
   * shot's disc reaches it.
   */
  private freezeTriggers: CellCoord[] = [];
  /** `this.freezeTriggers`, as `cellKey` strings — same reason `wallSet`
   * exists alongside `walls`: the bevel pass needs four neighbour lookups
   * per pixel, every redraw. */
  private freezeTriggerSet = new Set<string>();
  /** Which trigger each of `this.freezeTriggers`' cells belongs to, keyed by
   * `cellKey` — `redrawSand` reads this against `aimedFreezeTriggerId` to
   * decide which cells (if any) get this frame's white aim-highlight. A
   * board can hold more than one trigger, so "is *a* trigger aimed at" is
   * not enough on its own: this is what lets the highlight single out the
   * one actually under the crosshair. */
  private freezeCellTriggerId = new Map<string, string>();
  /** The trigger the crosshair is currently directly over, or null — set by
   * `updateAimPreview` every time the aim point moves, on request ("cục
   * freeze sẽ highlight lên bằng shadow trắng" khi crosshair nhắm vào nó).
   * Mirrors `triggerAtCell`'s own exact-cell-hit rule (sand-rules.ts) so the
   * highlight only lights up exactly what a shot fired right now would
   * actually arm — never a trigger merely within blast range. */
  private aimedFreezeTriggerId: string | null = null;
  /**
   * One entry per frame piece (backing, lip, 2 rails, 2 posts), each holding
   * the live uniform objects `createFrameFreezeMaterial` wired into that
   * piece's shader — kept around (rather than local to `buildFrame`) so
   * `applyFreezeVisualsInstant`/`beginFreezeVisualsTransition` can repaint
   * them later. `isRail` picks which of the two colour pairs
   * (FRAME_RAIL_COLOR* vs FRAME_INNER_COLOR*) that piece swaps between.
   */
  private frameFreezeMaterials: {
    uniforms: {
      uProgress: { value: number };
      uColorFrom: { value: THREE.Color };
      uColorTo: { value: THREE.Color };
      uCenterLocal: { value: THREE.Vector2 };
      uMaxRadius: { value: number };
      uFringe: { value: number };
    };
    isRail: boolean;
  }[] = [];
  /** Whether the frame/cannon are currently in (or animating toward) their
   * frozen look — compared against `state.freezeShotsRemaining > 0` by
   * `syncFreezeVisuals` to decide whether a new transition needs to start. */
  private freezeVisualsIsFrozen = false;
  /** Whether `updateFreezeVisualsAnimation` has a transition to advance this
   * frame — cheap early-out so it costs nothing while settled either way. */
  private freezeVisualsAnimating = false;
  /** 0..1 through the current transition (or already-finished at 1). */
  private freezeVisualsAnimT = 1;
  /**
   * How far each key has rolled, in radians, accumulated as it moves.
   *
   * A round key has no feature of its own to show it turning, so the glint
   * drawn in `redrawSand` reads its position off this angle — the key does
   * not actually spin, the mark just walks around its rim at the rate a
   * disc of its own measured radius would if it were truly rolling.
   */
  private keyRotation = new Map<string, number>();
  /** Real-time (`performance.now()`) timestamp of each key's last actual
   * shift — stamped at creation (`buildSand`) and on every genuine
   * `KEY_MOVE` (`applyStep`), deleted alongside `keys`/`keyRotation` on
   * `UNLOCK`. `updateKeyIdleSparkle` compares against this to know which
   * keys have sat still long enough to start sparkling. */
  private keyLastMovedAt = new Map<string, number>();
  /** When each idle key last spawned a sparkle burst, so `updateKeyIdleSparkle`
   * can throttle to `KEY_IDLE_SPARKLE_INTERVAL_MS` instead of every tick. */
  private keyLastSparkleAt = new Map<string, number>();
  /** Padlock placements, and whether the locked cells have changed under them. */
  private lockRegionCache: Array<{ icon: CellCoord[] }> = [];
  private lockRegionsDirty = true;

  private state: SandGameState;
  private beats: Beat[] = [];
  private beatElapsed = 0;
  private beatStarted = false;
  private settleLandings = 0;

  private projectile: Projectile | null = null;
  private projectileMesh: THREE.Mesh | null = null;
  /** Shared by every projectile ball's own outline child, real shots and
   * showcase demo shots alike — see `buildProjectileOutline`. */
  private projectileOutlineGeometry: THREE.SphereGeometry | null = null;
  private projectileOutlineMaterial: THREE.MeshBasicMaterial | null = null;

  private yaw = CANNON_NEUTRAL_YAW;
  private elevation = CANNON_NEUTRAL_ELEVATION;
  private recoil = 0;
  /**
   * The frame's own flinch: 0..1, decaying every step (see `step`).
   * `frameRecoilOffsetX/Y` are the impact point's position within the frame,
   * each -1..1 from centre, captured once at the moment of impact and held
   * fixed while `frameRecoil` decays back to 0 — that pair is what makes the
   * kick lean toward wherever the shot actually landed.
   */
  private frameRecoil = 0;
  private frameRecoilOffsetX = 0;
  private frameRecoilOffsetY = 0;
  /**
   * Radius Overcharge's own screen shake (on request: "tranh rung mạnh
   * hơn... rung có tốc độ giảm dần đến khi dừng") — an oscillation layered
   * on top of `frameRecoil` above, not a replacement for it. `radiusShakeTime`
   * is the oscillation's own running clock (only advances while a shake is
   * live); `radiusShakeAmplitude` starts at 1 on a Radius impact and decays
   * exponentially toward 0 every step, which is what makes the wobble settle
   * out smoothly instead of cutting off abruptly once it gets small.
   */
  private radiusShakeAmplitude = 0;
  private radiusShakeTime = 0;
  /**
   * `performance.now()` of the last real input — a pointer going down on the
   * aim zone, or the phase settling back to READY after a shot. Read by
   * `updateIdleHint`, which is the only thing that cares how long this has
   * sat unchanged.
   */
  private lastInputAt = 0;
  /** Seconds into the current loop of `IDLE_SHAKE_CYCLE` — only advances while the hint is actually running (see `updateIdleHint`). */
  private idleHintElapsed = 0;
  /** 0 while the hint is off. Read by `redrawSand`'s border-glow pass. */
  private idleHighlightStrength = 0;
  /** Whatever `currentAmmo` was the instant the hint last turned on — stashed so `redrawSand` does not have to re-derive it. */
  private idleHighlightColor: SandColor | null = null;
  private nextShotAt = 0;
  private aimPointer: number | null = null;
  private readonly aimStart = new THREE.Vector2();
  private readonly aimCurrent = new THREE.Vector2();
  private readonly aimStick = new THREE.Vector2();
  private aimDistance = 0;
  private aimArmed = false;
  private displayedAimArmed = false;
  private displayedLaunch: BallisticSolution | null = null;
  private aimPreviewDirty = false;
  /** Centre/radius/colour-rule of the shot the crosshair currently reaches,
   * or null whenever the player is not actively aiming at a valid target —
   * set once per `updateAimPreview` call, read every fixed step by the lift
   * loop in `step()` rather than recomputed there. */
  private liftTarget: { x: number; y: number; radius: number; color: SandColor; matchColor: boolean } | null = null;
  /** Chain Sort's own lift preview — it has no radius, so `liftTarget` above
   * cannot describe its reach at all. Set instead to the exact cells
   * `cellsByFloodFill` would take from here, recomputed in `updateAimPreview`
   * the same way `liftTarget` is; the two are mutually exclusive (only one
   * is ever non-null at a time, matching which booster is armed). */
  private liftCells: Set<string> | null = null;
  private aimDragSensitivity = 1;
  /** Non-null while the pointer is currently outside `host` mid-drag — see
   * `AIM_OUTSIDE_ZONE_CANCEL_MS`. Cleared the instant the pointer comes back
   * inside, or the gesture ends any other way. */
  private aimOutsideTimer: ReturnType<typeof setTimeout> | null = null;

  private frameId = 0;
  private accumulator = 0;
  private lastFrame = performance.now();
  private paused = false;
  private disposed = false;
  private firstFrameSent = false;

  /** True while the home screen is up — the state `setIdle` is toggling. */
  private idle = true;
  /** Set the moment the player taps Play; cleared once the picture has eased
   * back to rotation 0 and gameplay is unpaused. */
  private spinReturnStart: number | null = null;
  /** frameRoot's rotation.y when the return-to-default animation began. */
  private spinReturnFrom = 0;
  /** Set the moment the player taps Play, alongside `spinReturnStart`; cleared
   * once the cannon has finished rising into place. Null the rest of the
   * time, including the whole time the cannon sits hidden on the home screen. */
  private cannonEntranceStart: number | null = null;

  /** Pool of round white puffs `spawnMuzzleSmoke` recycles on every shot — see
   * `buildMuzzleSmoke`. In `this.scene` directly rather than under the cannon
   * hierarchy: real smoke does not stay glued to the barrel it left. */
  private readonly muzzleSmokePuffs: MuzzleSmokePuff[] = [];

  /** Pool of tumbling grains `spawnSandSpray` recycles on every shot that lands
   * on sand — see `buildSandSpray`. In `this.scene` directly, same reasoning
   * as `muzzleSmokePuffs`: flying debris does not stay glued to anything. */
  private readonly sandSprayGrains: SandSprayGrain[] = [];

  /** Pool of magic shards `spawnSparkles` recycles — the rune costume's
   * muzzle burst, flight trail and impact burst, see `buildSparkles`. Also
   * where a Prism Shot's own rainbow trail (`spawnPrismTrail`) draws from,
   * since both are the same "small coloured shard trickling behind a shot"
   * effect and there is never more than one projectile in flight at once. */
  private readonly sparkleShards: SparkleShard[] = [];
  /** Rolling cursor into `sparkleShards` — a plain round-robin rather than
   * "reuse the first N" (`spawnSandSpray`'s pattern) because a muzzle burst,
   * a flight trail and an impact burst can all be alive at once, and reusing
   * the same first shards every time would cut an earlier effect off rather
   * than letting it fade on its own. */
  private sparkleCursor = 0;
  /** Time since the last flight-trail shard, throttling `updateProjectile`'s
   * trickle to roughly `SPARKLE_TRAIL_INTERVAL` instead of once a tick. */
  private sparkleTrailAge = 0;
  /** Same throttle as `sparkleTrailAge`, kept separate so a Prism Shot fired
   * while wearing the magic costume gets both trails at their own cadence
   * rather than one starving the other. */
  private prismTrailAge = 0;

  /** The reward stage, built the first time the reward screen opens and kept
   * for the life of the engine after that — a player who opens one chest will
   * open more, and it is a few hundred triangles. `null` until then. */
  private chestStage: ChestStage | null = null;
  private chestPhase: ChestPhase | null = null;
  /** What the engine looked like before the chest took the stage, so closing
   * it puts everything back rather than guessing at the home screen's state. */
  private chestRestore: { frameVisible: boolean; cannonVisible: boolean } | null = null;

  /** The skin picker's full-screen preview — see `setShowcase`. Off for the
   * entire rest of the game's life; only the picker ever turns it on. */
  private showcase = false;
  private showcaseTime = 0;
  private showcaseCountdown = 0;
  private showcaseShots: ShowcaseShot[] = [];
  private showcaseShotGeometry: THREE.SphereGeometry | null = null;
  private showcaseMaterials: Record<CostumeFlavor, THREE.MeshBasicMaterial> | null = null;

  /** True for the whole span of `runScriptedShotSequence` (level 31's freeze
   * FTUE) — blocks real pointer input from hijacking the aim gesture the
   * demo is driving, without touching `canInteract()`'s own rules (the
   * scripted shots still go through them via `canStartAim()`). */
  private scriptedShotActive = false;

  /** "New cannon unlocked" celebration — see `playUnlockCelebration`. Built
   * lazily on first use since most sessions never buy a skin, and torn down
   * with everything else `track()` owns. */
  private unlockGlowRing: THREE.Mesh | null = null;
  private unlockGlowDisc: THREE.Mesh | null = null;
  private unlockCelebrationStart: number | null = null;

  /** Level-clear reveal — see `playWinReveal`/`updateWinReveal`. */
  private winRevealStart: number | null = null;

  constructor(
    host: HTMLDivElement,
    aimZone: HTMLDivElement,
    crosshair: HTMLSpanElement,
    rawLevel: SandLevelConfig,
    callbacks: SandEngineCallbacks,
  ) {
    this.host = host;
    this.aimZone = aimZone;
    this.crosshair = crosshair;
    // Expanded once, here, so every line after this treats the picture as
    // whatever resolution it is actually simulated and drawn at.
    this.level = expandLevelForPixelBoard(rawLevel);
    this.callbacks = callbacks;
    this.state = createSandGameState(this.level);
    this.lastInputAt = performance.now();
    // Fitted rather than fixed, so a small board and a large one both fill the
    // frame instead of one of them falling off the top of a phone.
    this.cell = Math.min(FIT_WIDTH / this.level.frame.width, FIT_HEIGHT / this.level.frame.height);
    this.sortRadius = this.level.sortRadius;

    this.sandCanvas = document.createElement("canvas");
    this.sandCanvas.width = this.level.frame.width;
    this.sandCanvas.height = this.level.frame.height;
    this.sandContext = this.sandCanvas.getContext("2d", { willReadFrequently: false })!;
    this.sandImage = this.sandContext.createImageData(this.level.frame.width, this.level.frame.height);
    this.sandTexture = new THREE.CanvasTexture(this.sandCanvas);
    // Nearest, not linear: the whole point is a real pixel board, so the plane
    // must show hard pixel edges rather than a blurred blow-up of a tiny image.
    this.sandTexture.magFilter = THREE.NearestFilter;
    this.sandTexture.minFilter = THREE.NearestFilter;
    this.sandTexture.colorSpace = THREE.SRGBColorSpace;
    const sandMaterial = this.track(
      new THREE.MeshBasicMaterial({ map: this.sandTexture, transparent: true }),
    );
    const sandGeometry = this.track(new THREE.PlaneGeometry(1, 1));
    this.sandMesh = new THREE.Mesh(sandGeometry, sandMaterial);
    // Rotated 180° about Y rather than mirrored in place: that flip is what
    // makes a viewer standing behind a rotated plane see it right-reading
    // instead of backwards, the same trick a two-sided sign uses.
    this.sandMeshBack = new THREE.Mesh(sandGeometry, sandMaterial);
    this.sandMeshBack.rotation.y = Math.PI;

    this.crosshair.classList.remove("is-visible", "is-engaged", "is-aiming", "is-target-valid", "is-cooling-down");
    // Matching --bg in globals.css — the canvas is transparent wherever
    // nothing is drawn, so the frame and cannon need to fade into that same
    // pastel sky as they recede, not into a colour of their own, for the two
    // to blend seamlessly into one continuous "wall" the picture and the
    // cannon stand out against.
    this.scene.fog = new THREE.FogExp2(0xaedee4, 0.02);
    this.camera.position.copy(CAMERA_POSITION);
    this.camera.lookAt(CAMERA_LOOK_AT);
    this.renderer = acquireRenderer(this, this.host);

    this.buildLighting();
    this.buildFrame();
    this.buildSand();
    this.buildLiftBlocks();
    this.buildCannon();
    this.buildSortRings();
    this.buildMuzzleSmoke();
    this.buildSandSpray();
    this.buildSparkles();
    this.bindInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.resetCannonDirection();
    this.showIdleCrosshair();
    this.callbacks.onState(this.cloneState());
    this.animate();
  }

  // ---- scene ------------------------------------------------------------

  /** Neutral on purpose: a warm key or a blue rim would tint every lit
   * material toward that hue, and the whole point of this pass is that
   * nothing lit carries a cast that competes with the sand picture's own
   * colours. The frame and sand stay unlit (`MeshBasicMaterial`) and so are
   * unaffected; the cannon's toon-shaded shell (`MeshToonMaterial`, see
   * `costumes.ts`) is what these lights actually shape — the key gives it a
   * lit face and the rim keeps its shadow side from going flat black. */
  private buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0xf2f2f2, 0x8fa8ab, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.85);
    key.position.set(-4, 7.5, 6.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xababab, 0.75);
    rim.position.set(5, 2.5, -5);
    this.scene.add(rim);
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(item: T) {
    this.disposables.push(item);
    return item;
  }

  /**
   * A thin black rim for a projectile ball, as a child `Mesh` the caller
   * adds to whichever sphere it belongs to (a real shot's `projectileMesh`,
   * or one of the skin picker's showcase demo shots). The classic
   * shader-free outline trick: the same sphere shape, scaled up a fixed
   * ratio (`PROJECTILE_OUTLINE_SCALE`) and flipped to `BackSide` — at the
   * silhouette edge the shell's far wall pokes out past the smaller fill
   * sphere sitting in front of it; everywhere else the fill sphere occludes
   * it, so what reads is a rim, not a solid black ball. Riding as a child
   * means it follows the ball's own position/scale/visibility (including
   * the Radius Overcharge puff-up) for free — nothing has to keep it in
   * sync by hand. Geometry and material are both lazily built once and
   * shared by every ball this ever gets called for, real or showcase.
   */
  private buildProjectileOutline(): THREE.Mesh {
    if (!this.projectileOutlineGeometry) {
      this.projectileOutlineGeometry = this.track(new THREE.SphereGeometry(PROJECTILE_RADIUS, 12, 8));
    }
    if (!this.projectileOutlineMaterial) {
      this.projectileOutlineMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
    }
    const outline = new THREE.Mesh(this.projectileOutlineGeometry, this.projectileOutlineMaterial);
    outline.scale.setScalar(PROJECTILE_OUTLINE_SCALE);
    return outline;
  }

  /**
   * The frame is a real object, not a border drawn on the backdrop.
   *
   * Its inner faces are exactly the walls and floor the solver clamps sand to,
   * so what stops a falling body on screen is the surface the player can see it
   * land on. The sand picture itself sits inside this recess as one flat plane.
   */
  private buildFrame() {
    const openWidth = this.level.frame.width * this.cell;
    const openHeight = this.level.frame.height * this.cell;
    const border = this.cell * FRAME_BORDER_CELLS;
    const depth = this.cell * 1.75;

    this.frameRoot.position.set(0, FRAME_CENTER_Y, SAND_PLANE_Z);
    this.frameRoot.scale.setScalar(this.idle ? HUB_FRAME_SCALE : 1);
    this.scene.add(this.frameRoot);

    // How far a colour-swap ripple has to travel to clear the frame's own
    // farthest corner — the shared "clock" every piece below reads its own
    // `uProgress * uMaxRadius` against, so a single 0..1 progress value
    // sweeps outward from the picture's centre continuously across the
    // backing, the lip and all four rail/post pieces at once, rather than
    // each piece flipping colour on its own separate schedule. `* 1.1`: a
    // small margin past the true corner distance so the very last few
    // pixels are fully swept by the time `uProgress` reaches 1, instead of
    // sitting exactly on the smoothstep's fifty-fifty midpoint.
    const freezeMaxRadius = Math.hypot((openWidth + border * 2) / 2, (openHeight + border * 2) / 2) * 1.1;
    const freezeFringe = border * 0.3;
    this.frameFreezeMaterials = [];

    const backing = this.track(
      new THREE.BoxGeometry(openWidth + border * 0.5, openHeight + border * 0.5, this.cell * BACKING_DEPTH_RATIO),
    );
    // Cream/light-greige by default, swapped to blue-white only while frozen
    // — see `createFrameFreezeMaterial`'s own comment for how the swap
    // itself plays as an outward ripple rather than an instant colour
    // change. Unlit apart from that ripple shader (no Lambert/Phong): flat
    // regardless of the scene's lights, same reasoning as the rail material
    // below. DoubleSide: the picture is seen from both faces (the idle spin
    // shows its back, via `sandMeshBack`), and this recess has to read the
    // same colour behind either one, not just the front.
    const backingMaterial = this.createFrameFreezeMaterial(
      new THREE.Vector2(0, 0),
      false,
      freezeMaxRadius,
      freezeFringe,
      true,
    );
    const back = new THREE.Mesh(backing, backingMaterial);
    back.position.z = this.cell * BACKING_Z_RATIO;
    this.frameRoot.add(back);

    // Flat wood-brown by default, unlit apart from the same ripple shader —
    // the frame reads as one flat painted colour regardless of the scene's
    // lights, the same "sticker" look the cannon's own shell (costumes.ts)
    // and its fixed trim (baseRing/muzzleBand below) already use, rather
    // than a lit surface picking up shading/highlights. Each of the 4
    // rail/post pieces gets its OWN material (not one shared one, unlike
    // before) because each needs its own `uCenterLocal` — the mesh's own
    // offset from the picture's centre — for the ripple to read as
    // continuous across the whole assembled frame rather than four separate
    // rings each centred on its own piece.
    const horizontal = this.track(new RoundedBoxGeometry(openWidth + border * 2, border, depth, 2, border * 0.22));
    const vertical = this.track(new RoundedBoxGeometry(border, openHeight, depth, 2, border * 0.22));

    for (const sign of [1, -1]) {
      const railCenter = new THREE.Vector2(0, (sign * (openHeight + border)) / 2);
      const rail = new THREE.Mesh(
        horizontal,
        this.createFrameFreezeMaterial(railCenter, true, freezeMaxRadius, freezeFringe, false),
      );
      rail.position.set(railCenter.x, railCenter.y, 0);
      this.frameRoot.add(rail);

      const postCenter = new THREE.Vector2((sign * (openWidth + border)) / 2, 0);
      const post = new THREE.Mesh(
        vertical,
        this.createFrameFreezeMaterial(postCenter, true, freezeMaxRadius, freezeFringe, false),
      );
      post.position.set(postCenter.x, postCenter.y, 0);
      this.frameRoot.add(post);
    }

    // A thin lip on the inside edge so the opening reads as a recess holding
    // the sand rather than a picture printed flush on the wall. Same cream
    // as `backingMaterial`: `lip` sits directly behind the sand (closer to
    // camera than `back`), so it — not `back` — is what a straight-on view
    // actually reveals through empty sand pixels. `back` only shows through
    // at an angle, or from behind. Both have to read the same colour, and
    // ripple in step, frozen or not.
    const lipGeometry = this.track(new THREE.BoxGeometry(openWidth, openHeight, this.cell * 0.16));
    const lip = new THREE.Mesh(
      lipGeometry,
      this.createFrameFreezeMaterial(new THREE.Vector2(0, 0), false, freezeMaxRadius, freezeFringe, false),
    );
    lip.position.z = -this.cell * 0.5;
    this.frameRoot.add(lip);

    this.applyFreezeVisualsInstant(this.state.freezeShotsRemaining > 0);
  }

  /**
   * Builds one frame piece's material: a plain flat colour apart from one
   * ripple effect (on request — the colour swap animates as an outward
   * ring from the picture's centre rather than snapping instantly). Since
   * `MeshBasicMaterial` has no per-pixel colour hook of its own, this
   * grafts one on via `onBeforeCompile`: a varying carries each fragment's
   * position in the *picture's* local space (`position.xy + uCenterLocal`,
   * where `uCenterLocal` is this particular mesh's own offset from that
   * shared centre — see the call sites above), and the single line that
   * normally reads `vec4 diffuseColor = vec4( diffuse, opacity )` is
   * replaced with a mix between `uColorFrom`/`uColorTo` keyed on whether
   * that fragment's distance from centre has been overtaken yet by the
   * growing `uProgress * uMaxRadius` ring.
   */
  private createFrameFreezeMaterial(
    centerLocal: THREE.Vector2,
    isRail: boolean,
    maxRadius: number,
    fringe: number,
    doubleSide: boolean,
  ): THREE.MeshBasicMaterial {
    const baseColor = isRail ? FRAME_RAIL_COLOR : FRAME_INNER_COLOR;
    const uniforms = {
      uProgress: { value: 1 },
      uColorFrom: { value: new THREE.Color(baseColor) },
      uColorTo: { value: new THREE.Color(baseColor) },
      uCenterLocal: { value: centerLocal },
      uMaxRadius: { value: maxRadius },
      uFringe: { value: fringe },
    };
    const material = new THREE.MeshBasicMaterial({ side: doubleSide ? THREE.DoubleSide : THREE.FrontSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vFreezeXY;\nuniform vec2 uCenterLocal;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFreezeXY = position.xy + uCenterLocal;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec2 vFreezeXY;\nuniform float uProgress;\nuniform float uMaxRadius;\nuniform float uFringe;\nuniform vec3 uColorFrom;\nuniform vec3 uColorTo;",
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          `float freezeDist = length( vFreezeXY );
           float freezeRadius = uProgress * uMaxRadius;
           float freezeEdge = smoothstep( freezeRadius - uFringe, freezeRadius + uFringe, freezeDist );
           vec3 freezeColor = mix( uColorTo, uColorFrom, freezeEdge );
           vec4 diffuseColor = vec4( freezeColor, opacity );`,
        );
    };
    this.frameFreezeMaterials.push({ uniforms, isRail });
    return this.track(material);
  }

  /**
   * Snap the frame straight to its settled colours for `frozen`, no ripple —
   * used only from `buildFrame`, since a level's opening frame has nothing
   * to animate *from* yet. Every later change goes through
   * `syncFreezeVisuals`/`beginFreezeVisualsTransition` instead, which is
   * what actually plays the ripple.
   */
  private applyFreezeVisualsInstant(frozen: boolean) {
    for (const entry of this.frameFreezeMaterials) {
      const color = entry.isRail
        ? frozen ? FRAME_RAIL_COLOR_FROZEN : FRAME_RAIL_COLOR
        : frozen ? FRAME_INNER_COLOR_FROZEN : FRAME_INNER_COLOR;
      entry.uniforms.uColorFrom.value.setHex(color);
      entry.uniforms.uColorTo.value.setHex(color);
      entry.uniforms.uProgress.value = 1;
    }
    this.freezeVisualsIsFrozen = frozen;
    this.freezeVisualsAnimating = false;
    this.freezeVisualsAnimT = 1;
  }

  /**
   * Called alongside `syncFreezeTriggers`, anywhere a shot can change
   * `state.freezeShotsRemaining` — starts a ripple transition (see
   * `beginFreezeVisualsTransition`) exactly when frozen-vs-not actually
   * flips, and does nothing the other `freezeShotsRemaining - 1`-per-shot
   * ticks while already frozen (there is nothing to re-animate: the frame is
   * already fully in its frozen colours).
   */
  private syncFreezeVisuals() {
    const frozen = this.state.freezeShotsRemaining > 0;
    if (frozen === this.freezeVisualsIsFrozen) return;
    this.beginFreezeVisualsTransition(frozen);
  }

  /**
   * Arms a `FRAME_FREEZE_TRANSITION_MS`-long transition toward `targetFrozen`
   * — `updateFreezeVisualsAnimation` (called every rendered frame from
   * `animate()`) is what actually advances it. Sets each frame material's
   * `uColorFrom`/`uColorTo` for the direction this transition runs, so the
   * ripple always reveals the *new* state, whichever way it's headed.
   */
  private beginFreezeVisualsTransition(targetFrozen: boolean) {
    for (const entry of this.frameFreezeMaterials) {
      const from = entry.isRail
        ? targetFrozen ? FRAME_RAIL_COLOR : FRAME_RAIL_COLOR_FROZEN
        : targetFrozen ? FRAME_INNER_COLOR : FRAME_INNER_COLOR_FROZEN;
      const to = entry.isRail
        ? targetFrozen ? FRAME_RAIL_COLOR_FROZEN : FRAME_RAIL_COLOR
        : targetFrozen ? FRAME_INNER_COLOR_FROZEN : FRAME_INNER_COLOR;
      entry.uniforms.uColorFrom.value.setHex(from);
      entry.uniforms.uColorTo.value.setHex(to);
      entry.uniforms.uProgress.value = 0;
    }
    this.freezeVisualsIsFrozen = targetFrozen;
    this.freezeVisualsAnimating = true;
    this.freezeVisualsAnimT = 0;
  }

  /**
   * Advances whatever `beginFreezeVisualsTransition` armed — the frame's
   * colour ripple. Runs every rendered frame regardless of pause state, same
   * footing as `updateFrameSpin` — freeze can only actually change mid-play,
   * but there is no reason to special-case that here when a no-op
   * `!freezeVisualsAnimating` return already covers idle.
   */
  private updateFreezeVisualsAnimation(deltaMs: number) {
    if (!this.freezeVisualsAnimating) return;
    this.freezeVisualsAnimT = Math.min(1, this.freezeVisualsAnimT + deltaMs / FRAME_FREEZE_TRANSITION_MS);
    // Ease-out cubic: fast start, gentle settle — a ripple that decelerates
    // as it clears the frame's corners rather than arriving abruptly.
    const eased = 1 - (1 - this.freezeVisualsAnimT) ** 3;
    for (const entry of this.frameFreezeMaterials) entry.uniforms.uProgress.value = eased;

    if (this.freezeVisualsAnimT >= 1) this.freezeVisualsAnimating = false;
  }

  /**
   * Populate the pixel grid and paint the canvas once.
   *
   * Every pixel gets its jittered tint here, fixed for its whole life — like
   * every other property a grain is born with, its exact shade is part of what
   * it IS, not something recomputed frame to frame.
   */
  private buildSand() {
    const { bodies, locked, keys, walls, freezeTriggers } = parseSandLevel(this.level);
    const frozen = new Set(locked.map((cell) => cellKey(cell.x, cell.y)));
    this.walls = walls;
    this.wallSet = new Set(walls.map((cell) => cellKey(cell.x, cell.y)));
    this.setFreezeTriggerFields(freezeTriggers);

    for (const body of bodies) {
      for (const cell of body.cells) {
        const seed = cell.x * 733 + cell.y * 197;
        const rgb = jitterColor(sandColorHex(this.level, body.color), seed, SAND_SATURATION_JITTER, SAND_LIGHTNESS_JITTER);
        this.cells.set(cellKey(cell.x, cell.y), {
          x: cell.x,
          y: cell.y,
          color: body.color,
          bodyId: body.id,
          rgb,
          dying: null,
          dyingDelay: 0,
          shake: 0,
          locked: frozen.has(cellKey(cell.x, cell.y)),
          thaw: 0,
          lift: 0,
        });
      }
    }
    for (const key of keys) {
      this.keys.set(key.id, key.cells.map((cell) => ({ ...cell })));
      // A key that never moves at all (already at rest as authored) still
      // deserves its idle sparkle once `KEY_IDLE_SPARKLE_DELAY_MS` passes —
      // starting its clock here, not only on the first `KEY_MOVE`, is what
      // makes that true.
      this.keyLastMovedAt.set(key.id, performance.now());
    }

    const openWidth = this.level.frame.width * this.cell;
    const openHeight = this.level.frame.height * this.cell;
    this.sandMesh.scale.set(openWidth, openHeight, 1);
    this.sandMesh.position.z = this.cell * PLANE_LOCAL_Z_RATIO;
    this.frameRoot.add(this.sandMesh);

    this.sandMeshBack.scale.set(openWidth, openHeight, 1);
    // Just outside the backing panel, so it is fully hidden behind that panel
    // (and the front picture) head-on, and fully clear of it once the frame
    // has turned around.
    this.sandMeshBack.position.z = this.cell * (BACKING_Z_RATIO - BACKING_DEPTH_RATIO / 2 - 0.1);
    this.frameRoot.add(this.sandMeshBack);

    this.redrawSand();
  }

  /**
   * Two instanced meshes, sized to the largest number of grains this level
   * could ever have lifted at once (every cell) — cheap to over-allocate,
   * since an unused instance costs nothing beyond `count` itself, which
   * `updateLiftBlocks` shrinks back down every frame to just what is
   * actually lifted right now.
   *
   * A single shared unit `PlaneGeometry`, same as `sandMesh`'s own, so both
   * instanced meshes face the camera the same way with no rotation to carry
   * per instance — only position and scale ever change.
   */
  private buildLiftBlocks() {
    const maxInstances = Math.max(1, this.level.frame.width * this.level.frame.height);
    const geometry = this.track(new THREE.PlaneGeometry(1, 1));

    this.liftFaceMesh = new THREE.InstancedMesh(
      // Plain white base material, deliberately without `vertexColors` — that
      // flag pulls in a per-vertex `color` geometry attribute this shared
      // plane doesn't have, multiplying every instance to black. Per-instance
      // colour alone (`setColorAt` below) is its own shader path
      // (`USE_INSTANCING_COLOR`) that needs no such attribute.
      geometry,
      this.track(new THREE.MeshBasicMaterial()),
      maxInstances,
    );
    this.liftFaceMesh.count = 0;
    // These move every rendered frame the instant anything is lifted — a
    // frustum culled purely off the (0,0,0)-centred geometry bounds would
    // clip out instances that have walked away from it via their own matrix.
    this.liftFaceMesh.frustumCulled = false;
    this.frameRoot.add(this.liftFaceMesh);

    this.liftShadowMesh = new THREE.InstancedMesh(
      geometry,
      this.track(new THREE.MeshBasicMaterial()),
      maxInstances,
    );
    this.liftShadowMesh.count = 0;
    this.liftShadowMesh.frustumCulled = false;
    this.frameRoot.add(this.liftShadowMesh);
  }

  /**
   * Places one face+shadow instance pair per currently-lifted grain, and
   * shrinks both meshes' `count` down to exactly that many — called once per
   * rendered frame (alongside `redrawSand`, right after `step()`), since it
   * only ever needs to reflect where `cell.lift` ended up this frame, not
   * anything mid-fixed-step.
   *
   * The face quad pops forward along local Z by `cell.lift * LIFT_Z_DEPTH`,
   * in the grain's own true colour — see `PixelCell.lift`'s own comment for
   * why this replaced the first version's texture-side brighten-and-offset.
   * The shadow quad sits almost flush with the sand plane and grows from
   * nothing up to `LIFT_SHADOW_SCALE` cells wide as `lift` rises, so only its
   * corners show past the smaller face above it — a rim, not a full tile.
   */
  private updateLiftBlocks() {
    const faceMesh = this.liftFaceMesh;
    const shadowMesh = this.liftShadowMesh;
    if (!faceMesh || !shadowMesh) return;
    const maxInstances = faceMesh.instanceMatrix.count;
    const baseZ = this.sandMesh.position.z;
    let index = 0;
    for (const cell of this.cells.values()) {
      if (cell.lift <= 0 || index >= maxInstances) continue;
      const { x: worldX, y: worldY } = this.cellWorld(cell.x, cell.y);

      this.liftPosition.set(worldX, worldY, baseZ + cell.lift * LIFT_Z_DEPTH);
      this.liftScale.set(this.cell, this.cell, 1);
      this.liftMatrix.compose(this.liftPosition, LIFT_IDENTITY_QUATERNION, this.liftScale);
      faceMesh.setMatrixAt(index, this.liftMatrix);
      // `cell.rgb` is plain sRGB-encoded 0-255 bytes, same as every value this
      // engine ever writes into the sand canvas (that texture is explicitly
      // marked `SRGBColorSpace` for exactly this reason) — `setRGB` defaults
      // to treating its input as already-linear, which reads these bytes too
      // bright/washed out. Naming the colour space here is what keeps a
      // lifted grain matching the shade of the flat sand right next to it,
      // before `LIFT_FACE_DARKEN`/`LIFT_FACE_SATURATE` push it a step further
      // on purpose.
      const [faceR, faceG, faceB] = darkenAndSaturate(
        cell.rgb[0],
        cell.rgb[1],
        cell.rgb[2],
        LIFT_FACE_DARKEN,
        LIFT_FACE_SATURATE,
      );
      faceMesh.setColorAt(
        index,
        this.liftColor.setRGB(faceR / 255, faceG / 255, faceB / 255, THREE.SRGBColorSpace),
      );

      const shadowSize = this.cell * LIFT_SHADOW_SCALE * cell.lift;
      this.liftPosition.z = baseZ + LIFT_SHADOW_Z_EPSILON;
      this.liftScale.set(shadowSize, shadowSize, 1);
      this.liftMatrix.compose(this.liftPosition, LIFT_IDENTITY_QUATERNION, this.liftScale);
      shadowMesh.setMatrixAt(index, this.liftMatrix);
      shadowMesh.setColorAt(
        index,
        this.liftColor.setRGB(
          (cell.rgb[0] * (1 - LIFT_SHADOW_DARKEN)) / 255,
          (cell.rgb[1] * (1 - LIFT_SHADOW_DARKEN)) / 255,
          (cell.rgb[2] * (1 - LIFT_SHADOW_DARKEN)) / 255,
          THREE.SRGBColorSpace,
        ),
      );

      index += 1;
    }
    faceMesh.count = index;
    shadowMesh.count = index;
    faceMesh.instanceMatrix.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    if (faceMesh.instanceColor) faceMesh.instanceColor.needsUpdate = true;
    if (shadowMesh.instanceColor) shadowMesh.instanceColor.needsUpdate = true;
  }

  /**
   * Paint every live pixel into the canvas and upload it.
   *
   * A full repaint rather than a dirty-rect one: at the resolutions these
   * boards run at (a few hundred to a few thousand pixels), writing every byte
   * fresh each time it is called is comfortably cheap, and it is what keeps
   * this function a pure "draw the current state" — no bookkeeping about what
   * changed since the last call to get subtly wrong.
   */
  private redrawSand() {
    const { width, height } = this.level.frame;
    const data = this.sandImage.data;
    data.fill(0);

    const writePixel = (px: number, row: number, r: number, g: number, b: number, alpha: number) => {
      if (px < 0 || px >= width || row < 0 || row >= height) return;
      const index = (row * width + px) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = alpha;
    };

    // The idle hint's outline: every unlocked cell of the loaded colour that
    // touches a cell of a different colour (or the edge of what is left of
    // its own body) is a border pixel, and glows toward white by
    // `idleHighlightStrength` — a silhouette of "shoot around here" rather
    // than tinting the whole mass, which would just read as a colour swap.
    // Skipped entirely (and cheap to skip) the instant nothing is pulsing.
    const highlightColor = this.idleHighlightStrength > 0 ? this.idleHighlightColor : null;
    const isHighlightBorder = (cell: PixelCell) => {
      if (cell.color !== highlightColor || cell.locked) return false;
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const neighbor = this.cells.get(cellKey(cell.x + dx, cell.y + dy));
        if (!neighbor || neighbor.color !== cell.color) return true;
      }
      return false;
    };

    // Walls first, as a base layer: fixed for the level's whole life, never
    // shared a cell with sand, a key or a lock, so draw order against those
    // never matters — this only has to run before nothing else overwrites it.
    for (const cell of this.walls) {
      // Grid y runs opposite to screen rows (see `writePixel`'s own call
      // below), so "screen up" is `y + 1` here, not `y - 1`.
      const hasUp = this.wallSet.has(cellKey(cell.x, cell.y + 1));
      const hasDown = this.wallSet.has(cellKey(cell.x, cell.y - 1));
      const hasLeft = this.wallSet.has(cellKey(cell.x - 1, cell.y));
      const hasRight = this.wallSet.has(cellKey(cell.x + 1, cell.y));
      const [r, g, b] = wallBevelRgb(hasUp, hasDown, hasLeft, hasRight);
      writePixel(cell.x, height - 1 - cell.y, r, g, b, 255);
    }

    // Freeze Map triggers, same base-layer treatment as walls and for the
    // same reason: fixed shape, never shares a cell with sand/key/lock, and
    // gone the instant it is spent — see `freezeTriggerSet`'s own comment.
    // The one the crosshair is directly over (on request: "stroke chứ không
    // phải fill lớp màu trắng lên") gets a white outline, not a white fill —
    // only the pixels on its own silhouette's edge (touching a cell that is
    // NOT part of this same trigger) turn solid white; every interior pixel
    // keeps its ordinary icy fill untouched.
    const aimedFreezeId = this.aimedFreezeTriggerId;
    for (const cell of this.freezeTriggers) {
      const hasUp = this.freezeTriggerSet.has(cellKey(cell.x, cell.y + 1));
      const hasDown = this.freezeTriggerSet.has(cellKey(cell.x, cell.y - 1));
      const hasLeft = this.freezeTriggerSet.has(cellKey(cell.x - 1, cell.y));
      const hasRight = this.freezeTriggerSet.has(cellKey(cell.x + 1, cell.y));
      let [r, g, b] = freezeBevelRgb(hasUp, hasDown, hasLeft, hasRight);
      if (aimedFreezeId !== null && this.freezeCellTriggerId.get(cellKey(cell.x, cell.y)) === aimedFreezeId) {
        const sameUp = this.freezeCellTriggerId.get(cellKey(cell.x, cell.y + 1)) === aimedFreezeId;
        const sameDown = this.freezeCellTriggerId.get(cellKey(cell.x, cell.y - 1)) === aimedFreezeId;
        const sameLeft = this.freezeCellTriggerId.get(cellKey(cell.x - 1, cell.y)) === aimedFreezeId;
        const sameRight = this.freezeCellTriggerId.get(cellKey(cell.x + 1, cell.y)) === aimedFreezeId;
        if (!sameUp || !sameDown || !sameLeft || !sameRight) [r, g, b] = [255, 255, 255];
      }
      writePixel(cell.x, height - 1 - cell.y, r, g, b, 255);
    }

    for (const cell of this.cells.values()) {
      let [r, g, b] = cell.rgb;
      if (cell.locked) {
        r = Math.round(r * (1 - LOCK_DARKEN));
        g = Math.round(g * (1 - LOCK_DARKEN));
        b = Math.round(b * (1 - LOCK_DARKEN));
      } else if (cell.thaw > 0) {
        // Just came free: flare white and fall back to its own colour.
        const flare = cell.thaw;
        r = Math.round(r + (255 - r) * flare);
        g = Math.round(g + (255 - g) * flare);
        b = Math.round(b + (255 - b) * flare);
      } else if (highlightColor && isHighlightBorder(cell)) {
        r = Math.round(r + (255 - r) * this.idleHighlightStrength);
        g = Math.round(g + (255 - g) * this.idleHighlightStrength);
        b = Math.round(b + (255 - b) * this.idleHighlightStrength);
      }
      // A canvas has no sub-pixel space, so a "shake" is a whole-pixel wobble
      // in where a grain is drawn this frame — its true grid position, which
      // gameplay reasons about, never moves. A lifted grain (`cell.lift`) is
      // drawn here at its normal flat colour and position, unchanged — the
      // actual rise is a real Z-axis pop handled entirely by `updateLiftBlocks`'s
      // instanced meshes, which sit in front of this texture and cover it.
      const offset = cell.shake > 0 ? Math.round(Math.sin(cell.shake * 46) * cell.shake * SHAKE_DRAW_OFFSET_PX) : 0;
      // Row 0 of the canvas is the top of the image; grid y counts up from the
      // floor, so the row a pixel lands on is the mirror of its grid y.
      writePixel(cell.x + offset, height - 1 - cell.y, r, g, b, 255);
    }

    for (const cell of this.dying) {
      // Still waiting on this grain's own stagger delay — sits at its normal
      // colour, untouched, until its turn in the dissolve comes up.
      const local = Math.max(0, (cell.dying ?? 0) - cell.dyingDelay);
      if (local <= 0) {
        writePixel(cell.x, height - 1 - cell.y, cell.rgb[0], cell.rgb[1], cell.rgb[2], 255);
        continue;
      }
      const t = Math.min(1, local / CLEAR_LOCAL_MS);
      if (t < CLEAR_LOCAL_WHITEN_FRACTION) {
        // Flashes to solid white first — reads as the grain actually being
        // sorted away, not just quietly dimming to nothing.
        const whiten = t / CLEAR_LOCAL_WHITEN_FRACTION;
        const r = Math.round(cell.rgb[0] + (255 - cell.rgb[0]) * whiten);
        const g = Math.round(cell.rgb[1] + (255 - cell.rgb[1]) * whiten);
        const b = Math.round(cell.rgb[2] + (255 - cell.rgb[2]) * whiten);
        writePixel(cell.x, height - 1 - cell.y, r, g, b, 255);
      } else {
        const vanish = (t - CLEAR_LOCAL_WHITEN_FRACTION) / (1 - CLEAR_LOCAL_WHITEN_FRACTION);
        const alpha = Math.round(255 * Math.max(0, 1 - vanish));
        writePixel(cell.x, height - 1 - cell.y, 255, 255, 255, alpha);
      }
    }

    // A padlock on each locked region, so what the darkened sand *is* has a
    // name. Drawn after the sand and before the keys — the key is the thing
    // that answers this icon, and it should never be hidden behind one.
    for (const region of this.lockRegions()) {
      for (const cell of region.icon) {
        // A one-pixel shadow, because the icon sits on sand whose colour is not
        // ours to choose and a bare white shape can vanish into a pale one.
        writePixel(cell.x + 1, height - 1 - cell.y + 1, ...LOCK_ICON_SHADOW_RGB, 210);
      }
      for (const cell of region.icon) {
        writePixel(cell.x, height - 1 - cell.y, ...LOCK_ICON_RGB, 255);
      }
    }

    // Keys last, so a key resting in a hollow is never buried by the sand it
    // sits against — it is the one thing on the board the player is tracking.
    // No drop shadow here (unlike the padlock icon above): offsetting a copy
    // of a *round* shape down-right leaves a one-pixel sliver of shadow colour
    // poking out past the fill along the bottom and right rim only, since the
    // fill exactly covers the shadow everywhere else — that sliver is what
    // read as a bite taken out of the disc, not a shadow under it. The gold
    // shape is embossed into a coin (`keyBevelRgb`, same bevel `wallBevelRgb`
    // gives Wall Obstacle), plus a glint cell placed by `keyRotation` so a
    // shape with no notch of its own still reads as turning while it moves —
    // that is the whole drawing.
    // A hidden key (`SandLevelConfig.hiddenKeyRows`) peeks a bit of its own
    // gold through wherever one of its cells is already clear of sand — on
    // request, cell by cell as the picture above it clears, not only once
    // every last one is (see `hiddenKeyRows`'s own comment). Drawn before the
    // real keys below, same "buried key never actually invisible" spirit as
    // that loop's own comment, but reading `this.cells` (not
    // `state.bodies`) for what still covers it: that only drops a cell once
    // its own clear-flash animation actually finishes, so a peeking pixel
    // never pops in a beat ahead of the sand it was under visibly leaving.
    // No glint and no rotation — unlike a real key this one is not moving
    // yet, so nothing here needs recomputing once a frame decides nothing
    // changed underneath it.
    for (const hidden of this.state.hiddenKeys) {
      const hiddenCellSet = new Set(hidden.cells.map((cell) => cellKey(cell.x, cell.y)));
      for (const cell of hidden.cells) {
        if (this.cells.has(cellKey(cell.x, cell.y))) continue;
        const hasUp = hiddenCellSet.has(cellKey(cell.x, cell.y + 1));
        const hasDown = hiddenCellSet.has(cellKey(cell.x, cell.y - 1));
        const hasLeft = hiddenCellSet.has(cellKey(cell.x - 1, cell.y));
        const hasRight = hiddenCellSet.has(cellKey(cell.x + 1, cell.y));
        const rgb = keyBevelRgb(hasUp, hasDown, hasLeft, hasRight);
        writePixel(cell.x, height - 1 - cell.y, ...rgb, 255);
      }
    }

    for (const [id, cells] of this.keys) {
      const xs = cells.map((cell) => cell.x);
      const ys = cells.map((cell) => cell.y);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 || 1;
      const angle = this.keyRotation.get(id) ?? 0;
      // Sits inboard of the rim, not on it — a glint riding the actual edge
      // disappears whenever the rotation happens to point it off the shape's
      // own filled cells.
      const glintX = centerX + Math.cos(angle) * radius * 0.55;
      const glintY = centerY + Math.sin(angle) * radius * 0.55;
      let glintCell = cells[0];
      let bestDistance = Infinity;
      for (const cell of cells) {
        const distance = (cell.x - glintX) ** 2 + (cell.y - glintY) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          glintCell = cell;
        }
      }
      // Screen-space neighbour lookup for the bevel, scoped to this one
      // key's own cells (a handful to a few dozen) and rebuilt every frame
      // rather than cached like `wallSet` — unlike a wall, a key's shape
      // never sits still long enough for a cache to pay for itself.
      const keyCellSet = new Set(cells.map((cell) => cellKey(cell.x, cell.y)));
      for (const cell of cells) {
        if (cell === glintCell) {
          writePixel(cell.x, height - 1 - cell.y, ...KEY_GLINT_RGB, 255);
          continue;
        }
        const hasUp = keyCellSet.has(cellKey(cell.x, cell.y + 1));
        const hasDown = keyCellSet.has(cellKey(cell.x, cell.y - 1));
        const hasLeft = keyCellSet.has(cellKey(cell.x - 1, cell.y));
        const hasRight = keyCellSet.has(cellKey(cell.x + 1, cell.y));
        const rgb = keyBevelRgb(hasUp, hasDown, hasLeft, hasRight);
        writePixel(cell.x, height - 1 - cell.y, ...rgb, 255);
      }
    }

    this.sandContext.putImageData(this.sandImage, 0, 0);
    this.sandTexture.needsUpdate = true;
  }

  /**
   * Where to stamp a padlock, one per connected region of frozen sand.
   *
   * Recomputed only when the set of locked cells actually changes — which is
   * once at load and once per lock opened, not once per frame. The icon is
   * scaled to the region and dropped entirely when the region is too small to
   * hold one: a padlock spilling over the sand it labels would read as debris.
   */
  private lockRegions() {
    if (!this.lockRegionsDirty) return this.lockRegionCache;
    this.lockRegionsDirty = false;

    const frozen = [...this.cells.values()].filter((cell) => cell.locked);
    this.lockRegionCache = groupCells(frozen.map((cell) => ({ x: cell.x, y: cell.y })))
      .map((region) => {
        const xs = region.map((cell) => cell.x);
        const ys = region.map((cell) => cell.y);
        const left = Math.min(...xs);
        const bottom = Math.min(...ys);
        const width = Math.max(...xs) - left + 1;
        const height = Math.max(...ys) - bottom + 1;
        const scale = Math.floor(Math.min(
          width / (spriteWidth(PADLOCK_SPRITE) + 2),
          height / (spriteHeight(PADLOCK_SPRITE) + 2),
        ));
        if (scale < 1) return { icon: [] as CellCoord[] };

        const iconWidth = spriteWidth(PADLOCK_SPRITE) * scale;
        const iconHeight = spriteHeight(PADLOCK_SPRITE) * scale;
        const originX = left + Math.floor((width - iconWidth) / 2);
        const originY = bottom + Math.floor((height - iconHeight) / 2);
        // Only the parts of the icon that land on frozen sand. A region is not
        // always a rectangle, and the label belongs on the thing it labels.
        const inside = new Set(region.map((cell) => cellKey(cell.x, cell.y)));
        const icon = spriteCells(PADLOCK_SPRITE, scale)
          .map((cell) => ({ x: originX + cell.x, y: originY + cell.y }))
          .filter((cell) => inside.has(cellKey(cell.x, cell.y)));
        return { icon };
      })
      .filter((region) => region.icon.length > 0);
    return this.lockRegionCache;
  }

  private buildCannon() {
    // Hidden until the player actually enters a level — the home screen shows
    // off the picture, not the gun it will be shot with. `setIdle` toggles this.
    this.cannonRoot.visible = false;
    this.cannonRoot.position.copy(CANNON_ROOT_POSITION);
    this.cannonRoot.scale.setScalar(CANNON_MODEL_SCALE);
    this.scene.add(this.cannonRoot);
    this.turret.position.y = TURRET_REST_Y;
    this.cannonRoot.add(this.turret);
    this.barrelPivot.position.y = 0.12;
    this.turret.add(this.barrelPivot);
    this.barrelPivot.add(this.barrelVisual);
    this.muzzleAnchor.position.z = MUZZLE_Z;
    this.barrelPivot.add(this.muzzleAnchor);

    // The decorative shell — pedestal, cradle, barrel, muzzle ornament — is
    // whatever the equipped costume builds (see `costumes.ts`). Everything
    // below this line is costume-agnostic: it communicates gameplay state
    // (ammo colour, boosters, radius) and stays the same for every skin.
    this.buildCostumeRig();

    // Its own material, not the costume's — fixed dark slate, independent of
    // both the costume's shell and the muzzle band.
    this.baseRing = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(0.86, 0.11, 14, 40)),
      // Toon-shaded slate, matching the costume shell's own materials — same
      // stepped light falloff on the cannon's fixed trim as on the shell.
      // Was gold (0xffc233); moved to a cool dark tone so the shell has no
      // yellow left in it.
      this.track(new THREE.MeshToonMaterial({ color: 0x333c50, gradientMap: getCannonToonRamp() })),
    );
    this.baseRing.rotation.x = Math.PI / 2;
    this.baseRing.position.y = 0.27;
    this.cannonRoot.add(this.baseRing);

    // A painted line around the lip, matching `baseRing`'s slate — fixed
    // trim now rather than a preview of the chambered colour (see
    // `syncAmmoModel`'s comment: that signal moved to the background).
    this.muzzleBand = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(MUZZLE_BAND_RADIUS, 0.045, 10, 32)),
      this.track(new THREE.MeshToonMaterial({ color: 0x333c50, gradientMap: getCannonToonRamp() })),
    );
    this.muzzleBand.position.z = MUZZLE_Z + 0.2;
    this.barrelVisual.add(this.muzzleBand);

    this.syncAmmoModel();
    this.buildBoosterOverlay();
    this.applyCannonTransform();
  }

  /** Builds the equipped costume's decorative shell onto the rig groups and
   * records what it added, so `setCostume` can cleanly tear it back down. */
  private buildCostumeRig() {
    this.costumeParts = this.costume.build({
      cannonRoot: this.cannonRoot,
      turret: this.turret,
      barrelPivot: this.barrelPivot,
      barrelVisual: this.barrelVisual,
    });
  }

  /**
   * The sparkle bling's own palette for the equipped costume, or `null` for
   * a costume that gets none — every muzzle/trail/impact burst call site asks
   * this one question instead of naming a specific costume, so a second (and
   * third, ...) skin can carry its own bling without becoming "magic" itself
   * or duplicating the rune costume's exact colours.
   */
  private sparkleBlingColors(): number[] | null {
    if (this.costume.flavor === "magic") return SPARKLE_COLORS;
    if (this.costume.id === "hero-cannon") return HERO_SPARKLE_COLORS;
    if (this.costume.id === "frost-cannon") return FROST_SPARKLE_COLORS;
    return null;
  }

  /**
   * Swaps the cannon's decorative shell for another costume's, live — purely
   * visual, and purely a preview: it does NOT persist the choice. The picker
   * calls this on every card it previews, and `SandGame.tsx`'s own "Select"
   * button is what actually saves one (`setSelectedCostume`, `costumes.ts`) —
   * the same split the historical prototype's cosmetic picker used, so
   * browsing skins never overwrites the one a player has not confirmed yet.
   * The frame, the aim math and any shot already in flight are all untouched
   * — see `CostumeRigGroups`'s own contract in costumes.ts.
   */
  setCostume(id: CostumeId) {
    if (this.costume.id === id) return;
    disposeCostumeParts(this.costumeParts);
    this.costumeParts = [];
    this.costume = getCostume(id);
    this.buildCostumeRig();
  }

  getCostumeId(): CostumeId {
    return this.costume.id;
  }

  /** Rendered with the engine's own renderer, because the page keeps exactly
   * one WebGL context and a second one would eventually cost the game its
   * canvas — see `getCostumeThumbnails` in costumes.ts. */
  captureCostumeThumbnails() {
    return getCostumeThumbnails(this.renderer);
  }

  /**
   * The skin picker's full-screen preview: the rig moves out to
   * `SHOWCASE_POSITION`, turns slowly and fires demo shots on a loop, so the
   * skin on screen is the same rig a level will hand the player — nothing
   * here moves `muzzleAnchor` or touches the aim math, only where the whole
   * rig sits and how it is framed.
   *
   * The picker is only ever reachable from the paused home screen (`idle`),
   * so `step()` — and with it every real-gameplay tick — never runs while
   * this is on; `animate()` drives `updateShowcase`/`updateMuzzleSmoke`/
   * `updateSparkles` directly instead, on real elapsed time rather than the
   * fixed step the paused gameplay loop would otherwise supply them.
   */
  setShowcase(next: boolean) {
    if (this.showcase === next) return;
    this.showcase = next;
    // A burst lives past the moment it was fired in either direction: the
    // game must not inherit a showcase burst, and the showcase must not open
    // into the tail of one still fading from real play.
    this.clearTransientEffects();
    this.clearShowcaseShots();
    if (next) {
      this.showcaseTime = 0;
      this.showcaseCountdown = 0.3;
      // A demo shot fired the instant the entrance animation was mid-rise
      // would leave the rig split between two animations; the picker only
      // ever opens from the idle home screen, where there is none in flight,
      // but cancelling it here costs nothing and keeps that a fact this
      // method does not have to trust.
      this.cannonEntranceStart = null;
      this.cannonRoot.visible = true;
      this.cannonRoot.position.copy(SHOWCASE_POSITION);
      this.cannonRoot.scale.setScalar(SHOWCASE_SCALE);
      this.cannonRoot.rotation.y = SHOWCASE_YAW;
      this.yaw = CANNON_NEUTRAL_YAW;
      this.elevation = SHOWCASE_ELEVATION;
      this.applyCannonTransform();
      // Narrows to `SHOWCASE_FOV` — see its own comment — so a rig held
      // this far from camera still fills the frame instead of shrinking to
      // a speck. `resize()` reapplies this same narrow FOV on its own if a
      // resize fires while the showcase is still up (an orientation change,
      // say), rather than snapping back to real play's wide one.
      this.camera.fov = SHOWCASE_FOV;
      this.camera.updateProjectionMatrix();
      // The stage is the rig alone — the board it would otherwise be aiming
      // at has nothing to do with picking a skin, and neither does a sight:
      // there is nothing to aim at, so the crosshair stays exactly as hidden
      // as it already is on the paused home screen underneath this screen.
      this.frameRoot.visible = false;
      return;
    }
    this.recoil = 0;
    this.barrelVisual.position.z = 0;
    this.cannonRoot.rotation.y = 0;
    // A celebration left running behind a tab switch must not resume once
    // the picker is reopened later.
    this.unlockCelebrationStart = null;
    if (this.unlockGlowRing) this.unlockGlowRing.visible = false;
    if (this.unlockGlowDisc) this.unlockGlowDisc.visible = false;
    this.cannonRoot.position.copy(CANNON_ROOT_POSITION);
    this.cannonRoot.scale.setScalar(CANNON_MODEL_SCALE);
    // The picker is only reachable from the home screen, which shows the
    // cannon nowhere at all.
    this.cannonRoot.visible = false;
    this.frameRoot.visible = true;
    this.camera.fov = this.fitFov(this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.resetCannonDirection();
  }

  /**
   * Puts the reward chest on stage, on the given beat of its opening, or takes
   * it off again with `null`. Only ever called from the home screen, which is
   * paused and idle — the same footing the skin picker's `setShowcase` works
   * from, so `step()` never runs underneath it and `animate()` drives the
   * chest's own timers directly off real elapsed time.
   *
   * Re-entrant per phase: the reward screen calls this on every phase change
   * and on every re-render, so a repeated call with the phase already set must
   * not restart the animation.
   */
  setChestShowcase(phase: ChestPhase | null) {
    if (this.chestPhase === phase) return;
    const wasOff = this.chestPhase === null;
    this.chestPhase = phase;

    if (phase === null) {
      this.chestStage?.setPhase(null);
      if (this.chestRestore) {
        this.frameRoot.visible = this.chestRestore.frameVisible;
        this.cannonRoot.visible = this.chestRestore.cannonVisible;
        this.chestRestore = null;
      }
      // Back to whatever this aspect ratio's own gameplay lens is — the same
      // two numbers `resize()` picks between.
      this.camera.fov = this.showcase ? SHOWCASE_FOV : this.fitFov(this.camera.aspect);
      this.camera.updateProjectionMatrix();
      return;
    }

    if (!this.chestStage) {
      this.chestStage = new ChestStage();
      this.chestStage.root.position.copy(CHEST_POSITION);
      this.scene.add(this.chestStage.root);
    }

    if (wasOff) {
      // The chest owns the whole stage: the level's picture behind it and the
      // cannon (if the skin picker happened to leave it up) would both read as
      // clutter under a full-screen reward.
      this.chestRestore = { frameVisible: this.frameRoot.visible, cannonVisible: this.cannonRoot.visible };
      this.frameRoot.visible = false;
      this.cannonRoot.visible = false;
      this.camera.fov = CHEST_FOV;
      this.camera.updateProjectionMatrix();
    }

    this.chestStage.setPhase(phase);
  }

  /** Hides every muzzle-smoke puff and sparkle shard currently in flight,
   * without waiting for its own lifetime to run out — see `setShowcase`. */
  private clearTransientEffects() {
    for (const puff of this.muzzleSmokePuffs) puff.mesh.visible = false;
    for (const shard of this.sparkleShards) shard.mesh.visible = false;
  }

  private clearShowcaseShots() {
    for (const shot of this.showcaseShots) this.scene.remove(shot.mesh);
    this.showcaseShots = [];
  }

  private launchShowcaseShot() {
    if (!this.showcaseShotGeometry) this.showcaseShotGeometry = this.track(new THREE.SphereGeometry(PROJECTILE_RADIUS, 12, 8));
    if (!this.showcaseMaterials) {
      this.showcaseMaterials = {
        classic: this.track(new THREE.MeshBasicMaterial({ color: 0xffffff })) as THREE.MeshBasicMaterial,
        magic: this.track(new THREE.MeshBasicMaterial({ color: 0xd9b6ff })) as THREE.MeshBasicMaterial,
        frost: this.track(new THREE.MeshBasicMaterial({ color: 0xbdf3ff })) as THREE.MeshBasicMaterial,
      };
    }
    this.applyCannonTransform();
    const start = this.muzzleAnchor.getWorldPosition(new THREE.Vector3());
    const quaternion = this.muzzleAnchor.getWorldQuaternion(new THREE.Quaternion());
    const velocity = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).multiplyScalar(SHOWCASE_SHOT_SPEED);
    this.recoil = 1;
    this.spawnMuzzleSmoke(start, velocity);
    const bling = this.sparkleBlingColors();
    if (bling) {
      this.spawnSparkleMuzzleBurst(start, bling);
      this.sparkleTrailAge = 0;
    }
    const mesh = new THREE.Mesh(this.showcaseShotGeometry, this.showcaseMaterials[this.costume.flavor]);
    mesh.position.copy(start);
    mesh.add(this.buildProjectileOutline());
    this.scene.add(mesh);
    this.showcaseShots.push({ mesh, start: start.clone(), velocity, time: 0, trailTicks: 0 });
  }

  /** Advances the showcase's own timers on real elapsed seconds — see
   * `setShowcase` for why this cannot lean on `step()`'s fixed accumulator. */
  private updateShowcase(deltaSeconds: number) {
    this.showcaseTime += deltaSeconds;
    // The celebration itself now runs unconditionally from `animate()` (on
    // request: it has to play mid-level too, for a level-clear unlock, not
    // only over the skin picker's showcase rig) — see that call site's own
    // comment. Skip the idle sway here while it's running so the two don't
    // fight over the same `rotation.y`.
    if (this.unlockCelebrationStart === null) {
      this.cannonRoot.rotation.y = SHOWCASE_YAW + Math.sin(this.showcaseTime * SHOWCASE_SWAY_SPEED) * SHOWCASE_SWAY;
    }
    this.recoil = Math.max(0, this.recoil - deltaSeconds * 4.2);
    this.barrelVisual.position.z = this.recoil * RECOIL_TRAVEL;

    this.showcaseCountdown -= deltaSeconds;
    if (this.showcaseCountdown <= 0) {
      this.showcaseCountdown = SHOWCASE_FIRE_INTERVAL;
      this.launchShowcaseShot();
    }

    const showcaseBling = this.sparkleBlingColors();
    const survivors: ShowcaseShot[] = [];
    for (const shot of this.showcaseShots) {
      shot.time += deltaSeconds;
      const position = this.positionAt(shot.start, shot.velocity, shot.time);
      shot.mesh.position.copy(position);
      if (showcaseBling) {
        const ticks = Math.floor(shot.time / SPARKLE_TRAIL_INTERVAL);
        if (ticks !== shot.trailTicks) {
          shot.trailTicks = ticks;
          this.spawnSparkleTrail(position, showcaseBling);
        }
      }
      if (shot.time < SHOWCASE_SHOT_FLIGHT) {
        survivors.push(shot);
        continue;
      }
      // It ends in mid air on purpose: there is nothing to hit in the
      // picker, and the landing effect is the thing being shown.
      if (showcaseBling) this.spawnSparkleImpactBurst(position, showcaseBling);
      this.scene.remove(shot.mesh);
    }
    this.showcaseShots = survivors;
  }

  /** Builds the celebration's glow meshes on first use — a soft additive disc
   * under the rig plus a brighter ring floating just above it, both parented
   * to `cannonRoot` so they spin along with it rather than tracking it from
   * outside. Left invisible until `playUnlockCelebration` turns them on. */
  private ensureUnlockGlow() {
    if (this.unlockGlowRing) return;
    const discGeometry = this.track(new THREE.CircleGeometry(1.7, 48));
    const discMaterial = this.track(
      new THREE.MeshBasicMaterial({
        color: UNLOCK_GLOW_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.unlockGlowDisc = new THREE.Mesh(discGeometry, discMaterial);
    this.unlockGlowDisc.rotation.x = -Math.PI / 2;
    this.unlockGlowDisc.position.y = -0.22;
    this.unlockGlowDisc.visible = false;
    this.unlockGlowDisc.renderOrder = 5;
    this.cannonRoot.add(this.unlockGlowDisc);

    const ringGeometry = this.track(new THREE.RingGeometry(1.15, 1.34, 48));
    const ringMaterial = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.unlockGlowRing = new THREE.Mesh(ringGeometry, ringMaterial);
    this.unlockGlowRing.rotation.x = -Math.PI / 2;
    this.unlockGlowRing.position.y = -0.2;
    this.unlockGlowRing.visible = false;
    this.unlockGlowRing.renderOrder = 6;
    this.cannonRoot.add(this.unlockGlowRing);
  }

  /**
   * Plays the "new cannon unlocked" reveal: `cannonRoot` spins in place
   * while a golden ring blooms and pulses around its base. Runs
   * indefinitely — there is no timer, only `stopUnlockCelebration()` ends
   * it — because the reveal is meant to hold until the player actually taps
   * past it, not disappear out from under them. Works equally over the skin
   * picker's showcase rig (`buySkin` in SandGame.tsx, pairing this with
   * hiding the rest of the skin screen's own chrome so the rig and the glow
   * are the only things on screen) and over the real gameplay cannon
   * mid-level (a level-clear unlock, paired there with the same reveal
   * banner instead) — `animate()` advances it either way, not only while
   * `setShowcase(true)` is up.
   */
  playUnlockCelebration() {
    this.ensureUnlockGlow();
    this.unlockCelebrationStart = performance.now();
    if (this.unlockGlowDisc) this.unlockGlowDisc.visible = true;
    if (this.unlockGlowRing) this.unlockGlowRing.visible = true;
  }

  /** Ends a celebration `playUnlockCelebration` started — the player tapped
   * past it. A no-op if none is running (e.g. it was already cleared by
   * `setShowcase(false)`). */
  stopUnlockCelebration() {
    if (this.unlockCelebrationStart === null) return;
    this.unlockCelebrationStart = null;
    if (this.unlockGlowRing) this.unlockGlowRing.visible = false;
    if (this.unlockGlowDisc) this.unlockGlowDisc.visible = false;
    // Resets the sway's own clock so it picks back up from its resting phase
    // instead of wherever `showcaseTime` happened to drift to during the spin.
    this.showcaseTime = 0;
  }

  private updateUnlockCelebration() {
    if (this.unlockCelebrationStart === null) return;
    const elapsed = (performance.now() - this.unlockCelebrationStart) / 1000;
    this.cannonRoot.rotation.y = SHOWCASE_YAW + elapsed * Math.PI * 2 * UNLOCK_SPIN_TURNS_PER_SECOND;

    // Fades in over the first third-of-a-second rather than snapping on, then
    // breathes for as long as the reveal stays up — a glow that just
    // appeared mid-spin reads as a pop-in glitch, not a bloom.
    const fadeIn = Math.min(1, elapsed / 0.3);
    const pulse = 1 + Math.sin(elapsed * 6.4) * 0.14;
    if (this.unlockGlowRing) {
      this.unlockGlowRing.scale.setScalar(pulse);
      (this.unlockGlowRing.material as THREE.MeshBasicMaterial).opacity = 0.75 * fadeIn;
    }
    if (this.unlockGlowDisc) {
      this.unlockGlowDisc.scale.setScalar(pulse * 1.08);
      (this.unlockGlowDisc.material as THREE.MeshBasicMaterial).opacity = 0.4 * fadeIn;
    }
  }

  /**
   * Starts the level-clear reveal: after `WIN_REVEAL_DELAY_SECONDS` of
   * sitting still (letting the settle/clear beats actually finish), the
   * finished picture takes one full turn (`frameRoot.rotation.y` 0 → 2π, so
   * it ends facing front again — see `sandMeshBack` for why the back reads
   * correctly mid-turn) and holds there. `updateWinReveal` stops touching
   * rotation once the turn completes, so a fresh engine (a new instance per
   * restart/level, see `runId` in SandGame.tsx) is the only thing that ever
   * resets it.
   *
   * `SandGame.tsx` calls this the instant a WIN result comes back, and
   * separately holds its own HUD/result-card off screen for
   * `WIN_REVEAL_HOLD_MS` so the player actually sees this play out.
   */
  playWinReveal() {
    this.winRevealStart = performance.now();
  }

  private updateWinReveal() {
    if (this.winRevealStart === null) return;
    const elapsed = (performance.now() - this.winRevealStart) / 1000 - WIN_REVEAL_DELAY_SECONDS;
    if (elapsed < 0) return;

    const spinT = Math.min(1, elapsed / WIN_REVEAL_SPIN_SECONDS);
    const spinEased = 1 - (1 - spinT) ** 3;
    this.frameRoot.rotation.y = spinEased * Math.PI * 2;

    if (spinT >= 1) {
      // Exactly 0, not `% twoPi` of whatever float `spinEased * 2π` landed
      // on — the turn is meant to end precisely back at the authored
      // orientation, not a hair off it.
      this.frameRoot.rotation.y = 0;
      this.winRevealStart = null;
    }
  }

  /**
   * A ring built from `PRISM_SPECTRUM_HEX.length` flat-coloured wedges rather
   * than one mesh, so it needs no shader to show several colours at once —
   * every other coloured surface on this cannon is a single flat
   * `MeshBasicMaterial`, and a wedge ring stays exactly that.
   */
  private buildSpectrumRing(innerRadius: number, outerRadius: number): THREE.Group {
    const group = new THREE.Group();
    const bandCount = PRISM_SPECTRUM_HEX.length;
    const arc = (Math.PI * 2) / bandCount;
    const gap = arc * PRISM_BAND_GAP_RATIO;
    PRISM_SPECTRUM_HEX.forEach((hex, index) => {
      const geometry = this.track(
        new THREE.RingGeometry(innerRadius, outerRadius, 10, 1, index * arc + gap / 2, arc - gap),
      );
      const material = this.track(
        new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
      );
      group.add(new THREE.Mesh(geometry, material));
    });
    return group;
  }

  /**
   * The booster overlay: a ring just outside the chambered round, and another
   * just outside the muzzle band, one pair per booster. Both start hidden —
   * `syncBoosterOverlay` shows whichever pair matches `armedBooster`.
   */
  private buildBoosterOverlay() {
    const chamberInner = CHAMBER_BALL_RADIUS * 2.05;
    const chamberOuter = chamberInner + 0.05;
    this.boosterChamberRadiusRing = new THREE.Mesh(
      this.track(new THREE.TorusGeometry((chamberInner + chamberOuter) / 2, 0.045, 10, 28)),
      this.track(new THREE.MeshBasicMaterial({ color: BOOSTER_RADIUS_RING_HEX, transparent: true, opacity: 0.8 })),
    );
    this.boosterChamberRadiusRing.position.copy(CHAMBER_POSITION);
    this.boosterChamberRadiusRing.visible = false;
    this.barrelPivot.add(this.boosterChamberRadiusRing);

    this.boosterChamberPrismRing = this.buildSpectrumRing(chamberInner, chamberOuter);
    this.boosterChamberPrismRing.position.copy(CHAMBER_POSITION);
    this.boosterChamberPrismRing.visible = false;
    this.barrelPivot.add(this.boosterChamberPrismRing);

    // The muzzle pair sits just outside the existing colour band, on
    // `barrelVisual` like that band — it has to recoil with the barrel, not
    // hang in the air where the barrel used to be.
    const muzzleInner = MUZZLE_BAND_RADIUS + 0.06;
    const muzzleOuter = muzzleInner + 0.05;
    this.boosterMuzzleRadiusRing = new THREE.Mesh(
      this.track(new THREE.TorusGeometry((muzzleInner + muzzleOuter) / 2, 0.045, 10, 32)),
      this.track(new THREE.MeshBasicMaterial({ color: BOOSTER_RADIUS_RING_HEX, transparent: true, opacity: 0.8 })),
    );
    this.boosterMuzzleRadiusRing.position.z = MUZZLE_Z + 0.2;
    this.boosterMuzzleRadiusRing.visible = false;
    this.barrelVisual.add(this.boosterMuzzleRadiusRing);

    this.boosterMuzzlePrismRing = this.buildSpectrumRing(muzzleInner, muzzleOuter);
    this.boosterMuzzlePrismRing.position.z = MUZZLE_Z + 0.2;
    this.boosterMuzzlePrismRing.visible = false;
    this.barrelVisual.add(this.boosterMuzzlePrismRing);
  }

  /** Shows whichever overlay ring pair matches `armedBooster`, hides the rest.
   * Chain Sort has no ring art of its own yet (on request: reuse Prism
   * Shot's for now — same placeholder reasoning as `BoosterIcon`,
   * SandGame.tsx), so it lights the same pair Prism Shot does. */
  private syncBoosterOverlay() {
    const isRadius = this.armedBooster === "radiusOvercharge";
    const isPrism = this.armedBooster === "prismShot" || this.armedBooster === "chainSort";
    if (this.boosterChamberRadiusRing) this.boosterChamberRadiusRing.visible = isRadius;
    if (this.boosterMuzzleRadiusRing) this.boosterMuzzleRadiusRing.visible = isRadius;
    if (this.boosterChamberPrismRing) this.boosterChamberPrismRing.visible = isPrism;
    if (this.boosterMuzzlePrismRing) this.boosterMuzzlePrismRing.visible = isPrism;
  }

  /** How much bigger than the level's base `sortRadius` a shot armed with
   * `booster` reaches, as a scale factor — 1 for no booster. Shared by the
   * aim-ring preview and the sortRing flash so neither ever shows a reach the
   * shot itself does not have. */
  private boosterRadiusScale(booster: BoosterType | null): number {
    if (this.sortRadius <= 0) return 1;
    return effectiveSortRadius(this.level, booster) / this.sortRadius;
  }

  /** The projectile scale a Radius Overcharge shot grows to by the time it
   * reaches the frame. A flat multiplier (`BOOSTER_PROJECTILE_SCALE`) rather
   * than matching the shot's actual reach (`effectiveSortRadius`) — that
   * read as far too large once the disc itself grows past a level's own
   * `sortRadius`, ballooning the ball to match. */
  private radiusBoosterMaxProjectileScale(): number {
    return BOOSTER_PROJECTILE_SCALE;
  }

  /**
   * How many charges of `type` are actually available right now — the
   * level's own forced allotment (`SandGameState.boosterChargesOverride`,
   * seeded from `SandLevelConfig.forcedBoosterCharges`) if it has an opinion
   * for this type, otherwise the real wallet (`getBoosterCharges`). Reused
   * by both `armBooster`'s own charge check and `fire()`'s spend below, so
   * the two can never disagree about which pool of charges is live.
   */
  private effectiveBoosterCharges(type: BoosterType): number {
    return this.state.boosterChargesOverride?.[type] ?? getBoosterCharges(type);
  }

  /**
   * Hands one charge of `type` back — a shot armed with it that missed
   * (`handleMiss`) or landed on the wrong colour (`NO_MATCH`) never really
   * "used" it. Mirrors `fire()`'s own spend: a forced-charges level gets its
   * local override bumped back up, everyone else gets the real wallet
   * credited and their entry removed from `boostersSpentThisAttempt` (the
   * most recent one for this type, since that is always the shot this
   * refund is for).
   */
  private refundBoosterCharge(booster: BoosterType) {
    const overrideCharges = this.state.boosterChargesOverride?.[booster];
    if (overrideCharges !== undefined) {
      this.state = {
        ...this.state,
        boosterChargesOverride: { ...this.state.boosterChargesOverride, [booster]: overrideCharges + 1 },
      };
      return;
    }
    addBoosterCharges(booster, 1);
    const idx = this.boostersSpentThisAttempt.lastIndexOf(booster);
    if (idx !== -1) this.boostersSpentThisAttempt.splice(idx, 1);
  }

  /**
   * Hands every real-wallet booster charge spent so far this attempt back —
   * called once a shot's resolution ends the attempt in `FAIL` (out of
   * shots, board not cleared): "dùng booster nhưng thua màn đó thì vẫn được
   * hoàn trả lại booster". Whatever `refundBoosterCharge` already pulled out
   * for this exact shot's own miss/`NO_MATCH` is already gone from the list,
   * so there is no double-refund for it.
   */
  private refundBoostersOnFail() {
    for (const booster of this.boostersSpentThisAttempt) addBoosterCharges(booster, 1);
    this.boostersSpentThisAttempt = [];
  }

  /**
   * Arms `type` for the next shot, toggling it back off if it is already the
   * one armed — a second tap on the same booster button cancels it rather
   * than doing nothing, spending no charge either way. Still a no-op to arm
   * `type` while the *other* booster is armed: swapping mid-arm stays
   * unsupported, the only way out of the other one is to fire it or cancel
   * it first with its own button.
   */
  armBooster(type: BoosterType) {
    if (!this.canInteract()) return;
    if (this.armedBooster === type) {
      this.armedBooster = null;
      this.syncBoosterOverlay();
      this.callbacks.onBoosterChange?.(null);
      this.callbacks.onEvent?.({ type: "BOOSTER_DISARMED", booster: type });
      return;
    }
    if (this.armedBooster !== null) return;
    if (this.effectiveBoosterCharges(type) <= 0) return;
    this.armedBooster = type;
    this.syncBoosterOverlay();
    this.callbacks.onBoosterChange?.(this.armedBooster);
    this.callbacks.onEvent?.({ type: "BOOSTER_ARMED", booster: type });
  }

  /**
   * Point the model at whatever the queue now holds.
   *
   * Called every tick and cheap when nothing changed: the queue is compared as
   * a string, and only a real change updates anything.
   */
  private syncAmmoModel() {
    const current = currentAmmo(this.level, this.state);
    const upcoming = nextAmmo(this.level, this.state);
    const key = `${current ?? "-"}|${upcoming.join(",")}|${this.chamberLoaded}`;
    if (key === this.ammoKey) return;
    this.ammoKey = key;

    // The muzzle band and base ring used to repaint to the chambered colour
    // here — the cannon itself is fixed gold now (its construction colour,
    // set once in `buildCannonModel` and never touched again) so the game's
    // background carries that signal instead (see `.game-frame`'s
    // `--ammo-bg` in globals.css, driven by `loadedAmmo` in SandGame.tsx).
    //
    // The radius rings — reach preview (`aimRing`/`aimRingGlow`) and hit
    // flash (`sortRing`, drawn with `hitMaterial`) — used to be plain white
    // regardless of what was loaded. Tinting them to the chambered colour
    // puts them in the same bullet-colour language as the muzzle band and
    // base ring this function already keeps in sync; the lower opacities on
    // all three materials (set where they are constructed) are what keep a
    // fully-saturated colour from reading as a solid disc instead of a soft
    // radius indicator.
    if (current) {
      const hex = sandColorHex(this.level, current);
      if (this.aimRing) (this.aimRing.material as THREE.MeshBasicMaterial).color.setHex(hex);
      if (this.aimRingGlow) (this.aimRingGlow.material as THREE.MeshBasicMaterial).color.setHex(hex);
      if (this.sortRing) (this.sortRing.material as THREE.MeshBasicMaterial).color.setHex(hex);
    }
  }

  /**
   * Keeps the ammo-tinted parts of the model (muzzle band, base ring, radius
   * rings) and the booster overlay's idle pulse in step with the game clock.
   * The queue itself is no longer shown in the model at all — see the HUD's
   * own ammo badge for that preview instead.
   */
  private updateAmmoModel() {
    // The next round is only handed over once the board is at rest and the
    // player may fire again — the same moment §21 unlocks input.
    if (!this.projectile && this.state.phase === "READY") this.chamberLoaded = true;
    this.syncAmmoModel();
    this.chamberAge += FIXED_STEP;

    // Still used below for the booster overlay's own idle pulse, even with
    // no chamber halo left to breathe.
    const breath = 0.5 + 0.5 * Math.sin(this.chamberAge * Math.PI * 2 * CHAMBER_GLOW_HZ);

    // The overlay rings breathe and spin so an armed booster never looks like
    // a static sticker slapped on the gun — same idle-never-frozen intent as
    // the chamber halo just above, reusing its `breath` sine.
    if (this.armedBooster === "radiusOvercharge") {
      const pulse = 0.55 + 0.35 * breath;
      const chamberMat = this.boosterChamberRadiusRing?.material as THREE.MeshBasicMaterial | undefined;
      if (chamberMat) chamberMat.opacity = pulse;
      const muzzleMat = this.boosterMuzzleRadiusRing?.material as THREE.MeshBasicMaterial | undefined;
      if (muzzleMat) muzzleMat.opacity = pulse;
    } else if (this.armedBooster === "prismShot" || this.armedBooster === "chainSort") {
      // Chain Sort reuses Prism Shot's spin too — same placeholder ring.
      this.boosterChamberPrismRing?.rotation.set(0, 0, (this.boosterChamberPrismRing.rotation.z + FIXED_STEP * 0.7) % (Math.PI * 2));
      this.boosterMuzzlePrismRing?.rotation.set(0, 0, (this.boosterMuzzlePrismRing.rotation.z + FIXED_STEP * 0.7) % (Math.PI * 2));
    }
  }

  /**
   * The disc a radius shot takes, drawn twice.
   *
   * Under the radius rule the player is choosing a *place*, not a region, so
   * the reach of a shot has to be visible before it is spent — otherwise the
   * rule is guesswork. One ring follows the crosshair while aiming; the other
   * flashes where the shot actually landed, which is also the only honest way
   * to read a shot that took less than it looked like it would.
   */
  private buildSortRings() {
    if (this.sortRadius <= 0) return;
    const outer = this.sortRadius * this.cell + this.cell * 0.5;
    // A thicker rim than the old 0.14-cell hairline: the ring is the only
    // thing telling the player where a shot reaches, so it has to survive
    // being glanced at, not just looked for.
    const rimThickness = this.cell * 0.26;
    const geometry = this.track(new THREE.RingGeometry(outer - rimThickness, outer, 64));
    const glowGeometry = this.track(
      new THREE.RingGeometry(Math.max(0, outer - rimThickness * 2.2), outer + this.cell * 0.18, 64),
    );
    // Tinted to the chambered ammo colour (`syncAmmoModel`), not plain white.
    // Opacity went 0.85 -> 0.5 when the tint first shipped (a fully-saturated
    // colour read as too solid at the old white-ring opacity), then back up
    // to 0.75 on feedback that the tint itself was too faint to actually
    // read as that colour — still short of the original 0.85 so the ring
    // stays a translucent indicator rather than a solid disc.
    const aimMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }),
    );
    // Additive halo behind the rim: a flat-opacity ring reads the same over
    // every sand colour, but a soft glow is what actually pulls the eye to
    // it against a busy multi-colour picture.
    const aimGlowMaterial = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const hitMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );

    this.aimRingGlow = new THREE.Mesh(glowGeometry, aimGlowMaterial);
    this.aimRingGlow.visible = false;
    this.aimRingGlow.renderOrder = 19;
    this.aimRingGlow.position.z = this.cell * 0.6;
    this.frameRoot.add(this.aimRingGlow);

    this.aimRing = new THREE.Mesh(geometry, aimMaterial);
    this.aimRing.visible = false;
    this.aimRing.renderOrder = 20;
    this.aimRing.position.z = this.cell * 0.62;
    this.frameRoot.add(this.aimRing);

    this.sortRing = new THREE.Mesh(geometry, hitMaterial);
    this.sortRing.visible = false;
    this.sortRing.renderOrder = 21;
    this.sortRing.position.z = this.cell * 0.64;
    this.frameRoot.add(this.sortRing);
  }

  /** Builds the muzzle-smoke pool once. Each puff gets its own material —
   * cheap at this count — so `updateMuzzleSmoke` can fade them independently
   * for a puffier, less uniform-looking burst than one shared material would. */
  private buildMuzzleSmoke() {
    const geometry = this.track(new THREE.IcosahedronGeometry(1, 1));
    for (let index = 0; index < MUZZLE_SMOKE_PUFFS; index += 1) {
      const material = this.track(
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
      ) as THREE.MeshBasicMaterial;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      this.muzzleSmokePuffs.push({ mesh, material, velocity: new THREE.Vector3(), age: 0, life: 0, startScale: 0, endScale: 0 });
    }
  }

  /**
   * Fires the whole pool at once from the muzzle: each puff gets a random
   * sideways offset around the bore, a forward push along the shot's own
   * direction, and its own lifetime, so the burst reads as one ragged cloud
   * rather than N identical copies of the same puff.
   */
  private spawnMuzzleSmoke(origin: THREE.Vector3, direction: THREE.Vector3) {
    if (!this.muzzleSmokePuffs.length) return;
    const forward = direction.clone().normalize();
    // Any vector not parallel to `forward`, to build a sideways basis from.
    const helper = Math.abs(forward.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(forward, helper).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();

    for (const puff of this.muzzleSmokePuffs) {
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * MUZZLE_SMOKE_SPREAD_RADIUS;
      const reach = MUZZLE_SMOKE_FORWARD_REACH * (0.3 + Math.random() * 0.7);
      const sideways = right.clone().multiplyScalar(Math.cos(angle) * spread)
        .addScaledVector(up, Math.sin(angle) * spread);

      puff.mesh.position.copy(origin).add(sideways);
      puff.velocity.copy(forward).multiplyScalar(reach).addScaledVector(sideways, 0.6);
      puff.age = 0;
      puff.life = MUZZLE_SMOKE_MIN_LIFE + Math.random() * (MUZZLE_SMOKE_MAX_LIFE - MUZZLE_SMOKE_MIN_LIFE);
      puff.startScale = MUZZLE_SMOKE_MIN_SCALE * (0.8 + Math.random() * 0.4);
      puff.endScale = MUZZLE_SMOKE_MAX_SCALE * (0.8 + Math.random() * 0.4);
      puff.mesh.scale.setScalar(puff.startScale);
      puff.material.opacity = MUZZLE_SMOKE_OPACITY;
      puff.mesh.visible = true;
    }
  }

  /** Ages and drifts every visible puff, expanding fast at first — like a
   * real burst of pressurised gas — and fading in over its back half so the
   * cloud hangs fully visible for a moment before it dissolves. */
  private updateMuzzleSmoke(deltaSeconds: number) {
    for (const puff of this.muzzleSmokePuffs) {
      if (!puff.mesh.visible) continue;
      puff.age += deltaSeconds;
      const life = Math.min(1, puff.age / puff.life);
      puff.mesh.position.addScaledVector(puff.velocity, deltaSeconds);
      const scaleT = 1 - (1 - life) ** 2;
      puff.mesh.scale.setScalar(THREE.MathUtils.lerp(puff.startScale, puff.endScale, scaleT));
      puff.material.opacity = MUZZLE_SMOKE_OPACITY * (1 - life) ** 2;
      if (life >= 1) puff.mesh.visible = false;
    }
  }

  /** Builds the sand-spray pool once. Each grain gets its own material, same
   * reasoning as `buildMuzzleSmoke`: independent fades read as loose debris
   * rather than one shared puff. */
  private buildSandSpray() {
    const geometry = this.track(new THREE.BoxGeometry(1, 1, 1));
    for (let index = 0; index < SAND_SPRAY_GRAINS; index += 1) {
      const material = this.track(
        // depthTest off: a grain spawns exactly on the sand plane's own
        // surface, so with depth testing on, half of every grain would be
        // silently clipped by that plane depending on which way it happened
        // to tumble — this is meant to read as a foreground burst, not a
        // physically occludable object.
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false }),
      ) as THREE.MeshBasicMaterial;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 22;
      this.scene.add(mesh);
      this.sandSprayGrains.push({
        mesh,
        material,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        age: 0,
        life: SAND_SPRAY_LIFE_SECONDS,
      });
    }
  }

  /**
   * Fires `count` grains from the pool, each starting at its own random point
   * inside the shot's sort disc (`radiusCells`, in grid cells) rather than
   * all bursting from the exact contact point — real kicked-up sand comes
   * loose across the whole reach a shot disturbed, not from one spot. Each
   * grain also gets its own small random sideways jitter and a brief upward
   * hop, so the burst reads as sand actually getting knocked loose and pulled
   * straight back down rather than a ring of identical debris. `count` is
   * how much sand this shot actually sorted — a
   * big clear kicks up a lot of sand, a one-cell clear barely disturbs the pile.
   * `colors` is every colour the shot actually cleared — usually one colour
   * repeated, but a Prism Shot clearing several at once hands over all of
   * them, and each grain picks its own at random so the burst shows the
   * whole palette rather than being painted in a single colour.
   */
  private spawnSandSpray(point: THREE.Vector3, colors: number[], count: number, radiusCells: number) {
    if (!this.sandSprayGrains.length || !colors.length) return;
    const radiusWorld = Math.max(0, radiusCells) * this.cell;
    for (const grain of this.sandSprayGrains.slice(0, count)) {
      const angle = Math.random() * Math.PI * 2;
      const jitter = SAND_SPRAY_JITTER_MIN_SPEED + Math.random() * (SAND_SPRAY_JITTER_MAX_SPEED - SAND_SPRAY_JITTER_MIN_SPEED);
      grain.velocity.set(
        Math.cos(angle) * jitter,
        SAND_SPRAY_UP_SPEED * (0.5 + Math.random() * 0.6),
        Math.sin(angle) * jitter,
      );
      // Uniform over the disc, not the square — sqrt(random()) on the radius
      // is what keeps the distribution from bunching up toward the centre.
      const spawnAngle = Math.random() * Math.PI * 2;
      const spawnDist = radiusWorld * Math.sqrt(Math.random());
      grain.mesh.position.set(
        point.x + Math.cos(spawnAngle) * spawnDist,
        point.y + Math.sin(spawnAngle) * spawnDist,
        point.z,
      );
      grain.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      grain.spin.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      );
      grain.age = 0;
      grain.life = SAND_SPRAY_LIFE_SECONDS * (0.9 + Math.random() * 0.2);
      const scale = this.cell * (SAND_SPRAY_MIN_SCALE + Math.random() * (SAND_SPRAY_MAX_SCALE - SAND_SPRAY_MIN_SCALE));
      grain.mesh.scale.setScalar(scale);
      grain.material.color.setHex(colors[Math.floor(Math.random() * colors.length)]);
      grain.material.opacity = 1;
      grain.mesh.visible = true;
    }
  }

  /** Ages every visible grain, pulling it down much harder than the shot's
   * own gravity — see `SAND_SPRAY_GRAVITY_SCALE` — and fading it out over its
   * lifetime so the burst dissolves rather than popping out of existence. */
  private updateSandSpray(deltaSeconds: number) {
    for (const grain of this.sandSprayGrains) {
      if (!grain.mesh.visible) continue;
      grain.age += deltaSeconds;
      const life = Math.min(1, grain.age / grain.life);
      grain.velocity.addScaledVector(GRAVITY, SAND_SPRAY_GRAVITY_SCALE * deltaSeconds);
      grain.mesh.position.addScaledVector(grain.velocity, deltaSeconds);
      grain.mesh.rotation.x += grain.spin.x * deltaSeconds;
      grain.mesh.rotation.y += grain.spin.y * deltaSeconds;
      grain.mesh.rotation.z += grain.spin.z * deltaSeconds;
      // Fully solid for the first stretch of its life — fading from the very
      // instant it spawns read as soft and washed-out rather than a crisp
      // chunk of sand — then fades out over the back half.
      const fadeT = Math.max(0, (life - 0.4) / 0.6);
      grain.material.opacity = 1 - fadeT ** 2;
      if (life >= 1) grain.mesh.visible = false;
    }
  }

  /** Builds the sparkle pool once. A shard, not a ball: flat faces catch the
   * light as it spins, which is what separates a spark from a puff of smoke.
   * Each shard gets its own material so a burst can show several colours and
   * fade independently, same reasoning as `buildMuzzleSmoke`. */
  private buildSparkles() {
    const geometry = this.track(new THREE.OctahedronGeometry(0.5));
    for (let index = 0; index < SPARKLE_POOL_SIZE; index += 1) {
      const material = this.track(
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
      ) as THREE.MeshBasicMaterial;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 23;
      this.scene.add(mesh);
      this.sparkleShards.push({
        mesh,
        material,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        gravity: 0,
        size: 1,
        age: 0,
        life: 1,
      });
    }
  }

  /**
   * Fires `count` shards from the pool, walking a rolling cursor rather than
   * always reusing the first N (`spawnSandSpray`'s pattern) — a muzzle burst,
   * a flight trail and an impact burst can all be alive together, and always
   * grabbing the same first shards would cut an earlier burst off instead of
   * letting it fade on its own. `speed` is how hard a shard leaves `origin`,
   * `rise` how much of that is upward, and `gravity` whether it arcs back
   * down — a bling burst floats, an impact burst falls a little harder.
   */
  private spawnSparkles(
    origin: THREE.Vector3,
    options: {
      count: number;
      size: number;
      speed: number;
      rise: number;
      life: number;
      gravity: number;
      spread?: number;
      /** Overrides the random `SPARKLE_COLORS` pick with one exact colour —
       * `spawnPrismTrail` uses this to paint every shard the ball's own
       * in-flight hue instead of the magic costume's random bling colours. */
      colorHex?: number;
      /** Which palette the random pick draws from when `colorHex` is not
       * given — defaults to `SPARKLE_COLORS`, the rune costume's own. Every
       * gameplay call site passes `sparkleBlingColors()`'s own result through
       * here instead, so a burst always draws from whichever costume is
       * actually equipped rather than always the rune palette. */
      colors?: number[];
    },
  ) {
    if (!this.sparkleShards.length) return;
    const spread = options.spread ?? 1;
    for (let shard = 0; shard < options.count; shard += 1) {
      const slot = this.sparkleShards[this.sparkleCursor];
      this.sparkleCursor = (this.sparkleCursor + 1) % this.sparkleShards.length;
      const angle = (shard / options.count) * Math.PI * 2 + Math.random() * 1.6;
      const lift = Math.random() * 2 - 1;
      const size = options.size * (0.6 + Math.random() * 0.8);

      slot.mesh.position.copy(origin).add(
        new THREE.Vector3(
          Math.cos(angle) * spread * 0.16,
          (Math.random() - 0.5) * spread * 0.2,
          Math.sin(angle) * spread * 0.16,
        ),
      );
      slot.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      slot.mesh.scale.setScalar(size);
      slot.velocity.set(
        Math.cos(angle) * options.speed * (0.7 + Math.random() * 0.6),
        options.rise + lift * options.speed * 0.35,
        Math.sin(angle) * options.speed * (0.7 + Math.random() * 0.6),
      );
      slot.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      slot.gravity = options.gravity;
      slot.size = size;
      slot.age = 0;
      slot.life = options.life;
      const palette = options.colors ?? SPARKLE_COLORS;
      slot.material.color.setHex(options.colorHex ?? palette[Math.floor(Math.random() * palette.length)]);
      slot.material.opacity = 1;
      slot.mesh.visible = true;
    }
  }

  /** Bling: a bright burst at the muzzle the instant a shot fires — the
   * equipped costume's own palette (`sparkleBlingColors`), rune's by default
   * since every existing call predates the hero costume's own. */
  private spawnSparkleMuzzleBurst(origin: THREE.Vector3, colors?: number[]) {
    this.spawnSparkles(origin, { count: 10, size: 0.14, speed: 2, rise: 0.9, life: 0.42, gravity: -2, spread: 1, colors });
  }

  /** The thin trail a shot leaves along its whole flight, in the equipped
   * costume's own bling palette. */
  private spawnSparkleTrail(point: THREE.Vector3, colors?: number[]) {
    this.spawnSparkles(point, { count: 2, size: 0.09, speed: 0.35, rise: 0.1, life: 0.26, gravity: -1.2, spread: 0.5, colors });
  }

  /** The rainbow streak a Prism Shot leaves along its whole flight — spec
   * §6's "vệt cầu vồng". `hue` is the ball's own hue at this instant
   * (`updateProjectile`'s `prismHue`), so the trail always reads as the same
   * spectrum the ball itself is cycling through, not an unrelated colour.
   * A long `life` against a slow `speed`/tight `spread` is what makes the
   * streak read as one long ribbon following the ball rather than a puff of
   * confetti at each spawn point — `PRISM_TRAIL_INTERVAL`'s dense spawn rate
   * does the rest. */
  private spawnPrismTrail(point: THREE.Vector3, hue: number) {
    const colorHex = new THREE.Color().setHSL(hue, 0.85, 0.6).getHex();
    this.spawnSparkles(point, { count: 2, size: 0.11, speed: 0.16, rise: 0.02, life: 0.6, gravity: -0.35, spread: 0.28, colorHex });
  }

  /** Bling: the landing itself, floating outward rather than dropping, in
   * the equipped costume's own bling palette. */
  private spawnSparkleImpactBurst(point: THREE.Vector3, colors?: number[]) {
    this.spawnSparkles(point, { count: 14, size: 0.15, speed: 2.6, rise: 1.1, life: 0.5, gravity: -2.4, spread: 1.2, colors });
  }

  /** Ages, drags and fades every visible shard — same shape as `updateSandSpray`. */
  private updateSparkles(deltaSeconds: number) {
    for (const shard of this.sparkleShards) {
      if (!shard.mesh.visible) continue;
      shard.age += deltaSeconds;
      const progress = Math.min(1, shard.age / shard.life);
      if (progress >= 1) {
        shard.mesh.visible = false;
        continue;
      }
      shard.velocity.multiplyScalar(SPARKLE_DRAG);
      shard.velocity.y += shard.gravity * deltaSeconds;
      shard.mesh.position.addScaledVector(shard.velocity, deltaSeconds);
      shard.mesh.rotation.x += shard.spin.x * deltaSeconds;
      shard.mesh.rotation.y += shard.spin.y * deltaSeconds;
      shard.mesh.rotation.z += shard.spin.z * deltaSeconds;
      // Solid to the last frame, like the smoke: it goes out by getting small.
      shard.mesh.scale.setScalar(Math.max(0.001, shard.size * (1 - progress * progress)));
      shard.material.opacity = 1 - progress;
    }
  }

  /**
   * The idle twinkle: once a key has sat still for `KEY_IDLE_SPARKLE_DELAY_MS`
   * (`keyLastMovedAt`), it starts giving off a slow trickle of warm-gold
   * shards from the same pool `spawnSparkles` already draws the cannon skins'
   * own bling from — thrown at `KEY_IDLE_SPARKLE_INTERVAL_MS` rather than
   * every tick, the same "ambient, not a burst" pacing `spawnSparkleTrail`
   * uses for a shot's own flight trail.
   *
   * A key has no mesh of its own (`redrawSand` rasterises it straight onto
   * the sand canvas, see `keys`'s own comment) — its bounding box is read
   * fresh from `this.keys` every call, converted through `cellWorld` (which
   * is `frameRoot`-local) and `frameRoot.localToWorld` into the world space
   * `sparkleShards` actually lives in, since unlike `sortRing`/`aimRing`
   * (children of `frameRoot`) the shard pool is parented directly to
   * `this.scene`.
   */
  private updateKeyIdleSparkle() {
    if (!this.keys.size) return;
    const now = performance.now();
    for (const [id, cells] of this.keys) {
      const lastMoved = this.keyLastMovedAt.get(id) ?? now;
      if (now - lastMoved < KEY_IDLE_SPARKLE_DELAY_MS) continue;
      const lastSparkle = this.keyLastSparkleAt.get(id) ?? 0;
      if (now - lastSparkle < KEY_IDLE_SPARKLE_INTERVAL_MS) continue;
      this.keyLastSparkleAt.set(id, now);

      const xs = cells.map((cell) => cell.x);
      const ys = cells.map((cell) => cell.y);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      // Same bounding-box radius `redrawSand`'s own glint reads off — the
      // scatter should hug however big this particular key actually is,
      // not a size assuming every key is `KEY_SPRITE`'s own default.
      const cellRadius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 || 1;
      const { x: localX, y: localY } = this.cellWorld(centerX, centerY);
      // In front of the sand plane by the same margin `aimRingGlow`/`aimRing`
      // sit at, so the shards never render as if buried under the sand.
      const origin = this.frameRoot.localToWorld(new THREE.Vector3(localX, localY, this.cell * 0.65));
      // `spawnSparkles`' own `spread` is "world units / 0.16" (see its
      // header comment) — this converts the key's cell-space radius to that
      // same unit so the scatter radius tracks the key's real world size.
      const spread = Math.max(1.4, (cellRadius * this.cell) / 0.16);
      // Bigger and more numerous than the cannon skins' own bling
      // (`spawnSparkleTrail`'s `size: 0.09`/`count: 2`) — a key sits back on
      // the sand plane, much further from the camera than the cannon rig the
      // skins' shards fly past, so the same world-space size that reads
      // clearly there would wash out to almost nothing here.
      this.spawnSparkles(origin, {
        count: 3,
        size: 0.22,
        speed: 0.22,
        rise: 0.32,
        life: 0.85,
        gravity: -0.35,
        spread,
        colors: KEY_IDLE_SPARKLE_COLORS,
      });
    }
  }

  private cellWorld(x: number, y: number) {
    return {
      x: (x - (this.level.frame.width - 1) / 2) * this.cell,
      y: (y - (this.level.frame.height - 1) / 2) * this.cell,
    };
  }

  private moveRingToCell(ring: THREE.Mesh, x: number, y: number) {
    const { x: worldX, y: worldY } = this.cellWorld(x, y);
    ring.position.x = worldX;
    ring.position.y = worldY;
  }

  private spawnSortRing(x: number, y: number, scale = 1) {
    if (!this.sortRing) return;
    this.moveRingToCell(this.sortRing, x, y);
    this.sortRing.visible = true;
    this.sortRingScale = scale;
    this.sortRing.scale.setScalar(0.72 * scale);
    (this.sortRing.material as THREE.MeshBasicMaterial).opacity = SORT_RING_PEAK_OPACITY;
    this.sortRingAge = 0;
  }

  // ---- input -------------------------------------------------------------

  private bindInput() {
    this.aimZone.addEventListener("pointerdown", this.onAimPointerDown);
    this.aimZone.addEventListener("pointermove", this.onAimPointerMove);
    this.aimZone.addEventListener("pointerup", this.onAimPointerUp);
    this.aimZone.addEventListener("pointercancel", this.onAimPointerCancel);
  }

  /** §21: aim and fire exist in READY and nowhere else — and never while the
   * skin picker's showcase is running the rig itself. */
  private canInteract() {
    return !this.paused && !this.disposed && !this.showcase && this.state.phase === "READY" && !this.state.result;
  }

  private canStartAim() {
    return this.canInteract() && this.projectile === null && performance.now() >= this.nextShotAt;
  }

  private onAimPointerDown = (event: PointerEvent) => {
    if (this.scriptedShotActive) return;
    if (!this.canStartAim()) return;
    this.aimPointer = event.pointerId;
    this.lastInputAt = performance.now();
    this.callbacks.onEvent?.({ type: "AIM_TOUCHED" });
    this.aimStart.set(event.clientX, event.clientY);
    this.aimCurrent.copy(this.aimStart);
    this.aimDistance = 0;
    this.aimArmed = false;
    this.aimStick.set(0, 0);
    this.clearAimOutsideTimer();
    const bounds = this.aimZone.getBoundingClientRect();
    this.aimZone.style.setProperty("--joystick-x", `${event.clientX - bounds.left}px`);
    this.aimZone.style.setProperty("--joystick-y", `${event.clientY - bounds.top}px`);
    this.aimZone.style.setProperty("--joystick-dx", "0px");
    this.aimZone.style.setProperty("--joystick-dy", "0px");
    // Capture throws on a pointer the browser is no longer tracking, and the
    // gesture has to survive that: without capture the drag still works, it
    // just stops following a finger that leaves the zone.
    try {
      this.aimZone.setPointerCapture(event.pointerId);
    } catch {
      // Not capturable — carry on with the gesture.
    }
    this.aimZone.classList.add("is-aiming", "is-cancelled");
    this.updateAimGesture(event.clientX, event.clientY);
    this.updateAimPreview();
  };

  private updateAimGesture(clientX: number, clientY: number) {
    this.aimCurrent.set(clientX, clientY);
    const dx = clientX - this.aimStart.x;
    const dy = clientY - this.aimStart.y;
    this.aimDistance = Math.hypot(dx, dy);

    // Sticky once armed: once the stick has been dragged out past the arm
    // radius, drifting back toward the centre — even all the way to it — no
    // longer un-arms the shot. Only letting go of the pointer does (see
    // `onAimPointerUp`/`clearAimGesture`), so a hand that overshoots back
    // through the middle mid-gesture does not lose the aim it already built.
    if (!this.aimArmed && this.aimDistance >= JOYSTICK_ARM_RADIUS) {
      this.aimArmed = true;
    }

    const clampedScale = this.aimDistance > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / this.aimDistance : 1;
    this.aimZone.style.setProperty("--joystick-dx", `${dx * clampedScale}px`);
    this.aimZone.style.setProperty("--joystick-dy", `${dy * clampedScale}px`);
    this.aimZone.classList.toggle("is-cancelled", !this.aimArmed);

    // No dead zone here on purpose: a flat "response pinned to exactly zero"
    // band near the centre reads, to a thumb easing back in, as the aim
    // snapping to dead-centre the moment it crosses into that band — rather
    // than the crosshair just running out of room to move. Scaling from raw
    // distance keeps the response continuous all the way to the centre.
    //
    // Each axis gets its OWN response, computed from its own signed offset —
    // not a single magnitude shared across a direction vector. A shared
    // magnitude can only ever reach 1 in total (dx/dist and dy/dist are a
    // unit vector), so `aimStick` traced out a disc; fed through
    // `cursorForCurrentStick`'s independent horizontal/vertical scale, that
    // disc becomes an ellipse *inscribed* in the frame's rectangle — the
    // frame's actual corners sit outside it and were never reachable by any
    // drag, however far or in whatever direction. Letting x and y saturate
    // independently means a drag far enough along both axes at once — e.g.
    // straight for a corner — lands both at their own full response
    // together, so the crosshair can reach the corner itself.
    const responseRadius = Math.min(
      JOYSTICK_RESPONSE_RADIUS,
      Math.max(this.host.clientWidth, 1) * JOYSTICK_RESPONSE_RADIUS_SCREEN_FRACTION,
      Math.max(this.host.clientHeight, 1) * JOYSTICK_RESPONSE_RADIUS_SCREEN_FRACTION,
    );
    this.aimStick.set(
      this.axisResponse(dx, responseRadius),
      this.axisResponse(dy, responseRadius),
    );
    this.aimPreviewDirty = true;
    this.updateAimOutsideZone(clientX, clientY);
  }

  /** One axis' share of `updateAimGesture`'s response curve — same shape as
   * the old shared-magnitude version (clamp 0-1, then `aimDragSensitivity`'s
   * easing), just evaluated on this axis' own signed offset so the two axes
   * can each reach ±1 without competing for a shared unit-vector budget. */
  private axisResponse(delta: number, radius: number): number {
    const magnitude = THREE.MathUtils.clamp(Math.abs(delta) / radius, 0, 1);
    const eased = (magnitude * this.aimDragSensitivity) / (1 + (this.aimDragSensitivity - 1) * magnitude);
    return Math.sign(delta) * eased;
  }

  /** Whether a screen point sits over `host` — the rendered scene the drag
   * is meant to stay near. See `AIM_OUTSIDE_ZONE_CANCEL_MS`. */
  private isInsideAimZone(clientX: number, clientY: number) {
    const bounds = this.host.getBoundingClientRect();
    return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
  }

  /**
   * Arms or disarms the leave-the-zone grace timer for the current pointer
   * position. Called on every drag update; the timer itself is what actually
   * fires the cancel, since a finger that stops moving outside the zone would
   * otherwise never trigger another check.
   */
  private updateAimOutsideZone(clientX: number, clientY: number) {
    if (this.isInsideAimZone(clientX, clientY)) {
      this.clearAimOutsideTimer();
      return;
    }
    if (this.aimOutsideTimer !== null) return;
    this.aimZone.classList.add("is-out-of-bounds");
    this.aimOutsideTimer = setTimeout(() => {
      this.aimOutsideTimer = null;
      if (this.aimPointer === null) return;
      this.clearAimGesture();
      this.updateAimPreview();
    }, AIM_OUTSIDE_ZONE_CANCEL_MS);
  }

  private clearAimOutsideTimer() {
    if (this.aimOutsideTimer !== null) {
      clearTimeout(this.aimOutsideTimer);
      this.aimOutsideTimer = null;
    }
    this.aimZone.classList.remove("is-out-of-bounds");
  }

  private onAimPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.aimPointer) return;
    this.updateAimGesture(event.clientX, event.clientY);
  };

  private onAimPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.aimPointer) return;
    // Letting go near the centre no longer cancels by itself — `aimArmed` is
    // sticky (see `updateAimGesture`), so once the drag has crossed the arm
    // radius at any point, releasing anywhere still fires.
    const shouldFire = this.canInteract()
      && this.aimArmed
      && this.displayedAimArmed
      && this.displayedLaunch !== null
      && this.projectile === null
      && performance.now() >= this.nextShotAt;
    const launch = shouldFire ? this.displayedLaunch : null;
    this.clearAimGesture();
    if (!launch) {
      this.updateAimPreview();
      return;
    }
    this.fire(launch);
  };

  private onAimPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.aimPointer) return;
    this.clearAimGesture();
    this.updateAimPreview();
  };

  private clearAimGesture() {
    const pointer = this.aimPointer;
    this.aimPointer = null;
    try {
      if (pointer !== null && this.aimZone.hasPointerCapture(pointer)) this.aimZone.releasePointerCapture(pointer);
    } catch {
      // Already released with the pointer itself.
    }
    this.clearAimOutsideTimer();
    this.aimZone.classList.remove("is-aiming", "is-cancelled");
    this.aimArmed = false;
    this.displayedAimArmed = false;
    this.aimStick.set(0, 0);
    this.displayedLaunch = null;
    this.aimPreviewDirty = false;
    this.resetCannonDirection();
    this.showIdleCrosshair();
  }

  setControlSensitivity(next: Partial<ControlSensitivity>) {
    if (next.aim !== undefined) {
      this.aimDragSensitivity = THREE.MathUtils.clamp(next.aim, MIN_CONTROL_SENSITIVITY, MAX_CONTROL_SENSITIVITY);
    }
    if (this.aimPointer !== null) this.updateAimGesture(this.aimCurrent.x, this.aimCurrent.y);
  }

  // ---- aiming ------------------------------------------------------------

  private applyCannonTransform() {
    this.turret.rotation.y = this.yaw;
    this.barrelPivot.rotation.x = this.elevation;
    this.turret.updateMatrixWorld(true);
  }

  private resetCannonDirection() {
    this.yaw = CANNON_NEUTRAL_YAW;
    this.elevation = CANNON_NEUTRAL_ELEVATION;
    this.applyCannonTransform();
  }

  private cursorForCurrentStick() {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    const centerX = width * 0.5;
    const centerY = height * 0.5;

    // The old ratios (fixed fractions of the viewport) were tuned against
    // small boards and always clamped to the margin term below on width/up —
    // but on a board large enough to fill FIT_WIDTH/FIT_HEIGHT on both axes
    // at once (e.g. an 80×90 picture), the frame's own bottom edge projects
    // well past AIM_CURSOR_DOWN_RATIO's reach, so the joystick could never
    // drag the crosshair down to the picture's lower rows no matter how far
    // the drag went. Projecting the frame's actual screen-space edges here
    // instead means the reach always matches the picture in front of it,
    // whatever the level's grid size or aspect.
    const border = this.cell * FRAME_BORDER_CELLS;
    const halfWidth = (this.level.frame.width * this.cell) / 2 + border;
    const halfHeight = (this.level.frame.height * this.cell) / 2 + border;
    const planeZ = this.frameRoot.position.z;
    const left = this.screenPointForWorld(new THREE.Vector3(this.frameRoot.position.x - halfWidth, FRAME_CENTER_Y, planeZ));
    const right = this.screenPointForWorld(new THREE.Vector3(this.frameRoot.position.x + halfWidth, FRAME_CENTER_Y, planeZ));
    const top = this.screenPointForWorld(new THREE.Vector3(this.frameRoot.position.x, FRAME_CENTER_Y + halfHeight, planeZ));
    const bottom = this.screenPointForWorld(new THREE.Vector3(this.frameRoot.position.x, FRAME_CENTER_Y - halfHeight, planeZ));

    const edgeLimit = centerX - AIM_CURSOR_EDGE_MARGIN;
    const verticalEdgeLimit = centerY - AIM_CURSOR_EDGE_MARGIN;
    const horizontalRange = Math.max(0, Math.min(Math.max(centerX - left.x, right.x - centerX), edgeLimit));
    const upwardRange = Math.max(0, Math.min(centerY - top.y, verticalEdgeLimit));
    const downwardRange = Math.max(0, Math.min(bottom.y - centerY, verticalEdgeLimit));
    return new THREE.Vector2(
      centerX + this.aimStick.x * horizontalRange,
      centerY + this.aimStick.y * (this.aimStick.y < 0 ? upwardRange : downwardRange),
    );
  }

  private cameraRayForScreenPoint(screenX: number, screenY: number) {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.camera.updateMatrixWorld(true);
    const point = new THREE.Vector3((screenX / width) * 2 - 1, 1 - (screenY / height) * 2, 0.5).unproject(this.camera);
    const direction = point.sub(this.camera.position).normalize();
    return { origin: this.camera.position.clone(), direction };
  }

  /**
   * Where a ray meets the sand plane, in grid coordinates — and which live
   * pixel, if any, is actually there.
   *
   * A flat 2D board turns what used to be a scan over every cell's collider
   * into a single plane intersection: solve for the one z the picture sits
   * at, then read straight off the pixel grid. `PROJECTILE_RADIUS` still buys
   * a little forgiveness, searched for as the nearest occupied pixel within
   * that reach of the exact crossing point, the same shot the ball's own
   * width would have grazed under the old per-cell colliders.
   */
  private planeHit(origin: THREE.Vector3, direction: THREE.Vector3, forgive: boolean) {
    const planeWorldZ = this.frameRoot.position.z + this.sandMesh.position.z;
    if (Math.abs(direction.z) < 1e-6) return null;
    const t = (planeWorldZ - origin.z) / direction.z;
    if (!Number.isFinite(t) || t < 0) return null;
    const point = origin.clone().addScaledVector(direction, t);
    const local = point.clone().sub(this.frameRoot.position);
    const gx = Math.round(local.x / this.cell + (this.level.frame.width - 1) / 2);
    const gy = Math.round(local.y / this.cell + (this.level.frame.height - 1) / 2);

    // Anywhere inside the frame is a place the player may aim at, sand or not.
    // The empty air above the pile is the clearest case: the disc lands there
    // and still reaches the colour below it, so the shot has to resolve rather
    // than be thrown away as a miss.
    const inside = gx >= 0 && gx < this.level.frame.width && gy >= 0 && gy < this.level.frame.height;
    if (!inside) return null;
    const grid = { x: gx, y: gy };

    const exact = this.cells.get(cellKey(gx, gy));
    if (exact) return { t, point, grid, cell: exact };
    if (!forgive) return { t, point, grid, cell: null };

    const reach = Math.max(1, Math.round(PROJECTILE_RADIUS / this.cell));
    let best: { cell: PixelCell; distanceSq: number } | null = null;
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        if (dx * dx + dy * dy > reach * reach) continue;
        const candidate = this.cells.get(cellKey(gx + dx, gy + dy));
        if (!candidate) continue;
        const distanceSq = dx * dx + dy * dy;
        if (!best || distanceSq < best.distanceSq) best = { cell: candidate, distanceSq };
      }
    }
    return { t, point, grid, cell: best?.cell ?? null };
  }

  /** Fallback so a trajectory can still be solved over empty parts of the frame. */
  private sandPlanePoint(screenX: number, screenY: number) {
    const { origin, direction } = this.cameraRayForScreenPoint(screenX, screenY);
    const planeZ = this.frameRoot.position.z + this.sandMesh.position.z;
    if (Math.abs(direction.z) < 1e-5) return new THREE.Vector3(0, FRAME_CENTER_Y, planeZ);
    const distance = (planeZ - origin.z) / direction.z;
    if (!Number.isFinite(distance) || distance <= 0) return new THREE.Vector3(0, FRAME_CENTER_Y, planeZ);
    return origin.addScaledVector(direction, distance);
  }

  private fixedSpeedVelocity(start: THREE.Vector3, target: THREE.Vector3) {
    const dx = target.x - start.x;
    const dz = target.z - start.z;
    const horizontalDistance = Math.hypot(dx, dz);
    if (horizontalDistance < 1e-4) return null;
    const dy = target.y - start.y;
    const gravity = -GRAVITY.y;
    const speedSquared = FIXED_LAUNCH_SPEED * FIXED_LAUNCH_SPEED;
    const discriminant = speedSquared * speedSquared
      - gravity * (gravity * horizontalDistance * horizontalDistance + 2 * dy * speedSquared);
    if (discriminant < 0) return null;
    const tangent = (speedSquared - Math.sqrt(discriminant)) / (gravity * horizontalDistance);
    const cosine = 1 / Math.sqrt(1 + tangent * tangent);
    const horizontalSpeed = FIXED_LAUNCH_SPEED * cosine;
    return new THREE.Vector3(
      (dx / horizontalDistance) * horizontalSpeed,
      horizontalSpeed * tangent,
      (dz / horizontalDistance) * horizontalSpeed,
    );
  }

  /** Iterative yaw/elevation solve shared by `solveAimAtScreenPoint` (a real
   * drag, aimed via a screen-space ray) and the scripted FTUE shots in
   * `runScriptedShot` (aimed directly at a known world point) — everything
   * past "here is the target in world space" is identical between the two. */
  private solveAimAtWorldTarget(target: THREE.Vector3): BallisticSolution | null {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const start = this.muzzleAnchor.getWorldPosition(new THREE.Vector3());
      const desiredVelocity = this.fixedSpeedVelocity(start, target);
      if (!desiredVelocity) return null;
      this.yaw = THREE.MathUtils.clamp(Math.atan2(-desiredVelocity.x, -desiredVelocity.z), -CANNON_MAX_YAW, CANNON_MAX_YAW);
      this.elevation = THREE.MathUtils.clamp(
        Math.atan2(desiredVelocity.y, Math.hypot(desiredVelocity.x, desiredVelocity.z)),
        CANNON_MIN_ELEVATION,
        CANNON_MAX_ELEVATION,
      );
      this.applyCannonTransform();
    }
    const solution = this.ballisticSetup();
    if (Math.abs(solution.velocity.z) < 1e-5) return null;
    const planeTime = (target.z - solution.start.z) / solution.velocity.z;
    if (!Number.isFinite(planeTime) || planeTime <= 0 || planeTime > AIM_PREDICTION_DURATION) return null;
    const crossing = this.positionAt(solution.start, solution.velocity, planeTime);
    const residual = Math.hypot(crossing.x - target.x, crossing.y - target.y);
    if (residual > 0.16) return null;
    return solution;
  }

  private solveAimAtScreenPoint(screenX: number, screenY: number) {
    const { origin, direction } = this.cameraRayForScreenPoint(screenX, screenY);
    const hit = this.planeHit(origin, direction, true);
    const target = hit?.point ?? this.sandPlanePoint(screenX, screenY);
    const solution = this.solveAimAtWorldTarget(target);
    if (!solution) return null;
    // The grid square is what the ring is drawn on and what the shot will be
    // centred on, so it is reported whether or not sand happens to sit there.
    return { solution, cell: hit?.cell ?? null, grid: hit?.grid ?? this.gridAtPoint(target) };
  }

  /** Inverse of `gridAtPoint` — the world point (on the sand plane) a given
   * frame cell sits at. Used only by the scripted FTUE shots, which aim at a
   * known cell directly instead of ray-casting from a screen position. */
  private worldPointForGrid(gx: number, gy: number): THREE.Vector3 {
    const planeWorldZ = this.frameRoot.position.z + this.sandMesh.position.z;
    const localX = (gx - (this.level.frame.width - 1) / 2) * this.cell;
    const localY = (gy - (this.level.frame.height - 1) / 2) * this.cell;
    return new THREE.Vector3(this.frameRoot.position.x + localX, this.frameRoot.position.y + localY, planeWorldZ);
  }

  /** Projects a world point to on-screen pixels within `this.host`, the same
   * space the crosshair's `left`/`top` styles are written in. */
  private screenPointForWorld(point: THREE.Vector3): { x: number; y: number } {
    const ndc = point.clone().project(this.camera);
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
  }

  /** Where a frame cell renders on screen right now — for the freeze
   * tutorial's spotlight callout (`SandGame.tsx`'s `freezeFtueStep`), which
   * has to point a highlight ring at the same cell `runScriptedShot` is
   * about to fire at, in the same `left`/`top` pixel space the crosshair
   * itself is positioned in. */
  screenPointForGrid(gx: number, gy: number): { x: number; y: number } {
    return this.screenPointForWorld(this.worldPointForGrid(gx, gy));
  }

  private waitUntilReadyToAim(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.disposed || this.canStartAim()) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  /**
   * Level 31's freeze FTUE (`SandLevelConfig.ftueFreezeDemo`): drags the aim
   * onto `(gx, gy)` and fires — a REAL shot through `fire()`/`resolveShot`,
   * not a cosmetic showcase round. Resolves `true` once the shot has left
   * the barrel, `false` if the engine wasn't in a state to aim at all (the
   * caller should just stop the sequence in that case).
   *
   * Blocks real pointer input for the duration via `scriptedShotActive` (set
   * by the caller, `runScriptedShotSequence`) — see `onAimPointerDown`.
   */
  private runScriptedShot(gx: number, gy: number, dragMs = 650): Promise<boolean> {
    if (!this.canStartAim()) return Promise.resolve(false);
    const target = this.worldPointForGrid(gx, gy);
    const startYaw = this.yaw;
    const startElevation = this.elevation;
    const solution = this.solveAimAtWorldTarget(target);
    if (!solution) {
      this.yaw = startYaw;
      this.elevation = startElevation;
      this.applyCannonTransform();
      return Promise.resolve(false);
    }
    const finalYaw = this.yaw;
    const finalElevation = this.elevation;
    const finalScreen = this.screenPointForWorld(target);
    this.yaw = startYaw;
    this.elevation = startElevation;
    this.applyCannonTransform();

    const pointerId = SCRIPTED_AIM_POINTER_ID;
    this.aimPointer = pointerId;
    this.lastInputAt = performance.now();
    this.callbacks.onEvent?.({ type: "AIM_TOUCHED" });
    this.aimZone.classList.add("is-aiming");
    this.crosshair.classList.add("is-visible", "is-engaged", "is-aiming", "is-target-valid");
    const centerX = this.host.clientWidth / 2;
    const centerY = this.host.clientHeight / 2;
    this.aimZone.style.setProperty("--joystick-x", `${centerX}px`);
    this.aimZone.style.setProperty("--joystick-y", `${centerY}px`);

    return new Promise((resolve) => {
      const started = performance.now();
      const tick = (now: number) => {
        if (this.disposed || this.aimPointer !== pointerId) {
          resolve(false);
          return;
        }
        const t = THREE.MathUtils.clamp((now - started) / dragMs, 0, 1);
        const eased = t * t * (3 - 2 * t);
        this.yaw = THREE.MathUtils.lerp(startYaw, finalYaw, eased);
        this.elevation = THREE.MathUtils.lerp(startElevation, finalElevation, eased);
        this.applyCannonTransform();
        const screenX = THREE.MathUtils.lerp(centerX, finalScreen.x, eased);
        const screenY = THREE.MathUtils.lerp(centerY, finalScreen.y, eased);
        this.crosshair.style.left = `${screenX}px`;
        this.crosshair.style.top = `${screenY}px`;
        this.aimZone.style.setProperty("--joystick-dx", `${(screenX - centerX) * 0.5}px`);
        this.aimZone.style.setProperty("--joystick-dy", `${(screenY - centerY) * 0.5}px`);
        if (t >= 1) {
          this.displayedLaunch = solution;
          window.setTimeout(() => {
            if (this.disposed || this.aimPointer !== pointerId) {
              resolve(false);
              return;
            }
            this.clearAimGesture();
            this.fire(solution);
            resolve(true);
          }, 180);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** Runs level 31's freeze FTUE end to end: an auto-drag-and-fire at each
   * grid cell in `targets`, in order, each one waiting for the previous shot
   * to fully land and the board to settle before starting the next drag.
   * Stops early (returning `false`) if any shot can't be aimed — the caller
   * should still show "Tap to continue" and hand back control either way. */
  async runScriptedShotSequence(targets: readonly { x: number; y: number }[]): Promise<boolean> {
    this.scriptedShotActive = true;
    try {
      for (const target of targets) {
        await this.waitUntilReadyToAim();
        const fired = await this.runScriptedShot(target.x, target.y);
        if (!fired) return false;
      }
      await this.waitUntilReadyToAim();
      return true;
    } finally {
      this.scriptedShotActive = false;
    }
  }

  /** The frame square a world point falls in, or null if it falls outside. */
  private gridAtPoint(point: THREE.Vector3) {
    const local = point.clone().sub(this.frameRoot.position);
    const x = Math.round(local.x / this.cell + (this.level.frame.width - 1) / 2);
    const y = Math.round(local.y / this.cell + (this.level.frame.height - 1) / 2);
    const inside = x >= 0 && x < this.level.frame.width && y >= 0 && y < this.level.frame.height;
    return inside ? { x, y } : null;
  }

  private ballisticSetup(): BallisticSolution {
    this.applyCannonTransform();
    const start = this.muzzleAnchor.getWorldPosition(new THREE.Vector3());
    const quaternion = this.muzzleAnchor.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
    return { start, velocity: forward.multiplyScalar(FIXED_LAUNCH_SPEED) };
  }

  private positionAt(start: THREE.Vector3, velocity: THREE.Vector3, time: number) {
    return start.clone().addScaledVector(velocity, time).addScaledVector(GRAVITY, 0.5 * time * time);
  }

  private showIdleCrosshair() {
    this.displayedAimArmed = false;
    this.displayedLaunch = null;
    this.crosshair.style.left = "50%";
    this.crosshair.style.top = "50%";
    this.crosshair.classList.remove("is-engaged", "is-aiming", "is-target-valid");
    this.crosshair.style.removeProperty("--aim-color");
    this.crosshair.classList.toggle("is-visible", this.canInteract());
    if (this.aimRing) this.aimRing.visible = false;
    if (this.aimRingGlow) this.aimRingGlow.visible = false;
    // No crosshair, no radius (or Chain Sort mass) to preview — every lifted
    // grain eases back down via the loop in `step()`.
    this.liftTarget = null;
    this.liftCells = null;
  }

  private updateAimPreview() {
    if (this.aimPointer === null || !this.canInteract()) {
      this.showIdleCrosshair();
      this.aimedFreezeTriggerId = null;
      return;
    }
    const cursor = this.cursorForCurrentStick();
    const solved = this.solveAimAtScreenPoint(cursor.x, cursor.y);
    // On request ("cục freeze sẽ highlight lên bằng shadow trắng" khi
    // crosshair nhắm vào nó): an exact-cell match against `freezeCellTriggerId`,
    // the same rule `triggerAtCell` (sand-rules.ts) uses to decide whether a
    // shot fired right now would actually arm it — the highlight never lights
    // up a trigger this shot would only sweep past. Gated on `aimArmed` like
    // `liftTarget` just below: a bare touch-down with no drag yet previews
    // nothing, freeze included.
    this.aimedFreezeTriggerId =
      solved?.grid && this.aimArmed
        ? this.freezeCellTriggerId.get(cellKey(solved.grid.x, solved.grid.y)) ?? null
        : null;
    this.displayedLaunch = solved?.solution ?? null;
    this.displayedAimArmed = this.aimArmed;
    this.crosshair.style.left = `${THREE.MathUtils.clamp(cursor.x, AIM_CURSOR_EDGE_MARGIN, Math.max(AIM_CURSOR_EDGE_MARGIN, this.host.clientWidth - AIM_CURSOR_EDGE_MARGIN))}px`;
    this.crosshair.style.top = `${THREE.MathUtils.clamp(cursor.y, AIM_CURSOR_EDGE_MARGIN, Math.max(AIM_CURSOR_EDGE_MARGIN, this.host.clientHeight - AIM_CURSOR_EDGE_MARGIN))}px`;
    this.crosshair.classList.add("is-visible", "is-engaged", "is-aiming");
    // Valid means "inside the frame", not "on sand": aiming at the gap above
    // the pile is a shot the player is allowed to take and one that resolves.
    this.crosshair.classList.toggle("is-target-valid", Boolean(solved?.grid) && this.aimArmed);
    // Tints the sight with whatever sand it is over. It reports what is under
    // the crosshair, never whether that is the right answer — the player still
    // has to read the ammo colour against it.
    if (solved?.cell) {
      this.crosshair.style.setProperty("--aim-color", `#${sandColorHex(this.level, solved.cell.color).toString(16).padStart(6, "0")}`);
    } else {
      this.crosshair.style.removeProperty("--aim-color");
    }
    // Radius Overcharge's reach is shown before it is spent: the same ring
    // the player already reads the un-boosted disc from just scales up,
    // rather than a second ring competing for attention (spec §6's reuse of
    // the aim-ring language for Radius's icon, carried into the ring itself).
    // Chain Sort has no disc to show at all — a ring at the base radius would
    // just be wrong, not merely uninformative — so it is hidden outright
    // rather than scaled, the same way it is while no booster is armed.
    const isChainSort = this.armedBooster === "chainSort";
    const armedScale = this.boosterRadiusScale(this.armedBooster);
    if (this.aimRing) {
      this.aimRing.visible = Boolean(solved?.grid) && !isChainSort;
      if (solved?.grid) {
        this.moveRingToCell(this.aimRing, solved.grid.x, solved.grid.y);
        this.aimRing.scale.setScalar(armedScale);
      }
    }
    if (this.aimRingGlow) {
      this.aimRingGlow.visible = Boolean(solved?.grid) && !isChainSort;
      if (solved?.grid) {
        this.moveRingToCell(this.aimRingGlow, solved.grid.x, solved.grid.y);
        this.aimRingGlow.scale.setScalar(armedScale);
      }
    }
    // What the disc this shot would resolve against actually reaches — same
    // centre/radius/colour-rule `handleImpact` hands `resolveShot`, just read
    // here instead of spent, so the lift loop in `step()` can preview it.
    // Gated on `aimArmed` like `is-target-valid` above: a bare touch-down
    // with no drag yet shows no ring, so it should light up no sand either.
    const ammo = currentAmmo(this.level, this.state);
    // Chain Sort previews the exact cells it would take (no fixed radius to
    // approximate it with) — the real oracle, `cellsByFloodFill`, run here
    // read-only the same way `liftTarget`'s own disc is a read of what
    // `resolveShot` would do, never spent by looking.
    this.liftCells = solved?.grid && this.aimArmed && ammo && isChainSort
      ? new Set(
          cellsByFloodFill(this.state.bodies, { x: solved.grid.x, y: solved.grid.y }, ammo, frozenSet(this.state))
            .map((cell) => cellKey(cell.x, cell.y)),
        )
      : null;
    this.liftTarget = solved?.grid && this.aimArmed && ammo && !isChainSort
      ? {
          x: solved.grid.x,
          y: solved.grid.y,
          radius: effectiveSortRadius(this.level, this.armedBooster),
          color: ammo,
          matchColor: this.armedBooster !== "prismShot",
        }
      : null;
    this.aimPreviewDirty = false;
  }

  // ---- firing ------------------------------------------------------------

  private fire(launch: BallisticSolution) {
    const color = currentAmmo(this.level, this.state);
    if (!color) return;
    this.nextShotAt = performance.now() + SHOT_COOLDOWN_MS;
    this.recoil = 1;
    // The round left the chamber. It stays empty until the shot resolves and
    // the queue hands the next one over.
    this.chamberLoaded = false;
    this.spawnMuzzleSmoke(launch.start, launch.velocity);
    const fireBling = this.sparkleBlingColors();
    if (fireBling) {
      this.spawnSparkleMuzzleBurst(launch.start, fireBling);
      this.sparkleTrailAge = 0;
    }

    // Consumed the instant it leaves the barrel (spec §7.1), whether this
    // shot goes on to hit or miss — the overlay rings come down with it, since
    // whatever chambers next carries no buff.
    const booster = this.armedBooster;
    this.armedBooster = null;
    this.syncBoosterOverlay();
    this.callbacks.onBoosterChange?.(null);
    // The charge this armed shot cost — see `spendBoosterCharge`'s own
    // comment for why this is the one and only place it is spent. A level
    // that forces this type's charges (`boosterChargesOverride`) spends down
    // its own local count instead of the real wallet — same pool
    // `effectiveBoosterCharges`/`armBooster` just checked, so arming and
    // spending never disagree about which one is live.
    if (booster) {
      const overrideCharges = this.state.boosterChargesOverride?.[booster];
      if (overrideCharges !== undefined) {
        this.state = {
          ...this.state,
          boosterChargesOverride: { ...this.state.boosterChargesOverride, [booster]: Math.max(0, overrideCharges - 1) },
        };
      } else {
        spendBoosterCharge(booster);
        // Provisional: refunded right back if this exact shot turns out to
        // be a miss or a NO_MATCH, or if this attempt ends in FAIL before the
        // charge was ever "worth it" — see `boostersSpentThisAttempt`'s own
        // doc comment.
        this.boostersSpentThisAttempt.push(booster);
      }
    }

    if (!this.projectileMesh) {
      const geometry = this.track(new THREE.SphereGeometry(PROJECTILE_RADIUS, 12, 8));
      const material = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.projectileMesh = new THREE.Mesh(geometry, material);
      this.projectileMesh.add(this.buildProjectileOutline());
      this.scene.add(this.projectileMesh);
    }
    const material = this.projectileMesh.material as THREE.MeshBasicMaterial;
    material.color.setHex(sandColorHex(this.level, color));
    this.projectileMesh.visible = true;
    this.projectileMesh.position.copy(launch.start);
    // Spec §6: the bullet itself has to look different, not just the chamber
    // it left. Radius Overcharge starts life-size and grows in flight (see
    // `updateProjectile`'s growth ramp) rather than jumping straight to its
    // final size here; Prism Shot's hue-cycle and rainbow trail are both
    // applied per frame in `updateProjectile` instead, since they move in time.
    this.projectileMesh.scale.setScalar(1);
    if (booster === "prismShot") this.prismTrailAge = 0;

    this.projectile = {
      mesh: this.projectileMesh,
      start: launch.start.clone(),
      velocity: launch.velocity.clone(),
      previous: launch.start.clone(),
      time: 0,
      color,
      booster,
      growTargetScale: booster === "radiusOvercharge" ? this.radiusBoosterMaxProjectileScale() : undefined,
    };
    this.setPhase("PROJECTILE_FLYING");
    // Published, not just recorded: the flight is the first stretch of the
    // locked-input window, and §24 asks for that to be visible from the moment
    // it starts rather than only once sand begins moving.
    this.callbacks.onState(this.cloneState());
    this.callbacks.onEvent?.({ type: "SHOT_FIRED", color });
  }

  private updateProjectile(projectile: Projectile) {
    projectile.time += FIXED_STEP;
    // The bullet's own colour cycles through the spectrum for as long as
    // it's in the air — still unmistakably not a normal round even before
    // the rainbow trail below is accounted for.
    let prismHue: number | null = null;
    if (projectile.booster === "prismShot") {
      prismHue = (projectile.time * PRISM_PROJECTILE_HUE_HZ) % 1;
      (projectile.mesh.material as THREE.MeshBasicMaterial).color.setHSL(prismHue, 0.85, 0.6);
    }
    const next = this.positionAt(projectile.start, projectile.velocity, projectile.time);

    const flightBling = this.sparkleBlingColors();
    if (flightBling) {
      this.sparkleTrailAge += FIXED_STEP;
      if (this.sparkleTrailAge >= SPARKLE_TRAIL_INTERVAL) {
        this.sparkleTrailAge = 0;
        this.spawnSparkleTrail(next, flightBling);
      }
    }

    // Spec §6's "vệt cầu vồng": a streak of colour-cycling shards trickling
    // behind the ball, same cadence idea as the magic trail just above but
    // its own throttle so the two never starve each other.
    if (prismHue !== null) {
      this.prismTrailAge += FIXED_STEP;
      if (this.prismTrailAge >= PRISM_TRAIL_INTERVAL) {
        this.prismTrailAge = 0;
        this.spawnPrismTrail(next, prismHue);
      }
    }

    const hit = this.planeHit(projectile.previous, next.clone().sub(projectile.previous).normalize(), true);
    // planeHit solves against the infinite plane along a ray; confirm the
    // crossing actually falls inside this tick's travelled segment before
    // trusting it, since a ray can cross the plane far outside the step taken.
    const segmentLength = projectile.previous.distanceTo(next);
    const validHit = hit && hit.t >= 0 && hit.t <= segmentLength + PROJECTILE_RADIUS;

    // Radius Overcharge: the ball puffs up from life-size at the muzzle to
    // `growTargetScale` (`radiusBoosterMaxProjectileScale`) by the moment it
    // reaches the frame's plane, so it visibly grows in flight rather than
    // arriving pre-inflated. Progress rides the same z-axis the miss check
    // below already uses to know "reached the frame", since velocity.z is
    // unaffected by `GRAVITY` and so travels at a constant rate.
    if (projectile.growTargetScale) {
      const planeZ = this.frameRoot.position.z + this.sandMesh.position.z;
      const totalDist = projectile.start.z - planeZ;
      const point = validHit ? hit.point : next;
      const progress = totalDist > 0 ? THREE.MathUtils.clamp((projectile.start.z - point.z) / totalDist, 0, 1) : 1;
      projectile.mesh.scale.setScalar(THREE.MathUtils.lerp(1, projectile.growTargetScale, progress));
    }

    if (validHit) {
      const contact = hit.point;
      projectile.mesh.position.copy(contact);
      this.handleImpact(hit.cell, hit.grid, contact);
      return;
    }

    projectile.mesh.position.copy(next);
    projectile.previous.copy(next);
    // Everything else is a miss. Whether it clipped the frame only changes the
    // feedback, never the ammo: MISS_IS_FREE_TEMP covers both (Open Decisions 6 and 7).
    const passedPlane = next.z <= this.frameRoot.position.z + this.sandMesh.position.z;
    if (passedPlane || projectile.time > 3 || next.y < -4 || Math.abs(next.x) > 14) {
      const hitFrame = this.hitFrameStructure(next);
      // A graze off the frame's own border is still the frame getting hit —
      // it flinches the same as a shot that actually lands inside it.
      if (hitFrame) this.triggerFrameRecoil(next);
      this.handleMiss(hitFrame);
    }
  }

  /** Did the shot land on the frame itself rather than sail past the whole thing? */
  private hitFrameStructure(point: THREE.Vector3) {
    const halfWidth = (this.level.frame.width * this.cell) / 2 + this.cell * FRAME_BORDER_CELLS;
    const halfHeight = (this.level.frame.height * this.cell) / 2 + this.cell * FRAME_BORDER_CELLS;
    const dx = Math.abs(point.x - this.frameRoot.position.x);
    const dy = Math.abs(point.y - this.frameRoot.position.y);
    return dx <= halfWidth && dy <= halfHeight;
  }

  /**
   * A light flinch every time a shot actually reaches the frame — see the
   * constants above `frameRecoil`. Off-centre hits lean the kick toward
   * whichever edge they landed nearest, on top of the same straight-back
   * push every impact gets; `step` is what plays it out and decays it.
   */
  private triggerFrameRecoil(point: THREE.Vector3) {
    const halfWidth = (this.level.frame.width * this.cell) / 2;
    const halfHeight = (this.level.frame.height * this.cell) / 2;
    this.frameRecoilOffsetX = halfWidth > 0
      ? THREE.MathUtils.clamp((point.x - this.frameRoot.position.x) / halfWidth, -1, 1)
      : 0;
    this.frameRecoilOffsetY = halfHeight > 0
      ? THREE.MathUtils.clamp((point.y - this.frameRoot.position.y) / halfHeight, -1, 1)
      : 0;
    this.frameRecoil = 1;
  }

  private handleMiss(hitFrame: boolean) {
    // A boosted shot that never even landed on the board didn't do anything
    // its charge was for — hand it straight back (spec: "bắn trượt không
    // tính là đã dùng").
    const booster = this.projectile?.booster ?? null;
    this.clearProjectile();
    if (booster) this.refundBoosterCharge(booster);
    this.callbacks.onEvent?.({ type: "MISS", hitFrame });
    this.setPhase("READY");
    this.callbacks.onState(this.cloneState());
  }

  private clearProjectile() {
    if (this.projectile) this.projectile.mesh.visible = false;
    this.projectile = null;
  }

  private handleImpact(cell: PixelCell | null, grid: CellCoord, contact: THREE.Vector3) {
    const ammo = this.projectile?.color ?? null;
    const booster = this.projectile?.booster ?? null;
    this.clearProjectile();
    if (!ammo) return;
    this.triggerFrameRecoil(contact);
    if (booster) {
      this.callbacks.onEvent?.({ type: "BOOSTER_IMPACT", booster });
      // Radius Overcharge's own tell (on request): a bigger, decaying
      // oscillation layered on top of the ordinary per-shot recoil flinch
      // above — `step()` is what plays it out. Reset on every radius impact
      // rather than added to whatever is left of a previous one, so back-to-
      // back Radius shots each read as their own full kick instead of
      // stacking into something wilder than any single shot earned.
      if (booster === "radiusOvercharge") {
        this.radiusShakeAmplitude = 1;
        this.radiusShakeTime = 0;
      }
    }
    haptic("impact");
    sound("impact");
    const impactBling = this.sparkleBlingColors();
    if (impactBling) this.spawnSparkleImpactBurst(contact, impactBling);

    // Sand under the impact centres the disc on that grain; empty air centres it
    // on the square the shot came down in. Either way the disc has a centre and
    // sorts from it.
    const center = cell ? { x: cell.x, y: cell.y } : grid;
    const resolution = resolveShot(
      this.level,
      this.state,
      { bodyId: cell?.bodyId ?? null, x: center.x, y: center.y },
      booster,
    );
    // Sized to what this specific shot actually reached — the flash for a
    // Radius Overcharge hit has to be the bigger disc, not the level's base
    // one. Chain Sort has no disc at all (see `updateAimPreview`'s own
    // comment), so it skips the ring flash entirely rather than draw one at
    // a size that means nothing — the clear-flash on every grain it actually
    // took is its own tell.
    const radiusUsed = effectiveSortRadius(this.level, booster);
    if (booster !== "chainSort") this.spawnSortRing(center.x, center.y, this.boosterRadiusScale(booster));
    // How much this shot actually kicked loose, not just whether the crosshair
    // itself sat on a grain — aiming at the gap above the pile still sorts
    // whatever sand the disc reaches, so the spray has to fire off of that,
    // not off `cell` (which is null whenever the contact point itself is empty
    // air). Grains start spread across the whole disc the shot reached, not
    // all bunched at the exact contact point.
    if (resolution.removed.length) {
      // Every colour actually cleared, not just the one under the crosshair —
      // a Prism Shot clears every colour the disc touches (matchColor is off
      // for it), so its spray has to show the whole palette that came loose,
      // not just paint it all in the ammo's own colour.
      const colors = resolution.removed
        .map((coord) => this.cells.get(cellKey(coord.x, coord.y))?.rgb)
        .filter((rgb): rgb is readonly [number, number, number] => Boolean(rgb))
        .map((rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]);
      if (colors.length) {
        const grainCount = THREE.MathUtils.clamp(resolution.removed.length, SAND_SPRAY_MIN_GRAINS, SAND_SPRAY_GRAINS);
        this.spawnSandSpray(contact, colors, grainCount, radiusUsed);
      }
    }

    // The disc landed on sand but found none of its own colour in reach. The
    // shot is still spent and the board is untouched, so the only thing left to
    // say is which reach came up empty — hence the whole disc rattling.
    if (resolution.outcome === "NO_MATCH") {
      // Same "didn't do anything its charge was for" reasoning as a total
      // miss in `handleMiss` — a boosted shot that landed on the wrong
      // colour is refunded, not spent.
      if (booster) this.refundBoosterCharge(booster);
      haptic("wrongColor");
      sound("wrongColor");
      this.callbacks.onEvent?.({ type: "NO_MATCH", ammo });
      // The next shot no longer waits on this one's own animation to finish —
      // state (and the ability to aim again) applies the instant the outcome
      // is known. The shake is queued as a purely cosmetic beat, appended
      // behind whatever is already animating rather than replacing it.
      this.beats.push({ kind: "SHAKE_AREA", center, radius: radiusUsed, ms: NO_MATCH_SHAKE_MS });
      // A NO_MATCH shot ordinarily has nothing to settle — but the one that
      // also happens to tick Freeze's count down to 0 forces a whole-board
      // settle regardless (see `justUnfroze` in sand-rules.ts), so this can
      // arrive with real `steps` to play even though nothing was removed.
      // Same STEP/HOLD beat playback the matched-shot path below uses, just
      // with no CLEAR beat first since there is nothing to flash away.
      if (resolution.steps.length) {
        const timed = resolution.steps.reduce((total, step) => total + (step.kind === "REINDEX" ? 0 : 1), 0);
        const perStep = this.settleStepMs(timed);
        this.beats.push(
          ...resolution.steps.map((step): Beat => ({
            kind: "STEP",
            step,
            ms: step.kind === "REINDEX" ? 0 : perStep,
          })),
          { kind: "HOLD", ms: SETTLE_TAIL_MS },
        );
        this.settleLandings = 0;
        this.nextShotAt = Math.max(this.nextShotAt, performance.now() + CLEAR_DURATION_MS);
        this.state = resolution.state.result ? resolution.state : { ...resolution.state, phase: "SETTLING" };
      } else {
        this.state = resolution.state;
      }
      // "Dùng booster nhưng thua màn đó thì vẫn được hoàn trả lại booster" —
      // this NO_MATCH shot's own charge (if any) was just refunded above;
      // this hands back everything ELSE spent earlier this attempt too, now
      // that the attempt itself is over having never cleared the board.
      if (resolution.state.result?.kind === "FAIL") this.refundBoostersOnFail();
      this.syncFreezeTriggers();
      this.syncFreezeVisuals();
      this.callbacks.onState(this.cloneState());
      return;
    }

    if (!resolution.removed.length) {
      this.setPhase("READY");
      this.callbacks.onState(this.cloneState());
      return;
    }

    haptic("bodyCleared");
    sound("bodyCleared");
    this.callbacks.onEvent?.({
      type: "SAND_SORTED",
      color: ammo,
      cells: resolution.removed.length,
    });

    const doomed = resolution.removed
      .map((coord) => this.cells.get(cellKey(coord.x, coord.y)))
      .filter((entry): entry is PixelCell => Boolean(entry));

    const steps = resolution.steps;
    // REINDEX only relabels, so it does not belong in the division that decides
    // how fast the pouring plays.
    const timed = steps.reduce((total, step) => total + (step.kind === "REINDEX" ? 0 : 1), 0);
    const perStep = this.settleStepMs(timed);
    this.beats.push(
      { kind: "CLEAR", cells: doomed, ms: CLEAR_DURATION_MS },
      ...steps.map((step): Beat => ({
        kind: "STEP",
        step,
        // A relabel is bookkeeping, not an event: it must not cost the player a
        // frame of waiting.
        ms: step.kind === "REINDEX" ? 0 : perStep,
      })),
      { kind: "HOLD", ms: SETTLE_TAIL_MS },
    );
    this.settleLandings = 0;
    // Firing stays locked for the whole clear-flash-and-dissolve-and-fall
    // sequence, not just the clear beat: landing a shot on a board that is
    // still pouring sand would aim it at grains that haven't reached their
    // final cell yet. `setPhase("SETTLING")` below is what actually blocks
    // `canInteract()`; this floor just keeps the ordinary cooldown from being
    // shorter than that lock (never longer — SHOT_COOLDOWN_MS still applies
    // on top if it's already longer, e.g. nothing was cleared).
    this.nextShotAt = Math.max(this.nextShotAt, performance.now() + CLEAR_DURATION_MS);
    // State applies immediately so the board, ammo count, etc. are correct
    // the instant the outcome is known — but the phase it carries is
    // overridden to SETTLING (unless the shot already ended the level) so
    // `canInteract()` stays closed and the "still moving" indicator
    // (`SandGame.tsx`'s `.settle-badge`, keyed off `busy`) shows until
    // `advanceBeats` clears the queue below.
    this.state = resolution.state.result ? resolution.state : { ...resolution.state, phase: "SETTLING" };
    this.syncFreezeTriggers();
    this.syncFreezeVisuals();
    this.callbacks.onState(this.cloneState());
    if (resolution.state.result?.kind === "WIN") { haptic("win"); sound("win"); this.playWinReveal(); }
    // "Dùng booster nhưng thua màn đó thì vẫn được hoàn trả lại booster" —
    // this shot itself matched (it's in the SORTED path), so its own charge
    // stands; this is only for whatever else was spent earlier and never
    // paid off, now that the attempt is over.
    if (resolution.state.result?.kind === "FAIL") { haptic("lose"); sound("lose"); this.refundBoostersOnFail(); }
    if (!resolution.state.result) this.showIdleCrosshair();
  }

  // ---- settle playback ---------------------------------------------------

  /**
   * How long each non-REINDEX settle step gets, given how many of them a
   * shot (or gust) produced — see the comment on `SETTLE_TOTAL_MS`. Every
   * cascade is spread evenly across the same fixed window, so the total
   * falling time is always `SETTLE_TOTAL_MS` regardless of cascade size.
   */
  private settleStepMs(timed: number): number {
    if (!timed) return 0;
    return SETTLE_TOTAL_MS / timed;
  }

  private startBeat(beat: Beat) {
    switch (beat.kind) {
      case "CLEAR":
        for (const cell of beat.cells) {
          cell.dying = 0;
          cell.dyingDelay = Math.random() * CLEAR_STAGGER_MS;
          this.cells.delete(cellKey(cell.x, cell.y));
          this.dying.push(cell);
        }
        break;
      case "SHAKE_AREA": {
        // A shot that found none of its colour shakes the whole disc it swept,
        // so what is rattling is the reach that came up empty rather than one
        // region that happened to be under the crosshair.
        const limit = beat.radius * beat.radius;
        for (const cell of this.cells.values()) {
          const dx = cell.x - beat.center.x;
          const dy = cell.y - beat.center.y;
          if (dx * dx + dy * dy <= limit) cell.shake = 1;
        }
        break;
      }
      case "STEP":
        this.applyStep(beat.step);
        break;
      case "HOLD":
        break;
    }
  }

  /**
   * Replay one solver step on the pixels.
   *
   * The renderer never decides where sand goes — it is told, and only chooses
   * how fast the pixels get there.
   */
  private applyStep(step: SettleStep) {
    if (step.kind === "REINDEX") {
      // Nothing moves here. The solver re-derives bodies from the settled grid,
      // so this is the one moment those labels become true — the pixels are
      // simply told which body they now belong to, ready for the next shot.
      for (const entry of step.assignment) {
        const cell = this.cells.get(cellKey(entry.x, entry.y));
        if (cell) cell.bodyId = entry.bodyId;
      }
      return;
    }

    if (step.kind === "KEY_MOVE") {
      const cells = this.keys.get(step.keyId);
      if (cells) {
        // Radius from the shape's own current bounding box — an author's key
        // is never guaranteed to be `KEY_SPRITE` exactly, so this has to read
        // the shape rather than assume it.
        const xs = cells.map((cell) => cell.x);
        const ys = cells.map((cell) => cell.y);
        const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 || 1;
        // Rolling without slipping: the arc length covered by one step is the
        // step's own path length, so the angle it turns through is that
        // length over the radius. `dx - dy` is a simple, direction-aware
        // stand-in for that length on a grid where a step is at most one cell
        // in each axis, and it keeps a straight vertical drop visibly turning
        // too, rather than only spinning on a sideways nudge.
        const previous = this.keyRotation.get(step.keyId) ?? 0;
        this.keyRotation.set(step.keyId, previous + (step.dx - step.dy) / radius);
        for (const cell of cells) {
          cell.x += step.dx;
          cell.y += step.dy;
        }
        // A genuine shift — `KEY_MOVE` is only ever emitted for one (see
        // `sand-rules.ts`'s own settle solver) — resets the idle clock.
        this.keyLastMovedAt.set(step.keyId, performance.now());
      }
      return;
    }

    if (step.kind === "UNLOCK") {
      // The solver has already decided this region is free. All the renderer
      // does is stop drawing it as ice and flash it once.
      for (const coord of step.cells) {
        const cell = this.cells.get(cellKey(coord.x, coord.y));
        if (!cell) continue;
        cell.locked = false;
        cell.thaw = 1;
      }
      this.lockRegionsDirty = true;
      this.keys.delete(step.keyId);
      this.keyRotation.delete(step.keyId);
      this.keyLastMovedAt.delete(step.keyId);
      this.keyLastSparkleAt.delete(step.keyId);
      haptic("bodyCleared");
      sound("bodyCleared");
      this.callbacks.onEvent?.({ type: "UNLOCKED", cells: step.cells.length });
      return;
    }

    if (step.kind === "GRAIN_PASS") {
      // Applied in the order the solver recorded them, because a grain can move
      // into a cell another grain vacated earlier in the same pass. Doing all
      // the deletions first and then all the arrivals would lose that.
      for (const move of step.moves) {
        const cell = this.cells.get(cellKey(move.from.x, move.from.y));
        if (!cell) continue;
        this.cells.delete(cellKey(move.from.x, move.from.y));
        cell.x = move.to.x;
        cell.y = move.to.y;
        this.cells.set(cellKey(cell.x, cell.y), cell);
      }
      this.settleLandings += 1;
      if (this.settleLandings % 2 === 1) {
        const order = Math.floor(this.settleLandings / 2);
        hapticSandLanded(order);
        soundSandLanded(order);
      }
    }
  }

  /**
   * The "come back and shoot" nag — see `IDLE_HINT_DELAY_SECONDS`'s own
   * comment for the pattern and why. Returns the frame's extra Z-rotation
   * for this instant (0 outside a shake beat), and leaves
   * `idleHighlightStrength`/`idleHighlightColor` set for `redrawSand` to
   * read; both are the actual off switch, so a caller never has to check
   * eligibility itself.
   */
  private updateIdleHint(deltaMs: number): number {
    // A gameplay nag, not a hub one — `canInteract()` alone doesn't rule the
    // hub out (`phase` is READY there too, there is just no shot to take),
    // so this needs its own `!this.idle` on top of it, or a player who
    // leaves the hub open past `IDLE_HINT_DELAY_SECONDS` would see the
    // picture's frame pick up the shake/highlight while nobody has even
    // pressed Play yet.
    const eligible = this.canInteract() && !this.idle && this.aimPointer === null;
    if (!eligible || (performance.now() - this.lastInputAt) / 1000 < IDLE_HINT_DELAY_SECONDS) {
      this.idleHintElapsed = 0;
      this.idleHighlightStrength = 0;
      this.idleHighlightColor = null;
      return 0;
    }

    this.idleHintElapsed = (this.idleHintElapsed + deltaMs / 1000) % IDLE_SHAKE_CYCLE_SECONDS;
    this.idleHighlightColor = currentAmmo(this.level, this.state);
    const breathe = 0.5 + 0.5 * Math.sin(this.idleHintElapsed * IDLE_HIGHLIGHT_HZ * Math.PI * 2);
    this.idleHighlightStrength = IDLE_HIGHLIGHT_FLOOR + (IDLE_HIGHLIGHT_CEILING - IDLE_HIGHLIGHT_FLOOR) * breathe;

    let cursor = 0;
    for (const beat of IDLE_SHAKE_CYCLE) {
      if (this.idleHintElapsed < cursor + beat.seconds) {
        if (!beat.shake) return 0;
        return Math.sin((this.idleHintElapsed - cursor) * IDLE_SHAKE_HZ * Math.PI * 2) * IDLE_SHAKE_TILT;
      }
      cursor += beat.seconds;
    }
    return 0;
  }

  /**
   * Plays the queued beats — the clear flash, pixel dissolve and settle
   * fall. `handleImpact` applies gameplay state the instant a shot resolves,
   * but while `this.state.phase` is SETTLING that state's own `canInteract()`
   * stays closed, so the last beat draining the queue is what hands the
   * player their next shot back (never replacing what is already animating —
   * a later shot can't queue more beats on top since firing is locked until
   * this queue is empty).
   */
  private advanceBeats(deltaMs: number) {
    if (!this.beats.length) return;
    if (!this.beatStarted) {
      this.startBeat(this.beats[0]);
      this.beatStarted = true;
      this.beatElapsed = 0;
    }
    this.beatElapsed += deltaMs;
    while (this.beats.length && this.beatElapsed >= this.beats[0].ms) {
      this.beatElapsed -= this.beats[0].ms;
      this.beats.shift();
      if (!this.beats.length) break;
      this.startBeat(this.beats[0]);
    }
    if (!this.beats.length) {
      this.beatStarted = false;
      if (this.state.phase === "SETTLING" && !this.state.result) {
        this.setPhase("READY");
        this.callbacks.onState(this.cloneState());
      }
    }
  }

  // ---- loop --------------------------------------------------------------

  private setPhase(phase: SandGameState["phase"]) {
    if (this.state.result) return;
    this.state = { ...this.state, phase };
    // Control just came back to the player — the idle-hint clock (see
    // `updateIdleHint`) starts counting fresh from here, not from whenever
    // the shot that led here was actually fired, or a settle animation that
    // ran long would leave the hint firing the instant the board goes quiet.
    if (phase === "READY") this.lastInputAt = performance.now();
  }

  /**
   * Re-derive `freezeTriggers`/`freezeTriggerSet`/`freezeCellTriggerId` from
   * `this.state` — called after every shot resolves. Unlike `walls` (baked
   * once in `buildSand` and never touched again), a trigger can vanish
   * mid-level, so the render-side copy has to be refreshed whenever the
   * state that owns the truth changes.
   */
  private syncFreezeTriggers() {
    this.setFreezeTriggerFields(this.state.freezeTriggers);
  }

  /** Shared by `buildSand` and `syncFreezeTriggers`: rebuilds every
   * render-side view of the trigger list from one source of truth. */
  private setFreezeTriggerFields(triggers: readonly SandFreezeTrigger[]) {
    this.freezeTriggers = triggers.flatMap((trigger) => trigger.cells);
    this.freezeTriggerSet = new Set(this.freezeTriggers.map((cell) => cellKey(cell.x, cell.y)));
    this.freezeCellTriggerId = new Map(
      triggers.flatMap((trigger) => trigger.cells.map((cell) => [cellKey(cell.x, cell.y), trigger.id] as const)),
    );
  }

  private cloneState(): SandGameState {
    return { ...this.state, bodies: this.state.bodies.map((body) => ({ ...body, cells: [...body.cells] })) };
  }

  private step(deltaMs: number) {
    // Unconditional, not either/or: `this.projectile` is only ever set while
    // there is no settle queue to advance (firing is locked for the whole
    // SETTLING phase — see `handleImpact`/`advanceBeats`), but both are cheap
    // no-ops when idle, so there is no reason to make that mutual exclusion
    // explicit here too.
    if (this.projectile) this.updateProjectile(this.projectile);
    this.advanceBeats(deltaMs);

    const liftTarget = this.liftTarget;
    const liftCells = this.liftCells;
    for (const cell of this.cells.values()) {
      if (cell.thaw > 0) cell.thaw = Math.max(0, cell.thaw - FIXED_STEP / THAW_SECONDS);
      // Same radius/colour rule `resolveShot` sweeps by (see `liftTarget`'s
      // own comment) — a locked grain never lifts, since a locked grain can
      // never actually be swept either. `liftCells` is Chain Sort's own exact
      // match instead (see its own comment) — the two are mutually exclusive.
      let target = 0;
      if (liftTarget && !cell.locked && (liftTarget.matchColor ? cell.color === liftTarget.color : true)) {
        const dx = cell.x - liftTarget.x;
        const dy = cell.y - liftTarget.y;
        if (dx * dx + dy * dy <= liftTarget.radius * liftTarget.radius) target = 1;
      } else if (liftCells && !cell.locked && liftCells.has(cellKey(cell.x, cell.y))) {
        target = 1;
      }
      if (cell.lift < target) cell.lift = Math.min(target, cell.lift + FIXED_STEP / LIFT_RISE_SECONDS);
      else if (cell.lift > target) cell.lift = Math.max(target, cell.lift - FIXED_STEP / LIFT_FALL_SECONDS);
    }

    this.recoil = Math.max(0, this.recoil - FIXED_STEP * 4.2);
    this.barrelVisual.position.z = this.recoil * RECOIL_TRAVEL;

    // The frame's own flinch — see the constants above `frameRecoil`. Tilt
    // leans toward whichever side the shot actually landed on; the straight
    // push back is the same for every hit regardless of where it landed.
    this.frameRecoil = Math.max(0, this.frameRecoil - FIXED_STEP * FRAME_RECOIL_DECAY_PER_SECOND);
    const idleShakeZ = this.updateIdleHint(deltaMs);
    // Radius Overcharge's own shake — see `radiusShakeAmplitude`'s own field
    // comment for why this decays exponentially (a real slow-down) rather
    // than linearly (a shake at constant strength that just switches off).
    // Two different frequency multipliers/phases for x vs z is what keeps
    // the wobble reading as an actual shake rather than one axis just
    // trailing the other by a fixed beat.
    let radiusShakeX = 0;
    let radiusShakeZ = 0;
    if (this.radiusShakeAmplitude > RADIUS_SHAKE_STOP_THRESHOLD) {
      this.radiusShakeTime += FIXED_STEP;
      radiusShakeX = Math.sin(this.radiusShakeTime * RADIUS_SHAKE_FREQUENCY_HZ * Math.PI * 2)
        * this.radiusShakeAmplitude * RADIUS_SHAKE_TILT;
      radiusShakeZ = Math.sin(this.radiusShakeTime * RADIUS_SHAKE_FREQUENCY_HZ * Math.PI * 2 * 1.37 + 1.1)
        * this.radiusShakeAmplitude * RADIUS_SHAKE_TILT;
      this.radiusShakeAmplitude *= Math.exp(-RADIUS_SHAKE_DECAY_PER_SECOND * FIXED_STEP);
    } else {
      this.radiusShakeAmplitude = 0;
    }
    this.frameRoot.rotation.x = -this.frameRecoil * FRAME_RECOIL_TILT * this.frameRecoilOffsetY + radiusShakeX;
    this.frameRoot.rotation.z = this.frameRecoil * FRAME_RECOIL_TILT * this.frameRecoilOffsetX + idleShakeZ + radiusShakeZ;
    this.frameRoot.position.z = SAND_PLANE_Z - this.frameRecoil * FRAME_RECOIL_PUSH;

    this.updateAmmoModel();
    this.updateMuzzleSmoke(FIXED_STEP);
    this.updateSandSpray(FIXED_STEP);
    this.updateSparkles(FIXED_STEP);
    this.updateKeyIdleSparkle();

    if (this.sortRing?.visible) {
      this.sortRingAge += FIXED_STEP;
      const life = Math.min(1, this.sortRingAge / SORT_RING_SECONDS);
      this.sortRing.scale.setScalar((0.72 + life * 0.42) * this.sortRingScale);
      (this.sortRing.material as THREE.MeshBasicMaterial).opacity = SORT_RING_PEAK_OPACITY * (1 - life);
      if (life >= 1) this.sortRing.visible = false;
    }

    for (const cell of this.cells.values()) {
      if (cell.shake > 0) cell.shake = Math.max(0, cell.shake - FIXED_STEP * (1000 / NO_MATCH_SHAKE_MS));
    }

    if (this.dying.length) {
      const finished: PixelCell[] = [];
      for (const cell of this.dying) {
        cell.dying = (cell.dying ?? 0) + FIXED_STEP * 1000;
        if (cell.dying >= cell.dyingDelay + CLEAR_LOCAL_MS) finished.push(cell);
      }
      if (finished.length) this.dying = this.dying.filter((cell) => !finished.includes(cell));
    }

    if (this.aimPreviewDirty) this.updateAimPreview();
  }

  private animate = () => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = Math.min(now - this.lastFrame, 120);
    this.lastFrame = now;
    this.updateFrameSpin(delta);
    this.updateWinReveal();
    this.updateCannonEntrance();
    this.updateFreezeVisualsAnimation(delta);
    // Unconditional now, not only while `this.showcase` is up (on request:
    // a level-clear unlock has to play the same "new cannon unlocked" spin
    // + glow the skin picker uses, and that happens mid-level, never in
    // showcase mode) — see `playUnlockCelebration`'s own comment.
    if (this.unlockCelebrationStart !== null) this.updateUnlockCelebration();
    // Runs through the same pause the picker opens on top of, the same way
    // `updateFrameSpin`/`updateCannonEntrance` already do — `step()` below
    // never runs while `this.paused` (the picker is home-screen-only), so the
    // showcase drives its own timers and its own smoke/sparkle pools directly
    // off real elapsed time instead of the fixed-step accumulator.
    if (this.showcase) {
      const deltaSeconds = delta / 1000;
      this.updateShowcase(deltaSeconds);
      this.updateMuzzleSmoke(deltaSeconds);
      this.updateSparkles(deltaSeconds);
    }
    // Same footing as the showcase above: the reward screen only opens from the
    // paused home screen, so the chest runs on real elapsed time rather than
    // the fixed-step accumulator that is not ticking underneath it.
    if (this.chestPhase) this.chestStage?.update(delta / 1000);
    if (!this.paused) {
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= FIXED_STEP * 1000 && steps < 6) {
        this.accumulator -= FIXED_STEP * 1000;
        this.step(FIXED_STEP * 1000);
        steps += 1;
      }
      // Once per rendered frame regardless of how many fixed ticks ran in it —
      // the canvas only needs to reflect where things ended up this frame.
      if (steps > 0) {
        this.redrawSand();
        this.updateLiftBlocks();
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (!this.firstFrameSent) {
      this.firstFrameSent = true;
      this.callbacks.onFirstFrame?.();
    }
  };

  /**
   * The vertical FOV that frames THIS level's picture at `FRAME_FILL_X` /
   * `FRAME_FILL_Y` on the current aspect.
   *
   * Two constraints, and the answer is whichever is the wider angle, since
   * both have to hold:
   *  - across: the picture's own width has to fit inside `FRAME_FILL_X` of the
   *    visible width at the picture's distance;
   *  - down: its top and bottom edges have to fit inside `FRAME_FILL_Y` of the
   *    visible height, measured from the camera's sightline rather than from
   *    the picture's middle — the two are not the same point, the frame hangs
   *    ~1.9 above the sightline at that distance.
   *
   * Everything is derived from the camera and the level rather than assumed,
   * so this stays correct if the camera moves or a level's board is a
   * different shape (`this.cell` is fitted per level — a square board's frame
   * is nowhere near `FIT_HEIGHT` tall).
   */
  private fitFov(aspect: number): number {
    const half = FIT_FOV_SIGHT.copy(CAMERA_LOOK_AT).sub(CAMERA_POSITION).normalize();
    // How far along the sightline the picture plane is, and where that line has
    // got to vertically by then.
    const distance = (SAND_PLANE_Z - CAMERA_POSITION.z) / half.z;
    const sightY = CAMERA_POSITION.y + half.y * distance;

    // The frame's OUTER edge, rails included — that is the edge a player sees
    // approach the side of the screen.
    const border = this.cell * FRAME_BORDER_CELLS;
    const halfWidth = (this.level.frame.width * this.cell) / 2 + border;
    const halfHeight = (this.level.frame.height * this.cell) / 2 + border;
    const fromWidth = halfWidth / FRAME_FILL_X / aspect;
    const fromHeight =
      Math.max(FRAME_CENTER_Y + halfHeight - sightY, sightY - (FRAME_CENTER_Y - halfHeight)) / FRAME_FILL_Y;

    const fov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.max(fromWidth, fromHeight) / distance));
    return THREE.MathUtils.clamp(fov, FIT_FOV_MIN, FIT_FOV_MAX);
  }

  private resize() {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.chestPhase
      ? CHEST_FOV
      : this.showcase
        ? SHOWCASE_FOV
        : this.fitFov(this.camera.aspect);
    this.camera.updateProjectionMatrix();
    if (this.aimPointer !== null) this.updateAimGesture(this.aimCurrent.x, this.aimCurrent.y);
    else this.showIdleCrosshair();
  }

  // ---- lifecycle ---------------------------------------------------------

  /**
   * The home screen is up.
   *
   * Not the same thing as a paused tab: the scene keeps being rendered, because
   * the picture in the frame IS the home screen's artwork. Only the playing of
   * it stops — no ticking, no aiming, and no sight left hanging over a menu
   * that has nothing to aim at.
   */
  setIdle(idle: boolean) {
    this.idle = idle;
    if (!idle) {
      // The idle-hint clock (`updateIdleHint`) has been running the whole
      // time the hub sat idle — nothing before this reset it, `lastInputAt`
      // is just whenever the player last actually touched the aim zone,
      // possibly minutes ago. Left alone, a player who reads the hub for
      // more than `IDLE_HINT_DELAY_SECONDS` before tapping Play would see
      // the "come back and shoot" hint fire on literally the first frame of
      // play, for a shot they have not even had the chance to take yet.
      // Bumping it here is what makes the countdown start counting from the
      // moment play actually begins, the same way `setPhase` already bumps
      // it every time a shot resolves and control returns to the player.
      this.lastInputAt = performance.now();
      this.cannonRoot.visible = true;
      this.startCannonEntrance();
      startAmbience();
      // Ease the picture back to its authored orientation first; `resume()`
      // fires once that finishes, from `updateFrameSpin`. Staying paused for
      // that stretch keeps a shot from landing before the aim math (which
      // assumes frameRoot is unrotated) is valid again.
      this.spinReturnFrom = this.frameRoot.rotation.y;
      this.spinReturnStart = performance.now();
      return;
    }
    this.cannonRoot.visible = false;
    // Cancel any animation in progress rather than snapping to it — if the
    // player is back on the home screen there is nothing left for either to
    // finish playing towards.
    this.cannonEntranceStart = null;
    this.spinReturnStart = null;
    // Shrinks back down instantly, same treatment as the cannon vanishing
    // above rather than the eased grow `updateFrameSpin` plays on the way
    // INTO play — nothing about arriving back at the hub is worth animating,
    // the player is not looking at this frame while a level's own result
    // screen or the hub nav is what just fired this.
    this.frameRoot.scale.setScalar(HUB_FRAME_SCALE);
    this.pause();
    stopAmbience();
    this.crosshair.classList.remove("is-visible", "is-engaged", "is-aiming", "is-target-valid");
  }

  /** Sets the cannon rig to its "just arriving" pose; `updateCannonEntrance`
   * eases it from here to its resting pose on every frame that follows. */
  private startCannonEntrance() {
    this.cannonEntranceStart = performance.now();
    this.cannonRoot.position.y = CANNON_ROOT_POSITION.y - CANNON_RISE_DISTANCE;
    this.turret.position.y = TURRET_REST_Y + TURRET_DROP_HEIGHT;
  }

  /**
   * Plays out the entrance `startCannonEntrance` set up: the rig rises into
   * place, and — starting partway through that rise — the turret drops onto
   * the base from above with a small overshoot, as if the two had just been
   * fitted together. Runs every frame regardless of `paused`, like
   * `updateFrameSpin`: the entrance has to keep playing through the very
   * pause it is layered on top of.
   */
  private updateCannonEntrance() {
    if (this.cannonEntranceStart === null) return;
    const elapsed = (performance.now() - this.cannonEntranceStart) / 1000;

    const riseT = Math.min(1, elapsed / CANNON_RISE_SECONDS);
    const riseEased = 1 - (1 - riseT) ** 3;
    this.cannonRoot.position.y = THREE.MathUtils.lerp(
      CANNON_ROOT_POSITION.y - CANNON_RISE_DISTANCE,
      CANNON_ROOT_POSITION.y,
      riseEased,
    );

    const dropElapsed = elapsed - TURRET_DROP_DELAY_SECONDS;
    const dropT = Math.min(1, Math.max(0, dropElapsed) / TURRET_DROP_SECONDS);
    const dropEased = easeOutBack(dropT);
    this.turret.position.y = TURRET_REST_Y + TURRET_DROP_HEIGHT * (1 - dropEased);

    if (riseT >= 1 && dropElapsed >= TURRET_DROP_SECONDS) {
      this.cannonRoot.position.y = CANNON_ROOT_POSITION.y;
      this.turret.position.y = TURRET_REST_Y;
      this.cannonEntranceStart = null;
    }
  }

  /**
   * Turns the picture while the home screen is up, and eases it back to
   * rotation 0 once the player has tapped Play. Runs every rendered frame
   * regardless of `paused`, since the idle spin has to keep turning through
   * the very pause it is layered on top of.
   */
  private updateFrameSpin(deltaMs: number) {
    if (this.spinReturnStart !== null) {
      const t = Math.min(1, (performance.now() - this.spinReturnStart) / (SPIN_RETURN_SECONDS * 1000));
      const eased = 1 - (1 - t) ** 3;
      this.frameRoot.rotation.y = this.spinReturnFrom * (1 - eased);
      // The picture growing back to full size rides the same timer/easing as
      // its rotation straightening out — always FROM `HUB_FRAME_SCALE` TO 1
      // (unlike rotation, there is no varying "from" to capture, since the
      // hub always leaves it shrunk by exactly that fixed amount).
      this.frameRoot.scale.setScalar(HUB_FRAME_SCALE + (1 - HUB_FRAME_SCALE) * eased);
      if (t >= 1) {
        this.frameRoot.rotation.y = 0;
        this.frameRoot.scale.setScalar(1);
        this.spinReturnStart = null;
        this.resume();
      }
      return;
    }
    if (!this.idle) return;
    const twoPi = Math.PI * 2;
    this.frameRoot.rotation.y = (this.frameRoot.rotation.y + (twoPi / IDLE_SPIN_SECONDS_PER_TURN) * (deltaMs / 1000)) % twoPi;
  }

  pause() {
    this.paused = true;
    if (this.aimPointer !== null) this.clearAimGesture();
  }

  resume() {
    this.paused = false;
    this.lastFrame = performance.now();
    this.showIdleCrosshair();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Immediate, not the usual fade: this instance is gone, so there is
    // nothing left for a fade-out to play against.
    stopAmbience(true);
    cancelAnimationFrame(this.frameId);
    this.clearAimOutsideTimer();
    this.resizeObserver.disconnect();
    this.aimZone.removeEventListener("pointerdown", this.onAimPointerDown);
    this.aimZone.removeEventListener("pointermove", this.onAimPointerMove);
    this.aimZone.removeEventListener("pointerup", this.onAimPointerUp);
    this.aimZone.removeEventListener("pointercancel", this.onAimPointerCancel);
    this.sandTexture.dispose();
    this.clearShowcaseShots();
    for (const item of this.disposables) item.dispose();
    this.crosshair.classList.remove("is-visible", "is-engaged", "is-aiming", "is-target-valid");
    releaseRenderer(this);
  }
}
