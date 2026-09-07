// A player-facing preference, same shape as sound.ts/haptics.ts: a plain
// module variable read once from localStorage, with a setter that persists
// it back. `SandCannonEngine.setControlSensitivity` is what actually applies
// the number (see SandGame.tsx's effect) — this module only owns storing and
// clamping it.
import { MAX_CONTROL_SENSITIVITY, MIN_CONTROL_SENSITIVITY } from "./SandCannonEngine";

const STORAGE_KEY = "cannon-sort:v1:aim-sensitivity";
const DEFAULT_AIM_SENSITIVITY = 1;

function clamp(value: number) {
  return Math.min(MAX_CONTROL_SENSITIVITY, Math.max(MIN_CONTROL_SENSITIVITY, value));
}

function readStoredSensitivity() {
  if (typeof window === "undefined") return DEFAULT_AIM_SENSITIVITY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? DEFAULT_AIM_SENSITIVITY : Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_AIM_SENSITIVITY;
  } catch {
    // A file:// page or a privacy mode can refuse storage outright.
    return DEFAULT_AIM_SENSITIVITY;
  }
}

let sensitivity = readStoredSensitivity();

export function getAimSensitivity() {
  return sensitivity;
}

export function setAimSensitivity(next: number) {
  sensitivity = clamp(next);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(sensitivity));
  } catch {
    // The preference just will not survive a reload.
  }
}
