import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { haptic, hapticSandLanded } from "./haptics";
import { acquireRenderer, releaseRenderer } from "./renderer-pool";
import { SAND_LIGHTNESS_JITTER, SAND_SATURATION_JITTER, jitterColor } from "./sand-color";
// Only the padlock: the key's shape is whatever cells the level authored, and
// this file draws them rather than deciding them.
import { PADLOCK_SPRITE, spriteCells, spriteHeight, spriteWidth } from "./sand-sprites";
import {
  cellKey,
  createSandGameState,
  currentAmmo,
  groupCells,
  expandLevelForPixelBoard,
  nextAmmo,
  parseSandLevel,
  resolveShot,
  resolveWind,
} from "./sand-rules";
import type {
  CellCoord,
  SandColor,
  SandPhase,
  WindDirection,
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

// Candy, not pastel-washed — the first pass at these leaned too far toward
// desaturated and read as faded next to the reference. Punched back up in
// saturation, in the same chill hue family as the chrome around them (see
// :root in globals.css), while staying far enough apart in hue that the
// colour-matching rule never gets ambiguous.
export const SAND_COLOR_HEX: Record<SandColor, number> = {
  red: 0xff4d64,
  green: 0x3ecc5e,
  yellow: 0xffc233,
  blue: 0x3aa0f5,
  purple: 0x9a5cf0,
  orange: 0xff8a33,
};

// ---- inherited cannon parameters ----------------------------------------
// §20 is explicit that this pivot does not get to invent cannon numbers. Every
// constant in this block is carried over unchanged from the pre-pivot
// prototype's cannon; nothing here was re-tuned for sand.
const PROJECTILE_RADIUS = 0.15;
const FIXED_STEP = 1 / 60;
const FIXED_LAUNCH_SPEED = 13.2;
const SHOT_COOLDOWN_MS = 400;
const JOYSTICK_RADIUS = 64;
const JOYSTICK_RESPONSE_DEAD_ZONE = 14;
const JOYSTICK_ARM_RADIUS = 18;
const JOYSTICK_CANCEL_RADIUS = 14;
const MIN_CONTROL_SENSITIVITY = 0.5;
const MAX_CONTROL_SENSITIVITY = 2;
const CANNON_NEUTRAL_YAW = 0;
const CANNON_NEUTRAL_ELEVATION = 0.24;
const CANNON_MAX_YAW = 0.54;
const CANNON_MIN_ELEVATION = -0.08;
const CANNON_MAX_ELEVATION = 1.08;
const GRAVITY = new THREE.Vector3(0, -9.5, 0);
const AIM_PREDICTION_DURATION = 2.2;
const AIM_CURSOR_EDGE_MARGIN = 22;
const AIM_CURSOR_HORIZONTAL_RATIO = 0.39;
const AIM_CURSOR_UP_RATIO = 0.4;
const AIM_CURSOR_DOWN_RATIO = 0.15;
const RECOIL_TRAVEL = 0.23;
const CANNON_ROOT_POSITION = new THREE.Vector3(0, -1.78, 5.25);
const MUZZLE_Z = -2.18;

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

// ---- cannon busy-fade -----------------------------------------------------
// While the board is doing something the player cannot interrupt — the shot
// still in the air, sand collapsing, a merge resolving — the gun is not the
// thing to be looking at. It dims rather than disappears, so it never reads
// as having been removed, just stepped back from.
const CANNON_FADE_PHASES = new Set<SandPhase>(["PROJECTILE_FLYING", "HIT_RESOLUTION", "SETTLING", "MERGING"]);
const CANNON_BUSY_OPACITY = 0.32;
const CANNON_FADE_SECONDS = 0.22;

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
/** Gap between queued rounds on the feed rail, and how far each sits above the last. */
const FEED_SLOT_SPACING = 0.44;
const FEED_SLOT_RISE = 0.075;
const FEED_BALL_RADIUS = 0.15;
/** How long a round takes to roll from its slot into the one ahead of it. */
const FEED_ROLL_SECONDS = 0.28;
/** Breathing rate of the chamber glow, in cycles per second. */
const CHAMBER_GLOW_HZ = 1.5;
/** Wider than the bore at that point, or the band is buried inside the barrel. */
const MUZZLE_BAND_RADIUS = 0.42;

// ---- board presentation --------------------------------------------------
/** The painting is fitted into this opening whatever the authored grid is. */
const FIT_WIDTH = 5.4;
const FIT_HEIGHT = 6.15;
const FRAME_CENTER_Y = 1.95;
const SAND_PLANE_Z = -2.3;
/** Where the pixel plane sits inside the recess, as a fraction of one pixel's world size. */
const PLANE_LOCAL_Z_RATIO = 0.5;
/** Centre and depth of the frame's rear backing panel, as fractions of one pixel's world
 * size. `buildSand` reads these too, to park the back-facing picture just outside it. */
const BACKING_Z_RATIO = -0.72;
const BACKING_DEPTH_RATIO = 0.3;
/** How fast the picture turns on the home screen, one full turn per this many seconds. */
const IDLE_SPIN_SECONDS_PER_TURN = 10;
/** How long the picture takes to ease back to its authored, unrotated orientation once the
 * player taps Play. Gameplay stays paused for this stretch — a shot resolved mid-spin would
 * hit the wrong cell, since the aim math assumes frameRoot is unrotated. */
const SPIN_RETURN_SECONDS = 1;

// SAND_SATURATION_JITTER / SAND_LIGHTNESS_JITTER live in ./sand-color, shared
// with the editor's preview so a level textures the same in both places.

// ---- settle pacing -------------------------------------------------------
// §24 wants sand that flows without turning into dead time, and Open Decision
// 17 asks how long is too long. Rather than a cutoff that snaps the board to
// its answer, the whole cascade is fitted into a budget: a two-step settle
// plays slowly and reads, a forty-step collapse plays fast and still shows
// every step in order. Nothing is ever skipped.
const SETTLE_BUDGET_MS = 1350;
const SETTLE_STEP_MIN_MS = 15;
const SETTLE_STEP_MAX_MS = 58;
// SETTLE_STEP_MIN_MS is a floor on each step, not on the total — for a big
// enough cascade (SETTLE_BUDGET_MS / SETTLE_STEP_MIN_MS ≈ 90 steps and up)
// that floor forces the total past the budget instead of holding it there,
// and the total keeps climbing the more steps a cascade has (a 300-step
// collapse would run 4.5s at the floor alone). This is the actual "how long
// is too long" ceiling Open Decision 17 asks for: it wins over the per-step
// floor once the two disagree, so nothing ever settles for that long no
// matter how big the cascade is — see `settleStepMs`.
const SETTLE_TOTAL_MAX_MS = 1900;
const CLEAR_DURATION_MS = 300;
const NO_MATCH_SHAKE_MS = 360;
/** A beat of stillness after the last grain lands, so the new board can be read. */
const SETTLE_TAIL_MS = 130;

const IMPACT_FLASH_SECONDS = 0.4;
/** How long the disc a radius shot swept stays readable after the impact. */
const SORT_RING_SECONDS = 0.5;
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
/** The key's own gold, and a pale glint that orbits the disc as it moves —
 * the one cue that reads as "rolling" on a shape with no notch or seam to
 * track otherwise. No drop shadow (see `redrawSand`). */
const KEY_RGB: readonly [number, number, number] = [255, 214, 84];
const KEY_GLINT_RGB: readonly [number, number, number] = [255, 250, 214];
const THAW_SECONDS = 0.5;
/** How long the warning shows before a phase of wind starts blowing. */
const WIND_WARNING_MS = 900;
/**
 * Shortest gap between two gusts inside one phase.
 *
 * A phase is a stretch of weather, not one shove: it gusts repeatedly for as
 * long as it lasts. This is only a floor — a gust also waits for the board to
 * come to rest, so a long settle paces the next one rather than stacking on it.
 */
const WIND_GUST_INTERVAL_MS = 620;

export type SandEngineEvent =
  | { type: "AIM_TOUCHED" }
  | { type: "SHOT_FIRED"; color: SandColor }
  | { type: "SAND_SORTED"; color: SandColor; cells: number }
  | { type: "NO_MATCH"; ammo: SandColor }
  | { type: "MISS"; hitFrame: boolean }
  | { type: "UNLOCKED"; cells: number }
  /** Wind is about to start. Fired once, `WIND_WARNING_MS` before the phase. */
  | { type: "WIND_INCOMING"; direction: WindDirection }
  | { type: "WIND_START"; direction: WindDirection }
  | { type: "WIND_END" }
  /** One gust inside a blowing phase. */
  | { type: "WIND"; direction: WindDirection }
  | { type: "SETTLE_END" };

export type SandEngineCallbacks = {
  onState: (state: SandGameState) => void;
  onEvent?: (event: SandEngineEvent) => void;
  onFirstFrame?: () => void;
};

/** One simulated grain — one pixel of the board's canvas, one cell of the grid. */
type PixelCell = {
  x: number;
  y: number;
  color: SandColor;
  bodyId: string;
  /** Fixed at spawn, like every grain's tint in a real sand pile. */
  rgb: readonly [number, number, number];
  /** 0 -> 1 while fading out after being sorted away. */
  dying: number | null;
  shake: number;
  /** Frozen: drawn as frost, cannot fall, cannot be shot out. */
  locked: boolean;
  /** 1 -> 0 right after a lock opened, so the sand that came free is seen to. */
  thaw: number;
};

type Projectile = {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  velocity: THREE.Vector3;
  previous: THREE.Vector3;
  time: number;
  color: SandColor;
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

  /** World size of one simulated pixel, fitted to the expanded grid. */
  private readonly cell: number;
  /** Pixels, not blueprint cells — already scaled by expandLevelForPixelBoard. */
  private readonly sortRadius: number;
  /** Shows the disc a radius shot would take, under the crosshair and at impact. */
  private aimRing: THREE.Mesh | null = null;
  private aimRingGlow: THREE.Mesh | null = null;
  private sortRing: THREE.Mesh | null = null;
  private sortRingAge = 0;

  /** The live round in the breech, its halo, and the light it throws. */
  private chamberBall: THREE.Mesh | null = null;
  private chamberGlow: THREE.Mesh | null = null;
  private chamberLight: THREE.PointLight | null = null;
  /** The colour band at the muzzle: what this cannon is about to fire. */
  private muzzleBand: THREE.Mesh | null = null;
  /** The collar around the base — the same colour as the muzzle band, so the
   * cannon reads its own next shot from any angle, not just head-on. */
  private baseRing: THREE.Mesh | null = null;
  /** The preview queue, nearest first, waiting on the rail. */
  private feedBalls: THREE.Mesh[] = [];
  /** 1 the moment a round is chambered, decaying to 0 as the queue rolls forward. */
  private feedRoll = 0;
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
  /**
   * How far each key has rolled, in radians, accumulated as it moves.
   *
   * A round key has no feature of its own to show it turning, so the glint
   * drawn in `redrawSand` reads its position off this angle — the key does
   * not actually spin, the mark just walks around its rim at the rate a
   * disc of its own measured radius would if it were truly rolling.
   */
  private keyRotation = new Map<string, number>();
  /** Where the level's wind loop has got to. */
  private windPhase = 0;
  /** Milliseconds left in whatever the current phase is doing. */
  private windRemaining = 0;
  /** True while the current phase is blowing, false while it is cooling down. */
  private windBlowing = false;
  private windSinceGust = 0;
  private windWarned = false;
  /** Padlock placements, and whether the locked cells have changed under them. */
  private lockRegionCache: Array<{ icon: CellCoord[] }> = [];
  private lockRegionsDirty = true;

  private state: SandGameState;
  /** The resolved state waiting for its animation to finish before it is published. */
  private pendingState: SandGameState | null = null;
  private beats: Beat[] = [];
  private beatElapsed = 0;
  private beatStarted = false;
  private settleLandings = 0;

  private projectile: Projectile | null = null;
  private projectileMesh: THREE.Mesh | null = null;
  private impactFlash: THREE.PointLight | null = null;
  private impactFlashAge = 0;

  private yaw = CANNON_NEUTRAL_YAW;
  private elevation = CANNON_NEUTRAL_ELEVATION;
  private recoil = 0;
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
  private aimDragSensitivity = 1;

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

  /** Every material on the cannon rig, and the opacity/transparency each was
   * built with — `updateCannonFade` scales toward this base rather than a
   * fixed 1, so parts authored partially see-through (the chamber housing)
   * stay proportionally more see-through than solid ones while both dim. */
  private readonly cannonMaterials: Array<{ material: THREE.Material; opacity: number; transparent: boolean }> = [];
  /** 1 when the gun is fully visible, down to `CANNON_BUSY_OPACITY` while a
   * phase in `CANNON_FADE_PHASES` has the board busy. Read by `updateAmmoModel`
   * too, so the chamber's own glow and light dim in step rather than fighting
   * this fade frame to frame. */
  private cannonFade = 1;

  /** Pool of round white puffs `spawnMuzzleSmoke` recycles on every shot — see
   * `buildMuzzleSmoke`. In `this.scene` directly rather than under the cannon
   * hierarchy: real smoke does not stay glued to the barrel it left. */
  private readonly muzzleSmokePuffs: MuzzleSmokePuff[] = [];

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
    this.scene.fog = new THREE.FogExp2(0x7fdde1, 0.02);
    this.camera.position.set(0, 3.3, 13.6);
    this.camera.lookAt(0, 1, -0.5);
    this.renderer = acquireRenderer(this, this.host);

    this.buildLighting();
    this.buildFrame();
    this.buildSand();
    this.buildCannon();
    this.buildSortRings();
    this.buildMuzzleSmoke();
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
   * nothing lit — the frame, the cannon's own grey and gold — carries a cast
   * that competes with the sand picture's actual colours. */
  private buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0xf2f2f2, 0x8fa8ab, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-4, 7.5, 6.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xababab, 0.85);
    rim.position.set(5, 2.5, -5);
    this.scene.add(rim);
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(item: T) {
    this.disposables.push(item);
    return item;
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
    const border = this.cell * 0.62;
    const depth = this.cell * 1.75;

    this.frameRoot.position.set(0, FRAME_CENTER_Y, SAND_PLANE_Z);
    this.scene.add(this.frameRoot);

    const backing = this.track(
      new THREE.BoxGeometry(openWidth + border * 0.5, openHeight + border * 0.5, this.cell * BACKING_DEPTH_RATIO),
    );
    // Pastel, not neutral grey: a shade of the same sky-blue behind the frame
    // (--bg in globals.css) so the recess reads as depth in one continuous
    // colour rather than a border competing with the picture it sets off.
    const backingMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0x6fcdd1 }));
    const back = new THREE.Mesh(backing, backingMaterial);
    back.position.z = this.cell * BACKING_Z_RATIO;
    this.frameRoot.add(back);

    // Flat white, no emissive glow — the "sticker" outline the rest of the
    // chrome uses instead of a lit highlight.
    const railMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const innerMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0xc4e8ea }));
    const horizontal = this.track(new RoundedBoxGeometry(openWidth + border * 2, border, depth, 2, border * 0.22));
    const vertical = this.track(new RoundedBoxGeometry(border, openHeight, depth, 2, border * 0.22));

    for (const sign of [1, -1]) {
      const rail = new THREE.Mesh(horizontal, railMaterial);
      rail.position.set(0, sign * (openHeight + border) * 0.5, 0);
      this.frameRoot.add(rail);
      const post = new THREE.Mesh(vertical, railMaterial);
      post.position.set(sign * (openWidth + border) * 0.5, 0, 0);
      this.frameRoot.add(post);
    }

    // A thin lip on the inside edge so the opening reads as a recess holding
    // the sand rather than a picture printed flush on the wall.
    const lipGeometry = this.track(new THREE.BoxGeometry(openWidth, openHeight, this.cell * 0.16));
    const lip = new THREE.Mesh(lipGeometry, innerMaterial);
    lip.position.z = -this.cell * 0.5;
    this.frameRoot.add(lip);
  }

  /**
   * Populate the pixel grid and paint the canvas once.
   *
   * Every pixel gets its jittered tint here, fixed for its whole life — like
   * every other property a grain is born with, its exact shade is part of what
   * it IS, not something recomputed frame to frame.
   */
  private buildSand() {
    const { bodies, locked, keys } = parseSandLevel(this.level);
    const frozen = new Set(locked.map((cell) => cellKey(cell.x, cell.y)));

    for (const body of bodies) {
      for (const cell of body.cells) {
        const seed = cell.x * 733 + cell.y * 197;
        const rgb = jitterColor(SAND_COLOR_HEX[body.color], seed, SAND_SATURATION_JITTER, SAND_LIGHTNESS_JITTER);
        this.cells.set(cellKey(cell.x, cell.y), {
          x: cell.x,
          y: cell.y,
          color: body.color,
          bodyId: body.id,
          rgb,
          dying: null,
          shake: 0,
          locked: frozen.has(cellKey(cell.x, cell.y)),
          thaw: 0,
        });
      }
    }
    for (const key of keys) this.keys.set(key.id, key.cells.map((cell) => ({ ...cell })));
    // The loop opens on the first phase's cooldown, so a level does not start
    // by immediately blowing the picture the player has not looked at yet.
    const first = this.level.wind?.phases[0];
    if (first) {
      this.windBlowing = false;
      this.windRemaining = first.cooldownMs;
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
      }
      // A canvas has no sub-pixel space, so a "shake" is a whole-pixel wobble
      // in where a grain is drawn this frame — its true grid position, which
      // gameplay reasons about, never moves.
      const offset = cell.shake > 0 ? Math.round(Math.sin(cell.shake * 46) * cell.shake * SHAKE_DRAW_OFFSET_PX) : 0;
      // Row 0 of the canvas is the top of the image; grid y counts up from the
      // floor, so the row a pixel lands on is the mirror of its grid y.
      writePixel(cell.x + offset, height - 1 - cell.y, r, g, b, 255);
    }

    for (const cell of this.dying) {
      const alpha = Math.round(255 * Math.max(0, 1 - (cell.dying ?? 0)));
      writePixel(cell.x, height - 1 - cell.y, cell.rgb[0], cell.rgb[1], cell.rgb[2], alpha);
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
    // read as a bite taken out of the disc, not a shadow under it. The flat
    // gold shape, plus a glint cell placed by `keyRotation` so a shape with no
    // notch of its own still reads as turning while it moves, is the whole
    // drawing.
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
      for (const cell of cells) {
        const rgb = cell === glintCell ? KEY_GLINT_RGB : KEY_RGB;
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
    this.scene.add(this.cannonRoot);
    this.turret.position.y = TURRET_REST_Y;
    this.cannonRoot.add(this.turret);
    this.barrelPivot.position.y = 0.12;
    this.turret.add(this.barrelPivot);
    this.barrelPivot.add(this.barrelVisual);
    this.muzzleAnchor.position.z = MUZZLE_Z;
    this.barrelPivot.add(this.muzzleAnchor);

    // Pastel, matching the chrome around it now: a soft powder-blue hull, a
    // muted lavender-navy for the shadowed parts, and the same candy gold the
    // CSS uses for coins and the "go" buttons (--gold).
    const body = this.track(new THREE.MeshLambertMaterial({ color: 0x8fc0f0 }));
    const dark = this.track(new THREE.MeshLambertMaterial({ color: 0x5468a0 }));
    const accent = this.track(new THREE.MeshLambertMaterial({ color: 0xffc233 }));

    const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 40)), dark);
    this.cannonRoot.add(base);
    // Its own material, not `accent` — it starts the same gold, but it has to
    // repaint independently of the muzzle ring once ammo starts cycling.
    this.baseRing = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(0.86, 0.11, 14, 40)),
      this.track(new THREE.MeshLambertMaterial({ color: 0xffc233 })),
    );
    this.baseRing.rotation.x = Math.PI / 2;
    this.baseRing.position.y = 0.27;
    this.cannonRoot.add(this.baseRing);

    // Squashed enough to keep swallowing the barrel's back rim through the
    // whole recoil travel, so nothing pops out of the cradle on a shot.
    const cradle = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.62, 28, 18)), dark);
    cradle.scale.set(1, 0.86, 1);
    this.turret.add(cradle);

    const barrel = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.24, 0.38, 2.35, 28)), body);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.98;
    this.barrelVisual.add(barrel);
    const muzzle = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.26, 0.07, 12, 28)), accent);
    muzzle.position.z = MUZZLE_Z + 0.06;
    this.barrelVisual.add(muzzle);

    // The muzzle says what is about to come out of it. Thin enough to read as a
    // painted line around the lip rather than a second ring of hardware, and
    // unlit so the colour is the colour — the same hex the HUD names.
    this.muzzleBand = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(MUZZLE_BAND_RADIUS, 0.045, 10, 32)),
      this.track(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    );
    this.muzzleBand.position.z = MUZZLE_Z + 0.2;
    this.barrelVisual.add(this.muzzleBand);

    this.buildAmmoFeed(dark);
    this.applyCannonTransform();
    this.collectCannonMaterials();
  }

  /** Walks every mesh under `cannonRoot` once, at build time, and records its
   * material(s) for `updateCannonFade` to dim uniformly. */
  private collectCannonMaterials() {
    const seen = new Set<THREE.Material>();
    this.cannonRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        // The chamber's halo drives its own opacity every frame — its breath
        // and the flare as a round drops in (`updateAmmoModel`) — which reads
        // `cannonFade` directly rather than being captured and scaled here,
        // so the two don't fight over the same property.
        if (material === this.chamberGlow?.material) continue;
        if (seen.has(material)) continue;
        seen.add(material);
        this.cannonMaterials.push({ material, opacity: material.opacity, transparent: material.transparent });
      }
    });
  }

  /**
   * The breech chamber and the rail that feeds it.
   *
   * Both hang off `barrelPivot`, not the turret: they are part of the barrel
   * assembly, so they swing and tilt with it and a round never appears to sit
   * beside the gun it is about to be fired from. They do NOT hang off
   * `barrelVisual`, which is the piece that slides back on recoil — the
   * chamber holding the *next* round should not kick with the shot that just
   * left.
   */
  private buildAmmoFeed(dark: THREE.Material) {
    // A groove for the queue to roll down, sloping up and back from the breech.
    const railLength = FEED_SLOT_SPACING * 3.6;
    const railGeometry = this.track(new THREE.BoxGeometry(0.07, 0.05, railLength));
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeometry, dark);
      rail.position.set(side * (FEED_BALL_RADIUS + 0.05), CHAMBER_POSITION.y - 0.1 + railLength * 0.5 * (FEED_SLOT_RISE / FEED_SLOT_SPACING), CHAMBER_POSITION.z + railLength * 0.5);
      rail.rotation.x = -Math.atan2(FEED_SLOT_RISE, FEED_SLOT_SPACING);
      this.barrelPivot.add(rail);
    }

    // The housing is see-through on purpose: the round inside it is the point,
    // and a solid breech would hide the one thing this part exists to show.
    const housing = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(CHAMBER_BALL_RADIUS * 1.5, CHAMBER_BALL_RADIUS * 1.5, CHAMBER_BALL_RADIUS * 2.4, 24, 1, true)),
      this.track(new THREE.MeshLambertMaterial({
        color: 0xc3d2ff,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      })),
    );
    housing.rotation.x = Math.PI / 2;
    housing.position.copy(CHAMBER_POSITION);
    this.barrelPivot.add(housing);

    const rimGeometry = this.track(new THREE.TorusGeometry(CHAMBER_BALL_RADIUS * 1.52, 0.035, 10, 26));
    for (const offset of [-CHAMBER_BALL_RADIUS * 1.2, CHAMBER_BALL_RADIUS * 1.2]) {
      const rim = new THREE.Mesh(rimGeometry, dark);
      rim.position.set(CHAMBER_POSITION.x, CHAMBER_POSITION.y, CHAMBER_POSITION.z + offset);
      this.barrelPivot.add(rim);
    }

    // A short throat down into the barrel, so the chamber reads as connected to
    // the bore rather than parked on top of it.
    const throat = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(CHAMBER_BALL_RADIUS * 0.8, CHAMBER_BALL_RADIUS * 0.95, 0.3, 16, 1, true)),
      this.track(new THREE.MeshLambertMaterial({ color: 0x5468a0, side: THREE.DoubleSide })),
    );
    throat.position.set(CHAMBER_POSITION.x, CHAMBER_POSITION.y - 0.2, CHAMBER_POSITION.z);
    this.barrelPivot.add(throat);

    this.chamberBall = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(CHAMBER_BALL_RADIUS, 20, 14)),
      this.track(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    );
    this.chamberBall.position.copy(CHAMBER_POSITION);
    this.chamberBall.renderOrder = 4;
    this.barrelPivot.add(this.chamberBall);

    // The glow is a shell around the round, additive so it reads as light
    // coming off it rather than a bigger ball of paint.
    this.chamberGlow = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(CHAMBER_BALL_RADIUS * 1.9, 18, 12)),
      this.track(new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })),
    );
    this.chamberGlow.position.copy(CHAMBER_POSITION);
    this.chamberGlow.renderOrder = 5;
    this.barrelPivot.add(this.chamberGlow);

    // Real light, so the colour spills onto the breech around it.
    this.chamberLight = new THREE.PointLight(0xffffff, 0, 2.6);
    this.chamberLight.position.copy(CHAMBER_POSITION);
    this.barrelPivot.add(this.chamberLight);

    const feedGeometry = this.track(new THREE.SphereGeometry(FEED_BALL_RADIUS, 16, 12));
    const count = Math.max(0, this.level.nextPreviewCount);
    for (let index = 0; index < count; index += 1) {
      const ball = new THREE.Mesh(feedGeometry, this.track(new THREE.MeshLambertMaterial({ color: 0xffffff })));
      ball.visible = false;
      this.barrelPivot.add(ball);
      this.feedBalls.push(ball);
    }

    this.syncAmmoModel(false);
  }

  /** Where the queued round `slot` places along the rail — 0 is the chamber. */
  private feedSlotPosition(slot: number) {
    return new THREE.Vector3(
      CHAMBER_POSITION.x,
      CHAMBER_POSITION.y + FEED_SLOT_RISE * slot,
      CHAMBER_POSITION.z + FEED_SLOT_SPACING * slot,
    );
  }

  /**
   * Point the model at whatever the queue now holds.
   *
   * Called every tick and cheap when nothing changed: the queue is compared as
   * a string, and only a real change restarts the roll. `animate` is false for
   * the first load and after a restart, where there is no previous round for
   * the new one to have rolled in behind.
   */
  private syncAmmoModel(animate: boolean) {
    const current = currentAmmo(this.level, this.state);
    const upcoming = nextAmmo(this.level, this.state);
    const key = `${current ?? "-"}|${upcoming.join(",")}|${this.chamberLoaded}`;
    if (key === this.ammoKey) return;
    // Only a chamber that has just gained a round rolls. Emptying it on the
    // shot is a change too, and that one must not drag the queue forward.
    const rolled = animate && this.ammoKey !== "" && this.chamberLoaded;
    this.ammoKey = key;
    if (rolled) this.feedRoll = 1;

    if (this.chamberBall) {
      this.chamberBall.visible = current !== null && this.chamberLoaded;
      if (current) (this.chamberBall.material as THREE.MeshBasicMaterial).color.setHex(SAND_COLOR_HEX[current]);
    }
    if (this.chamberGlow) {
      this.chamberGlow.visible = current !== null && this.chamberLoaded;
      if (current) (this.chamberGlow.material as THREE.MeshBasicMaterial).color.setHex(SAND_COLOR_HEX[current]);
    }
    if (this.chamberLight && current) this.chamberLight.color.setHex(SAND_COLOR_HEX[current]);
    if (this.muzzleBand) {
      // Grey once the wheel is spent: an empty cannon must not still be
      // advertising a colour it can no longer fire.
      (this.muzzleBand.material as THREE.MeshBasicMaterial).color.setHex(current ? SAND_COLOR_HEX[current] : 0x9fb3bb);
    }
    if (this.baseRing) {
      (this.baseRing.material as THREE.MeshLambertMaterial).color.setHex(current ? SAND_COLOR_HEX[current] : 0x9fb3bb);
    }
    this.feedBalls.forEach((ball, index) => {
      const color = upcoming[index];
      ball.visible = color !== undefined;
      if (color) (ball.material as THREE.MeshLambertMaterial).color.setHex(SAND_COLOR_HEX[color]);
    });
  }

  /**
   * The roll, and the breathing of the chambered round.
   *
   * Every queued round is drawn one slot further back than it belongs while
   * `feedRoll` runs down, so the whole line slides forward together and the new
   * round grows into the chamber as it arrives — one shot spent, one round in.
   */
  private updateAmmoModel() {
    // The next round is only handed over once the board is at rest and the
    // player may fire again — the same moment §21 unlocks input.
    if (!this.projectile && this.state.phase === "READY") this.chamberLoaded = true;
    this.syncAmmoModel(true);
    this.chamberAge += FIXED_STEP;
    if (this.feedRoll > 0) this.feedRoll = Math.max(0, this.feedRoll - FIXED_STEP / FEED_ROLL_SECONDS);
    // Ease-out: a round that has just been released moves fastest, then settles.
    const eased = 1 - (1 - this.feedRoll) * (1 - this.feedRoll);

    this.feedBalls.forEach((ball, index) => {
      if (!ball.visible) return;
      const slot = index + 1 + eased;
      ball.position.copy(this.feedSlotPosition(slot));
      // Rolling, not sliding: the spin is tied to the distance travelled, so it
      // stops the moment the ball settles into its slot.
      ball.rotation.x = -(slot * FEED_SLOT_SPACING) / FEED_BALL_RADIUS;
    });

    const seated = 1 - eased;
    if (this.chamberBall?.visible) {
      this.chamberBall.position.copy(this.feedSlotPosition(eased));
      this.chamberBall.scale.setScalar(0.45 + 0.55 * seated);
      this.chamberBall.rotation.x = -(eased * FEED_SLOT_SPACING) / CHAMBER_BALL_RADIUS;
    }
    // The halo breathes so a loaded cannon never looks frozen, and flares once
    // as the round drops in.
    const breath = 0.5 + 0.5 * Math.sin(this.chamberAge * Math.PI * 2 * CHAMBER_GLOW_HZ);
    const strength = this.chamberBall?.visible ? 0.34 + 0.16 * breath + 0.5 * eased : 0;
    if (this.chamberGlow) {
      this.chamberGlow.position.copy(this.chamberBall?.position ?? CHAMBER_POSITION);
      (this.chamberGlow.material as THREE.MeshBasicMaterial).opacity = strength * this.cannonFade;
      this.chamberGlow.scale.setScalar((0.86 + 0.1 * breath + 0.2 * eased) * (0.45 + 0.55 * seated));
    }
    if (this.chamberLight) this.chamberLight.intensity = strength * 3.4 * this.cannonFade;
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
    const aimMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    // Additive halo behind the rim: a flat-opacity ring reads the same over
    // every sand colour, but a soft glow is what actually pulls the eye to
    // it against a busy multi-colour picture.
    const aimGlowMaterial = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
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

  private spawnSortRing(x: number, y: number) {
    if (!this.sortRing) return;
    this.moveRingToCell(this.sortRing, x, y);
    this.sortRing.visible = true;
    this.sortRing.scale.setScalar(0.72);
    (this.sortRing.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.sortRingAge = 0;
  }

  // ---- input -------------------------------------------------------------

  private bindInput() {
    this.aimZone.addEventListener("pointerdown", this.onAimPointerDown);
    this.aimZone.addEventListener("pointermove", this.onAimPointerMove);
    this.aimZone.addEventListener("pointerup", this.onAimPointerUp);
    this.aimZone.addEventListener("pointercancel", this.onAimPointerCancel);
  }

  /** §21: aim and fire exist in READY and nowhere else. */
  private canInteract() {
    return !this.paused && !this.disposed && this.state.phase === "READY" && !this.state.result;
  }

  private canStartAim() {
    return this.canInteract() && this.projectile === null && performance.now() >= this.nextShotAt;
  }

  private onAimPointerDown = (event: PointerEvent) => {
    if (!this.canStartAim()) return;
    this.aimPointer = event.pointerId;
    this.callbacks.onEvent?.({ type: "AIM_TOUCHED" });
    this.aimStart.set(event.clientX, event.clientY);
    this.aimCurrent.copy(this.aimStart);
    this.aimDistance = 0;
    this.aimArmed = false;
    this.aimStick.set(0, 0);
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

    if (this.aimArmed) {
      if (this.aimDistance <= JOYSTICK_CANCEL_RADIUS) this.aimArmed = false;
    } else if (this.aimDistance >= JOYSTICK_ARM_RADIUS) {
      this.aimArmed = true;
    }

    const clampedScale = this.aimDistance > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / this.aimDistance : 1;
    this.aimZone.style.setProperty("--joystick-dx", `${dx * clampedScale}px`);
    this.aimZone.style.setProperty("--joystick-dy", `${dy * clampedScale}px`);
    this.aimZone.classList.toggle("is-cancelled", !this.aimArmed);

    const baseResponse = THREE.MathUtils.clamp(
      (Math.min(this.aimDistance, JOYSTICK_RADIUS) - JOYSTICK_RESPONSE_DEAD_ZONE)
        / (JOYSTICK_RADIUS - JOYSTICK_RESPONSE_DEAD_ZONE),
      0,
      1,
    );
    const response = (baseResponse * this.aimDragSensitivity)
      / (1 + (this.aimDragSensitivity - 1) * baseResponse);
    if (this.aimDistance > 1e-5 && response > 0) {
      this.aimStick.set(dx / this.aimDistance, dy / this.aimDistance).multiplyScalar(response);
    } else {
      this.aimStick.set(0, 0);
    }
    this.aimPreviewDirty = true;
  }

  private onAimPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.aimPointer) return;
    this.updateAimGesture(event.clientX, event.clientY);
  };

  private onAimPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.aimPointer) return;
    const releaseDistance = Math.hypot(event.clientX - this.aimStart.x, event.clientY - this.aimStart.y);
    const shouldFire = this.canInteract()
      && this.aimArmed
      && this.displayedAimArmed
      && releaseDistance > JOYSTICK_CANCEL_RADIUS
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
    const horizontalRange = Math.max(0, Math.min(width * AIM_CURSOR_HORIZONTAL_RATIO, centerX - AIM_CURSOR_EDGE_MARGIN));
    const upwardRange = Math.max(0, Math.min(height * AIM_CURSOR_UP_RATIO, centerY - AIM_CURSOR_EDGE_MARGIN));
    const downwardRange = Math.max(0, Math.min(height * AIM_CURSOR_DOWN_RATIO, centerY - AIM_CURSOR_EDGE_MARGIN));
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

  private solveAimAtScreenPoint(screenX: number, screenY: number) {
    const { origin, direction } = this.cameraRayForScreenPoint(screenX, screenY);
    const hit = this.planeHit(origin, direction, true);
    const target = hit?.point ?? this.sandPlanePoint(screenX, screenY);
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
    // The grid square is what the ring is drawn on and what the shot will be
    // centred on, so it is reported whether or not sand happens to sit there.
    return { solution, cell: hit?.cell ?? null, grid: hit?.grid ?? this.gridAtPoint(target) };
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
  }

  private updateAimPreview() {
    if (this.aimPointer === null || !this.canInteract()) {
      this.showIdleCrosshair();
      return;
    }
    const cursor = this.cursorForCurrentStick();
    const solved = this.solveAimAtScreenPoint(cursor.x, cursor.y);
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
      this.crosshair.style.setProperty("--aim-color", `#${SAND_COLOR_HEX[solved.cell.color].toString(16).padStart(6, "0")}`);
    } else {
      this.crosshair.style.removeProperty("--aim-color");
    }
    if (this.aimRing) {
      this.aimRing.visible = Boolean(solved?.grid);
      if (solved?.grid) this.moveRingToCell(this.aimRing, solved.grid.x, solved.grid.y);
    }
    if (this.aimRingGlow) {
      this.aimRingGlow.visible = Boolean(solved?.grid);
      if (solved?.grid) this.moveRingToCell(this.aimRingGlow, solved.grid.x, solved.grid.y);
    }
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

    if (!this.projectileMesh) {
      const geometry = this.track(new THREE.SphereGeometry(PROJECTILE_RADIUS, 12, 8));
      const material = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.projectileMesh = new THREE.Mesh(geometry, material);
      this.scene.add(this.projectileMesh);
    }
    const material = this.projectileMesh.material as THREE.MeshBasicMaterial;
    material.color.setHex(SAND_COLOR_HEX[color]);
    this.projectileMesh.visible = true;
    this.projectileMesh.position.copy(launch.start);

    this.projectile = {
      mesh: this.projectileMesh,
      start: launch.start.clone(),
      velocity: launch.velocity.clone(),
      previous: launch.start.clone(),
      time: 0,
      color,
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
    const next = this.positionAt(projectile.start, projectile.velocity, projectile.time);

    const hit = this.planeHit(projectile.previous, next.clone().sub(projectile.previous).normalize(), true);
    // planeHit solves against the infinite plane along a ray; confirm the
    // crossing actually falls inside this tick's travelled segment before
    // trusting it, since a ray can cross the plane far outside the step taken.
    const segmentLength = projectile.previous.distanceTo(next);
    const validHit = hit && hit.t >= 0 && hit.t <= segmentLength + PROJECTILE_RADIUS;

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
      this.handleMiss(this.hitFrameStructure(next));
    }
  }

  /** Did the shot land on the frame itself rather than sail past the whole thing? */
  private hitFrameStructure(point: THREE.Vector3) {
    const halfWidth = (this.level.frame.width * this.cell) / 2 + this.cell * 0.62;
    const halfHeight = (this.level.frame.height * this.cell) / 2 + this.cell * 0.62;
    const dx = Math.abs(point.x - this.frameRoot.position.x);
    const dy = Math.abs(point.y - this.frameRoot.position.y);
    return dx <= halfWidth && dy <= halfHeight;
  }

  private spawnImpactFlash(point: THREE.Vector3, color: SandColor) {
    if (!this.impactFlash) {
      this.impactFlash = new THREE.PointLight(0xffffff, 0, 4.5);
      this.scene.add(this.impactFlash);
    }
    this.impactFlash.color.setHex(SAND_COLOR_HEX[color]);
    this.impactFlash.position.copy(point);
    this.impactFlash.intensity = 12;
    this.impactFlashAge = 0;
  }

  private handleMiss(hitFrame: boolean) {
    this.clearProjectile();
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
    this.clearProjectile();
    if (!ammo) return;
    this.spawnImpactFlash(contact, ammo);
    haptic("impact");

    // Sand under the impact centres the disc on that grain; empty air centres it
    // on the square the shot came down in. Either way the disc has a centre and
    // sorts from it.
    const center = cell ? { x: cell.x, y: cell.y } : grid;
    const resolution = resolveShot(this.level, this.state, {
      bodyId: cell?.bodyId ?? null,
      x: center.x,
      y: center.y,
    });
    this.setPhase("HIT_RESOLUTION");
    this.spawnSortRing(center.x, center.y);

    // The disc landed on sand but found none of its own colour in reach. The
    // shot is still spent and the board is untouched, so the only thing left to
    // say is which reach came up empty — hence the whole disc rattling.
    if (resolution.outcome === "NO_MATCH") {
      haptic("wrongColor");
      this.callbacks.onEvent?.({ type: "NO_MATCH", ammo });
      // The bullet is already gone, so the count has to move now. Only the
      // phase waits for the shake to finish.
      this.pendingState = resolution.state;
      this.callbacks.onState({ ...resolution.state, phase: "HIT_RESOLUTION" });
      this.beats = [
        { kind: "SHAKE_AREA", center, radius: this.sortRadius, ms: NO_MATCH_SHAKE_MS },
      ];
      this.beatElapsed = 0;
      this.beatStarted = false;
      return;
    }

    if (!resolution.removed.length) {
      this.setPhase("READY");
      this.callbacks.onState(this.cloneState());
      return;
    }

    haptic("bodyCleared");
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
    this.beats = [
      { kind: "CLEAR", cells: doomed, ms: CLEAR_DURATION_MS },
      ...steps.map((step): Beat => ({
        kind: "STEP",
        step,
        // A relabel is bookkeeping, not an event: it must not cost the player a
        // frame of waiting.
        ms: step.kind === "REINDEX" ? 0 : perStep,
      })),
      { kind: "HOLD", ms: SETTLE_TAIL_MS },
    ];
    this.beatElapsed = 0;
    this.beatStarted = false;
    this.settleLandings = 0;
    this.pendingState = resolution.state;
    this.callbacks.onState({ ...resolution.state, phase: "SETTLING" });
  }

  // ---- settle playback ---------------------------------------------------

  /**
   * How long each non-REINDEX settle step gets, given how many of them a
   * shot (or gust) produced — see the comment on `SETTLE_TOTAL_MAX_MS`.
   */
  private settleStepMs(timed: number): number {
    if (!timed) return 0;
    const budgeted = THREE.MathUtils.clamp(SETTLE_BUDGET_MS / timed, SETTLE_STEP_MIN_MS, SETTLE_STEP_MAX_MS);
    return Math.min(budgeted, SETTLE_TOTAL_MAX_MS / timed);
  }

  private startBeat(beat: Beat) {
    switch (beat.kind) {
      case "CLEAR":
        for (const cell of beat.cells) {
          cell.dying = 0;
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
      haptic("bodyCleared");
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
      if (this.settleLandings % 2 === 1) hapticSandLanded(Math.floor(this.settleLandings / 2));
    }
  }

  // ---- wind ---------------------------------------------------------------

  /**
   * The clock the rules are not allowed to own.
   *
   * A gust only ever lands in READY, with nothing else playing: interrupting a
   * shot mid-flight would make the board the player aimed at a different board
   * by the time the disc arrived, which is the one thing §21 exists to prevent.
   * The timer keeps running through a shot, so a gust held back by a long
   * settle arrives as soon as the board is the player's again.
   */
  private updateWind(deltaMs: number) {
    const phases = this.level.wind?.phases;
    if (!phases?.length || this.state.result) return;

    const phase = phases[this.windPhase % phases.length];
    this.windRemaining -= deltaMs;
    this.windSinceGust += deltaMs;

    if (!this.windBlowing) {
      // Cooling down. Announce the phase that is about to start, once, so the
      // player can spend the last of the still air on a shot that expects it.
      if (!this.windWarned && this.windRemaining <= WIND_WARNING_MS) {
        this.windWarned = true;
        this.callbacks.onEvent?.({ type: "WIND_INCOMING", direction: phase.direction });
      }
      if (this.windRemaining > 0) return;
      this.windBlowing = true;
      this.windWarned = false;
      this.windRemaining = phase.durationMs;
      this.windSinceGust = WIND_GUST_INTERVAL_MS;
      this.callbacks.onEvent?.({ type: "WIND_START", direction: phase.direction });
    }

    if (this.windRemaining <= 0) {
      // The phase blew itself out. Hand over to the next one's cooldown.
      this.windBlowing = false;
      this.windPhase = (this.windPhase + 1) % phases.length;
      this.windRemaining = phases[this.windPhase].cooldownMs;
      this.windWarned = false;
      this.callbacks.onEvent?.({ type: "WIND_END" });
      return;
    }

    // A gust only lands on a board that is the player's again. §21 exists so
    // that what was aimed at is what the disc arrives at; weather is no more
    // entitled to break that than a second shot would be. The phase clock keeps
    // running through a settle, so a held-back gust arrives the moment it can.
    if (this.windSinceGust < WIND_GUST_INTERVAL_MS) return;
    if (this.projectile || this.beats.length || this.state.phase !== "READY") return;
    this.windSinceGust = 0;

    const resolution = resolveWind(this.level, this.state, phase);
    if (resolution.outcome === "MISS") return;

    haptic("impact");
    this.callbacks.onEvent?.({ type: "WIND", direction: phase.direction });

    const timed = resolution.steps.reduce((total, step) => total + (step.kind === "REINDEX" ? 0 : 1), 0);
    const perStep = this.settleStepMs(timed);
    this.beats = [
      ...resolution.steps.map((step): Beat => ({
        kind: "STEP",
        step,
        ms: step.kind === "REINDEX" ? 0 : perStep,
      })),
      { kind: "HOLD", ms: SETTLE_TAIL_MS },
    ];
    this.beatElapsed = 0;
    this.beatStarted = false;
    this.settleLandings = 0;
    this.pendingState = resolution.state;
    this.setPhase("SETTLING");
    this.callbacks.onState({ ...resolution.state, phase: "SETTLING" });
  }

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
    if (this.beats.length) return;

    // Everything the shot set in motion has now played out. Only here does the
    // resolved phase — READY, WIN or FAIL — reach the player (§13).
    this.beatStarted = false;
    const resolved = this.pendingState;
    this.pendingState = null;
    if (!resolved) return;
    this.state = resolved;
    this.callbacks.onEvent?.({ type: "SETTLE_END" });
    if (resolved.result?.kind === "WIN") haptic("win");
    if (resolved.result?.kind === "FAIL") haptic("lose");
    this.callbacks.onState(this.cloneState());
    if (!resolved.result) this.showIdleCrosshair();
  }

  // ---- loop --------------------------------------------------------------

  private setPhase(phase: SandGameState["phase"]) {
    if (this.state.result) return;
    this.state = { ...this.state, phase };
  }

  private cloneState(): SandGameState {
    return { ...this.state, bodies: this.state.bodies.map((body) => ({ ...body, cells: [...body.cells] })) };
  }

  private step(deltaMs: number) {
    if (this.projectile) this.updateProjectile(this.projectile);
    else this.advanceBeats(deltaMs);

    this.updateWind(deltaMs);
    for (const cell of this.cells.values()) {
      if (cell.thaw > 0) cell.thaw = Math.max(0, cell.thaw - FIXED_STEP / THAW_SECONDS);
    }

    this.recoil = Math.max(0, this.recoil - FIXED_STEP * 4.2);
    this.barrelVisual.position.z = this.recoil * RECOIL_TRAVEL;
    this.updateAmmoModel();
    this.updateMuzzleSmoke(FIXED_STEP);

    if (this.impactFlash && this.impactFlash.intensity > 0) {
      this.impactFlashAge += FIXED_STEP;
      const life = 1 - Math.min(1, this.impactFlashAge / IMPACT_FLASH_SECONDS);
      this.impactFlash.intensity = 12 * life * life;
    }

    if (this.sortRing?.visible) {
      this.sortRingAge += FIXED_STEP;
      const life = Math.min(1, this.sortRingAge / SORT_RING_SECONDS);
      this.sortRing.scale.setScalar(0.72 + life * 0.42);
      (this.sortRing.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - life);
      if (life >= 1) this.sortRing.visible = false;
    }

    for (const cell of this.cells.values()) {
      if (cell.shake > 0) cell.shake = Math.max(0, cell.shake - FIXED_STEP * (1000 / NO_MATCH_SHAKE_MS));
    }

    if (this.dying.length) {
      const finished: PixelCell[] = [];
      for (const cell of this.dying) {
        cell.dying = (cell.dying ?? 0) + FIXED_STEP * (1000 / CLEAR_DURATION_MS);
        if (cell.dying >= 1) finished.push(cell);
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
    this.updateCannonEntrance();
    this.updateCannonFade(delta);
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
      if (steps > 0) this.redrawSand();
    }
    this.renderer.render(this.scene, this.camera);
    if (!this.firstFrameSent) {
      this.firstFrameSent = true;
      this.callbacks.onFirstFrame?.();
    }
  };

  private resize() {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 0.62 ? 44 : 37;
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
      this.cannonRoot.visible = true;
      this.startCannonEntrance();
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
    this.pause();
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
   * Eases every cannon material's opacity toward `CANNON_BUSY_OPACITY` while
   * the board is in a phase the player cannot act during, and back to each
   * material's own built opacity the moment it returns to `READY`. Runs every
   * rendered frame regardless of `paused`, like the entrance and idle-spin
   * updaters, so the fade keeps easing even across a pause boundary.
   */
  private updateCannonFade(deltaMs: number) {
    if (!this.cannonMaterials.length) return;
    const target = CANNON_FADE_PHASES.has(this.state.phase) ? CANNON_BUSY_OPACITY : 1;
    if (this.cannonFade === target) return;
    const rate = 1 - Math.exp(-(deltaMs / 1000) / CANNON_FADE_SECONDS);
    this.cannonFade += (target - this.cannonFade) * rate;
    if (Math.abs(this.cannonFade - target) < 0.002) this.cannonFade = target;

    const fullyVisible = this.cannonFade >= 1;
    for (const entry of this.cannonMaterials) {
      entry.material.opacity = fullyVisible ? entry.opacity : entry.opacity * this.cannonFade;
      entry.material.transparent = fullyVisible ? entry.transparent : true;
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
      if (t >= 1) {
        this.frameRoot.rotation.y = 0;
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
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.aimZone.removeEventListener("pointerdown", this.onAimPointerDown);
    this.aimZone.removeEventListener("pointermove", this.onAimPointerMove);
    this.aimZone.removeEventListener("pointerup", this.onAimPointerUp);
    this.aimZone.removeEventListener("pointercancel", this.onAimPointerCancel);
    this.sandTexture.dispose();
    for (const item of this.disposables) item.dispose();
    this.crosshair.classList.remove("is-visible", "is-engaged", "is-aiming", "is-target-valid");
    releaseRenderer(this);
  }
}
