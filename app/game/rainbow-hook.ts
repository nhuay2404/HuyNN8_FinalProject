/**
 * Pure gameplay helpers for the Weak Point / Rainbow hook.
 *
 * Keep this module independent from React and Three so the renderer can hand it
 * plain collision data and the rules can be tested without a WebGL context.
 */

import type { RainbowPathId, WeakPointFace } from "./types";

export type { RainbowPathId, WeakPointFace } from "./types";

export type NormalizedScreenPoint = Readonly<{ u: number; v: number }>;

export type RainbowPathDefinition = Readonly<{
  id: RainbowPathId;
  name: string;
  kind: "linear" | "quadratic";
  start: NormalizedScreenPoint;
  end: NormalizedScreenPoint;
  control?: NormalizedScreenPoint;
}>;

const point = (u: number, v: number): NormalizedScreenPoint => Object.freeze({ u, v });

/** The twelve authored normalized screen-space paths from the hook spec. */
export const RAINBOW_PATHS: readonly RainbowPathDefinition[] = Object.freeze([
  { id: 1, name: "Horizontal Top L→R", kind: "linear", start: point(-0.15, 0.25), end: point(1.15, 0.25) },
  { id: 2, name: "Horizontal Top R→L", kind: "linear", start: point(1.15, 0.25), end: point(-0.15, 0.25) },
  { id: 3, name: "Horizontal Mid L→R", kind: "linear", start: point(-0.15, 0.5), end: point(1.15, 0.5) },
  { id: 4, name: "Horizontal Mid R→L", kind: "linear", start: point(1.15, 0.5), end: point(-0.15, 0.5) },
  { id: 5, name: "Horizontal Low L→R", kind: "linear", start: point(-0.15, 0.72), end: point(1.15, 0.72) },
  { id: 6, name: "Horizontal Low R→L", kind: "linear", start: point(1.15, 0.72), end: point(-0.15, 0.72) },
  { id: 7, name: "Diagonal Up L→R", kind: "linear", start: point(-0.15, 0.72), end: point(1.15, 0.28) },
  { id: 8, name: "Diagonal Up R→L", kind: "linear", start: point(1.15, 0.72), end: point(-0.15, 0.28) },
  { id: 9, name: "Diagonal Down L→R", kind: "linear", start: point(-0.15, 0.28), end: point(1.15, 0.72) },
  { id: 10, name: "Diagonal Down R→L", kind: "linear", start: point(1.15, 0.28), end: point(-0.15, 0.72) },
  {
    id: 11,
    name: "Arc L→R",
    kind: "quadratic",
    start: point(-0.15, 0.68),
    control: point(0.5, 0.2),
    end: point(1.15, 0.68),
  },
  {
    id: 12,
    name: "Arc R→L",
    kind: "quadratic",
    start: point(1.15, 0.68),
    control: point(0.5, 0.2),
    end: point(-0.15, 0.68),
  },
]);

const RAINBOW_PATH_BY_ID = new Map<RainbowPathId, RainbowPathDefinition>(
  RAINBOW_PATHS.map((pathDefinition) => [pathDefinition.id, pathDefinition]),
);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

/**
 * Samples a path in normalized screen space. Progress outside 0..1 is clamped
 * so a late/early render frame cannot briefly put the target past its authored
 * off-screen endpoint.
 */
export function evaluateRainbowPath(pathId: RainbowPathId, progress: number): NormalizedScreenPoint {
  if (!Number.isFinite(progress)) throw new TypeError("Rainbow path progress must be finite");

  const pathDefinition = RAINBOW_PATH_BY_ID.get(pathId);
  if (!pathDefinition) throw new RangeError(`Unknown rainbow path id: ${pathId}`);

  const t = clamp01(progress);
  if (pathDefinition.kind === "linear") {
    return {
      u: lerp(pathDefinition.start.u, pathDefinition.end.u, t),
      v: lerp(pathDefinition.start.v, pathDefinition.end.v, t),
    };
  }

  const control = pathDefinition.control;
  if (!control) throw new Error(`Quadratic rainbow path ${pathId} has no control point`);
  const oneMinusT = 1 - t;
  return {
    u: oneMinusT * oneMinusT * pathDefinition.start.u
      + 2 * oneMinusT * t * control.u
      + t * t * pathDefinition.end.u,
    v: oneMinusT * oneMinusT * pathDefinition.start.v
      + 2 * oneMinusT * t * control.v
      + t * t * pathDefinition.end.v,
  };
}

