/**
 * Pure gameplay helpers for the Weak Point / Rainbow hook.
 *
 * Keep this module independent from React and Three so the renderer can hand it
 * plain collision data and the rules can be tested without a WebGL context.
 */

import type { WeakPointFace } from "./types";

export type { WeakPointFace } from "./types";

export type NormalizedScreenPoint = Readonly<{ u: number; v: number }>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

/**
 * Deterministic pseudo-random in 0..1 from a seed and a channel.
 *
 * Local on purpose. The engine keeps its own copy for particle jitter; importing
 * that one here would tie this pure module to the renderer, and importing this
 * one there would tie every sparkle to the Rainbow module. Two three-line hashes
 * are cheaper than either coupling.
 */
function hash(seed: number, channel: number) {
  const value = Math.sin((seed + 1) * 12.9898 + channel * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** How far past the frame a target starts and ends, so it flies in and out. */
const OFF_SCREEN_MARGIN = 0.18;
/**
 * The band a target may fly in, measured from the top of the scene.
 *
 * Not just "on screen": measured on a 375x812 phone the cannon's aim envelope
 * only reaches the top 10%-48% of the scene, so a target below that is one the
 * player can see and can never shoot. The band is the reachable part, not the
 * visible part.
 */
const WANDER_V_LOW = 0.12;
const WANDER_V_HIGH = 0.48;
const WANDER_HARMONICS = 3;

/**
 * A target's position in normalized screen space at `progress` 0..1.
 *
 * Free-form rather than authored: three seeded sines of different frequency and
 * phase are summed across the crossing, so no two targets trace the same shape
 * and none of them is a straight line or a single arc. Deterministic, so a level
 * plays the same way twice and a replay of a bug is a replay of the same flight.
 *
 * The sum is tapered by sin(pi * t), which pins the entry and exit heights to
 * the seeded ones — otherwise a target would appear already displaced off its
 * own line, which reads as a glitch rather than as a path.
 */
export function rainbowWanderAt(seed: number, progress: number): NormalizedScreenPoint {
  if (!Number.isFinite(seed)) throw new TypeError("Rainbow wander seed must be finite");
  if (!Number.isFinite(progress)) throw new TypeError("Rainbow wander progress must be finite");

  const t = clamp01(progress);
  const leftToRight = hash(seed, 0) < 0.5;
  const entryV = 0.16 + hash(seed, 1) * 0.26;
  const exitV = 0.16 + hash(seed, 2) * 0.26;

  const fromU = leftToRight ? -OFF_SCREEN_MARGIN : 1 + OFF_SCREEN_MARGIN;
  const toU = leftToRight ? 1 + OFF_SCREEN_MARGIN : -OFF_SCREEN_MARGIN;

  let wander = 0;
  for (let harmonic = 0; harmonic < WANDER_HARMONICS; harmonic += 1) {
    const amplitude = (0.05 + hash(seed, 10 + harmonic) * 0.07) / (harmonic + 1);
    const frequency = 1 + harmonic + Math.floor(hash(seed, 20 + harmonic) * 3);
    const phase = hash(seed, 30 + harmonic) * Math.PI * 2;
    wander += amplitude * Math.sin(t * Math.PI * frequency + phase);
  }

  const taper = Math.sin(t * Math.PI);
  return {
    u: lerp(fromU, toU, t),
    v: clamp(lerp(entryV, exitV, t) + wander * taper, WANDER_V_LOW, WANDER_V_HIGH),
  };
}

export const RAINBOW_TARGET_DEFAULTS = Object.freeze({
  targetCount: 3,
  /** What the seeded jitter is measured against, not a fixed cadence. */
  spawnGapSeconds: 12,
  targetDurationSeconds: 4.5,
});

export type RainbowSpawnWindow = Readonly<{
  index: number;
  /** Feeds rainbowWanderAt, so a target's flight belongs to its slot. */
  seed: number;
  spawnAtSeconds: number;
  leaveAtSeconds: number;
}>;

export type RainbowScheduleOptions = Readonly<{
  levelSeed: number;
  targetCount?: number;
  baseGapSeconds?: number;
  durationSeconds?: number;
}>;

function requireNonNegativeFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number`);
}

/**
 * When each target flies, for one round.
 *
 * The round has no length any more, so there is no window to spread the targets
 * across. Each gap is drawn from the seed around `baseGapSeconds` instead: the
 * first target arrives after half to all of one gap, every later one after half
 * to one and a half. That scatters them through the round however long it runs,
 * and still produces exactly `targetCount` of them.
 */
export function createRainbowSpawnSchedule(options: RainbowScheduleOptions): readonly RainbowSpawnWindow[] {
  const targetCount = options.targetCount ?? RAINBOW_TARGET_DEFAULTS.targetCount;
  const baseGapSeconds = options.baseGapSeconds ?? RAINBOW_TARGET_DEFAULTS.spawnGapSeconds;
  const durationSeconds = options.durationSeconds ?? RAINBOW_TARGET_DEFAULTS.targetDurationSeconds;

  if (!Number.isInteger(targetCount) || targetCount < 0) {
    throw new RangeError("targetCount must be a non-negative integer");
  }
  if (!Number.isFinite(options.levelSeed)) throw new TypeError("levelSeed must be finite");
  requireNonNegativeFinite(baseGapSeconds, "baseGapSeconds");
  requireNonNegativeFinite(durationSeconds, "durationSeconds");

  const windows: RainbowSpawnWindow[] = [];
  let spawnAtSeconds = 0;
  for (let index = 0; index < targetCount; index += 1) {
    const jitter = index === 0
      ? 0.5 + hash(options.levelSeed, 100) * 0.5
      : 0.5 + hash(options.levelSeed, 100 + index);
    spawnAtSeconds += baseGapSeconds * jitter;
    windows.push(Object.freeze({
      index,
      seed: options.levelSeed * 97 + index * 31 + 7,
      spawnAtSeconds,
      leaveAtSeconds: spawnAtSeconds + durationSeconds,
    }));
  }
  return Object.freeze(windows);
}

/**
 * Outer radius of the drawn bullseye, as a fraction of one block side.
 *
 * Presentation only. The hit test below does not read it: a Weak Point is a
 * whole face, and the bullseye is the decal that tells the player which face.
 */
export const WEAK_POINT_VISUAL_RADIUS_RATIO = 0.21;

export type WeakPointHitInput = Readonly<{
  /** Face independently identified by collision code. */
  impactedFace: WeakPointFace;
  /** Face carrying the authored Weak Point. */
  weakPointFace: WeakPointFace;
}>;

/**
 * A Weak Point is the whole face, not a disc on it.
 *
 * Aiming a 3D arc at a centred disc on a rotating cube asked for precision the
 * camera cannot even show, and the drawn bullseye was never the same size as
 * the region that counted. Landing anywhere on the authored face now counts,
 * which is a rule the player can read straight off the model.
 */
export function isWeakPointFaceHit({ impactedFace, weakPointFace }: WeakPointHitInput): boolean {
  return impactedFace === weakPointFace;
}

export type BlockImpactResolution = "CLAIM_CLUSTER" | "RICOCHET_SHAKE";

/**
 * Read the bypass flag as it stands at impact, never as it stood at fire time.
 *
 * Continuous fire puts several balls in the air at once, so a shot that left the
 * barrel with the buff armed can land after another shot already spent it.
 */
export function resolveBlockImpact(
  weakPointBypassArmed: boolean,
  weakPointFaceHit: boolean,
): BlockImpactResolution {
  return weakPointBypassArmed || weakPointFaceHit ? "CLAIM_CLUSTER" : "RICOCHET_SHAKE";
}
