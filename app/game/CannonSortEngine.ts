import * as THREE from "three";
import {
  disposeCosmeticParts,
  getCosmetic,
  getCosmeticThumbnails,
  getSelectedCosmetic,
  type CosmeticDef,
  type CosmeticId,
} from "./cosmetics";
import { haptic } from "./haptics";
import {
  createRainbowSpawnSchedule,
  isWeakPointFaceHit,
  rainbowWanderAt,
  resolveBlockImpact,
  WEAK_POINT_VISUAL_RADIUS_RATIO,
} from "./rainbow-hook";
import { acquireRenderer, releaseRenderer } from "./renderer-pool";
import { applyBatchAutoFill, createGameState, nextBatchAutoFill, parkedBlockCount, planClusterSplit, resolveCluster } from "./rules";
import type {
  BatchTransfer,
  BlockColor,
  BlockRuntime,
  ClusterResult,
  GamePhase,
  GameState,
  LevelConfig,
  WeakPointFace,
  WeakPointSpec,
} from "./types";

const BLOCK_SIZE = 0.92;
const BLOCK_SPACING = 1.02;
const BLOCK_HALF = BLOCK_SIZE / 2;
const PROJECTILE_RADIUS = 0.15;
const FIXED_STEP = 1 / 60;
const FIXED_LAUNCH_SPEED = 13.2;
const SHOT_COOLDOWN_MS = 400;
const JOYSTICK_RADIUS = 64;
const JOYSTICK_RESPONSE_DEAD_ZONE = 14;
const JOYSTICK_ARM_RADIUS = 18;
const JOYSTICK_CANCEL_RADIUS = 14;
const MODEL_YAW_PER_PIXEL = 0.012;
const MODEL_PITCH_PER_PIXEL = 0.0105;
const MIN_CONTROL_SENSITIVITY = 0.5;
const MAX_CONTROL_SENSITIVITY = 2;
const CANNON_NEUTRAL_YAW = 0;
const CANNON_NEUTRAL_ELEVATION = 0.24;
const CANNON_MAX_YAW = 0.54;
const CANNON_MIN_ELEVATION = -0.08;
const CANNON_MAX_ELEVATION = 1.08;
const MODEL_DEPTH_OFFSET = -3.6;
// Targets fly on a real world-space plane between the cannon (z=5.25) and the
// block model (z=-3.6), so they can physically stop a projectile before it
// reaches the model behind them.
// TEMP prototype depth: targets live between the cannon and block model so
// normal 3D occlusion/first-contact rules decide what a shot reaches first.
const RAINBOW_TARGET_PLANE_Z = 0.45;
// Seven rings, outermost first. The spectrum is what tells the player this is
// the Rainbow Target and not one of the block Weak Point decals.
const RAINBOW_RING_COLORS = [
  0xff3b45, 0xff8a1f, 0xffdf57, 0x24e07f, 0x2f9dff, 0x4b45d8, 0xb45cff,
] as const;
const RAINBOW_TARGET_RADIUS = 0.46;
const RAINBOW_TARGET_COLLIDER_RADIUS = 0.5;
const WEAK_POINT_SURFACE_GAP = 0.012;
const RICOCHET_LIFETIME = 0.34;
// The guard that flashes over a block a shot could not break. Slightly larger
// than the cube so it reads as a layer wrapped around it rather than a recolour.
const SHIELD_SCALE = 1.16;
const SHIELD_LIFETIME = 0.44;
const SHIELD_PEAK_OPACITY = 0.62;
const AIM_PREDICTION_DURATION = 2.2;
const AIM_MOVING_TARGET_REFRESH_INTERVAL = 1 / 12;
const AIM_CURSOR_EDGE_MARGIN = 22;
const AIM_CURSOR_HORIZONTAL_RATIO = 0.39;
const AIM_CURSOR_UP_RATIO = 0.4;
const AIM_CURSOR_DOWN_RATIO = 0.15;
// Slow enough to read every face of the cluster while the menu is open.
const MENU_SPIN_SPEED = 0.5;
// The menu holds the cluster back so entering a level has somewhere to zoom to.
const MENU_MODEL_SCALE = 0.62;
// Long enough to read as a camera move rather than a cut. Play unlocks when it
// ends: the collision sweep tests the cluster where it is *now*, so a shot
// fired mid-zoom would be judged against a model that is still moving.
const INTRO_DURATION = 1;
// The cannon starts below the frame and rises into place over the tail of the
// intro instead of popping in.
const CANNON_INTRO_DROP = 3.4;
const CANNON_INTRO_START = 0.3;
// How far a shot pushes the barrel back into its housing. The rigs are built
// around this number — see the recoil clearance rule in cosmetics.ts — so
// changing it here means re-checking that nothing on a barrel crosses the
// housing surface on the way.
const RECOIL_TRAVEL = 0.23;
const SORT_FLIGHT_MS = 460;
// A batch emptying into a goal is its own beat. The whole thing has to stay
// under a second so it reads as an explanation, not a wait.
const BATCH_FLIGHT_MS = 420;
const BATCH_STAGGER_MS = 70;
const BATCH_FLIGHT_BUDGET_MS = 760;
const BATCH_FLIGHT_TAIL_MS = 60;
const SORT_STAGGER_MS = 85;
const GRAVITY = new THREE.Vector3(0, -9.5, 0);
const CONFIRMED_NEIGHBORS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
] as const;
const PHYSICAL_FACE_NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  ...CONFIRMED_NEIGHBORS, [0, 0, 1], [0, 0, -1],
];

// Every shot fires the same sphere, so its geometry, material and meshes are
// pooled once for the page instead of being allocated and disposed per shot.
const PROJECTILE_POOL_LIMIT = 8;
const projectileGeometry = new THREE.SphereGeometry(PROJECTILE_RADIUS, 12, 8);
// One per skin, shared for the page like the geometry and the pool: a shot is
// the same ball whichever level is loaded, only its colour changes.
const projectileMaterials = {
  gunpowder: new THREE.MeshBasicMaterial({ color: 0xfff3a6 }),
  magic: new THREE.MeshBasicMaterial({ color: 0xffb4f4 }),
} as const;
const projectileMeshPool: THREE.Mesh[] = [];

function takeProjectileMesh() {
  return projectileMeshPool.pop() ?? new THREE.Mesh(projectileGeometry, projectileMaterials.gunpowder);
}

function recycleProjectileMesh(mesh: THREE.Mesh) {
  if (projectileMeshPool.length < PROJECTILE_POOL_LIMIT) projectileMeshPool.push(mesh);
}

// A claim does not only nudge the blocks it was touching. The push leaves the
// hole ring by ring, each ring a little later and a little weaker, so what the
// player sees is one wave travelling out of the break instead of a single
// shell of blocks twitching.
const WAVE_RING_DELAY = 0.05;
const WAVE_FALLOFF = 0.6;
const WAVE_MIN_AMPLITUDE = 0.14;
const WAVE_PUSH = 0.13;
const WAVE_DURATION = 0.36;

// Impact smoke. Round puffs, unlit, pure white, and they leave by collapsing
// rather than by turning transparent — a fading puff greys out against the
// backdrop, which is exactly what "solid white" has to avoid.
const SMOKE_LIFETIME = 0.46;
const SMOKE_DRAG = 0.93;

// A shot that hit nothing is not deleted mid-air. On the way down it shrinks
// with how close it is to the floor and leaves a thin trail of puffs, so the
// miss reads as the ball dropping away rather than as the ball being taken off
// the screen. The trail is spaced by time, not by frame, so it looks the same
// whatever speed the ball is doing.
const PROJECTILE_FALL_FADE_SPAN = 1.4;
const PROJECTILE_FALL_MIN_SCALE = 0.22;
const FALL_TRAIL_INTERVAL = 0.085;
const FALL_TRAIL_LIFETIME = 0.22;

// The magic skin's answer to smoke: unlit shards that spin, drift and shrink
// away. A ray along the whole flight, a bling burst where a shot lands, and a
// small firework for a shot that ends on the floor instead of on a block.
const SPARKLE_DRAG = 0.94;
const SPARKLE_TRAIL_INTERVAL = 0.03;
const SPARKLE_COLORS = [0xffffff, 0xffd54a, 0xff8ad8, 0x9fe8ff];

// The picker's preview: the rig sits where the block cluster normally is, turns
// slowly, and fires on a loop. The demo shot never touches game state, so the
// numbers here are presentation only.
// Placed by projecting the rig's corners to screen space: with the barrel
// pitched up this fills 26-55% of the frame height and under half its width, so
// it sits inside the picker's preview band and clear of the card tray below.
const SHOWCASE_POSITION = new THREE.Vector3(0, 0.78, 2.1);
const SHOWCASE_SCALE = 1;
const SHOWCASE_ELEVATION = 0.42;
const SHOWCASE_SWAY = 0.3;
const SHOWCASE_SWAY_SPEED = 0.8;
const SHOWCASE_FIRE_INTERVAL = 1.4;
const SHOWCASE_SHOT_FLIGHT = 0.62;
const SHOWCASE_SHOT_SPEED = 8.5;
// Where a shot that got under the cluster is treated as hitting the floor.
// Just below the cannon's own base, so the puff still lands inside the frame,
// and far enough under the lowest block that no hit can be stolen from a face.
const GROUND_Y = -1.92;

// A level handing straight over to the next one gets its own short entrance
// instead of going back through the menu: the fresh cluster starts pulled back
// and half turned, then swings onto the authored transform.
const HANDOFF_INTRO_DURATION = 0.7;
const HANDOFF_MODEL_SCALE = 0.7;
const HANDOFF_SPIN_TURN = Math.PI;

const COLOR_HEX: Record<BlockColor, number> = {
  red: 0xff3d4d,
  green: 0x24e07f,
  yellow: 0xffd21f,
  blue: 0x2f9dff,
  purple: 0x9d5cff,
  orange: 0xff8a1f,
};

// A Rainbow Target hit arms exactly one weak-point bypass, so the only hook
// state the HUD needs is whether that shot is still owed. There is no phase and
// no clock to report: the round is untimed and targets come and go on their own.
export type HookSnapshot = {
  weakPointBypassArmed: boolean;
};

// Takes no level any more: nothing about the armed flag depends on one. The
// signature is kept so callers do not have to change.
export function createInitialHookSnapshot(): HookSnapshot {
  return { weakPointBypassArmed: false };
}

export type SortTransfer =
  | { kind: "goal"; slot: number; goalId: string; fromCount: number; count: number }
  | { kind: "reserve"; count: number };

export type SortAnimationEvent = {
  key: number;
  color: BlockColor;
  sources: Array<{ x: number; y: number }>;
  transfers: SortTransfer[];
  flightMs: number;
  staggerMs: number;
};

// One batch emptying into one goal, ready to be drawn: the UI turns batchId and
// goalSlot into the two elements the cubes fly between.
export type BatchFlightEvent = {
  key: number;
  color: BlockColor;
  batchId: string;
  goalId: string;
  goalSlot: number;
  count: number;
  goalFromCount: number;
  flightMs: number;
  staggerMs: number;
};

export type ControlSensitivity = {
  modelRotate: number;
  aimDrag: number;
};

type EngineCallbacks = {
  onState: (state: GameState) => void;
  onSort: (event: SortAnimationEvent) => void;
  onBatchFlight: (event: BatchFlightEvent) => void;
  onHookState: (state: HookSnapshot) => void;
};

type Projectile = {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
  time: number;
  shotIndex: number;
  // How many trail puffs this shot has dropped, so the trail is spaced by
  // flight time instead of once per frame.
  trailTicks: number;
};

type Ricochet = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
};

// One block's protective flash. Parented to the block, so it rides the shake
// the same impact starts instead of hanging in the air where the block was.
type Shield = {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  block: BlockRuntime;
  age: number;
};

type WeakPointVisual = {
  spec: WeakPointSpec;
  block: BlockRuntime;
  group: THREE.Group;
};

type RainbowTargetRuntime = {
  id: string;
  spawnIndex: number;
  /** Seeds rainbowWanderAt, so this target always flies the same shape. */
  seed: number;
  spawnTime: number;
  duration: number;
  hit: boolean;
  active: boolean;
  group: THREE.Group;
};

type RainbowTargetStepMotion = {
  target: RainbowTargetRuntime;
  fromFraction: number;
  toFraction: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
};

type BallisticSolution = {
  start: THREE.Vector3;
  velocity: THREE.Vector3;
};

type PendingResolution = {
  result: ClusterResult;
  countdown: number;
  impactSequence: number;
  animationStarted: boolean;
  sourceBlocks: BlockRuntime[];
};

type ReleasedBlock = {
  block: BlockRuntime;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  age: number;
};

// One block riding the shock wave out of a break. `delay` is how long the wave
// takes to reach its ring and `amplitude` how much of the push is left by the
// time it arrives.
type NeighborKick = {
  block: BlockRuntime;
  age: number;
  delay: number;
  amplitude: number;
  duration: number;
  basePosition: THREE.Vector3;
  direction: THREE.Vector3;
};

type SweepHit = { block: BlockRuntime; t: number; point: THREE.Vector3 };
type RainbowSweepHit = { target: RainbowTargetRuntime; t: number; point: THREE.Vector3 };

// One shard of magic light. Unlit, so it reads as light rather than as painted
// plastic, and it leaves by shrinking like the smoke does.
type Sparkle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  gravity: number;
  size: number;
  age: number;
  life: number;
};

// A demo shot in the picker's preview. Deliberately not a Projectile: it has no
// shot index, no collision and no cooldown, because it must not be able to
// touch a level that is only paused behind the menu.
type ShowcaseShot = {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  velocity: THREE.Vector3;
  time: number;
  trailTicks: number;
};

// One round puff of impact smoke. It grows from `fromScale` to `toScale` and
// then collapses; the material is never touched, which is what keeps every
// puff the same flat white for its whole life. No spin: a ball scaled evenly
// looks identical however it is turned, so turning it would cost frames and
// show nothing.
type SmokePuff = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  fromScale: number;
  toScale: number;
  age: number;
  // Per puff, because a trail puff has to be gone well before an impact puff
  // would be, or a falling shot drags a solid white rope behind it.
  life: number;
};

