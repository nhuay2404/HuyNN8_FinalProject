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
import { acquireRenderer, releaseRenderer } from "./renderer-pool";
import { applyBatchAutoFill, createGameState, nextBatchAutoFill, resolveCluster } from "./rules";
import type {
  BatchTransfer,
  BlockColor,
  BlockRuntime,
  ClusterResult,
  GamePhase,
  GameState,
  LevelConfig,
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
const AIM_PREDICTION_DURATION = 2.2;
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

// The shell is opaque, so the only thing telling the player how much cover is
// left is its shade: darkest at full depth, near white on the last layer.
const BARREL_LAYER_COLORS = [0xd8dae0, 0x74777f, 0x1c1d22];
const BARREL_DEBRIS_COLORS = [0xb9bcc4, 0x6a6d75, 0x2a2b31];
const DEBRIS_GRAVITY = -13;
const DEBRIS_LIFETIME = 0.85;

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

// Candidate faces for mounting the strap that joins a linked pair, in the
// order they are preferred, which is how visible each face is: the camera sits
// at +z and above the model, and the authored orientation yaws the model so
// its +x side turns toward the lens. The back and the underside are last
// because nothing there can be seen without the player rotating the cluster.
const FACE_DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 1], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, -1, 0],
];

// One strap joins one linked pair. Two pads bolted to the outside of the two
// blocks and a spine across the gap: how far out the pads sit, how much the
// spine overhangs them, and how far off the link axis a face may point and
// still count as somewhere the strap can lie flat.
const LINK_PAD_REACH = BLOCK_SIZE * 0.52;
const LINK_PAD_REACH_OVER_SHELL = BLOCK_SIZE * 0.58;
const LINK_SPINE_OVERHANG = BLOCK_SIZE * 0.1;
const LINK_MOUNT_MAX_AXIS_DOT = 0.35;

const COLOR_HEX: Record<BlockColor, number> = {
  red: 0xff3d4d,
  green: 0x24e07f,
  yellow: 0xffd21f,
  blue: 0x2f9dff,
  purple: 0x9d5cff,
  orange: 0xff8a1f,
};

export type SortTransfer =
  | { kind: "goal"; slot: number; goalId: string; fromCount: number; count: number }
  | { kind: "batch"; slot: number; count: number };

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

// A shattered barrel layer, or a link fitting that came off its block. Both
// just fall away under gravity and fade out.
type DebrisPiece = {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
};

// The one strap that joins a linked pair. It is not parented to either block:
// both ends have to be honoured, and each block can be moved on its own by the
// break wave, so the strap is placed from the two live positions every frame.
// One candidate way to bolt a strap on: which two blocks it would join, which
// face it would lie on, and how good that is (see chooseLinkAnchors).
type LinkAnchors = {
  from: BlockRuntime;
  to: BlockRuntime;
  mount: THREE.Vector3;
  rank: number;
  distance: number;
};

type LinkBridge = {
  group: string;
  from: BlockRuntime;
  to: BlockRuntime;
  // The face the strap lies on, in model space, picked once at build time.
  mount: THREE.Vector3;
  root: THREE.Group;
  spine: THREE.Mesh;
  padFrom: THREE.Mesh;
  padTo: THREE.Mesh;
};

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

