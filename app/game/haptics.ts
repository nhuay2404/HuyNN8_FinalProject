// The web has no amplitude control: navigator.vibrate() accepts durations and
// gap patterns only, so "strength" here is expressed as how long a pulse runs
// and how many pulses it has, never how hard the motor pushes. iOS Safari does
// not implement the Vibration API at all, so every call is a silent no-op
// there — that is a platform limit, not a failure to handle.
const STORAGE_KEY = "cannon-sort:v1:haptics";

export type HapticEvent =
  | "impact"
  | "goalComplete"
  | "batchCreated"
  | "batchFull"
  | "win"
  | "lose";

// The middle tier: felt clearly without wearing the hand out over a long
// session. A single number is one pulse; an array alternates pulse and gap.
export const HAPTIC_PATTERNS: Record<HapticEvent, number | number[]> = {
  impact: 25,
  goalComplete: [30, 50, 45],
  batchCreated: 40,
  batchFull: [50, 70, 50],
  win: [50, 60, 50, 60, 120],
  lose: 200,
};

// Cubes land a few dozen milliseconds apart, so each one gets its own shorter
// tick: a burst then reads as separate taps instead of one long buzz. The tail
// is capped because a large cluster would otherwise turn into a rattle, and
// pulses stay at or above 10ms since shorter ones are unreliable on Android.
const LANDING_BASE_MS = 18;
const LANDING_DECAY_MS = 2;
const LANDING_MIN_MS = 10;
export const LANDING_MAX_TICKS = 6;

export function landingPulseMs(order: number) {
  if (order >= LANDING_MAX_TICKS) return 0;
  return Math.max(LANDING_MIN_MS, LANDING_BASE_MS - order * LANDING_DECAY_MS);
}

function readStoredPreference() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // A file:// page or a privacy mode can refuse storage outright; haptics
    // stay on rather than silently turning themselves off.
    return true;
  }
}

let enabled = readStoredPreference();

export function isHapticsEnabled() {
  return enabled;
}

export function hapticsSupported() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function setHapticsEnabled(next: boolean) {
  enabled = next;
  if (!next) stopHaptics();
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // The preference just will not survive a reload.
  }
}

export function stopHaptics() {
  if (!hapticsSupported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    // Nothing to cancel.
  }
}

function fire(pattern: number | number[]) {
  if (!enabled || !hapticsSupported()) return;
  if (Array.isArray(pattern) ? pattern.length === 0 : pattern <= 0) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Chrome throws instead of returning false when the frame has never been
    // tapped. Losing one buzz must never interrupt the game.
  }
}

export function haptic(event: HapticEvent) {
  fire(HAPTIC_PATTERNS[event]);
}

export function hapticBlockLanded(order: number) {
  fire(landingPulseMs(order));
}