// Drawn at runtime instead of loaded: the whole game ships as one HTML file with
// no external assets. A horizontal spectrum strip, scrolled by the material's
// map offset so the coat reads as moving light rather than as paint.
function makeRainbowTexture() {
  const width = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 4;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, width, 0);
  const stops = ["#ff3b45", "#ff8a1f", "#ffdf57", "#24e07f", "#2f9dff", "#4b45d8", "#b45cff", "#ff3b45"];
  stops.forEach((color, index) => gradient.addColorStop(index / (stops.length - 1), color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function gridKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

// The distance from a point moving along a segment to an AABB is convex.
// Find its minimum, then binary-search the first point where the sphere touches.
function sweptSphereAabbEntry(a: THREE.Vector3, b: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3, radius: number) {
  const radiusSq = radius * radius;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const distanceAt = (t: number) => {
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const z = a.z + dz * t;
    const boxDx = x < min.x ? min.x - x : x > max.x ? x - max.x : 0;
    const boxDy = y < min.y ? min.y - y : y > max.y ? y - max.y : 0;
    const boxDz = z < min.z ? min.z - z : z > max.z ? z - max.z : 0;
    return boxDx * boxDx + boxDy * boxDy + boxDz * boxDz;
  };
  if (distanceAt(0) <= radiusSq) return 0;

  let searchMin = 0;
  let searchMax = 1;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const third = (searchMax - searchMin) / 3;
    const left = searchMin + third;
    const right = searchMax - third;
    if (distanceAt(left) <= distanceAt(right)) searchMax = right;
    else searchMin = left;
  }
  const closestT = (searchMin + searchMax) * 0.5;
  if (distanceAt(closestT) > radiusSq + 1e-10) return null;

  let outside = 0;
  let inside = closestT;
  for (let iteration = 0; iteration < 26; iteration += 1) {
    const middle = (outside + inside) * 0.5;
    if (distanceAt(middle) <= radiusSq) inside = middle;
    else outside = middle;
  }
  return inside;
}

// Standard slab test. Used to find which block the crosshair's screen point is
// actually looking at, so the ballistic solve can aim at that block's surface
// instead of a flat depth plane that ignores where blocks sit after rotation.
function rayAabbEntry(origin: THREE.Vector3, direction: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3) {
  let tmin = 0;
  let tmax = Infinity;
  for (const axis of ["x", "y", "z"] as const) {
    const originOnAxis = origin[axis];
    const directionOnAxis = direction[axis];
    if (Math.abs(directionOnAxis) < 1e-9) {
      if (originOnAxis < min[axis] || originOnAxis > max[axis]) return null;
      continue;
    }
    const inverse = 1 / directionOnAxis;
    let near = (min[axis] - originOnAxis) * inverse;
    let far = (max[axis] - originOnAxis) * inverse;
    if (near > far) [near, far] = [far, near];
    tmin = Math.max(tmin, near);
    tmax = Math.min(tmax, far);
    if (tmin > tmax) return null;
  }
  return tmin;
}

function raySphereEntry(origin: THREE.Vector3, direction: THREE.Vector3, center: THREE.Vector3, radius: number) {
  const offset = origin.clone().sub(center);
  const b = offset.dot(direction);
  const c = offset.lengthSq() - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = -b - root;
  if (near >= 0) return near;
  const far = -b + root;
  return far >= 0 ? far : null;
}

// Continuous segment-vs-sphere collision for a moving projectile. The target
// radius is expanded by the projectile radius, which is the sphere equivalent
// of the block sweep's Minkowski sum and prevents tunnelling at low frame rates.
function sweptSphereSphereEntry(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  combinedRadius: number,
) {
  const travel = b.clone().sub(a);
  const offset = a.clone().sub(center);
  const aa = travel.lengthSq();
  const cc = offset.lengthSq() - combinedRadius * combinedRadius;
  if (cc <= 0) return 0;
  if (aa < 1e-12) return null;
  const bb = 2 * offset.dot(travel);
  const discriminant = bb * bb - 4 * aa * cc;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = (-bb - root) / (2 * aa);
  if (near >= 0 && near <= 1) return near;
  const far = (-bb + root) / (2 * aa);
  return far >= 0 && far <= 1 ? far : null;
}

export class CannonSortEngine {
  private readonly host: HTMLDivElement;
  private readonly modelZone: HTMLDivElement;
  private readonly aimZone: HTMLDivElement;
  private readonly crosshair: HTMLSpanElement;
  private readonly level: LevelConfig;
  private readonly callbacks: EngineCallbacks;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(37, 1, 0.1, 70);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly modelRoot = new THREE.Group();
  private readonly cannonRoot = new THREE.Group();
  private readonly turret = new THREE.Group();
  private readonly barrelPivot = new THREE.Group();
  private readonly barrelVisual = new THREE.Group();
  private readonly muzzleAnchor = new THREE.Object3D();
  private readonly blocks: BlockRuntime[] = [];
  private readonly blockMap = new Map<string, BlockRuntime>();
  private readonly weakPointVisuals: WeakPointVisual[] = [];
  private readonly weakPointsByBlock = new Map<string, WeakPointSpec[]>();
  private readonly rainbowTargets: RainbowTargetRuntime[] = [];
  private readonly defaultModelOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, -0.36, 0));
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly cameraRight = new THREE.Vector3();
  private readonly modelYawDelta = new THREE.Quaternion();
  private readonly modelPitchDelta = new THREE.Quaternion();
  private readonly resizeObserver: ResizeObserver;
  private state: GameState;
  private projectiles: Projectile[] = [];
  private ricochets: Ricochet[] = [];
  private shields: Shield[] = [];
  private shieldGeometry: THREE.BoxGeometry | null = null;
  private releasedBlocks: ReleasedBlock[] = [];
  private neighborKicks: NeighborKick[] = [];
  private pendingResolutions: PendingResolution[] = [];
  private frameId = 0;
  private accumulator = 0;
  private lastFrame = performance.now();
  private disposed = false;
  private paused = false;
  private phaseBeforePause: GamePhase = "PLAYING";
  private modelPointer: number | null = null;
  private aimPointer: number | null = null;
  private lastModelPointer = new THREE.Vector2();
  private aimStart = new THREE.Vector2();
  private aimCurrent = new THREE.Vector2();
  private aimStick = new THREE.Vector2();
  private aimCursor = new THREE.Vector2();
  private aimDistance = 0;
  private aimArmed = false;
  private displayedAimArmed = false;
  private aimTargetValid = false;
  private displayedLaunch: BallisticSolution | null = null;
  private modelRotateSensitivity = 1;
  private aimDragSensitivity = 1;
  private yaw = CANNON_NEUTRAL_YAW;
  private elevation = CANNON_NEUTRAL_ELEVATION;
  private nextShotAt = 0;
  private aimPreviewDirty = false;
  private recoil = 0;
  private batchKey = 0;
  private batchFlight: { transfer: BatchTransfer; countdown: number } | null = null;
  private impactSequence = 0;
  private autoClearCountdown = 0;
  private autoClearFinishCountdown = 0;
  // Counts up and is never shown. It exists only so the seeded spawn schedule
  // has something to fire against; nothing ends a round on time any more.
  private roundElapsed = 0;
  private roundClockActive = false;
  private weakPointBypassArmed = false;
  private rainbowTargetStepMotions: RainbowTargetStepMotion[] | null = null;
  private hookSnapshotSignature = "";
  private rainbowVisualTime = 0;
  private cannonFilter: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private aimMovingTargetRefreshCountdown = 0;
  private idle = false;
  private readonly idleSpinDelta = new THREE.Quaternion();
  private introTime = 0;
  private introActive = false;
  private introDuration = INTRO_DURATION;
  // Non-zero only for the level-to-level handoff, which turns the cluster
  // instead of slerping it back from wherever the menu spin left it.
  private introSpinTurn = 0;
  // Coming out of the menu the cannon has to arrive; going from one level to
  // the next it was never gone, so it holds still instead of re-entering.
  private introRaisesCannon = true;
  // Set when an intro starts, cleared on its first frame. See animate().
  private introClockPending = false;
  private readonly introSpinDelta = new THREE.Quaternion();
  private readonly introFromQuaternion = new THREE.Quaternion();
  private introFromScale = 1;
  private cannonRestY = 0;
  // Shared geometry/material resources are released together in dispose().
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private smoke: SmokePuff[] = [];
  private smokeGeometry: THREE.SphereGeometry | null = null;
  private smokeMaterial: THREE.MeshBasicMaterial | null = null;
  private sparkles: Sparkle[] = [];
  private sparkleGeometry: THREE.OctahedronGeometry | null = null;
  private sparkleMaterials: THREE.MeshBasicMaterial[] = [];
  private cosmetic: CosmeticDef = getCosmetic(getSelectedCosmetic());
  private cosmeticParts: THREE.Object3D[] = [];
  private showcase = false;
  private showcaseTime = 0;
  private showcaseCountdown = 0;
  private showcaseShots: ShowcaseShot[] = [];
  private readonly cannonRestPosition = new THREE.Vector3();
  constructor(
    host: HTMLDivElement,
    modelZone: HTMLDivElement,
    aimZone: HTMLDivElement,
    crosshair: HTMLSpanElement,
    level: LevelConfig,
    callbacks: EngineCallbacks,
  ) {
    this.host = host;
    this.modelZone = modelZone;
    this.aimZone = aimZone;
    this.crosshair = crosshair;
    this.level = level;
    this.callbacks = callbacks;
    this.state = createGameState(level);
    this.crosshair.classList.remove(
      "is-visible",
      "is-engaged",
      "is-aiming",
      "is-target-valid",
      "is-cooling-down",
      "is-blocked",
    );

    this.scene.fog = new THREE.FogExp2(0x21489c, 0.018);
    this.camera.position.set(0, 4.7, 13.4);
    this.camera.lookAt(0, 0.45, 0.8);
    this.renderer = acquireRenderer(this, this.host);

    this.buildLighting();
    this.buildWorld();
    this.buildBlocks();
    this.buildWeakPoints();
    this.buildRainbowTargets();
    this.buildCannon();
    this.bindInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.updateAimPreview();
    this.callbacks.onState(this.cloneState());
    this.emitHookState(true);
    this.animate();
  }

  private buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x4b3bb0, 1.75));
    const key = new THREE.DirectionalLight(0xffffff, 2.25);
    key.position.set(-4, 8, 7);
    this.scene.add(key);
  }

  private buildWorld() {
    // The stage floor is intentionally empty: model and cannon float over the
    // CSS backdrop so nothing dark sits under the block cluster.
  }

  private buildBlocks() {
    // Keep a readable stretch of world space between the cannon and model.
    this.modelRoot.position.set(0, 1.18, MODEL_DEPTH_OFFSET);
    this.modelRoot.quaternion.copy(this.defaultModelOrientation);
    this.scene.add(this.modelRoot);
    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    this.disposables.push(geometry);
    // Centre whatever shape the sheet authored, instead of assuming the 4x3x2
    // prism the first level happens to use.
    const centre = {
      x: this.axisCentre(this.level.blocks.map((spec) => spec.x)),
      y: this.axisCentre(this.level.blocks.map((spec) => spec.y)),
      z: this.axisCentre(this.level.blocks.map((spec) => spec.z)),
    };

    for (const spec of this.level.blocks) {
      const material = new THREE.MeshLambertMaterial({
        color: COLOR_HEX[spec.color],
        emissive: 0x000000,
        emissiveIntensity: 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        (spec.x - centre.x) * BLOCK_SPACING,
        (spec.y - centre.y) * BLOCK_SPACING,
        (spec.z - centre.z) * BLOCK_SPACING,
      );
      this.modelRoot.add(mesh);

      const block: BlockRuntime = { ...spec, active: true, mesh };
      this.blocks.push(block);
      this.blockMap.set(gridKey(spec.x, spec.y, spec.z), block);
    }
  }

  private buildWeakPoints() {
    // Four shared discs make a high-contrast bullseye without one material or
    // geometry allocation per authored point. Each group is parented to its
    // block, so it inherits every model rotation and remains truly world-space.
    const visualRadius = BLOCK_SIZE * WEAK_POINT_VISUAL_RADIUS_RATIO;
    const geometries = [1, 0.82, 0.5, 0.2]
      .map((ratio) => new THREE.CircleGeometry(visualRadius * ratio, 28));
    const materials = [
      new THREE.MeshBasicMaterial({ color: 0x10152f, side: THREE.DoubleSide, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xff315f, side: THREE.DoubleSide, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false }),
    ];
    this.disposables.push(...geometries, ...materials);

    for (const spec of this.level.weakPoints) {
      const block = this.blockMap.get(gridKey(spec.x, spec.y, spec.z));
      if (!block) continue; // The level validator rejects this before runtime.
      const normal = this.weakPointFaceNormal(spec.face);
      const group = new THREE.Group();
      group.position.copy(normal).multiplyScalar(BLOCK_HALF + WEAK_POINT_SURFACE_GAP);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

      geometries.forEach((geometry, index) => {
        const disc = new THREE.Mesh(geometry, materials[index]);
        disc.position.z = index * 0.0015;
        disc.renderOrder = 20 + index;
        group.add(disc);
      });
      block.mesh.add(group);

      const visual = { spec, block, group };
      this.weakPointVisuals.push(visual);
      const authored = this.weakPointsByBlock.get(block.id) ?? [];
      authored.push(spec);
      this.weakPointsByBlock.set(block.id, authored);
    }
  }

  private weakPointFaceNormal(face: WeakPointFace) {
    switch (face) {
      case "PX": return new THREE.Vector3(1, 0, 0);
      case "NX": return new THREE.Vector3(-1, 0, 0);
      case "PY": return new THREE.Vector3(0, 1, 0);
      case "NY": return new THREE.Vector3(0, -1, 0);
      case "PZ": return new THREE.Vector3(0, 0, 1);
      case "NZ": return new THREE.Vector3(0, 0, -1);
    }
  }

  private buildRainbowTargets() {
    const bodyGeometry = new THREE.CylinderGeometry(
      RAINBOW_TARGET_RADIUS,
      RAINBOW_TARGET_RADIUS,
      0.13,
      32,
    );
    bodyGeometry.rotateX(Math.PI / 2);

    // A seven-ring spectrum bullseye. Concentric rings share one geometry and
    // one material each across every target, so the ring count costs seven
    // allocations for the whole round rather than seven per target.
    const ringGeometries = RAINBOW_RING_COLORS.map((_, ring) => {
      const outer = RAINBOW_TARGET_RADIUS * (1 - ring / RAINBOW_RING_COLORS.length);
      const inner = RAINBOW_TARGET_RADIUS * (1 - (ring + 1) / RAINBOW_RING_COLORS.length);
      // The innermost ring is a filled disc, or the bullseye would have a hole.
      return ring === RAINBOW_RING_COLORS.length - 1
        ? new THREE.CircleGeometry(outer, 32)
        : new THREE.RingGeometry(inner, outer, 32);
    });
    const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x37206f });
    const ringMaterials = RAINBOW_RING_COLORS.map((color) => (
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
    ));
    this.disposables.push(bodyGeometry, ...ringGeometries, bodyMaterial, ...ringMaterials);

    const schedule = createRainbowSpawnSchedule({
      levelSeed: this.level.id,
      targetCount: this.level.rainbow.targetCount,
      baseGapSeconds: this.level.rainbow.spawnGapSeconds,
      durationSeconds: this.level.rainbow.targetDurationSeconds,
    });
    for (const entry of schedule) {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(bodyGeometry, bodyMaterial));
      ringGeometries.forEach((geometry, ring) => {
        const mesh = new THREE.Mesh(geometry, ringMaterials[ring]);
        // Stacked front-to-back so the outer ring never z-fights the next one in.
        mesh.position.z = 0.068 + ring * 0.0012;
        mesh.renderOrder = 10 + ring;
        group.add(mesh);
      });
      group.visible = false;
      this.scene.add(group);
      this.rainbowTargets.push({
        id: `rainbow-target-${entry.index + 1}`,
        spawnIndex: entry.index,
        seed: entry.seed,
        spawnTime: entry.spawnAtSeconds,
        duration: entry.leaveAtSeconds - entry.spawnAtSeconds,
        hit: false,
        active: false,
        group,
      });
    }
  }

  private axisCentre(values: number[]) {
    if (!values.length) return 0;
    return (Math.min(...values) + Math.max(...values)) / 2;
  }

  // Only the frame lives here: where the rig stands, how it yaws and pitches,
  // and where a shot leaves it. What the frame is wearing comes from the
  // selected cosmetic, which is why a skin can never move the muzzle and so can
  // never change a trajectory.
  private buildCannon() {
    this.cannonRoot.position.set(0, -1.78, 5.25);
    this.cannonRestPosition.copy(this.cannonRoot.position);
    // Remembered so the intro knows where to raise the cannon back to.
    this.cannonRestY = this.cannonRoot.position.y;
    this.scene.add(this.cannonRoot);

    this.turret.position.y = 0.46;
    this.cannonRoot.add(this.turret);
    this.barrelPivot.position.y = 0.12;
    this.turret.add(this.barrelPivot);
    this.barrelPivot.add(this.barrelVisual);

    this.muzzleAnchor.position.z = -2.18;
    this.barrelPivot.add(this.muzzleAnchor);
    this.buildCosmeticRig();
    this.applyCannonTransform();
  }


  // Armed: the Weak Point decals come off every block, because any face will do
  // for the next shot, and the rig puts its rainbow coat on.
  private setRainbowVisualState(active: boolean) {
    for (const visual of this.weakPointVisuals) {
      visual.group.visible = !active && visual.block.active;
    }
    if (active) this.rainbowVisualTime = 0;
    this.applyRainbowCannonFilter(active);
  }

  /**
   * A translucent coat over the rig rather than a recolour of it.
   *
   * Hue-cycling the cannon's own materials repainted the gun; what the armed
   * state wants is a layer sitting on top of it, the same trick the block shield
   * uses. Unlit, because the scene key light would turn a shaded material into
   * just another paint job, and drawn from a runtime canvas because the whole
   * game ships as one HTML file with no external assets.
   */
  private applyRainbowCannonFilter(active: boolean) {
    if (!active) {
      if (this.cannonFilter) this.cannonFilter.visible = false;
      return;
    }
    if (!this.cannonFilter) {
      const texture = makeRainbowTexture();
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      const geometry = new THREE.SphereGeometry(1.16, 20, 14);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.disposables.push(texture, geometry, material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = 0.42;
      mesh.renderOrder = 12;
      // Parented to the rig root, so it rides the aim and the recoil instead of
      // hanging where the cannon used to be.
      this.cannonRoot.add(mesh);
      this.cannonFilter = mesh;
    }
    this.cannonFilter.visible = true;
    this.updateRainbowCannonFilter();
  }

  private updateRainbowCannonFilter() {
    const filter = this.cannonFilter;
    if (!filter || !filter.visible) return;
    // Scrolling the map rather than spinning the shell: a rotating sphere reads
    // as an object turning, a scrolling gradient reads as energy moving over one.
    const map = filter.material.map;
    if (map) map.offset.x = (this.rainbowVisualTime * 0.35) % 1;
    filter.material.opacity = 0.34 + Math.sin(this.rainbowVisualTime * 4.2) * 0.08;
  }



  private buildCosmeticRig() {
    this.cosmeticParts = this.cosmetic.build({
      cannonRoot: this.cannonRoot,
      turret: this.turret,
      barrelPivot: this.barrelPivot,
      barrelVisual: this.barrelVisual,
    });
    // The sight belongs to the weapon: a wand aims down a rune circle, not down
    // iron sights. Toggled here so both the first build and every later swap go
    // through one place.
    this.crosshair.classList.toggle("is-magic", this.isMagic());
  }

  // Swapping a skin is a visual change and nothing else: the frame, the aim and
  // the shot in flight are all untouched.
  setCosmetic(id: CosmeticId) {
    if (this.cosmetic.id === id) return;
    disposeCosmeticParts(this.cosmeticParts);
    this.cosmeticParts = [];
    this.cosmetic = getCosmetic(id);
    this.buildCosmeticRig();
    // A skin swap rebuilds the rig under the coat, so the coat is re-hung.
    if (this.weakPointBypassArmed) this.applyRainbowCannonFilter(true);
  }

  // Rendered with the engine's own renderer, because the page keeps exactly one
  // WebGL context and a second one would eventually cost the game its canvas.
  captureCosmeticThumbnails() {
    return getCosmeticThumbnails(this.renderer);
  }

  private bindInput() {
    this.modelZone.addEventListener("pointerdown", this.onModelPointerDown);
    this.modelZone.addEventListener("pointermove", this.onModelPointerMove);
    this.modelZone.addEventListener("pointerup", this.onModelPointerEnd);
    this.modelZone.addEventListener("pointercancel", this.onModelPointerEnd);
    this.modelZone.addEventListener("lostpointercapture", this.onModelPointerEnd);
    this.aimZone.addEventListener("pointerdown", this.onAimPointerDown);
    this.aimZone.addEventListener("pointermove", this.onAimPointerMove);
    this.aimZone.addEventListener("pointerup", this.onAimPointerUp);
    this.aimZone.addEventListener("pointercancel", this.onAimPointerCancel);
    this.aimZone.addEventListener("lostpointercapture", this.onAimPointerCancel);
  }

  private canInteract() {
    return !this.paused && !this.idle && !this.introActive && !this.showcase && !this.state.result;
  }

  // The skin picker's preview. The rig moves to where the cluster normally is,
  // turns slowly and fires on a loop, so the card you are looking at is the rig
  // the level will hand you.
  setShowcase(next: boolean) {
    if (this.showcase === next) return;
    this.showcase = next;
    // A puff lives up to 0.46s and a firework up to 0.72s, so the demo shots
    // leave particles behind them that outlast the screen they were fired on.
    // Both directions are cleared: the menu must not inherit a burst from the
    // picker, and the picker must not open into the tail of something else.
    this.clearParticles();
    if (next) {
      this.showcaseTime = 0;
      this.showcaseCountdown = 0.3;
      this.modelRoot.visible = false;
      this.cannonRoot.visible = true;
      this.cannonRoot.position.copy(SHOWCASE_POSITION);
      this.cannonRoot.scale.setScalar(SHOWCASE_SCALE);
      this.yaw = CANNON_NEUTRAL_YAW;
      this.elevation = SHOWCASE_ELEVATION;
      this.applyCannonTransform();
      return;
    }
    this.clearShowcaseShots();
    // A demo shot fired a moment ago leaves the barrel mid-recoil, and the
    // decay keeps running on whatever the rig is doing next.
    this.recoil = 0;
    this.barrelVisual.position.z = 0;
    this.cannonRoot.rotation.y = 0;
    this.cannonRoot.position.copy(this.cannonRestPosition);
    this.cannonRoot.scale.setScalar(1);
    // The picker is only reachable from the menu, and the menu shows the
    // cluster alone.
    this.cannonRoot.visible = !this.idle;
    this.modelRoot.visible = true;
    this.resetCannonDirection();
    this.aimPreviewDirty = true;
  }

  private launchShowcaseShot() {
    this.applyCannonTransform();
    const start = this.muzzleAnchor.getWorldPosition(new THREE.Vector3());
    const quaternion = this.muzzleAnchor.getWorldQuaternion(new THREE.Quaternion());
    const velocity = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(quaternion)
      .multiplyScalar(SHOWCASE_SHOT_SPEED);
    const mesh = takeProjectileMesh();
    mesh.position.copy(start);
    mesh.scale.setScalar(1);
    mesh.material = projectileMaterials[this.cosmetic.flavor];
    this.scene.add(mesh);
    this.showcaseShots.push({ mesh, start, velocity, time: 0, trailTicks: 0 });
    this.recoil = 1;
    if (this.isMagic()) this.spawnSparkleBurst(start, this.showcaseShots.length * 61);
  }

  private updateShowcase() {
    this.showcaseCountdown -= FIXED_STEP;
    if (this.showcaseCountdown <= 0) {
      this.showcaseCountdown = SHOWCASE_FIRE_INTERVAL;
      this.launchShowcaseShot();
    }

    const survivors: ShowcaseShot[] = [];
    for (const shot of this.showcaseShots) {
      shot.time += FIXED_STEP;
      const position = this.positionAt(shot.start, shot.velocity, shot.time);
      shot.mesh.position.copy(position);
      const interval = this.isMagic() ? SPARKLE_TRAIL_INTERVAL : FALL_TRAIL_INTERVAL;
      const ticks = Math.floor(shot.time / interval);
      if (ticks !== shot.trailTicks) {
        shot.trailTicks = ticks;
        if (this.isMagic()) this.spawnSparkleTrail(position, ticks * 17);
        else this.spawnFallTrail(position, ticks * 17);
      }
      if (shot.time < SHOWCASE_SHOT_FLIGHT) {
        survivors.push(shot);
        continue;
      }
      // It ends in mid air on purpose: there is nothing to hit in the picker,
      // and the landing effect is the thing being shown.
      this.playImpactEffect(position, ticks * 29);
      this.scene.remove(shot.mesh);
      recycleProjectileMesh(shot.mesh);
    }
    this.showcaseShots = survivors;
  }

  // Everything the particle systems still have in the air. Geometry and
  // materials are shared per engine and released once in dispose(), so only the
  // nodes leave here.
  private clearParticles() {
    for (const puff of this.smoke) this.scene.remove(puff.mesh);
    this.smoke = [];
    for (const sparkle of this.sparkles) this.scene.remove(sparkle.mesh);
    this.sparkles = [];
  }

  private clearShowcaseShots() {
    for (const shot of this.showcaseShots) {
      this.scene.remove(shot.mesh);
      recycleProjectileMesh(shot.mesh);
    }
    this.showcaseShots = [];
  }

  private hookSnapshot(): HookSnapshot {
    return { weakPointBypassArmed: this.weakPointBypassArmed };
  }

  private emitHookState(force = false) {
    const snapshot = this.hookSnapshot();
    // One boolean, so the HUD now re-renders on the two or three frames a round
    // where it actually changes rather than ten times a second for a clock.
    const signature = snapshot.weakPointBypassArmed ? "armed" : "idle";
    if (!force && signature === this.hookSnapshotSignature) return;
    this.hookSnapshotSignature = signature;
    this.callbacks.onHookState(snapshot);
  }

  private startRoundClock() {
    if (this.state.result || this.roundClockActive) return;
    this.roundClockActive = true;
    this.emitHookState(true);
  }

  private setRainbowTargetsInactive() {
    for (const target of this.rainbowTargets) {
      target.active = false;
      target.group.visible = false;
    }
  }

  // Arming is idempotent on purpose: two targets collected before the next shot
  // still owe exactly one bypass. The reward is the shot, not a counter.
  private armWeakPointBypass() {
    const alreadyArmed = this.weakPointBypassArmed;
    this.weakPointBypassArmed = true;
    if (!alreadyArmed) this.setRainbowVisualState(true);
    this.aimPreviewDirty = true;
    this.emitHookState(true);
  }

  // Called from the block-impact path only. A shot that lands on nothing keeps
  // the bypass, so one stray flick cannot throw the reward away.
  private consumeWeakPointBypass() {
    if (!this.weakPointBypassArmed) return;
    this.weakPointBypassArmed = false;
    this.setRainbowVisualState(false);
    this.aimPreviewDirty = true;
    this.emitHookState(true);
  }

  private targetPlanePointAt(u: number, v: number) {
    const { origin, direction } = this.cameraRayForScreenPoint(
      u * Math.max(this.host.clientWidth, 1),
      v * Math.max(this.host.clientHeight, 1),
    );
    if (Math.abs(direction.z) < 1e-6) return new THREE.Vector3(0, 0, RAINBOW_TARGET_PLANE_Z);
    const distance = (RAINBOW_TARGET_PLANE_Z - origin.z) / direction.z;
    return origin.addScaledVector(direction, distance);
  }

  private updateRainbowTargets() {
    for (const target of this.rainbowTargets) {
      const progress = (this.roundElapsed - target.spawnTime) / target.duration;
      const active = !target.hit && progress >= 0 && progress < 1;
      target.active = active;
      target.group.visible = active;
      if (!active) continue;
      const point = rainbowWanderAt(target.seed, progress);
      target.group.position.copy(this.targetPlanePointAt(point.u, point.v));
      target.group.lookAt(this.camera.position);
    }
  }

  // A target moves during the step a projectile is crossing it, so collision has
  // to be solved against the segment it travels, not against one sampled point.
  // This is what makes hitting a moving target honest, and it is independent of
  // anything about the reward.
  private rainbowTargetMotionsForInterval(intervalStart: number, intervalEnd: number) {
    const intervalDuration = intervalEnd - intervalStart;
    if (intervalDuration <= 0) return [];

    const motions: RainbowTargetStepMotion[] = [];
    for (const target of this.rainbowTargets) {
      if (target.hit) continue;
      const liveStart = Math.max(intervalStart, target.spawnTime);
      const liveEnd = Math.min(intervalEnd, target.spawnTime + target.duration);
      if (liveEnd <= liveStart) continue;
      const fromPath = rainbowWanderAt(target.seed, (liveStart - target.spawnTime) / target.duration);
      const toPath = rainbowWanderAt(target.seed, (liveEnd - target.spawnTime) / target.duration);
      motions.push({
        target,
        fromFraction: THREE.MathUtils.clamp((liveStart - intervalStart) / intervalDuration, 0, 1),
        toFraction: THREE.MathUtils.clamp((liveEnd - intervalStart) / intervalDuration, 0, 1),
        fromPosition: this.targetPlanePointAt(fromPath.u, fromPath.v),
        toPosition: this.targetPlanePointAt(toPath.u, toPath.v),
      });
    }
    return motions;
  }

  private stopHookForResult() {
    // Every result path comes through this finalizer. Besides stopping the hook,
    // it releases pointer capture and pooled shots so a result cannot leave a
    // frozen projectile or a rainbow layer retained behind the result panel.
    if (this.aimPointer !== null) this.clearAimGesture(true);
    if (this.modelPointer !== null) this.clearModelGesture();
    this.pendingResolutions = [];
    this.batchFlight = null;
    this.projectiles.slice().forEach((projectile) => this.removeProjectile(projectile));
    this.rainbowTargetStepMotions = null;
    this.weakPointBypassArmed = false;
    this.roundClockActive = false;
    this.setRainbowTargetsInactive();
    this.setRainbowVisualState(false);
    for (const visual of this.weakPointVisuals) visual.group.visible = false;
    this.emitHookState(true);
  }

  // The one place projectiles are integrated. It used to split the fixed step at
  // phase boundaries so an impact resolved against the phase it happened in;
  // with the bypass being a flag read at impact there is no boundary left to
  // split on, so this is a flat step again.
  private updateTimedGameplayStep() {
    if (this.roundClockActive && !this.state.result) {
      this.roundElapsed += FIXED_STEP;
      this.rainbowTargetStepMotions = this.rainbowTargetMotionsForInterval(
        this.roundElapsed - FIXED_STEP,
        this.roundElapsed,
      );
      // A target may spawn part-way through this interval. Marking it active
      // lets an impact after that instant collect it; the visible transform is
      // committed below.
      for (const motion of this.rainbowTargetStepMotions) motion.target.active = true;
    }

    if (!this.state.result) {
      this.projectiles.slice().forEach((projectile) => this.updateProjectile(projectile));
    }

    if (this.roundClockActive && !this.state.result) {
      this.updateRainbowTargets();
      if (this.state.phase === "AIMING") {
        this.aimMovingTargetRefreshCountdown -= FIXED_STEP;
        if (this.aimMovingTargetRefreshCountdown <= 0) {
          this.aimMovingTargetRefreshCountdown = AIM_MOVING_TARGET_REFRESH_INTERVAL;
          this.aimPreviewDirty = true;
        }
      }
      if (this.weakPointBypassArmed) {
        this.rainbowVisualTime += FIXED_STEP;
        this.updateRainbowCannonFilter();
      }
    }
    this.rainbowTargetStepMotions = null;
  }

  // Menu mode: the cluster turns on its own and nothing the player does reaches
  // the level. The cannon steps out of frame because the menu only shows the
  // model.
  setIdle(next: boolean) {
    if (this.idle === next) {
      // Fresh engines begin non-idle. A restart shown directly in gameplay calls
      // setIdle(false) without an intro, and that call is the signal to start its
      // timer even though the visual mode did not change.
      if (!next && !this.introActive) this.startRoundClock();
      return;
    }
    this.idle = next;
    if (next) {
      this.roundClockActive = false;
      if (this.aimPointer !== null) this.clearAimGesture(false);
      if (this.modelPointer !== null) this.clearModelGesture();
      this.introActive = false;
      this.cannonRoot.visible = false;
      this.modelRoot.scale.setScalar(MENU_MODEL_SCALE);
      this.crosshair.classList.remove(
        "is-visible",
        "is-engaged",
        "is-aiming",
        "is-target-valid",
        "is-cooling-down",
        "is-blocked",
      );
      return;
    }
    // Leaving the menu runs an intro instead of a cut: the cluster grows to full
    // size while turning back to the orientation the level was authored against,
    // and the cannon rises into frame behind it.
    this.introFromQuaternion.copy(this.modelRoot.quaternion);
    this.introFromScale = this.modelRoot.scale.x;
    this.introDuration = INTRO_DURATION;
    this.introSpinTurn = 0;
    this.introRaisesCannon = true;
    this.introClockPending = true;
    this.introTime = 0;
    this.introActive = true;
    this.cannonRoot.visible = true;
    this.cannonRoot.position.y = this.cannonRestY - CANNON_INTRO_DROP;
    this.aimPreviewDirty = true;
  }

  // Handing one level straight to the next, with no menu in between: the fresh
  // cluster still has to introduce itself, so it starts pulled back and half
  // turned and swings onto the authored transform instead of just being there.
  startHandoffIntro() {
    if (this.idle) return;
    if (this.aimPointer !== null) this.clearAimGesture(false);
    if (this.modelPointer !== null) this.clearModelGesture();
    this.introFromQuaternion.copy(this.modelRoot.quaternion);
    this.introFromScale = HANDOFF_MODEL_SCALE;
    this.introDuration = HANDOFF_INTRO_DURATION;
    this.introSpinTurn = HANDOFF_SPIN_TURN;
    // The cannon was already on screen a frame ago and stays exactly where it
    // was. Dropping it out of frame and flying it back in was the entrance
    // reading as a jerk: the level swap is the most expensive frame in the
    // game, and a 3.4-unit slide is where those long frames showed.
    this.introRaisesCannon = false;
    this.introClockPending = true;
    this.introTime = 0;
    this.introActive = true;
    // Placed on the first frame rather than waited for, so the zoomed-out,
    // half-turned pose is what the player sees the moment the level swaps.
    this.modelRoot.scale.setScalar(HANDOFF_MODEL_SCALE);
    this.introSpinDelta.setFromAxisAngle(this.worldUp, HANDOFF_SPIN_TURN);
    this.modelRoot.quaternion.copy(this.defaultModelOrientation).premultiply(this.introSpinDelta);
    this.cannonRoot.visible = true;
    this.cannonRoot.position.y = this.cannonRestY;
    this.showIdleCrosshair();
    this.aimPreviewDirty = true;
    // The constructor already drew this engine's first frame with the cluster
    // at rest. Redrawing here keeps that frame from reaching the screen, so the
    // level never flashes its finished pose before the entrance starts.
    this.renderer.render(this.scene, this.camera);
  }

  private updateIntro(frameDelta: number) {
    this.introTime = Math.min(this.introTime + frameDelta, this.introDuration);
    const progress = this.introTime / this.introDuration;
    const eased = 1 - Math.pow(1 - progress, 3);
    if (this.introSpinTurn !== 0) {
      // Driven as an angle around world up, not as a slerp: a half turn has no
      // shorter arc for slerp to choose, so the spin direction would be
      // whatever the quaternion signs happened to give.
      this.introSpinDelta.setFromAxisAngle(this.worldUp, this.introSpinTurn * (1 - eased));
      this.modelRoot.quaternion.copy(this.defaultModelOrientation).premultiply(this.introSpinDelta);
    } else {
      this.modelRoot.quaternion.slerpQuaternions(this.introFromQuaternion, this.defaultModelOrientation, eased);
    }
    this.modelRoot.scale.setScalar(THREE.MathUtils.lerp(this.introFromScale, 1, eased));

    if (this.introRaisesCannon) {
      const cannonProgress = THREE.MathUtils.clamp(
        (progress - CANNON_INTRO_START) / (1 - CANNON_INTRO_START),
        0,
        1,
      );
      const cannonEased = 1 - Math.pow(1 - cannonProgress, 3);
      this.cannonRoot.position.y = this.cannonRestY - CANNON_INTRO_DROP * (1 - cannonEased);
    }

    if (progress < 1) return;
    // Land on the exact authored values so gameplay never starts from a
    // rounded-off transform.
    this.introActive = false;
    this.introSpinTurn = 0;
    this.modelRoot.quaternion.copy(this.defaultModelOrientation);
    this.modelRoot.scale.setScalar(1);
    this.modelRoot.updateMatrixWorld(true);
    this.cannonRoot.position.y = this.cannonRestY;
    this.resetCannonDirection();
    this.showIdleCrosshair();
    this.aimPreviewDirty = true;
    this.startRoundClock();
  }

  private canStartAim() {
    // Aiming and rotating are two different fingers on two different zones, so
    // one starting does not block the other — a right-hand aim gesture and a
    // left-hand rotate gesture can both be live at once.
    return this.canInteract()
      && this.aimPointer === null
      && performance.now() >= this.nextShotAt;
  }

  private canRotateModel() {
    // Rotation still waits out a shot already in flight: sweepBlocks tests the
    // cluster's *current* rotation every step, so spinning the model mid-flight
    // would let a shot land on a different block than the one it was aimed at
    // when it left the barrel — the same fairness problem the aim fix solved,
    // just reintroduced through motion instead of math.
    return this.canInteract() && this.projectiles.length === 0;
  }

  private onModelPointerDown = (event: PointerEvent) => {
    if (!this.canRotateModel() || this.modelPointer !== null) return;
    this.modelPointer = event.pointerId;
    this.lastModelPointer.set(event.clientX, event.clientY);
    this.modelZone.setPointerCapture(event.pointerId);
    this.modelZone.classList.add("is-dragging");
  };

  private onModelPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.modelPointer) return;
    if (!this.canRotateModel()) {
      this.clearModelGesture();
      return;
    }
    const dx = event.clientX - this.lastModelPointer.x;
    const dy = event.clientY - this.lastModelPointer.y;
    this.cameraRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    this.modelYawDelta.setFromAxisAngle(
      this.worldUp,
      dx * MODEL_YAW_PER_PIXEL * this.modelRotateSensitivity,
    );
    this.modelPitchDelta.setFromAxisAngle(
      this.cameraRight,
      dy * MODEL_PITCH_PER_PIXEL * this.modelRotateSensitivity,
    );
    this.modelRoot.quaternion
      .premultiply(this.modelYawDelta)
      .premultiply(this.modelPitchDelta)
      .normalize();
    this.lastModelPointer.set(event.clientX, event.clientY);
    this.aimPreviewDirty = true;
  };

  private clearModelGesture() {
    const pointer = this.modelPointer;
    this.modelPointer = null;
    if (pointer !== null && this.modelZone.hasPointerCapture(pointer)) this.modelZone.releasePointerCapture(pointer);
    this.modelZone.classList.remove("is-dragging");
  }

  private onModelPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== this.modelPointer) return;
    this.clearModelGesture();
  };

  private onAimPointerDown = (event: PointerEvent) => {
    if (!this.canStartAim()) {
      if (this.canInteract() && performance.now() < this.nextShotAt) this.pulseCooldownCrosshair();
      return;
    }
    this.aimPointer = event.pointerId;
    this.aimStart.set(event.clientX, event.clientY);
    this.aimCurrent.copy(this.aimStart);
    this.aimDistance = 0;
    this.aimArmed = false;
    this.aimTargetValid = false;
    this.aimStick.set(0, 0);
    const bounds = this.aimZone.getBoundingClientRect();
    this.aimZone.style.setProperty("--joystick-x", `${event.clientX - bounds.left}px`);
    this.aimZone.style.setProperty("--joystick-y", `${event.clientY - bounds.top}px`);
    this.aimZone.style.setProperty("--joystick-dx", "0px");
    this.aimZone.style.setProperty("--joystick-dy", "0px");
    this.aimZone.setPointerCapture(event.pointerId);
    this.aimZone.classList.add("is-aiming", "is-cancelled");
    this.setPhase("AIMING");
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
    const stickX = dx * clampedScale;
    const stickY = dy * clampedScale;
    this.aimZone.style.setProperty("--joystick-dx", `${stickX}px`);
    this.aimZone.style.setProperty("--joystick-dy", `${stickY}px`);
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

  private cursorForCurrentStick() {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const horizontalRange = Math.max(
      0,
      Math.min(width * AIM_CURSOR_HORIZONTAL_RATIO, centerX - AIM_CURSOR_EDGE_MARGIN),
    );
    const upwardRange = Math.max(
      0,
      Math.min(height * AIM_CURSOR_UP_RATIO, centerY - AIM_CURSOR_EDGE_MARGIN),
    );
    const downwardRange = Math.max(
      0,
      Math.min(height * AIM_CURSOR_DOWN_RATIO, centerY - AIM_CURSOR_EDGE_MARGIN),
    );
    return new THREE.Vector2(
      centerX + this.aimStick.x * horizontalRange,
      centerY + this.aimStick.y * (this.aimStick.y < 0 ? upwardRange : downwardRange),
    );
  }

  private onAimPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.aimPointer || this.state.phase !== "AIMING") return;
    this.updateAimGesture(event.clientX, event.clientY);
  };

  private clearAimGesture(restoreDirection: boolean) {
    const pointer = this.aimPointer;
    this.aimPointer = null;
    if (pointer !== null && this.aimZone.hasPointerCapture(pointer)) this.aimZone.releasePointerCapture(pointer);
    this.aimZone.classList.remove("is-aiming", "is-cancelled");
    this.aimArmed = false;
    this.displayedAimArmed = false;
    this.aimTargetValid = false;
    this.aimStick.set(0, 0);
    this.displayedLaunch = null;
    if (restoreDirection) this.resetCannonDirection();
    this.aimPreviewDirty = false;
    this.showIdleCrosshair();
  }

  private cancelAimGesture() {
    this.clearAimGesture(true);
    if (this.state.phase === "AIMING" && !this.paused) this.setPhase("PLAYING");
    this.updateAimPreview();
  }

  private onAimPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.aimPointer) return;
    const canRelease = this.state.phase === "AIMING" && this.canInteract();
    // Fire the exact solution already shown by the last pointer-move frame.
    // Pointer-up coordinates can advance without being visually presented first.
    const releaseDistance = Math.hypot(
      event.clientX - this.aimStart.x,
      event.clientY - this.aimStart.y,
    );
    const shouldFire = canRelease
      && this.aimArmed
      && this.displayedAimArmed
      && releaseDistance > JOYSTICK_CANCEL_RADIUS
      && this.displayedLaunch !== null
      && performance.now() >= this.nextShotAt;
    const launch = shouldFire ? this.displayedLaunch : null;
    this.clearAimGesture(true);
    if (!shouldFire) {
      if (this.state.phase === "AIMING") this.setPhase("PLAYING");
      this.updateAimPreview();
      return;
    }
    this.fire(launch!);
  };

  private onAimPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.aimPointer) return;
    this.cancelAimGesture();
  };

  private applyCannonTransform() {
    this.turret.rotation.y = this.yaw;
    this.barrelPivot.rotation.x = this.elevation;
    this.turret.updateMatrixWorld(true);
  }

  private resetCannonDirection() {
    this.yaw = CANNON_NEUTRAL_YAW;
    this.elevation = CANNON_NEUTRAL_ELEVATION;
    this.applyCannonTransform();
    const centerSolution = this.solveAimAtScreenPoint(
      Math.max(this.host.clientWidth, 1) * 0.5,
      Math.max(this.host.clientHeight, 1) * 0.5,
    );
    if (!centerSolution) {
      this.yaw = CANNON_NEUTRAL_YAW;
      this.elevation = CANNON_NEUTRAL_ELEVATION;
      this.applyCannonTransform();
    }
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

  private cameraRayForScreenPoint(screenX: number, screenY: number) {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.camera.updateMatrixWorld(true);
    const point = new THREE.Vector3(
      (screenX / width) * 2 - 1,
      1 - (screenY / height) * 2,
      0.5,
    ).unproject(this.camera);
    const direction = point.sub(this.camera.position).normalize();
    return { origin: this.camera.position.clone(), direction };
  }

  // Fallback for when the crosshair is not over any block: aim at a flat
  // depth plane through the model's pivot so a trajectory can still be solved.
  private targetPlanePoint(screenX: number, screenY: number) {
    this.modelRoot.updateMatrixWorld(true);
    const modelCenter = this.modelRoot.getWorldPosition(new THREE.Vector3());
    const { origin, direction } = this.cameraRayForScreenPoint(screenX, screenY);
    if (Math.abs(direction.z) < 1e-5) return modelCenter;
    const distance = (modelCenter.z - origin.z) / direction.z;
    if (!Number.isFinite(distance) || distance <= 0) return modelCenter;
    return origin.addScaledVector(direction, distance);
  }

  // What the player actually sees under the crosshair: cast a ray from the
  // camera through the screen point and find the nearest block it touches, in
  // the block cluster's own rotated space. Solving the trajectory toward this
  // point (instead of a fixed-depth plane) is what keeps "aimed at yellow"
  // and "hit yellow" the same block once the model has been rotated.
  private raycastBlockSurfacePoint(screenX: number, screenY: number): THREE.Vector3 | null {
    this.modelRoot.updateMatrixWorld(true);
    const inverseModel = this.modelRoot.matrixWorld.clone().invert();
    const { origin, direction } = this.cameraRayForScreenPoint(screenX, screenY);
    const localOrigin = origin.clone().applyMatrix4(inverseModel);
    const localDirection = origin.clone().add(direction).applyMatrix4(inverseModel).sub(localOrigin).normalize();

    let best: { t: number; block: BlockRuntime } | null = null;
    for (const block of this.blocks) {
      if (!block.active) continue;
      const center = block.mesh.position;
      const min = new THREE.Vector3(center.x - BLOCK_HALF, center.y - BLOCK_HALF, center.z - BLOCK_HALF);
      const max = new THREE.Vector3(center.x + BLOCK_HALF, center.y + BLOCK_HALF, center.z + BLOCK_HALF);
      const t = rayAabbEntry(localOrigin, localDirection, min, max);
      if (t === null) continue;
      if (!best || t < best.t) best = { t, block };
    }
    if (!best) return null;
    return localOrigin.clone().addScaledVector(localDirection, best.t).applyMatrix4(this.modelRoot.matrixWorld);
  }

  private raycastRainbowTargetSurfacePoint(screenX: number, screenY: number): THREE.Vector3 | null {
    if (!this.roundClockActive) return null;
    const { origin, direction } = this.cameraRayForScreenPoint(screenX, screenY);
    let best: { t: number; point: THREE.Vector3 } | null = null;
    for (const target of this.rainbowTargets) {
      if (!target.active) continue;
      const center = target.group.getWorldPosition(new THREE.Vector3());
      const t = raySphereEntry(origin, direction, center, RAINBOW_TARGET_COLLIDER_RADIUS);
      if (t === null || (best && t >= best.t)) continue;
      best = { t, point: origin.clone().addScaledVector(direction, t) };
    }
    return best?.point ?? null;
  }

  private solveAimAtScreenPoint(screenX: number, screenY: number): BallisticSolution | null {
    const modelTarget = this.raycastBlockSurfacePoint(screenX, screenY) ?? this.targetPlanePoint(screenX, screenY);
    const target = this.raycastRainbowTargetSurfacePoint(screenX, screenY) ?? modelTarget;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const start = this.muzzleAnchor.getWorldPosition(new THREE.Vector3());
      const desiredVelocity = this.fixedSpeedVelocity(start, target);
      if (!desiredVelocity) return null;
      const desiredYaw = Math.atan2(-desiredVelocity.x, -desiredVelocity.z);
      const desiredElevation = Math.atan2(
        desiredVelocity.y,
        Math.hypot(desiredVelocity.x, desiredVelocity.z),
      );
      this.yaw = THREE.MathUtils.clamp(desiredYaw, -CANNON_MAX_YAW, CANNON_MAX_YAW);
      this.elevation = THREE.MathUtils.clamp(
        desiredElevation,
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
    return residual <= 0.16 ? solution : null;
  }

  private ballisticSetup(): BallisticSolution {
    this.applyCannonTransform();
    const start = this.muzzleAnchor.getWorldPosition(new THREE.Vector3());
    const quaternion = this.muzzleAnchor.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
    // Fixed full-power speed keeps every authored target comfortably in range.
    return { start, velocity: forward.multiplyScalar(FIXED_LAUNCH_SPEED) };
  }

  private positionAt(start: THREE.Vector3, velocity: THREE.Vector3, time: number) {
    return start.clone().addScaledVector(velocity, time).addScaledVector(GRAVITY, 0.5 * time * time);
  }

  private showIdleCrosshair() {
    this.displayedAimArmed = false;
    this.displayedLaunch = null;
    this.aimTargetValid = false;
    this.crosshair.style.left = "50%";
    this.crosshair.style.top = "50%";
    this.crosshair.classList.remove("is-engaged", "is-aiming", "is-target-valid");
    // Guarded rather than added: this runs from resize() too, and a resize
    // observation lands right after the menu opens — which used to put the
    // crosshair back over a menu that shows nothing to aim at. It reappears
    // exactly when the intro hands control over.
    this.crosshair.classList.toggle("is-visible", !this.idle && !this.introActive);
  }

  private showAimCrosshairAt(screenX: number, screenY: number, targetValid: boolean) {
    const x = THREE.MathUtils.clamp(
      screenX,
      AIM_CURSOR_EDGE_MARGIN,
      Math.max(AIM_CURSOR_EDGE_MARGIN, this.host.clientWidth - AIM_CURSOR_EDGE_MARGIN),
    );
    const y = THREE.MathUtils.clamp(
      screenY,
      AIM_CURSOR_EDGE_MARGIN,
      Math.max(AIM_CURSOR_EDGE_MARGIN, this.host.clientHeight - AIM_CURSOR_EDGE_MARGIN),
    );
    this.crosshair.style.left = `${x}px`;
    this.crosshair.style.top = `${y}px`;
    this.crosshair.classList.add("is-visible");
    this.crosshair.classList.toggle(
      "is-engaged",
      this.aimPointer !== null && this.state.phase === "AIMING",
    );
    this.crosshair.classList.toggle("is-aiming", this.displayedAimArmed);
    this.crosshair.classList.toggle("is-target-valid", this.displayedAimArmed && targetValid);
  }

  private pulseCooldownCrosshair() {
    this.showIdleCrosshair();
    this.crosshair.classList.remove("is-blocked");
    void this.crosshair.offsetWidth;
    this.crosshair.classList.add("is-blocked");
  }

  private updateAimPreview() {
    this.aimPreviewDirty = false;
    if (this.state.phase !== "AIMING" || this.state.result) {
      this.showIdleCrosshair();
      return;
    }

    const candidateCursor = this.cursorForCurrentStick();
    const candidateLaunch = this.solveAimAtScreenPoint(candidateCursor.x, candidateCursor.y);
    let candidateTargetValid = false;

    if (candidateLaunch && this.aimArmed) {
      const { start, velocity } = candidateLaunch;
      this.modelRoot.updateMatrixWorld(true);
      const inverseModel = this.modelRoot.matrixWorld.clone().invert();
      let previous = start;
      const sampleCount = Math.ceil(AIM_PREDICTION_DURATION / FIXED_STEP);
      for (let step = 1; step <= sampleCount; step += 1) {
        const current = this.positionAt(start, velocity, step * FIXED_STEP);
        const previewEventStart = this.roundElapsed + (step - 1) * FIXED_STEP;
        const rainbowHit = this.sweepRainbowTargets(
          previous,
          current,
          previewEventStart,
          previewEventStart + FIXED_STEP,
        );
        const hit = this.sweepBlocks(previous, current, inverseModel);
        if (rainbowHit || hit) {
          candidateTargetValid = true;
          break;
        }
        if (current.y < -3 || current.lengthSq() > 500) break;
        previous = current;
      }
    }

    // Commit the cursor, launch and validity together so release can only fire
    // the exact state that was presented in this animation frame.
    // Collision prediction changes only the + / × state; it never pulls the
    // crosshair away from the position selected with the joystick.
    this.aimCursor.copy(candidateCursor);
    this.displayedLaunch = candidateLaunch;
    this.displayedAimArmed = this.aimArmed;
    this.aimTargetValid = candidateTargetValid;
    this.showAimCrosshairAt(this.aimCursor.x, this.aimCursor.y, this.aimTargetValid);
  }

  private fire({ start, velocity }: BallisticSolution) {
    const now = performance.now();
    if (!this.canInteract() || now < this.nextShotAt) {
      if (this.state.phase === "AIMING") this.setPhase("PLAYING");
      return;
    }
    if (this.level.shotLimit !== null && this.state.shotIndex >= this.level.shotLimit) {
      this.state = {
        ...this.state,
        phase: "FAIL",
        result: { kind: "FAIL", allClear: this.state.remainingBlockCount === 0, reason: "Out of shots" },
        lastEvents: ["Out of shots"],
      };
      haptic("lose");
      this.callbacks.onState(this.cloneState());
      this.stopHookForResult();
      return;
    }
    const mesh = takeProjectileMesh();
    mesh.position.copy(start);
    // The last shot to use this mesh may have shrunk away as it fell, and the
    // pool hands the same mesh back — possibly from a different skin.
    mesh.scale.setScalar(1);
    mesh.material = projectileMaterials[this.cosmetic.flavor];
    this.scene.add(mesh);
    // The wand throws its light at the tip as the shot leaves it.
    if (this.isMagic()) this.spawnSparkleBurst(start, this.state.shotIndex * 137 + 5);

    const shotIndex = this.state.shotIndex + 1;
    this.state = { ...this.state, shotIndex };
    this.projectiles.push({
      mesh,
      start,
      previous: start.clone(),
      velocity,
      time: 0,
      shotIndex,
      trailTicks: 0,
    });
    this.nextShotAt = now + SHOT_COOLDOWN_MS;
    this.aimZone.classList.add("is-cooling-down");
    this.crosshair.classList.add("is-cooling-down");
    this.recoil = 1;
    this.showIdleCrosshair();
    this.aimDistance = 0;
    this.setPhase("PLAYING");
  }

  private updateProjectile(projectile: Projectile) {
    projectile.time += FIXED_STEP;
    const next = this.positionAt(projectile.start, projectile.velocity, projectile.time);
    this.modelRoot.updateMatrixWorld(true);
    const inverseModel = this.modelRoot.matrixWorld.clone().invert();
    const rainbowHit = this.sweepRainbowTargets(projectile.previous, next);
    const hit = this.sweepBlocks(projectile.previous, next, inverseModel);
    // TEMP collision policy: resolve the first physical contact. A target only
    // wins an exact tie, which is deterministic without inventing a nonphysical
    // target-priority rule the design document explicitly leaves open.
    if (rainbowHit && (!hit || rainbowHit.t <= hit.t)) {
      projectile.mesh.position.copy(rainbowHit.point);
      this.handleRainbowTargetHit(rainbowHit.target, projectile);
      return;
    }
    if (hit) {
      projectile.mesh.position.copy(hit.point);
      this.handleHit(hit.block, projectile);
      return;
    }

    // A shot that got under the cluster ends on the floor with a puff instead
    // of sinking silently out of frame.
    if (projectile.previous.y > GROUND_Y && next.y <= GROUND_Y) {
      const drop = projectile.previous.y - next.y;
      const contact = projectile.previous
        .clone()
        .lerp(next, drop > 1e-6 ? (projectile.previous.y - GROUND_Y) / drop : 1);
      contact.y = GROUND_Y;
      projectile.mesh.position.copy(contact);
      this.playGroundEffect(contact, projectile.shotIndex);
      this.handleMiss(projectile);
      return;
    }

    projectile.mesh.position.copy(next);
    projectile.previous.copy(next);
    this.updateProjectileFall(projectile, next);
    if (projectile.time > 3 || next.y < -3 || Math.abs(next.x) > 14 || Math.abs(next.z) > 18) this.handleMiss(projectile);
  }

  // What a shot in flight looks like. Nothing here touches the flight itself:
  // the sweep keeps using PROJECTILE_RADIUS whatever size the ball is drawn at,
  // so a shrinking ball can never change what it would have hit.
  private updateProjectileFall(projectile: Projectile, position: THREE.Vector3) {
    const descending = projectile.velocity.y + GRAVITY.y * projectile.time < 0;

    // The wand's ray belongs to the shot, so it runs the whole way; the
    // cannon's dust only means "this one is falling away", so it waits for the
    // shot to start dropping.
    const interval = this.isMagic() ? SPARKLE_TRAIL_INTERVAL : FALL_TRAIL_INTERVAL;
    if (this.isMagic() || descending) {
      const ticks = Math.floor(projectile.time / interval);
      if (ticks !== projectile.trailTicks) {
        projectile.trailTicks = ticks;
        const seed = projectile.shotIndex * 61 + ticks * 7;
        if (this.isMagic()) this.spawnSparkleTrail(position, seed);
        else this.spawnFallTrail(position, seed);
      }
    }

    // Still climbing, so it is on its way to something, not away from it.
    if (!descending) return;
    const height = THREE.MathUtils.clamp(
      (position.y - GROUND_Y) / PROJECTILE_FALL_FADE_SPAN,
      0,
      1,
    );
    projectile.mesh.scale.setScalar(THREE.MathUtils.lerp(PROJECTILE_FALL_MIN_SCALE, 1, height));
  }

  private sweepRainbowTargets(
    worldA: THREE.Vector3,
    worldB: THREE.Vector3,
    previewEventStart?: number,
    previewEventEnd?: number,
  ): RainbowSweepHit | null {
    if (!this.roundClockActive) return null;
    let best: { target: RainbowTargetRuntime; t: number } | null = null;
    const motions = previewEventStart !== undefined && previewEventEnd !== undefined
      ? this.rainbowTargetMotionsForInterval(previewEventStart, previewEventEnd)
      : this.rainbowTargetStepMotions;

    if (motions !== null) {
      for (const motion of motions) {
        const { target } = motion;
        if (target.hit) continue;
        const projectileFrom = worldA.clone().lerp(worldB, motion.fromFraction);
        const projectileTo = worldA.clone().lerp(worldB, motion.toFraction);
        const relativeFrom = projectileFrom.sub(motion.fromPosition);
        const relativeTo = projectileTo.sub(motion.toPosition);
        const localT = sweptSphereSphereEntry(
          relativeFrom,
          relativeTo,
          new THREE.Vector3(),
          RAINBOW_TARGET_COLLIDER_RADIUS + PROJECTILE_RADIUS,
        );
        if (localT === null) continue;
        const t = THREE.MathUtils.lerp(motion.fromFraction, motion.toFraction, localT);
        if (!best || t < best.t - 1e-7 || (Math.abs(t - best.t) < 1e-7 && target.spawnIndex < best.target.spawnIndex)) {
          best = { target, t };
        }
      }
    } else {
      // Non-physics callers can still query the currently rendered target
      // positions. Runtime/projectile and prediction paths both use motion data.
      for (const target of this.rainbowTargets) {
        if (!target.active || target.hit) continue;
        const center = target.group.getWorldPosition(new THREE.Vector3());
        const t = sweptSphereSphereEntry(
          worldA,
          worldB,
          center,
          RAINBOW_TARGET_COLLIDER_RADIUS + PROJECTILE_RADIUS,
        );
        if (t === null) continue;
        if (!best || t < best.t - 1e-7 || (Math.abs(t - best.t) < 1e-7 && target.spawnIndex < best.target.spawnIndex)) {
          best = { target, t };
        }
      }
    }
    if (!best) return null;
    return { target: best.target, t: best.t, point: worldA.clone().lerp(worldB, best.t) };
  }

  private sweepBlocks(worldA: THREE.Vector3, worldB: THREE.Vector3, inverseModel: THREE.Matrix4): SweepHit | null {
    const a = worldA.clone().applyMatrix4(inverseModel);
    const b = worldB.clone().applyMatrix4(inverseModel);
    const radius = PROJECTILE_RADIUS;
    let best: { block: BlockRuntime; t: number } | null = null;

    for (const block of this.blocks) {
      if (!block.active) {
        if (this.level.claimedBlockCollision !== "PASS_THROUGH_TEMP") {
          throw new Error(`Unsupported temporary claimed-block behavior: ${this.level.claimedBlockCollision}`);
        }
        // TODO(design): The document leaves collision against already-claimed
        // released blocks open; this prototype explicitly lets shots pass through.
        continue;
      }
      const center = block.mesh.position;
      const min = new THREE.Vector3(center.x - BLOCK_HALF, center.y - BLOCK_HALF, center.z - BLOCK_HALF);
      const max = new THREE.Vector3(center.x + BLOCK_HALF, center.y + BLOCK_HALF, center.z + BLOCK_HALF);
      const t = sweptSphereAabbEntry(a, b, min, max, radius);
      if (t === null || t < 0 || t > 1) continue;
      if (!best || t < best.t - 1e-7 || (Math.abs(t - best.t) < 1e-7 && block.id < best.block.id)) best = { block, t };
    }

    if (!best) return null;
    return { block: best.block, t: best.t, point: worldA.clone().lerp(worldB, best.t) };
  }

  private findCluster(start: BlockRuntime) {
    if (!start.active) return [];
    const neighbors: ReadonlyArray<readonly [number, number, number]> = this.level.adjacency.z
      ? PHYSICAL_FACE_NEIGHBORS
      : CONFIRMED_NEIGHBORS;
    const queue = [start];
    const visited = new Set([start.id]);
    const result: BlockRuntime[] = [];

    while (queue.length) {
      const block = queue.shift()!;
      result.push(block);
      for (const [dx, dy, dz] of neighbors) {
        const neighbor = this.blockMap.get(gridKey(block.x + dx, block.y + dy, block.z + dz));
        if (!neighbor?.active || neighbor.color !== start.color || visited.has(neighbor.id)) continue;
        visited.add(neighbor.id);
        queue.push(neighbor);
      }
    }
    return result;
  }

  private impactedFace(localPoint: THREE.Vector3): WeakPointFace {
    const x = Math.abs(localPoint.x);
    const y = Math.abs(localPoint.y);
    const z = Math.abs(localPoint.z);
    if (x >= y && x >= z) return localPoint.x >= 0 ? "PX" : "NX";
    if (y >= z) return localPoint.y >= 0 ? "PY" : "NY";
    return localPoint.z >= 0 ? "PZ" : "NZ";
  }

  private projectileHitWeakPoint(block: BlockRuntime, projectile: Projectile) {
    const authored = this.weakPointsByBlock.get(block.id) ?? [];
    if (!authored.length) return false;
    this.modelRoot.updateMatrixWorld(true);
    const localImpact = projectile.mesh.position
      .clone()
      .applyMatrix4(this.modelRoot.matrixWorld.clone().invert())
      .sub(block.mesh.position);
    const face = this.impactedFace(localImpact);
    // Anywhere on the authored face counts. The bullseye is the decal that says
    // which face; it is not the region being tested.
    return authored.some((weakPoint) => isWeakPointFaceHit({
      impactedFace: face,
      weakPointFace: weakPoint.face,
    }));
  }

  private shakeCluster(cluster: BlockRuntime[], shotIndex: number) {
    for (let index = 0; index < cluster.length; index += 1) {
      const member = cluster[index];
      this.clearNeighborKick(member);
      const angle = shotIndex * 1.91 + index * 2.37;
      const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle * 1.3) * 0.45, Math.sin(angle)).normalize();
      this.neighborKicks.push({
        block: member,
        age: 0,
        delay: index * 0.012,
        amplitude: 0.72,
        duration: 0.3,
        basePosition: member.mesh.position.clone(),
        direction,
      });
    }
  }

  // Blue, unlit and additive-looking: it has to read as an energy layer over
  // whatever colour the block underneath is, and the scene's key light would
  // turn a shaded material into just another face tint.
  private spawnShield(block: BlockRuntime) {
    if (!this.shieldGeometry) {
      const side = BLOCK_SIZE * SHIELD_SCALE;
      this.shieldGeometry = new THREE.BoxGeometry(side, side, side);
      this.disposables.push(this.shieldGeometry);
    }
    // A second shot on the same block restarts its flash instead of stacking a
    // second layer, which would double the opacity and read as a solid box.
    const existing = this.shields.find((shield) => shield.block === block);
    if (existing) {
      existing.age = 0;
      return;
    }

    const material = new THREE.MeshBasicMaterial({
      color: 0x49b8ff,
      transparent: true,
      opacity: SHIELD_PEAK_OPACITY,
      depthWrite: false,
    });
    this.disposables.push(material);
    const mesh = new THREE.Mesh(this.shieldGeometry, material);
    mesh.renderOrder = 15;
    block.mesh.add(mesh);
    this.shields.push({ mesh, block, age: 0 });
  }

  private updateShields() {
    const survivors: Shield[] = [];
    for (const shield of this.shields) {
      shield.age += FIXED_STEP;
      const progress = shield.age / SHIELD_LIFETIME;
      if (progress >= 1 || !shield.block.active) {
        shield.block.mesh.remove(shield.mesh);
        shield.mesh.material.dispose();
        continue;
      }
      // Snaps on hard, then swells a little as it fades, so the block looks
      // pushed back against rather than merely tinted.
      shield.mesh.material.opacity = SHIELD_PEAK_OPACITY * (1 - progress) ** 1.6;
      shield.mesh.scale.setScalar(1 + progress * 0.1);
      survivors.push(shield);
    }
    this.shields = survivors;
  }

  private startRicochet(projectile: Projectile) {
    // TEMP prototype policy: the rebound is feedback only. It leaves the live
    // collision list immediately, flies backward briefly, then despawns rather
    // than creating a second gameplay hit.
    const index = this.projectiles.indexOf(projectile);
    if (index >= 0) this.projectiles.splice(index, 1);
    const velocityAtImpact = projectile.velocity.clone().addScaledVector(GRAVITY, projectile.time);
    velocityAtImpact.multiplyScalar(-0.28);
    velocityAtImpact.y = Math.max(velocityAtImpact.y, 1.35);
    this.ricochets.push({ mesh: projectile.mesh, velocity: velocityAtImpact, age: 0 });
  }

  private updateRicochets() {
    const survivors: Ricochet[] = [];
    for (const ricochet of this.ricochets) {
      ricochet.age += FIXED_STEP;
      ricochet.velocity.addScaledVector(GRAVITY, FIXED_STEP * 0.28);
      ricochet.mesh.position.addScaledVector(ricochet.velocity, FIXED_STEP);
      const scale = Math.max(0.05, 1 - ricochet.age / RICOCHET_LIFETIME);
      ricochet.mesh.scale.setScalar(scale);
      if (ricochet.age < RICOCHET_LIFETIME) {
        survivors.push(ricochet);
      } else {
        this.scene.remove(ricochet.mesh);
        ricochet.mesh.scale.setScalar(1);
        recycleProjectileMesh(ricochet.mesh);
      }
    }
    this.ricochets = survivors;
  }

  private handleRainbowTargetHit(target: RainbowTargetRuntime, projectile: Projectile) {
    if (!target.active || target.hit) return;
    // TEMP prototype policy: a collected target disappears immediately and its
    // hit latch makes the reward strictly single-use.
    target.hit = true;
    target.active = false;
    target.group.visible = false;
    this.armWeakPointBypass();
    this.spawnFirework(projectile.mesh.position, projectile.shotIndex * 173 + target.spawnIndex * 31);
    haptic("impact");
    this.removeProjectile(projectile);
    this.aimPreviewDirty = true;
    this.emitHookState(true);
  }

  private clearNeighborKick(block: BlockRuntime) {
    const kick = this.neighborKicks.find((candidate) => candidate.block === block);
    if (!kick) return;
    block.mesh.position.copy(kick.basePosition);
    block.mesh.scale.setScalar(1);
    block.mesh.material.emissiveIntensity = 0;
    this.neighborKicks = this.neighborKicks.filter((candidate) => candidate.block !== block);
  }

  // The shock wave a claim sends through what is left of the model: every ring
  // of blocks outward from the hole is shoved away from it, later and weaker
  // the further out it sits, so the break reads as one wave crossing the
  // cluster rather than as its immediate neighbours flinching alone.
  private sendBreakWave(cluster: BlockRuntime[]) {
    const clusterIds = new Set(cluster.map((member) => member.id));
    for (const member of cluster) this.clearNeighborKick(member);

    const clusterCenter = cluster.reduce(
      (center, member) => center.add(member.mesh.position),
      new THREE.Vector3(),
    ).multiplyScalar(1 / cluster.length);
    const ejectionDirection = clusterCenter.clone();
    ejectionDirection.y = Math.max(0.14, ejectionDirection.y * 0.18);
    if (ejectionDirection.lengthSq() < 1e-5) ejectionDirection.set(0, 0.14, 1);
    ejectionDirection.normalize();

    // This is physical contact feedback, not connected-component membership:
    // direct face contact on any world-grid axis passes the wave along.
    const offsets = PHYSICAL_FACE_NEIGHBORS;
    const reached = new Set(clusterIds);
    let front: BlockRuntime[] = cluster;
    let amplitude = 1;

    for (let ring = 0; front.length && amplitude >= WAVE_MIN_AMPLITUDE; ring += 1) {
      const nextRing = new Map<BlockRuntime, THREE.Vector3>();
      for (const member of front) {
        for (const [dx, dy, dz] of offsets) {
          const candidate = this.blockMap.get(gridKey(member.x + dx, member.y + dy, member.z + dz));
          if (!candidate?.active || reached.has(candidate.id)) continue;
          const away = nextRing.get(candidate) ?? new THREE.Vector3();
          away.add(new THREE.Vector3(dx, dy, dz));
          nextRing.set(candidate, away);
        }
      }
      // Marked only once the whole ring is collected: marking as we go would
      // let two blocks in the same ring hand the wave to each other, which
      // would turn one wave front into a crawl through the cluster.
      for (const candidate of nextRing.keys()) reached.add(candidate.id);

      for (const [candidate, away] of nextRing) {
        this.clearNeighborKick(candidate);
        if (away.lengthSq() < 1e-5) away.copy(candidate.mesh.position).sub(clusterCenter);
        const direction = away.normalize().multiplyScalar(0.35).addScaledVector(ejectionDirection, 0.65).normalize();
        this.neighborKicks.push({
          block: candidate,
          age: 0,
          delay: ring * WAVE_RING_DELAY,
          amplitude,
          duration: WAVE_DURATION,
          basePosition: candidate.mesh.position.clone(),
          direction,
        });
      }

      front = [...nextRing.keys()];
      amplitude *= WAVE_FALLOFF;
    }
  }

  private updateNeighborKicks() {
    const survivors: NeighborKick[] = [];
    for (const kick of this.neighborKicks) {
      kick.age += FIXED_STEP;
      // The wave has not arrived at this ring yet, so the block is still at
      // rest: nothing to move, and nothing to reset either.
      if (kick.age < kick.delay) {
        if (kick.block.active) survivors.push(kick);
        continue;
      }
      const progress = (kick.age - kick.delay) / kick.duration;
      if (progress >= 1 || !kick.block.active) {
        kick.block.mesh.position.copy(kick.basePosition);
        kick.block.mesh.scale.setScalar(1);
        kick.block.mesh.material.emissiveIntensity = 0;
        continue;
      }

      const kickOut = 0.24;
      const amount = progress < kickOut
        ? 1 - Math.pow(1 - progress / kickOut, 3)
        : Math.pow(1 - (progress - kickOut) / (1 - kickOut), 2)
          * (1 + Math.sin(((progress - kickOut) / (1 - kickOut)) * Math.PI * 3) * 0.1);
      kick.block.mesh.position
        .copy(kick.basePosition)
        .addScaledVector(kick.direction, amount * WAVE_PUSH * kick.amplitude);
      kick.block.mesh.scale.setScalar(1);
      kick.block.mesh.material.emissiveIntensity = 0;
      survivors.push(kick);
    }
    this.neighborKicks = survivors;
  }

  private recenterModelPivot() {
    const remaining = this.blocks.filter(
      (block) => block.active && block.mesh.parent === this.modelRoot,
    );
    if (!remaining.length) return;

    const parent = this.modelRoot.parent;
    if (!parent) return;

    const kickByBlock = new Map(
      this.neighborKicks
        .filter(
          (kick) => kick.block.active && kick.block.mesh.parent === this.modelRoot,
        )
        .map((kick) => [kick.block, kick] as const),
    );
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const block of remaining) {
      const restingPosition = kickByBlock.get(block)?.basePosition ?? block.mesh.position;
      min.min(restingPosition);
      max.max(restingPosition);
    }
    const localCenter = min.add(max).multiplyScalar(0.5);
    if (
      !Number.isFinite(localCenter.x)
      || !Number.isFinite(localCenter.y)
      || !Number.isFinite(localCenter.z)
      || localCenter.lengthSq() < 1e-12
    ) return;

    parent.updateWorldMatrix(true, false);
    this.modelRoot.updateWorldMatrix(true, false);
    const worldCenter = localCenter.clone().applyMatrix4(this.modelRoot.matrixWorld);
    for (const block of remaining) block.mesh.position.sub(localCenter);
    for (const kick of this.neighborKicks) {
      if (kick.block.active && kick.block.mesh.parent === this.modelRoot) {
        kick.basePosition.sub(localCenter);
      }
    }

    this.modelRoot.position.copy(parent.worldToLocal(worldCenter));
    this.modelRoot.updateMatrixWorld(true);
    if (this.aimPointer === null) this.resetCannonDirection();
    this.aimPreviewDirty = true;
  }

  private releaseCluster(cluster: BlockRuntime[], shotIndex: number) {
    const modelWorld = this.modelRoot.getWorldPosition(new THREE.Vector3());
    for (const member of cluster) {
      this.clearNeighborKick(member);
      member.active = false;
      for (const visual of this.weakPointVisuals) {
        if (visual.block === member) visual.group.visible = false;
      }
      member.mesh.material.emissive.setHex(COLOR_HEX[member.color]);
      member.mesh.material.emissiveIntensity = 0.55;
      this.scene.attach(member.mesh);
      const seed = shotIndex * 97 + member.x * 17 + member.y * 31 + member.z * 53;
      const radial = member.mesh.position.clone().sub(modelWorld).setY(0).normalize();
      const jitterX = seededUnit(seed) - 0.5;
      const jitterZ = seededUnit(seed + 1) - 0.5;
      this.releasedBlocks.push({
        block: member,
        velocity: new THREE.Vector3(
          radial.x * 0.45 + jitterX * 0.45,
          2.8 + seededUnit(seed + 2) * 0.75,
          radial.z * 0.45 + jitterZ * 0.45,
        ),
        angularVelocity: new THREE.Vector3(
          (seededUnit(seed + 3) - 0.5) * 6,
          (seededUnit(seed + 4) - 0.5) * 6,
          (seededUnit(seed + 5) - 0.5) * 6,
        ),
        age: 0,
      });
    }
    this.recenterModelPivot();
  }

  private handleHit(block: BlockRuntime, projectile: Projectile) {
    // Fired before the branch below, because a shot refused by a full reserve
    // and a shot that claimed a cluster both landed, and both should show it.
    this.playImpactEffect(projectile.mesh.position, projectile.shotIndex);

    const cluster = this.findCluster(block);
    if (!cluster.length) return;

    haptic("impact");
    const faceHit = this.projectileHitWeakPoint(block, projectile);
    // Read and spend in one place. Continuous fire can land two balls in the
    // same step, and only the first of them may use the bypass.
    const bypassArmed = this.weakPointBypassArmed;
    const impactResolution = resolveBlockImpact(bypassArmed, faceHit);
    if (bypassArmed) this.consumeWeakPointBypass();
    if (impactResolution === "RICOCHET_SHAKE") {
      this.shakeCluster(cluster, projectile.shotIndex);
      // The guard goes on the block that was actually struck, not the cluster:
      // the shake already says "this group held", the shield says "here".
      this.spawnShield(block);
      this.startRicochet(projectile);
      this.aimPreviewDirty = true;
      return;
    }

    // Claim immediately so another projectile cannot resolve this cluster twice.
    this.sendBreakWave(cluster);
    this.releaseCluster(cluster, projectile.shotIndex);
    // The ball bounces off a Weak Point too. It used to blink out at the moment
    // of the hit, which read as the ball being consumed by the block instead of
    // breaking it, so the one shot that works had the weakest feedback.
    this.startRicochet(projectile);
    this.aimPreviewDirty = true;

    const claimed = [cluster];
    this.state = {
      ...this.state,
      remainingBlockCount: this.blocks.filter((candidate) => candidate.active).length,
    };

    for (const group of claimed) {
      this.impactSequence += 1;
      this.pendingResolutions.push({
        result: {
          color: group[0].color,
          count: group.length,
          shotIndex: projectile.shotIndex,
          remainingBlockCount: this.state.remainingBlockCount,
        },
        countdown: 0.24,
        impactSequence: this.impactSequence,
        animationStarted: false,
        sourceBlocks: [...group],
      });
    }
    this.callbacks.onState(this.cloneState());
  }

  private ensureSmokeResources() {
    if (this.smokeGeometry) return;
    // One unit-diameter ball per puff, scaled at runtime. Round, and solid
    // geometry rather than a sprite, so the puff keeps its own silhouette from
    // every angle the model can be turned to.
    this.smokeGeometry = new THREE.SphereGeometry(0.5, 12, 9);
    // Unlit on purpose. A shaded box takes the scene's blue key and hemisphere
    // light and stops reading as white at all.
    this.smokeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.disposables.push(this.smokeGeometry, this.smokeMaterial);
  }

  // `origin` is a world point. `spread` is how hard the puffs push outward and
  // `rise` how much of that goes upward, which is the whole difference between
  // a puff off a block face and one rolling along the floor.
  // `startScale` is the fraction of `size` a puff is born at: an impact blooms
  // from small to full, while a trail puff is born at its full size and only
  // collapses — a growing trail puff makes the line widen behind the ball,
  // which reads as a thick wedge rather than a thin trail.
  private spawnSmoke(
    origin: THREE.Vector3,
    seed: number,
    options: {
      count: number;
      size: number;
      spread: number;
      rise: number;
      life?: number;
      startScale?: number;
    },
  ) {
    this.ensureSmokeResources();
    for (let puff = 0; puff < options.count; puff += 1) {
      const step = seed + puff * 17;
      // Spread evenly around the impact and then jittered, so the ring never
      // looks like a diagram of itself.
      const angle = (puff / options.count) * Math.PI * 2 + seededUnit(step) * 1.4;
      const reach = 0.2 + seededUnit(step + 1) * 0.5;
      const mesh = new THREE.Mesh(this.smokeGeometry!, this.smokeMaterial!);
      mesh.position.copy(origin).add(new THREE.Vector3(
        Math.cos(angle) * reach * options.spread * 0.3,
        (seededUnit(step + 2) - 0.2) * 0.14,
        Math.sin(angle) * reach * options.spread * 0.3,
      ));
      const size = options.size * (0.7 + seededUnit(step + 6) * 0.6);
      const fromScale = size * (options.startScale ?? 0.35);
      mesh.scale.setScalar(fromScale);
      this.scene.add(mesh);
      this.smoke.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * options.spread * (0.8 + seededUnit(step + 7) * 0.6),
          options.rise * (0.6 + seededUnit(step + 8) * 0.8),
          Math.sin(angle) * options.spread * (0.8 + seededUnit(step + 9) * 0.6),
        ),
        fromScale,
        toScale: size,
        age: 0,
        life: options.life ?? SMOKE_LIFETIME,
      });
    }
  }

  // Every shot that lands puffs, whether it broke anything or not.
  private spawnImpactSmoke(point: THREE.Vector3, shotIndex: number) {
    this.spawnSmoke(point, shotIndex * 137 + 11, {
      count: 7,
      size: BLOCK_SIZE * 0.42,
      spread: 1.5,
      rise: 1.1,
    });
  }

  private ensureSparkleResources() {
    if (this.sparkleGeometry) return;
    // A shard, not a ball: flat faces catch the light as it spins, which is
    // what separates a spark from a puff of smoke.
    this.sparkleGeometry = new THREE.OctahedronGeometry(0.5);
    this.disposables.push(this.sparkleGeometry);
    this.sparkleMaterials = SPARKLE_COLORS.map((color) => {
      const material = new THREE.MeshBasicMaterial({ color });
      this.disposables.push(material);
      return material;
    });
  }

  // `speed` is how hard the shards leave the point, `rise` how much of that is
  // upward, and `gravity` whether they arc back down — a bling burst floats, a
  // firework falls.
  private spawnSparkles(
    origin: THREE.Vector3,
    seed: number,
    options: {
      count: number;
      size: number;
      speed: number;
      rise: number;
      life: number;
      gravity: number;
      spread?: number;
    },
  ) {
    this.ensureSparkleResources();
    const spread = options.spread ?? 1;
    for (let shard = 0; shard < options.count; shard += 1) {
      const step = seed + shard * 23;
      const material = this.sparkleMaterials[shard % this.sparkleMaterials.length];
      const mesh = new THREE.Mesh(this.sparkleGeometry!, material);
      const angle = (shard / options.count) * Math.PI * 2 + seededUnit(step) * 1.6;
      const lift = seededUnit(step + 1) * 2 - 1;
      const size = options.size * (0.6 + seededUnit(step + 2) * 0.8);
      mesh.position.copy(origin).add(new THREE.Vector3(
        Math.cos(angle) * spread * 0.16,
        (seededUnit(step + 3) - 0.5) * spread * 0.2,
        Math.sin(angle) * spread * 0.16,
      ));
      mesh.rotation.set(seededUnit(step + 4) * Math.PI, seededUnit(step + 5) * Math.PI, 0);
      mesh.scale.setScalar(size);
      this.scene.add(mesh);
      this.sparkles.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * options.speed * (0.7 + seededUnit(step + 6) * 0.6),
          options.rise + lift * options.speed * 0.35,
          Math.sin(angle) * options.speed * (0.7 + seededUnit(step + 6) * 0.6),
        ),
        spin: new THREE.Vector3(
          (seededUnit(step + 7) - 0.5) * 12,
          (seededUnit(step + 8) - 0.5) * 12,
          (seededUnit(step + 9) - 0.5) * 12,
        ),
        gravity: options.gravity,
        size,
        age: 0,
        life: options.life,
      });
    }
  }

  // The ray the wand leaves along its whole flight, not only on the way down:
  // this is the shot itself being magic, not the shot falling.
  private spawnSparkleTrail(point: THREE.Vector3, seed: number) {
    this.spawnSparkles(point, seed, {
      count: 2,
      size: 0.09,
      speed: 0.35,
      rise: 0.1,
      life: 0.26,
      gravity: -1.2,
      spread: 0.5,
    });
  }

  // Bling: the landing itself, floating outward rather than dropping.
  private spawnSparkleBurst(point: THREE.Vector3, seed: number) {
    this.spawnSparkles(point, seed, {
      count: 12,
      size: 0.15,
      speed: 2.4,
      rise: 1.1,
      life: 0.5,
      gravity: -2.4,
      spread: 1.2,
    });
  }

  // A shot that ended on the floor goes out with a small firework: wider and
  // faster than the bling, and it falls, which is what makes it read as an
  // explosion rather than as a shimmer.
  private spawnFirework(point: THREE.Vector3, seed: number) {
    this.spawnSparkles(point, seed, {
      count: 18,
      size: 0.13,
      speed: 3.6,
      rise: 2.2,
      life: 0.72,
      gravity: -7,
      spread: 0.8,
    });
    // One bright core, gone almost at once, so the burst has a flash at its
    // centre instead of only an outline.
    this.spawnSparkles(point, seed + 401, {
      count: 3,
      size: 0.4,
      speed: 0.5,
      rise: 0.4,
      life: 0.16,
      gravity: 0,
      spread: 0.2,
    });
  }

  private updateSparkles() {
    const survivors: Sparkle[] = [];
    for (const sparkle of this.sparkles) {
      sparkle.age += FIXED_STEP;
      const progress = sparkle.age / sparkle.life;
      if (progress >= 1) {
        // Geometry and materials are shared per engine; dispose() frees them
        // once, so only the node leaves here.
        this.scene.remove(sparkle.mesh);
        continue;
      }
      sparkle.velocity.multiplyScalar(SPARKLE_DRAG);
      sparkle.velocity.y += sparkle.gravity * FIXED_STEP;
      sparkle.mesh.position.addScaledVector(sparkle.velocity, FIXED_STEP);
      sparkle.mesh.rotation.x += sparkle.spin.x * FIXED_STEP;
      sparkle.mesh.rotation.y += sparkle.spin.y * FIXED_STEP;
      sparkle.mesh.rotation.z += sparkle.spin.z * FIXED_STEP;
      // Solid to the last frame, like the smoke: it goes out by getting small.
      sparkle.mesh.scale.setScalar(Math.max(0.001, sparkle.size * (1 - progress * progress)));
      survivors.push(sparkle);
    }
    this.sparkles = survivors;
  }

  // Which of the two effect families a landing, a trail or a muzzle belongs to.
  // Every branch below asks this one question instead of naming a skin.
  private isMagic() {
    return this.cosmetic.flavor === "magic";
  }

  private playImpactEffect(point: THREE.Vector3, seed: number) {
    if (this.isMagic()) this.spawnSparkleBurst(point, seed);
    else this.spawnImpactSmoke(point, seed);
  }

  private playGroundEffect(point: THREE.Vector3, seed: number) {
    if (this.isMagic()) this.spawnFirework(point, seed);
    else this.spawnGroundSmoke(point, seed);
  }

  // One small puff dropped behind a falling shot: smaller than the ball itself,
  // held tight to the path, born at full size and only shrinking. All four of
  // those keep the trail a thin dotted line instead of a thick wedge.
  private spawnFallTrail(point: THREE.Vector3, seed: number) {
    this.spawnSmoke(point, seed, {
      count: 1,
      size: PROJECTILE_RADIUS * 0.95,
      spread: 0.14,
      rise: 0.28,
      life: FALL_TRAIL_LIFETIME,
      startScale: 1,
    });
  }

  // Wider and flatter than an impact: a shot that got under the cluster skids
  // into the floor, so the smoke rolls out sideways instead of blooming up.
  private spawnGroundSmoke(point: THREE.Vector3, shotIndex: number) {
    this.spawnSmoke(point, shotIndex * 211 + 7, {
      count: 9,
      size: BLOCK_SIZE * 0.5,
      spread: 2.6,
      rise: 0.4,
    });
  }

  private updateSmoke() {
    const survivors: SmokePuff[] = [];
    for (const puff of this.smoke) {
      puff.age += FIXED_STEP;
      const progress = puff.age / puff.life;
      if (progress >= 1) {
        // Geometry and material are shared per engine, so only the node goes;
        // dispose() releases the pair once.
        this.scene.remove(puff.mesh);
        continue;
      }
      puff.velocity.multiplyScalar(SMOKE_DRAG);
      puff.mesh.position.addScaledVector(puff.velocity, FIXED_STEP);
      const grown = THREE.MathUtils.lerp(puff.fromScale, puff.toScale, 1 - Math.pow(1 - progress, 2));
      // The puff leaves by shrinking, never by turning transparent, which is
      // what keeps the white solid from the first frame to the last.
      const collapse = progress < 0.55 ? 1 : Math.pow(1 - (progress - 0.55) / 0.45, 1.4);
      puff.mesh.scale.setScalar(Math.max(0.001, grown * collapse));
      survivors.push(puff);
    }
    this.smoke = survivors;
  }

  private handleMiss(projectile: Projectile) {
    this.removeProjectile(projectile);
  }

  private removeProjectile(projectile: Projectile) {
    const index = this.projectiles.indexOf(projectile);
    if (index >= 0) this.projectiles.splice(index, 1);
    this.scene.remove(projectile.mesh);
    recycleProjectileMesh(projectile.mesh);
  }

  private updateReleasedBlocks() {
    const survivors: ReleasedBlock[] = [];
    for (const released of this.releasedBlocks) {
      const { mesh } = released.block;
      released.age += FIXED_STEP;
      released.velocity.x *= 0.996;
      released.velocity.z *= 0.996;
      mesh.position.addScaledVector(released.velocity, FIXED_STEP);
      mesh.rotation.x += released.angularVelocity.x * FIXED_STEP;
      mesh.rotation.y += released.angularVelocity.y * FIXED_STEP;
      mesh.rotation.z += released.angularVelocity.z * FIXED_STEP;

      if (released.age > 0.18) {
        const scale = THREE.MathUtils.clamp(1 - (released.age - 0.18) / 0.52, 0, 1);
        mesh.scale.setScalar(scale);
      }
      if (released.age < 0.72) survivors.push(released);
      else {
        this.scene.remove(mesh);
        mesh.material.dispose();
      }
    }
    this.releasedBlocks = survivors;
  }

  private projectBlockToScreen(block: BlockRuntime) {
    const projected = block.mesh.getWorldPosition(new THREE.Vector3()).project(this.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * this.host.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * this.host.clientHeight,
    };
  }

  private createSortAnimation(pending: PendingResolution): SortAnimationEvent | null {
    const { result } = pending;
    const transfers: SortTransfer[] = [];
    // The same split resolveCluster will apply, so the flight can never show a
    // share of the claim the state does not go on to record.
    const split = planClusterSplit(this.level, this.state, result.color, result.count);

    if (split.goalSlot >= 0 && split.toGoal > 0) {
      const goal = this.state.activeGoals[split.goalSlot]!;
      transfers.push({ kind: "goal", slot: split.goalSlot, goalId: goal.id, fromCount: goal.current, count: split.toGoal });
    }
    // Drawn even when it does not fit: those cubes are what the player is
    // about to lose the level over, and a silent claim would be the last thing
    // they see before the panel.
    if (split.excess > 0) {
      transfers.push({ kind: "reserve", count: split.excess });
    }
    if (!transfers.length) return null;

    return {
      key: pending.impactSequence,
      color: result.color,
      sources: pending.sourceBlocks.map((block) => this.projectBlockToScreen(block)),
      transfers,
      flightMs: SORT_FLIGHT_MS,
      staggerMs: SORT_STAGGER_MS,
    };
  }

  // One resolution can finish a goal, spill into a batch and fill the last
  // batch slot all at once. navigator.vibrate() replaces whatever is already
  // running, so firing several patterns here would only leave the last one
  // felt. Exactly one buzz goes out, picked by how much the player needs to
  // know: the level ending first, then the batch warning, then progress.
  private emitResolutionHaptics(before: GameState, after: GameState) {
    if (!before.result && after.result) {
      haptic(after.result.kind === "WIN" ? "win" : "lose");
      return;
    }

    // Counted in blocks, so a claim that only tops the reserve up still buzzes
    // as "full" once it reaches the budget.
    const parkedBefore = parkedBlockCount(before);
    const parkedAfter = parkedBlockCount(after);
    const batchesAdded = parkedAfter > parkedBefore;
    if (batchesAdded && parkedAfter >= this.level.reserveBlocks) {
      haptic("batchFull");
      return;
    }

    const goalFinished = before.activeGoals.some((goal, slot) => {
      if (!goal) return false;
      const next = after.activeGoals[slot];
      return !next || next.id !== goal.id;
    });
    if (goalFinished) {
      haptic("goalComplete");
      return;
    }

    if (batchesAdded) haptic("batchCreated");
  }

  private resolvePending() {
    // A batch in flight owns the screen until it lands.
    if (this.batchFlight || !this.pendingResolutions.length) return;
    if (this.level.resolutionOrder !== "IMPACT_TIME_THEN_SHOT_ID_TEMP") {
      throw new Error(`Unsupported temporary resolution order: ${this.level.resolutionOrder}`);
    }
    // TODO(design): Official simultaneous-impact ordering remains unconfirmed.
    this.pendingResolutions.sort((a, b) => a.impactSequence - b.impactSequence || a.result.shotIndex - b.result.shotIndex);
    let processed = false;
    while (this.pendingResolutions[0]?.countdown <= 0) {
      const head = this.pendingResolutions[0];
      if (!head.animationStarted) {
        head.animationStarted = true;
        const animation = this.createSortAnimation(head);
        if (animation) {
          this.callbacks.onSort(animation);
          const transferCount = animation.transfers.reduce((total, transfer) => total + transfer.count, 0);
          head.countdown = (animation.flightMs + Math.max(0, transferCount - 1) * animation.staggerMs + 90) / 1000;
          break;
        }
      }

      processed = true;
      const pending = this.pendingResolutions.shift()!;
      const stateBeforeResolve = this.state;
      // Auto-fill is left out here and driven one step at a time below, so the
      // board never jumps from "batch full" to "next goal open" with nothing to
      // watch in between.
      const resolvedState = resolveCluster(this.level, this.state, pending.result, false);
      this.state = this.aimPointer !== null && !resolvedState.result
        ? { ...resolvedState, phase: "AIMING" }
        : resolvedState;
      this.emitResolutionHaptics(stateBeforeResolve, this.state);
      if (this.state.result) {
        this.stopHookForResult();
        if (this.state.result.kind === "WIN" && this.state.postWinClearing) {
          this.autoClearCountdown = 0.12;
          this.autoClearFinishCountdown = 0;
        }
        break;
      }
    }
    if (!processed) return;
    this.callbacks.onState(this.cloneState());
    this.updateAimPreview();
  }

  // Runs after the shot's own transaction has been shown: each batch that is due
  // to empty into a goal gets its own flight, and its state change is applied
  // only once that flight has landed.
  private updateBatchFlight() {
    if (this.batchFlight) {
      this.batchFlight.countdown -= FIXED_STEP;
      if (this.batchFlight.countdown > 0) return;
      const { transfer } = this.batchFlight;
      this.batchFlight = null;
      const before = this.state;
      const filled = applyBatchAutoFill(this.level, this.state, transfer);
      if (filled === before) return;
      this.state = filled;
      this.emitResolutionHaptics(before, filled);
      if (this.state.result) this.stopHookForResult();
      if (this.state.result?.kind === "WIN" && this.state.postWinClearing) {
        this.autoClearCountdown = 0.12;
        this.autoClearFinishCountdown = 0;
      }
      this.callbacks.onState(this.cloneState());
      return;
    }

    // Nothing may start while a cluster is still resolving, or two different
    // explanations would be on screen at once.
    if (this.pendingResolutions.length || this.state.result) return;
    const transfer = nextBatchAutoFill(this.level, this.state);
    if (!transfer) return;

    // Kept under a second whatever the batch holds: the stagger shrinks as the
    // count grows instead of the tail running on.
    const staggerMs = transfer.count > 1
      ? Math.min(BATCH_STAGGER_MS, (BATCH_FLIGHT_BUDGET_MS - BATCH_FLIGHT_MS) / (transfer.count - 1))
      : 0;
    this.batchKey += 1;
    this.batchFlight = {
      transfer,
      countdown: (BATCH_FLIGHT_MS + staggerMs * (transfer.count - 1) + BATCH_FLIGHT_TAIL_MS) / 1000,
    };
    this.callbacks.onBatchFlight({
      key: this.batchKey,
      color: transfer.color,
      batchId: transfer.batchId,
      goalId: transfer.goalId,
      goalSlot: transfer.goalSlot,
      count: transfer.count,
      goalFromCount: transfer.goalFromCount,
      flightMs: BATCH_FLIGHT_MS,
      staggerMs,
    });
  }

  private updateAutoClear() {
    if (this.batchFlight) return;
    if (!this.state.postWinClearing || this.state.result?.kind !== "WIN") return;
    if (this.level.postWinAutoClearPattern !== "STABLE_CLUSTER_CADENCE_TEMP") {
      throw new Error(`Unsupported temporary auto-clear pattern: ${this.level.postWinAutoClearPattern}`);
    }
    const remaining = this.blocks.filter((block) => block.active);
    if (remaining.length) {
      this.autoClearCountdown -= FIXED_STEP;
      if (this.autoClearCountdown > 0) return;
      // TODO(design): Auto-clear pattern/speed are presentation choices pending
      // tuning; the prototype uses stable block order and a short cadence.
      const cluster = this.findCluster(remaining[0]);
      this.releaseCluster(cluster, 10000 + this.impactSequence);
      this.recoil = 1;
      this.state = { ...this.state, remainingBlockCount: remaining.length - cluster.length };
      this.callbacks.onState(this.cloneState());
      this.autoClearCountdown = 0.18;
      return;
    }

    if (this.autoClearFinishCountdown === 0) this.autoClearFinishCountdown = 1.75;
    this.autoClearFinishCountdown -= FIXED_STEP;
    if (this.autoClearFinishCountdown <= 0) {
      this.state = {
        ...this.state,
        postWinClearing: false,
        remainingBlockCount: 0,
        result: { kind: "WIN", allClear: true },
      };
      this.callbacks.onState(this.cloneState());
    }
  }

  private setPhase(phase: GamePhase) {
    this.state = { ...this.state, phase };
    this.callbacks.onState(this.cloneState());
  }

  private cloneState(): GameState {
    return {
      ...this.state,
      activeGoals: this.state.activeGoals.map((goal) => (goal ? { ...goal } : null)),
      batches: this.state.batches.map((batch) => ({ ...batch })),
      result: this.state.result ? { ...this.state.result } : null,
      lastEvents: [...this.state.lastEvents],
    };
  }

  private resize() {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 0.62 ? 40 : 37;
    this.camera.updateProjectionMatrix();
    this.updateRainbowTargets();
    if (this.state.phase === "AIMING") {
      this.updateAimGesture(this.aimCurrent.x, this.aimCurrent.y);
    } else if (this.introActive) {
      // The resting aim is solved by raycasting the cluster, so re-solving it
      // mid-intro would point the cannon at a model that is still turning and
      // still growing — the turret would swing to a pose that is wrong by the
      // time the frame is drawn, then swing back when the intro lands. The
      // observer's own first callback arrives right inside that window, which
      // is what made a level swap look like the cannon was twitching. The end
      // of the intro re-aims once, against the settled cluster.
      this.showIdleCrosshair();
    } else {
      this.resetCannonDirection();
      this.showIdleCrosshair();
    }
  }

  private animate = () => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const frameDelta = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    if (this.nextShotAt > 0 && now >= this.nextShotAt) {
      this.nextShotAt = 0;
      this.aimZone.classList.remove("is-cooling-down");
      this.crosshair.classList.remove("is-cooling-down");
    }

    // Runs outside the paused branch: the menu keeps turning even with a dialog
    // open, which is what makes the screen feel alive rather than frozen.
    if (this.idle) {
      this.idleSpinDelta.setFromAxisAngle(this.worldUp, frameDelta * MENU_SPIN_SPEED);
      this.modelRoot.quaternion.premultiply(this.idleSpinDelta).normalize();
    }
    // Also outside the paused branch, for the same reason: the picker has to
    // keep moving while it is open.
    if (this.showcase) {
      this.showcaseTime += frameDelta;
      this.cannonRoot.rotation.y = Math.sin(this.showcaseTime * SHOWCASE_SWAY_SPEED) * SHOWCASE_SWAY;
    }
    // Frozen while a dialog is open so the intro resumes where it left off.
    if (this.introActive && !this.paused) {
      // The frame an intro starts on is the frame that built this engine,
      // committed React's tree and laid out the new HUD. Its delta is that
      // cost, not an animation step, so it is spent on setting the clock
      // rather than on the easing — otherwise every entrance opens with a jump
      // proportional to how slow the level swap was.
      if (this.introClockPending) this.introClockPending = false;
      else this.updateIntro(frameDelta);
    }

    if (!this.paused) {
      this.accumulator += frameDelta;
      while (this.accumulator >= FIXED_STEP) {
        this.updateTimedGameplayStep();
        if (this.showcase) this.updateShowcase();
        if (this.smoke.length) this.updateSmoke();
        if (this.sparkles.length) this.updateSparkles();
        if (this.ricochets.length) this.updateRicochets();
        if (this.shields.length) this.updateShields();
        if (this.releasedBlocks.length) this.updateReleasedBlocks();
        if (this.neighborKicks.length) this.updateNeighborKicks();
        if (this.pendingResolutions.length) {
          this.pendingResolutions.forEach((pending) => { pending.countdown -= FIXED_STEP; });
          this.resolvePending();
        }
        this.updateBatchFlight();
        this.updateAutoClear();
        this.accumulator -= FIXED_STEP;
      }
      this.recoil = Math.max(0, this.recoil - frameDelta * 5.5);
      this.barrelVisual.position.z = this.recoil * RECOIL_TRAVEL;
      if (this.aimPreviewDirty) this.updateAimPreview();
    }

    this.renderer.render(this.scene, this.camera);
  };

  resetView() {
    if (!this.canRotateModel()) return;
    this.modelRoot.quaternion.copy(this.defaultModelOrientation);
    this.updateAimPreview();
  }

  setControlSensitivity(next: Partial<ControlSensitivity>) {
    if (Number.isFinite(next.modelRotate)) {
      this.modelRotateSensitivity = THREE.MathUtils.clamp(
        next.modelRotate!,
        MIN_CONTROL_SENSITIVITY,
        MAX_CONTROL_SENSITIVITY,
      );
    }
    if (Number.isFinite(next.aimDrag)) {
      this.aimDragSensitivity = THREE.MathUtils.clamp(
        next.aimDrag!,
        MIN_CONTROL_SENSITIVITY,
        MAX_CONTROL_SENSITIVITY,
      );
    }
    if (this.aimPointer !== null && this.state.phase === "AIMING") {
      this.updateAimGesture(this.aimCurrent.x, this.aimCurrent.y);
    }
  }

  pause() {
    if (this.paused || (this.state.result && !this.state.postWinClearing)) return false;
    this.phaseBeforePause = this.state.phase === "AIMING" ? "PLAYING" : this.state.phase;
    if (this.aimPointer !== null) this.clearAimGesture(true);
    if (this.modelPointer !== null) this.clearModelGesture();
    this.paused = true;
    this.setPhase("PAUSED");
    return true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.lastFrame = performance.now();
    this.setPhase(this.phaseBeforePause === "AIMING" ? "PLAYING" : this.phaseBeforePause);
    this.updateAimPreview();
  }

  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    if (this.aimPointer !== null) this.clearAimGesture(false);
    if (this.modelPointer !== null) this.clearModelGesture();
    this.modelZone.removeEventListener("pointerdown", this.onModelPointerDown);
    this.modelZone.removeEventListener("pointermove", this.onModelPointerMove);
    this.modelZone.removeEventListener("pointerup", this.onModelPointerEnd);
    this.modelZone.removeEventListener("pointercancel", this.onModelPointerEnd);
    this.modelZone.removeEventListener("lostpointercapture", this.onModelPointerEnd);
    this.aimZone.removeEventListener("pointerdown", this.onAimPointerDown);
    this.aimZone.removeEventListener("pointermove", this.onAimPointerMove);
    this.aimZone.removeEventListener("pointerup", this.onAimPointerUp);
    this.aimZone.removeEventListener("pointercancel", this.onAimPointerCancel);
    this.aimZone.removeEventListener("lostpointercapture", this.onAimPointerCancel);
    this.aimZone.classList.remove("is-aiming", "is-cancelled", "is-cooling-down");
    this.crosshair.classList.remove(
      "is-visible",
      "is-engaged",
      "is-aiming",
      "is-target-valid",
      "is-cooling-down",
      "is-blocked",
      // The crosshair element outlives the engine, so the skin's mark on it
      // goes back too.
      "is-magic",
    );
    this.projectiles.slice().forEach((projectile) => this.removeProjectile(projectile));
    for (const ricochet of this.ricochets) {
      this.scene.remove(ricochet.mesh);
      ricochet.mesh.scale.setScalar(1);
      recycleProjectileMesh(ricochet.mesh);
    }
    this.ricochets = [];
    // Showcase shots come out of the same pool, so they have to leave the scene
    // here too: the sweep below disposes whatever it finds, and the projectile
    // geometry and materials are shared with every other level on the page.
    this.clearShowcaseShots();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      const renderable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      if (renderable.geometry) geometries.add(renderable.geometry);
      if (renderable.material) {
        const list = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        list.forEach((material) => materials.add(material));
      }
    });
    this.blocks.forEach((block) => {
      geometries.add(block.mesh.geometry);
      materials.add(block.mesh.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    // Shared Weak Point/target/particle resources are held here as well as in
    // the scene graph, so a marker already detached by a break cannot leak.
    this.disposables.forEach((resource) => resource.dispose());
    // The renderer outlives this engine, so it is handed back rather than
    // disposed. Pooled projectiles already left the scene above, which keeps
    // the sweep from disposing shared resources.
    releaseRenderer(this);
  }
}