// Drawn at runtime instead of loaded, because the whole game ships as one HTML
// file with no external assets. Greyscale only, so the material's colour is
// what decides the shade and one texture serves every barrel depth.
function makePlatingTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);

  // Brushed streaks give the surface a direction without adding colour.
  context.strokeStyle = "rgba(0,0,0,0.09)";
  context.lineWidth = 1;
  for (let y = 2; y < size; y += 4) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(size, y + 0.5);
    context.stroke();
  }
  // A rim and corner bolts read as a plate rather than a painted cube.
  context.strokeStyle = "rgba(0,0,0,0.3)";
  context.lineWidth = 3;
  context.strokeRect(1.5, 1.5, size - 3, size - 3);
  context.fillStyle = "rgba(0,0,0,0.38)";
  for (const [x, y] of [[9, 9], [size - 9, 9], [9, size - 9], [size - 9, size - 9]]) {
    context.beginPath();
    context.arc(x, y, 2.6, 0, Math.PI * 2);
    context.fill();
  }

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
  private readonly defaultModelOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, -0.36, 0));
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly cameraRight = new THREE.Vector3();
  private readonly modelYawDelta = new THREE.Quaternion();
  private readonly modelPitchDelta = new THREE.Quaternion();
  private readonly resizeObserver: ResizeObserver;
  private state: GameState;
  private projectiles: Projectile[] = [];
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
  // Shared across every barrel and link marker in the level, so a shell that
  // breaks never disposes something another block is still drawing with. All of
  // them are released together in dispose().
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private barrelShellGeometry: THREE.BoxGeometry | null = null;
  private barrelShellMaterials: THREE.MeshLambertMaterial[] = [];
  private debris: DebrisPiece[] = [];
  private debrisGeometry: THREE.BoxGeometry | null = null;
  private debrisMaterials: THREE.MeshLambertMaterial[] = [];
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
  private linkBridges: LinkBridge[] = [];
  private linkStrapParts: {
    pad: THREE.BoxGeometry;
    spine: THREE.BoxGeometry;
    loop: THREE.TorusGeometry;
    metal: THREE.MeshLambertMaterial;
    rivet: THREE.MeshLambertMaterial;
  } | null = null;

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
    this.buildCannon();
    this.bindInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.updateAimPreview();
    this.callbacks.onState(this.cloneState());
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

      const block: BlockRuntime = {
        ...spec,
        active: true,
        mesh,
        barrelLeft: spec.barrelLayers ?? 0,
      };
      if (block.barrelLeft > 0) block.barrelShell = this.attachBarrelShell(mesh, block.barrelLeft);
      this.blocks.push(block);
      this.blockMap.set(gridKey(spec.x, spec.y, spec.z), block);
    }

    // Straps need every block registered first: which two blocks a link joins,
    // and which face the strap can lie on, are both answered by looking around
    // the finished cluster.
    this.buildLinkBridges();
  }

  private axisCentre(values: number[]) {
    if (!values.length) return 0;
    return (Math.min(...values) + Math.max(...values)) / 2;
  }

  // The shell is fully opaque: what colour hides under it is not readable until
  // it breaks. Only its shade changes with depth, from black at three layers to
  // near white on the last one, so remaining cover is legible without a HUD.
  private attachBarrelShell(mesh: THREE.Mesh, layers: number) {
    if (!this.barrelShellGeometry) {
      const size = BLOCK_SIZE * 1.1;
      this.barrelShellGeometry = new THREE.BoxGeometry(size, size, size);
      this.disposables.push(this.barrelShellGeometry);
      const plating = makePlatingTexture();
      this.disposables.push(plating);
      this.barrelShellMaterials = BARREL_LAYER_COLORS.map((color) => {
        const material = new THREE.MeshLambertMaterial({ color, map: plating });
        this.disposables.push(material);
        return material;
      });
    }
    const shell = new THREE.Mesh(this.barrelShellGeometry, this.shellMaterialFor(layers));
    mesh.add(shell);
    return shell;
  }

  private shellMaterialFor(layers: number) {
    const index = THREE.MathUtils.clamp(layers - 1, 0, this.barrelShellMaterials.length - 1);
    return this.barrelShellMaterials[index];
  }

  // A link is one physical strap: two riveted pads bolted to the outside of
  // the two joined blocks, and a spine running across the gap between them.
  // One strap per pair — hardware bolted onto every exposed face read as studs
  // on every block instead of as a join between two particular ones.
  private buildLinkBridges() {
    const groups = new Map<string, BlockRuntime[]>();
    for (const block of this.blocks) {
      if (!block.linkGroup) continue;
      const members = groups.get(block.linkGroup) ?? [];
      members.push(block);
      groups.set(block.linkGroup, members);
    }

    for (const [group, members] of groups) {
      const ordered = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // Split the way gameplay splits it, so the strap joins exactly the two
      // clusters that go down together.
      const nearSide = this.findCluster(ordered[0]);
      const nearIds = new Set(nearSide.map((member) => member.id));
      const farSide = ordered.filter((member) => !nearIds.has(member.id));
      if (!nearSide.length || !farSide.length) continue;

      // Every place the two clusters actually touch gets its own strap: the
      // pair is bolted together along its whole seam, so one strap on one
      // corner would read as one block being tied rather than the two shapes
      // being joined.
      const contacts = this.linkContactPairs(nearSide, farSide);
      const seams = contacts.length
        ? contacts
        // Nothing touches — the two clusters were authored apart, so one strap
        // spans the gap between the closest pair instead.
        : [this.chooseLinkAnchors(nearSide, farSide)].filter((anchors) => anchors !== null);

      for (const seam of seams) {
        this.linkBridges.push(this.buildLinkStrap(group, seam.from, seam.to, seam.mount));
      }
    }
    this.updateLinkBridges();
  }

  // Face-to-face contacts across the two clusters, in block and face order so
  // a level always builds the same set. Each contact is found from the near
  // side only, so a junction is never strapped twice from the same side.
  //
  // A junction gets a strap on *every* outside face it has, not just its best
  // one. One strap per junction scattered them across whichever face each
  // junction happened to prefer, so any single face of the model showed straps
  // at some of its junctions and nothing at the others — which reads as a join
  // that was left half finished.
  private linkContactPairs(nearSide: BlockRuntime[], farSide: BlockRuntime[]) {
    const farIds = new Set(farSide.map((member) => member.id));
    const ordered = [...nearSide].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const contacts: LinkAnchors[] = [];
    for (const from of ordered) {
      for (const [dx, dy, dz] of PHYSICAL_FACE_NEIGHBORS) {
        const to = this.blockMap.get(gridKey(from.x + dx, from.y + dy, from.z + dz));
        if (!to?.active || !farIds.has(to.id)) continue;
        const distance = from.mesh.position.distanceTo(to.mesh.position);
        for (const mount of this.strapMountDirections(from, to)) {
          contacts.push({ from, to, mount: mount.direction, rank: mount.rank, distance });
        }
      }
    }
    return contacts;
  }

  // Which two blocks the strap runs between. Two clusters usually touch along a
  // whole face, so several pairs are equally close: level 5's pair touches at
  // four blocks at once. Picking by distance alone would settle those ties on
  // block order and could bolt the strap to the underside of the cluster while
  // an equally close pair had the top face free, so the face the pair can offer
  // is part of the choice.
  private chooseLinkAnchors(nearSide: BlockRuntime[], farSide: BlockRuntime[]) {
    let best: LinkAnchors | null = null;
    for (const from of nearSide) {
      for (const to of farSide) {
        const [mount] = this.strapMountDirections(from, to);
        const candidate: LinkAnchors = {
          from,
          to,
          mount: mount.direction,
          rank: mount.rank,
          distance: from.mesh.position.distanceTo(to.mesh.position),
        };
        if (!best || this.preferAnchors(candidate, best)) best = candidate;
      }
    }
    return best;
  }

  // Closest first, because that is where the two shapes meet. Then the most
  // visible face. Then id, so a level builds the same strap every time.
  private preferAnchors(candidate: LinkAnchors, best: LinkAnchors) {
    if (Math.abs(candidate.distance - best.distance) > 1e-6) return candidate.distance < best.distance;
    if (candidate.rank !== best.rank) return candidate.rank < best.rank;
    if (candidate.from.id !== best.from.id) return candidate.from.id < best.from.id;
    return candidate.to.id < best.to.id;
  }

  // Every face a strap can lie on for this junction, best first: square-on to
  // the link axis, and open air on both blocks — a face with a block against it
  // would put the strap inside the cluster, which is exactly what the seam
  // between the two joined blocks already is. `rank` carries both how visible a
  // face is and how far down the fallback ladder it was found, so a pair
  // offering a real face always beats one that does not.
  private strapMountDirections(from: BlockRuntime, to: BlockRuntime) {
    const axis = to.mesh.position.clone().sub(from.mesh.position);
    if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1);
    axis.normalize();

    const faceCount = FACE_DIRECTIONS.length;
    const open: Array<{ direction: THREE.Vector3; rank: number }> = [];
    let halfOpen: { direction: THREE.Vector3; rank: number } | null = null;
    let anySquareOn: { direction: THREE.Vector3; rank: number } | null = null;
    for (const [index, [dx, dy, dz]] of FACE_DIRECTIONS.entries()) {
      const direction = new THREE.Vector3(dx, dy, dz);
      if (Math.abs(direction.dot(axis)) > LINK_MOUNT_MAX_AXIS_DOT) continue;
      anySquareOn ??= { direction, rank: faceCount * 2 + index };
      const fromOpen = !this.blockMap.get(gridKey(from.x + dx, from.y + dy, from.z + dz))?.active;
      const toOpen = !this.blockMap.get(gridKey(to.x + dx, to.y + dy, to.z + dz))?.active;
      if (fromOpen && toOpen) {
        open.push({ direction, rank: index });
        continue;
      }
      if (fromOpen) halfOpen ??= { direction, rank: faceCount + index };
    }
    if (open.length) return open;
    // A junction with no outside at all — buried in the middle of a wide seam —
    // still gets one strap, so no junction is ever left bare.
    return [halfOpen ?? anySquareOn ?? { direction: new THREE.Vector3(0, 1, 0), rank: Infinity }];
  }

  private ensureLinkStrapParts() {
    if (this.linkStrapParts) return this.linkStrapParts;
    const metal = new THREE.MeshLambertMaterial({ color: 0xb6b9c2, map: makePlatingTexture() });
    const rivet = new THREE.MeshLambertMaterial({ color: 0x3a3c44 });
    const parts = {
      // Local frame of a strap: z runs along the link, y points out of the
      // face it is bolted to. The pad is flat in that frame, and the spine is
      // one unit long on z so spanning a gap is a single scale.
      pad: new THREE.BoxGeometry(BLOCK_SIZE * 0.46, BLOCK_SIZE * 0.1, BLOCK_SIZE * 0.42),
      spine: new THREE.BoxGeometry(BLOCK_SIZE * 0.22, BLOCK_SIZE * 0.09, 1),
      loop: new THREE.TorusGeometry(BLOCK_SIZE * 0.085, BLOCK_SIZE * 0.028, 6, 14),
      metal,
      rivet,
    };
    this.linkStrapParts = parts;
    this.disposables.push(parts.pad, parts.spine, parts.loop, metal, rivet, metal.map!);
    return parts;
  }

  private buildLinkStrap(group: string, from: BlockRuntime, to: BlockRuntime, mount: THREE.Vector3) {
    const parts = this.ensureLinkStrapParts();
    const root = new THREE.Group();

    const spine = new THREE.Mesh(parts.spine, parts.metal);
    root.add(spine);
    // A collar at the middle of the spine: the one detail that says the two
    // ends are one piece rather than a bracket each.
    const collar = new THREE.Mesh(parts.loop, parts.metal);
    collar.scale.setScalar(1.7);
    root.add(collar);

    const pads = [from, to].map(() => {
      const pad = new THREE.Mesh(parts.pad, parts.metal);
      for (const side of [-1, 1]) {
        const head = new THREE.Mesh(parts.loop, parts.rivet);
        head.scale.setScalar(0.55);
        // Turned so the ring faces out of the block, reading as a bolt head.
        head.rotation.x = Math.PI / 2;
        head.position.set(side * BLOCK_SIZE * 0.15, BLOCK_SIZE * 0.06, 0);
        pad.add(head);
      }
      root.add(pad);
      return pad;
    });

    this.modelRoot.add(root);
    return { group, from, to, mount, root, spine, padFrom: pads[0], padTo: pads[1] };
  }

  // Placed from the two live block positions every frame. Either end can be
  // shoved on its own by the break wave, a shell can peel off one of them, and
  // recentring the pivot moves both, so a strap positioned once at build time
  // would drift off the blocks it is bolted to.
  private updateLinkBridges() {
    for (const bridge of this.linkBridges) {
      const from = bridge.from.mesh.position;
      const to = bridge.to.mesh.position;
      const forward = to.clone().sub(from);
      const span = forward.length();
      if (span < 1e-4) continue;
      forward.divideScalar(span);

      // The mount face squared off against the axis, so the strap lies flat
      // even when the two clusters sit diagonally from each other.
      const up = bridge.mount.clone().addScaledVector(forward, -bridge.mount.dot(forward));
      if (up.lengthSq() < 1e-6) up.copy(this.worldUp);
      up.normalize();
      const right = up.clone().cross(forward).normalize();

      const reach = Math.max(this.linkPadReach(bridge.from), this.linkPadReach(bridge.to));
      bridge.root.position.copy(from).lerp(to, 0.5).addScaledVector(up, reach);
      bridge.root.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(right, up, forward),
      );
      bridge.spine.scale.z = span + LINK_SPINE_OVERHANG;
      bridge.padFrom.position.z = -span / 2;
      bridge.padTo.position.z = span / 2;
    }
  }

  // Clear of the shell while cover is up, down on the block once it is gone.
  private linkPadReach(block: BlockRuntime) {
    return block.barrelLeft > 0 ? LINK_PAD_REACH_OVER_SHELL : LINK_PAD_REACH;
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

  // Menu mode: the cluster turns on its own and nothing the player does reaches
  // the level. The cannon steps out of frame because the menu only shows the
  // model.
  setIdle(next: boolean) {
    if (this.idle === next) return;
    this.idle = next;
    if (next) {
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

  private solveAimAtScreenPoint(screenX: number, screenY: number): BallisticSolution | null {
    const target = this.raycastBlockSurfacePoint(screenX, screenY) ?? this.targetPlanePoint(screenX, screenY);
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
        const hit = this.sweepBlocks(previous, current, inverseModel);
        if (hit) {
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
    const hit = this.sweepBlocks(projectile.previous, next, inverseModel);
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
        // A shell separates what it covers from what it does not, so a cluster
        // never straddles the boundary. This also makes the wrapped group the
        // unit a shell covers, matching "one barrel wraps one cluster".
        if ((neighbor.barrelLeft > 0) !== (start.barrelLeft > 0)) continue;
        visited.add(neighbor.id);
        queue.push(neighbor);
      }
    }
    return result;
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
      // The strap is bolted on, not painted on: it comes off in one piece and
      // falls when the pair it joined is claimed.
      this.dropLinkBridge(member);
      member.active = false;
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
    // Fired before the branches below, because a shot that peeled a shell, a
    // shot that was refused by a link and a shot that claimed a cluster all
    // landed, and all three should show it.
    this.playImpactEffect(projectile.mesh.position, projectile.shotIndex);

    // A hit on a covered block only peels a layer. The cluster underneath needs
    // its own shot once fully uncovered, so a barrel always costs extra shots
    // instead of being a shortcut (draft §1.3).
    if (block.barrelLeft > 0) {
      haptic("impact");
      this.peelBarrelAround(block);
      this.removeProjectile(projectile);
      this.aimPreviewDirty = true;
      this.callbacks.onState(this.cloneState());
      return;
    }

    const cluster = this.findCluster(block);
    if (!cluster.length) return;

    // A linked partner still under cover holds its whole pair in place: linked
    // clusters go down together, so while one cannot be claimed neither can the
    // other (draft §2.4.2). The shot lands and shakes the pair instead.
    const blockedBy = this.coveredLinkPartner(cluster);
    if (blockedBy) {
      haptic("impact");
      this.jostleCluster(cluster);
      this.jostleCluster(this.findCluster(blockedBy));
      this.removeProjectile(projectile);
      this.aimPreviewDirty = true;
      return;
    }

    haptic("impact");
    // Claim immediately so another projectile cannot resolve this cluster twice.
    this.sendBreakWave(cluster);
    this.releaseCluster(cluster, projectile.shotIndex);
    this.removeProjectile(projectile);
    this.aimPreviewDirty = true;

    // Hitting a block next to a shell also opens that shell, in the same shot
    // as the claim (draft §1.3).
    const openedShells = this.breakBarrelsTouching(cluster);

    // A linked cluster goes down with the one that was shot. It stays a
    // separate claim: batches hold one colour each, so two colours can never
    // merge into one transaction, and each side then follows the ordinary goal
    // and batch rules including the fail when no batch slot is free.
    const claimed = [cluster, ...this.claimLinkedClusters(cluster, projectile.shotIndex)];
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
    if (openedShells) this.aimPreviewDirty = true;
    this.callbacks.onState(this.cloneState());
  }

  // Peels one layer off the whole wrapped group, since one barrel covers one
  // cluster rather than one cell.
  private peelBarrelAround(block: BlockRuntime) {
    for (const member of this.findCluster(block)) this.peelShell(member);
  }

  private breakBarrelsTouching(cluster: BlockRuntime[]) {
    const offsets = this.level.adjacency.z ? PHYSICAL_FACE_NEIGHBORS : CONFIRMED_NEIGHBORS;
    const touched: BlockRuntime[] = [];
    for (const member of cluster) {
      for (const [dx, dy, dz] of offsets) {
        const neighbor = this.blockMap.get(gridKey(member.x + dx, member.y + dy, member.z + dz));
        if (neighbor?.active && neighbor.barrelLeft > 0) touched.push(neighbor);
      }
    }
    // Collected first, then peeled: peeling changes what findCluster walks, so
    // reading and mutating in one pass would only reach part of a group.
    const groups = new Set<BlockRuntime>();
    for (const neighbor of touched) {
      const group = this.findCluster(neighbor);
      if (group.length) groups.add(group[0]);
    }
    for (const representative of groups) this.peelBarrelAround(representative);
    return groups.size > 0;
  }

  // The partner cluster of a link, if it is still under cover.
  private coveredLinkPartner(cluster: BlockRuntime[]) {
    const groups = new Set(cluster.flatMap((member) => (member.linkGroup ? [member.linkGroup] : [])));
    if (!groups.size) return null;
    const ownIds = new Set(cluster.map((member) => member.id));
    return this.blocks.find((candidate) =>
      candidate.active
      && !ownIds.has(candidate.id)
      && candidate.linkGroup !== undefined
      && groups.has(candidate.linkGroup)
      && candidate.barrelLeft > 0) ?? null;
  }

  // Feedback for a shot that could not break anything: the cluster jolts in
  // place, reusing the same kick the neighbours of a claim get.
  private jostleCluster(cluster: BlockRuntime[]) {
    for (const member of cluster) {
      this.clearNeighborKick(member);
      this.neighborKicks.push({
        block: member,
        age: 0,
        delay: 0,
        amplitude: 1,
        duration: 0.22,
        basePosition: member.mesh.position.clone(),
        direction: new THREE.Vector3(0, 0.35, 1).normalize(),
      });
    }
  }

  // One breaking event peels exactly one layer, whether it came from a direct
  // hit or from a claim next door.
  private peelShell(block: BlockRuntime) {
    if (block.barrelLeft <= 0) return;
    this.spawnShellDebris(block, block.barrelLeft);
    block.barrelLeft -= 1;
    if (block.barrelLeft > 0) {
      if (block.barrelShell) block.barrelShell.material = this.shellMaterialFor(block.barrelLeft);
      return;
    }
    if (block.barrelShell) {
      block.mesh.remove(block.barrelShell);
      block.barrelShell = undefined;
    }
    // Nothing to do for a link here: the strap reads its own clearance from
    // barrelLeft every frame, so it settles onto the bare block by itself.
  }

  private ensureDebrisResources() {
    if (this.debrisGeometry) return;
    const shard = BLOCK_SIZE * 0.2;
    this.debrisGeometry = new THREE.BoxGeometry(shard, shard, shard * 0.5);
    this.disposables.push(this.debrisGeometry);
    this.debrisMaterials = BARREL_DEBRIS_COLORS.map((color) => {
      const material = new THREE.MeshLambertMaterial({ color, transparent: true });
      this.disposables.push(material);
      return material;
    });
  }

  private spawnShellDebris(block: BlockRuntime, layer: number) {
    this.ensureDebrisResources();
    const material = this.debrisMaterials[THREE.MathUtils.clamp(layer - 1, 0, this.debrisMaterials.length - 1)];
    const origin = block.mesh.getWorldPosition(new THREE.Vector3());
    for (let piece = 0; piece < 7; piece += 1) {
      const seed = block.x * 31 + block.y * 17 + block.z * 7 + layer * 101 + piece * 13;
      const mesh = new THREE.Mesh(this.debrisGeometry!, material);
      mesh.position.copy(origin).add(new THREE.Vector3(
        (seededUnit(seed) - 0.5) * BLOCK_SIZE,
        (seededUnit(seed + 1) - 0.5) * BLOCK_SIZE,
        (seededUnit(seed + 2) - 0.5) * BLOCK_SIZE,
      ));
      this.addDebris(mesh, seed);
    }
  }

  // Shards and fittings leave the model and fall through world space, so they
  // are parented to the scene rather than to the block they came from.
  private addDebris(mesh: THREE.Object3D, seed: number) {
    this.scene.add(mesh);
    this.debris.push({
      mesh,
      velocity: new THREE.Vector3(
        (seededUnit(seed + 3) - 0.5) * 2.6,
        0.9 + seededUnit(seed + 4) * 1.6,
        (seededUnit(seed + 5) - 0.5) * 2.6,
      ),
      spin: new THREE.Vector3(
        (seededUnit(seed + 6) - 0.5) * 9,
        (seededUnit(seed + 7) - 0.5) * 9,
        (seededUnit(seed + 8) - 0.5) * 9,
      ),
      age: 0,
    });
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

  // The whole seam comes off at once: every strap of the group is taken out of
  // the list, so the partner cluster going down in the same shot finds nothing
  // left to drop and no strap falls twice.
  private dropLinkBridge(block: BlockRuntime) {
    if (!block.linkGroup) return;
    const dropped = this.linkBridges.filter((bridge) => bridge.group === block.linkGroup);
    if (!dropped.length) return;
    this.linkBridges = this.linkBridges.filter((bridge) => bridge.group !== block.linkGroup);
    for (const [index, bridge] of dropped.entries()) {
      const worldPosition = bridge.root.getWorldPosition(new THREE.Vector3());
      const worldQuaternion = bridge.root.getWorldQuaternion(new THREE.Quaternion());
      this.modelRoot.remove(bridge.root);
      bridge.root.position.copy(worldPosition);
      bridge.root.quaternion.copy(worldQuaternion);
      this.addDebris(bridge.root, block.x * 41 + block.y * 23 + block.z * 11 + index * 13);
    }
  }

  private updateDebris() {
    const survivors: DebrisPiece[] = [];
    for (const piece of this.debris) {
      piece.age += FIXED_STEP;
      piece.velocity.y += DEBRIS_GRAVITY * FIXED_STEP;
      piece.mesh.position.addScaledVector(piece.velocity, FIXED_STEP);
      piece.mesh.rotation.x += piece.spin.x * FIXED_STEP;
      piece.mesh.rotation.y += piece.spin.y * FIXED_STEP;
      piece.mesh.rotation.z += piece.spin.z * FIXED_STEP;
      const fade = 1 - piece.age / DEBRIS_LIFETIME;
      piece.mesh.scale.setScalar(Math.max(0.05, fade));
      if (piece.age < DEBRIS_LIFETIME) {
        survivors.push(piece);
        continue;
      }
      // Geometry and materials here are shared per engine, so only the node is
      // detached; dispose() releases the shared resources once.
      this.scene.remove(piece.mesh);
    }
    this.debris = survivors;
  }

  private claimLinkedClusters(cluster: BlockRuntime[], shotIndex: number) {
    const groups = new Set(cluster.flatMap((member) => (member.linkGroup ? [member.linkGroup] : [])));
    if (!groups.size) return [];

    const claimedIds = new Set(cluster.map((member) => member.id));
    const extra: BlockRuntime[][] = [];
    for (const partner of this.blocks) {
      if (!partner.active || claimedIds.has(partner.id)) continue;
      if (!partner.linkGroup || !groups.has(partner.linkGroup)) continue;
      // A covered partner is impossible here: handleHit refuses the shot
      // outright while any linked cluster still has cover left.
      if (partner.barrelLeft > 0) continue;
      const partnerCluster = this.findCluster(partner);
      if (!partnerCluster.length) continue;
      partnerCluster.forEach((member) => claimedIds.add(member.id));
      this.sendBreakWave(partnerCluster);
      this.releaseCluster(partnerCluster, shotIndex);
      this.breakBarrelsTouching(partnerCluster);
      extra.push(partnerCluster);
    }
    return extra;
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
    let unassigned = result.count;
    const goalSlot = this.state.activeGoals.findIndex((goal) => goal?.color === result.color);

    if (goalSlot >= 0) {
      const goal = this.state.activeGoals[goalSlot]!;
      const amount = Math.min(unassigned, goal.target - goal.current);
      if (amount > 0) {
        transfers.push({ kind: "goal", slot: goalSlot, goalId: goal.id, fromCount: goal.current, count: amount });
        unassigned -= amount;
      }
    }

    if (unassigned > 0 && this.state.batches.length < this.level.batchCapacity) {
      transfers.push({ kind: "batch", slot: this.state.batches.length, count: unassigned });
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

    const batchesAdded = after.batches.length > before.batches.length;
    if (batchesAdded && after.batches.length >= this.level.batchCapacity) {
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
        if (this.aimPointer !== null) this.clearAimGesture(true);
        if (this.modelPointer !== null) this.clearModelGesture();
        this.pendingResolutions = [];
        this.projectiles.slice().forEach((projectile) => this.removeProjectile(projectile));
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
        this.projectiles.slice().forEach((projectile) => this.updateProjectile(projectile));
        if (this.showcase) this.updateShowcase();
        if (this.debris.length) this.updateDebris();
        if (this.smoke.length) this.updateSmoke();
        if (this.sparkles.length) this.updateSparkles();
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

    // Last thing before the draw, so a strap is placed against the block
    // positions this frame actually shows.
    if (this.linkBridges.length) this.updateLinkBridges();

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
    // Barrel and link visuals are shared between blocks, so they are held here
    // rather than found by the sweep: a shell already removed from the scene
    // would otherwise leak.
    this.disposables.forEach((resource) => resource.dispose());
    // The renderer outlives this engine, so it is handed back rather than
    // disposed. Pooled projectiles already left the scene above, which keeps
    // the sweep from disposing shared resources.
    releaseRenderer(this);
  }
}
