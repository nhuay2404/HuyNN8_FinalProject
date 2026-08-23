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
const LINEAR_V_LOW = 0.16;
const LINEAR_V_HIGH = 0.42;

/**
 * A target's position on one straight line in normalized screen space.
 *
 * The seed only chooses its direction and the two endpoints. Everything between
 * them is a linear interpolation, so the player can read and lead the target
 * instead of chasing a path that repeatedly changes curvature.
 */
export function rainbowLinearAt(seed: number, progress: number): NormalizedScreenPoint {
  if (!Number.isFinite(seed)) throw new TypeError("Rainbow line seed must be finite");
  if (!Number.isFinite(progress)) throw new TypeError("Rainbow line progress must be finite");

  const t = clamp01(progress);
  const leftToRight = hash(seed, 0) < 0.5;
  const entryV = lerp(LINEAR_V_LOW, LINEAR_V_HIGH, hash(seed, 1));
  const exitV = lerp(LINEAR_V_LOW, LINEAR_V_HIGH, hash(seed, 2));

  const fromU = leftToRight ? -OFF_SCREEN_MARGIN : 1 + OFF_SCREEN_MARGIN;
  const toU = leftToRight ? 1 + OFF_SCREEN_MARGIN : -OFF_SCREEN_MARGIN;

  return {
    u: lerp(fromU, toU, t),
    v: clamp(lerp(entryV, exitV, t), LINEAR_V_LOW, LINEAR_V_HIGH),
  };
}

export const RAINBOW_TARGET_DEFAULTS = Object.freeze({
  targetCount: 3,
  /** What the seeded jitter is measured against, not a fixed cadence. */
  spawnGapSeconds: 12,
  targetDurationSeconds: 7,
});

export type RainbowSpawnWindow = Readonly<{
  index: number;
  /** Feeds rainbowLinearAt, so a target's straight crossing belongs to its slot. */
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
 * Outer radius of the drawn bullseye logo, as a fraction of one block side.
 *
 * Presentation only. The hit test below does not read it: a Weak Point is a
 * whole face, and the bullseye is the logo that tells the player which face.
 */
export const WEAK_POINT_VISUAL_RADIUS_RATIO = 0.32;

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
 * camera cannot even show, and the old drawn bullseye was never the same size as
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