export type LocalPoint3 = Readonly<{ x: number; y: number; z: number }>;

/** Outer radius of the visible bullseye, as a fraction of one block side. */
export const WEAK_POINT_VISUAL_RADIUS_RATIO = 0.21;

/**
 * TEMP prototype policy: the clickable radius is one third wider than the
 * visible 0.21-radius bullseye to make precision aiming forgiving on mobile.
 * Playtest may tune this without changing the authored Weak Point positions.
 */
export const WEAK_POINT_HIT_RADIUS_RATIO = 0.28;

export type BullseyeHitInput = Readonly<{
  /** Impact position expressed as an offset from the impacted block's centre. */
  localPoint: LocalPoint3;
  /** Face independently identified by collision code. */
  impactedFace: WeakPointFace;
  /** Face carrying the authored Weak Point. */
  weakPointFace: WeakPointFace;
  blockSize?: number;
  hitRadiusRatio?: number;
}>;

/**
 * Tests a centred face bullseye using only the two axes tangent to that face.
 *
 * The normal axis is intentionally ignored: sweep collision often reports the
 * projectile centre at contact rather than the exact point on the cube surface.
 */
export function isBullseyeHit({
  localPoint,
  impactedFace,
  weakPointFace,
  blockSize = 1,
  hitRadiusRatio = WEAK_POINT_HIT_RADIUS_RATIO,
}: BullseyeHitInput): boolean {
  if (impactedFace !== weakPointFace) return false;
  if (!Number.isFinite(blockSize) || blockSize <= 0) return false;
  if (!Number.isFinite(hitRadiusRatio) || hitRadiusRatio < 0) return false;
  if (![localPoint.x, localPoint.y, localPoint.z].every(Number.isFinite)) return false;

  let tangentA: number;
  let tangentB: number;
  switch (weakPointFace) {
    case "PX":
    case "NX":
      tangentA = localPoint.y;
      tangentB = localPoint.z;
      break;
    case "PY":
    case "NY":
      tangentA = localPoint.x;
      tangentB = localPoint.z;
      break;
    case "PZ":
    case "NZ":
      tangentA = localPoint.x;
      tangentB = localPoint.y;
      break;
  }

  const hitRadius = blockSize * hitRadiusRatio;
  return tangentA * tangentA + tangentB * tangentB <= hitRadius * hitRadius + Number.EPSILON;
}

export type WeakPointHookPhase = "NORMAL_WEAK_POINT" | "RAINBOW_TARGET_EVENT" | "RAINBOW_CLIMAX";
export type BlockImpactResolution = "CLAIM_CLUSTER" | "RICOCHET_SHAKE";

/** Resolve using the phase passed at impact time, never the phase at fire time. */
export function resolveBlockImpact(
  phaseAtImpact: WeakPointHookPhase,
  bullseyeHit: boolean,
): BlockImpactResolution {
  return phaseAtImpact === "RAINBOW_CLIMAX" || bullseyeHit ? "CLAIM_CLUSTER" : "RICOCHET_SHAKE";
}

export const RAINBOW_BASELINE = Object.freeze({
  triggerAtMainSeconds: 25,
  targetCount: 3,
  spawnGapSeconds: 2,
  targetDurationSeconds: 4,
  rewardSecondsPerHit: 5,
});

export type RainbowTimelineOptions = Readonly<{
  targetCount?: number;
  spawnGapSeconds?: number;
  targetDurationSeconds?: number;
}>;

export type RainbowTargetWindow = Readonly<{
  index: number;
  label: string;
  spawnAtSeconds: number;
  leaveAtSeconds: number;
}>;

function requireNonNegativeFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number`);
}

/** Builds the target event windows; the baseline yields A 0–4, B 2–6, C 4–8. */
export function createRainbowTargetTimeline(
  options: RainbowTimelineOptions = {},
): readonly RainbowTargetWindow[] {
  const targetCount = options.targetCount ?? RAINBOW_BASELINE.targetCount;
  const spawnGapSeconds = options.spawnGapSeconds ?? RAINBOW_BASELINE.spawnGapSeconds;
  const targetDurationSeconds = options.targetDurationSeconds ?? RAINBOW_BASELINE.targetDurationSeconds;

  if (!Number.isInteger(targetCount) || targetCount < 0) {
    throw new RangeError("targetCount must be a non-negative integer");
  }
  requireNonNegativeFinite(spawnGapSeconds, "spawnGapSeconds");
  requireNonNegativeFinite(targetDurationSeconds, "targetDurationSeconds");

  return Object.freeze(Array.from({ length: targetCount }, (_, index) => {
    const spawnAtSeconds = index * spawnGapSeconds;
    return Object.freeze({
      index,
      label: index < 26 ? String.fromCharCode(65 + index) : String(index + 1),
      spawnAtSeconds,
      leaveAtSeconds: spawnAtSeconds + targetDurationSeconds,
    });
  }));
}

export function getRainbowEventDuration(timeline: readonly RainbowTargetWindow[]): number;
export function getRainbowEventDuration(options?: RainbowTimelineOptions): number;
/** The event ends when its final target leaves, not when the last one spawns. */
export function getRainbowEventDuration(
  timelineOrOptions: readonly RainbowTargetWindow[] | RainbowTimelineOptions = {},
): number {
  const timeline = Array.isArray(timelineOrOptions)
    ? timelineOrOptions as readonly RainbowTargetWindow[]
    : createRainbowTargetTimeline(timelineOrOptions as RainbowTimelineOptions);
  return timeline.reduce((latest, target) => Math.max(latest, target.leaveAtSeconds), 0);
}

/** Spawn is inclusive and leave time is exclusive, preventing a one-frame ghost target. */
export function getActiveRainbowTargets(
  timeline: readonly RainbowTargetWindow[],
  eventElapsedSeconds: number,
): readonly RainbowTargetWindow[] {
  if (!Number.isFinite(eventElapsedSeconds)) return [];
  return timeline.filter((target) => (
    eventElapsedSeconds >= target.spawnAtSeconds && eventElapsedSeconds < target.leaveAtSeconds
  ));
}

// Fixed-step clocks otherwise miss authored whole-second boundaries by one
// tick because repeatedly adding/subtracting 1/60 leaves tiny IEEE-754 residue.
export const HOOK_TIME_EPSILON_SECONDS = 1e-9;

export function advanceHookCountdown(
  remainingSeconds: number,
  deltaSeconds: number,
  snapAtSeconds?: number,
) {
  requireNonNegativeFinite(remainingSeconds, "remainingSeconds");
  requireNonNegativeFinite(deltaSeconds, "deltaSeconds");
  if (snapAtSeconds !== undefined) requireNonNegativeFinite(snapAtSeconds, "snapAtSeconds");
  const next = Math.max(0, remainingSeconds - deltaSeconds);
  if (next <= HOOK_TIME_EPSILON_SECONDS) return 0;
  if (snapAtSeconds !== undefined && Math.abs(next - snapAtSeconds) <= HOOK_TIME_EPSILON_SECONDS) {
    return snapAtSeconds;
  }
  return next;
}

export function advanceHookElapsed(elapsedSeconds: number, deltaSeconds: number, endSeconds: number) {
  requireNonNegativeFinite(elapsedSeconds, "elapsedSeconds");
  requireNonNegativeFinite(deltaSeconds, "deltaSeconds");
  requireNonNegativeFinite(endSeconds, "endSeconds");
  const next = Math.min(endSeconds, elapsedSeconds + deltaSeconds);
  return endSeconds - next <= HOOK_TIME_EPSILON_SECONDS ? endSeconds : next;
}

/** Computes the separate Climax bank; it never changes the main-round timer. */
export function climaxSecondsForHits(
  hitCount: number,
  rewardSecondsPerHit = RAINBOW_BASELINE.rewardSecondsPerHit,
): number {
  if (!Number.isInteger(hitCount) || hitCount < 0) throw new RangeError("hitCount must be a non-negative integer");
  requireNonNegativeFinite(rewardSecondsPerHit, "rewardSecondsPerHit");
  return hitCount * rewardSecondsPerHit;
}

/**
 * Detects the one threshold crossing during countdown. A round authored at or
 * below the trigger needs an explicit caller policy, matching the spec's open
 * decision instead of silently triggering here.
 */
export function didCrossRainbowTrigger(
  previousMainSeconds: number,
  currentMainSeconds: number,
  triggerAtMainSeconds: number = RAINBOW_BASELINE.triggerAtMainSeconds,
  alreadyTriggered = false,
): boolean {
  if (alreadyTriggered) return false;
  if (![previousMainSeconds, currentMainSeconds, triggerAtMainSeconds].every(Number.isFinite)) return false;
  return previousMainSeconds > triggerAtMainSeconds && currentMainSeconds <= triggerAtMainSeconds;
}
