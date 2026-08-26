import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { haptic, hapticSandLanded } from "./haptics";
import { acquireRenderer, releaseRenderer } from "./renderer-pool";
import {
  cellKey,
  createSandGameState,
  currentAmmo,
  expandLevelForPixelBoard,
  nextAmmo,
  parseSandLevel,
  resolveShot,
  resolveWind,
} from "./sand-rules";
import type {
  CellCoord,
  SandColor,
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

export const SAND_COLOR_HEX: Record<SandColor, number> = {
  red: 0xff3d4d,
  green: 0x24e07f,
  yellow: 0xffd21f,
  blue: 0x2f9dff,
  purple: 0x9d5cff,
  orange: 0xff8a1f,
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
const FIT_WIDTH = 4.45;
const FIT_HEIGHT = 5.2;
const FRAME_CENTER_Y = 1.05;
const SAND_PLANE_Z = -2.3;
/** Where the pixel plane sits inside the recess, as a fraction of one pixel's world size. */
const PLANE_LOCAL_Z_RATIO = 0.5;

/**
 * How far a pixel's colour is nudged from its cell's base colour when it is
 * spawned. Presentation only — it never reaches the grid.
 *
 * Ported from a reference falling-sand renderer (UniSand, MIT): every grain
 * there gets a one-time random nudge to its saturation and value, fixed at
 * spawn rather than animated. That is what turns a field of one flat colour
 * into something that reads as poured grains instead of a painted swatch —
 * real sand looks textured because countless grains catch the light very
 * slightly differently, not because any one grain is shaded. Hue is never
 * touched: a jitter big enough to see would start reading as a different
 * gameplay colour, which a coincidence of tint must never be able to fake.
 *
 * Close to the reference's own ±0.1, at a resolution fine enough that
 * individual pixels disappear into the whole.
 */
const SATURATION_JITTER = 0.1;
const LIGHTNESS_JITTER = 0.09;

/** Nudges a colour's saturation and lightness by up to `range`, hue untouched. */
function jitterColor(hex: number, seed: number, saturationRange: number, lightnessRange: number) {
  const color = new THREE.Color(hex);
  if (saturationRange <= 0 && lightnessRange <= 0) return color;
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const s = THREE.MathUtils.clamp(hsl.s + (seededUnit(seed) - 0.5) * 2 * saturationRange, 0, 1);
  const l = THREE.MathUtils.clamp(hsl.l + (seededUnit(seed + 3) - 0.5) * 2 * lightnessRange, 0, 1);
  return color.setHSL(hsl.h, s, l);
}

// ---- settle pacing -------------------------------------------------------
// §24 wants sand that flows without turning into dead time, and Open Decision
// 17 asks how long is too long. Rather than a cutoff that snaps the board to
// its answer, the whole cascade is fitted into a budget: a two-step settle
// plays slowly and reads, a forty-step collapse plays fast and still shows
// every step in order. Nothing is ever skipped.
const SETTLE_BUDGET_MS = 1350;
const SETTLE_STEP_MIN_MS = 15;
const SETTLE_STEP_MAX_MS = 58;
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
/** Frozen sand is drawn this far toward frost, so a lock reads without a legend. */
const LOCK_FROST_MIX = 0.52;
const LOCK_FROST_RGB: readonly [number, number, number] = [198, 226, 255];
/** Breathing rate of the frost, in cycles per second. Slow — it is ice, not an alarm. */
const LOCK_SHIMMER_HZ = 0.55;
/** The key's own colour. Gold, and nothing in the sand palette is gold. */
const KEY_RGB: readonly [number, number, number] = [255, 214, 84];
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

export type ControlSensitivity = { aim: number };

function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
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
  private sortRing: THREE.Mesh | null = null;
  private sortRingAge = 0;

  /** The live round in the breech, its halo, and the light it throws. */
  private chamberBall: THREE.Mesh | null = null;
  private chamberGlow: THREE.Mesh | null = null;
  private chamberLight: THREE.PointLight | null = null;
  /** The colour band at the muzzle: what this cannon is about to fire. */
  private muzzleBand: THREE.Mesh | null = null;
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

  /** Live pixels by "x,y". Rebuilt on every settle step so lookups stay exact. */
  private cells = new Map<string, PixelCell>();
  private dying: PixelCell[] = [];
  /** The keys on the board, by id, as the cells they currently cover. */
  private keys = new Map<string, CellCoord[]>();
  /** Where the level's wind loop has got to. */
  private windPhase = 0;
  /** Milliseconds left in whatever the current phase is doing. */
  private windRemaining = 0;
  /** True while the current phase is blowing, false while it is cooling down. */
  private windBlowing = false;
  private windSinceGust = 0;
  private windWarned = false;
  private lockAge = 0;

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
    this.sandMesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1, 1)), sandMaterial);

    this.crosshair.classList.remove("is-visible", "is-engaged", "is-aiming", "is-target-valid", "is-cooling-down");
    this.scene.fog = new THREE.FogExp2(0x2a1c46, 0.02);
    this.camera.position.set(0, 4.7, 13.4);
    this.camera.lookAt(0, 0.45, 0.8);
    this.renderer = acquireRenderer(this, this.host);

    this.buildLighting();
    this.buildFrame();
    this.buildSand();
    this.buildCannon();
    this.buildSortRings();
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

  private buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0xfff0d8, 0x3a2a66, 1.5));
    const key = new THREE.DirectionalLight(0xfff3dd, 2.1);
    key.position.set(-4, 7.5, 6.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x89b7ff, 0.85);
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
      new THREE.BoxGeometry(openWidth + border * 0.5, openHeight + border * 0.5, this.cell * 0.3),
    );
    const backingMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0x241a3d }));
    const back = new THREE.Mesh(backing, backingMaterial);
    back.position.z = -this.cell * 0.72;
    this.frameRoot.add(back);

    const railMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0xc99a5b, emissive: 0x3a2410, emissiveIntensity: 0.35 }));
    const innerMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0x8a6438 }));
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
        const jittered = jitterColor(SAND_COLOR_HEX[body.color], seed, SATURATION_JITTER, LIGHTNESS_JITTER);
        const rgb: readonly [number, number, number] = [
          Math.round(jittered.r * 255),
          Math.round(jittered.g * 255),
          Math.round(jittered.b * 255),
        ];
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

    // Frost breathes as one sheet rather than per grain, so a locked region
    // reads as a single frozen thing instead of a field of twinkling pixels.
    const shimmer = 0.5 + 0.5 * Math.sin(this.lockAge * Math.PI * 2 * LOCK_SHIMMER_HZ);
    const frostMix = LOCK_FROST_MIX + shimmer * 0.1;

    for (const cell of this.cells.values()) {
      let [r, g, b] = cell.rgb;
      if (cell.locked) {
        r = Math.round(r + (LOCK_FROST_RGB[0] - r) * frostMix);
        g = Math.round(g + (LOCK_FROST_RGB[1] - g) * frostMix);
        b = Math.round(b + (LOCK_FROST_RGB[2] - b) * frostMix);
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

    // Keys last, so a key resting in a hollow is never buried by the sand it is
    // sitting against. It is the one thing on the board the player is tracking.
    for (const cells of this.keys.values()) {
      for (const cell of cells) {
        writePixel(cell.x, height - 1 - cell.y, KEY_RGB[0], KEY_RGB[1], KEY_RGB[2], 255);
      }
    }

    this.sandContext.putImageData(this.sandImage, 0, 0);
    this.sandTexture.needsUpdate = true;
  }

  private buildCannon() {
    this.cannonRoot.position.copy(CANNON_ROOT_POSITION);
    this.scene.add(this.cannonRoot);
    this.turret.position.y = 0.46;
    this.cannonRoot.add(this.turret);
    this.barrelPivot.position.y = 0.12;
    this.turret.add(this.barrelPivot);
    this.barrelPivot.add(this.barrelVisual);
    this.muzzleAnchor.position.z = MUZZLE_Z;
    this.barrelPivot.add(this.muzzleAnchor);

    const body = this.track(new THREE.MeshLambertMaterial({ color: 0xa2b6ec }));
    const dark = this.track(new THREE.MeshLambertMaterial({ color: 0x3d4680 }));
    const accent = this.track(new THREE.MeshLambertMaterial({ color: 0xffd54a }));

    const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 40)), dark);
    this.cannonRoot.add(base);
    const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.86, 0.11, 14, 40)), accent);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.27;
    this.cannonRoot.add(ring);

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
      this.track(new THREE.MeshLambertMaterial({ color: 0x3d4680, side: THREE.DoubleSide })),
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
      (this.muzzleBand.material as THREE.MeshBasicMaterial).color.setHex(current ? SAND_COLOR_HEX[current] : 0x6a6f8f);
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
      (this.chamberGlow.material as THREE.MeshBasicMaterial).opacity = strength;
      this.chamberGlow.scale.setScalar((0.86 + 0.1 * breath + 0.2 * eased) * (0.45 + 0.55 * seated));
    }
    if (this.chamberLight) this.chamberLight.intensity = strength * 3.4;
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
    const geometry = this.track(new THREE.RingGeometry(outer - this.cell * 0.14, outer, 56));
    const aimMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
    );
    const hitMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
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
    const perStep = timed
      ? THREE.MathUtils.clamp(SETTLE_BUDGET_MS / timed, SETTLE_STEP_MIN_MS, SETTLE_STEP_MAX_MS)
      : 0;
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
      this.keys.delete(step.keyId);
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
    const perStep = timed
      ? THREE.MathUtils.clamp(SETTLE_BUDGET_MS / timed, SETTLE_STEP_MIN_MS, SETTLE_STEP_MAX_MS)
      : 0;
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

    this.lockAge += FIXED_STEP;
    this.updateWind(deltaMs);
    for (const cell of this.cells.values()) {
      if (cell.thaw > 0) cell.thaw = Math.max(0, cell.thaw - FIXED_STEP / THAW_SECONDS);
    }

    this.recoil = Math.max(0, this.recoil - FIXED_STEP * 4.2);
    this.barrelVisual.position.z = this.recoil * RECOIL_TRAVEL;
    this.updateAmmoModel();

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
    this.camera.fov = this.camera.aspect < 0.62 ? 40 : 37;
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
    if (!idle) {
      this.resume();
      return;
    }
    this.pause();
    this.crosshair.classList.remove("is-visible", "is-engaged", "is-aiming", "is-target-valid");
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
