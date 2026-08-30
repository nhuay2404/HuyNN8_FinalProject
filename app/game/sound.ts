// Procedural sound effects and ambient music — no audio files anywhere. Same
// reasoning as `haptics.ts`'s vibration patterns: this project ships as a
// single offline HTML page (README's `outputs/3d-cannon-sort.html`, no
// server, no network), so a `.mp3` would be the first binary asset the build
// has to manage and the first thing licensing has to be checked on. A
// handful of oscillators, synthesised live, needs neither.

const STORAGE_KEY = "cannon-sort:v1:sound";

export type SoundEvent =
  | "impact"
  | "wrongColor"
  | "bodyCleared"
  | "win"
  | "lose";

function readStoredPreference() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // A file:// page or a privacy mode can refuse storage outright; sound
    // stays on rather than silently turning itself off.
    return true;
  }
}

let enabled = readStoredPreference();
/** Whether the caller last asked for ambience to be playing — remembered so
 * toggling sound back on mid-level resumes it instead of leaving it off. */
let ambienceWanted = false;

export function isSoundEnabled() {
  return enabled;
}

export function soundSupported() {
  return typeof window !== "undefined" && Boolean(audioContextCtor());
}

export function setSoundEnabled(next: boolean) {
  enabled = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // The preference just will not survive a reload.
    }
  }
  if (!next) stopAmbience(true);
  else if (ambienceWanted) startAmbience();
}

// ---- the shared audio graph -----------------------------------------------
// One AudioContext, one master bus, for the whole page — a fresh context per
// engine instance would each fight to unlock separately and would leak nodes
// every time a level is torn down and rebuilt.

function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBufferCache: AudioBuffer | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.55;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(master);
  attachUnlockListeners(ctx);
  return ctx;
}

/**
 * Browsers refuse to start an AudioContext before a real user gesture. One
 * shared set of listeners — harmless to leave attached, `resume()` on an
 * already-running context is a no-op — catches the first tap/click/key
 * anywhere on the page, so sound unlocks the moment the player touches
 * anything rather than only if they happen to tap the exact node that first
 * tried to play something.
 */
function attachUnlockListeners(audio: AudioContext) {
  const unlock = () => {
    if (audio.state === "suspended") audio.resume().catch(() => {});
  };
  for (const type of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(type, unlock, { passive: true });
  }
}

/** A second or so of white noise, generated once and replayed at whatever
 * rate/filter each hit wants — cheaper than building a fresh buffer per shot. */
function noiseBuffer(audio: AudioContext): AudioBuffer {
  if (noiseBufferCache) return noiseBufferCache;
  const length = Math.floor(audio.sampleRate * 1);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBufferCache = buffer;
  return buffer;
}

// ---- one-shot voices --------------------------------------------------
// Every helper below schedules its own nodes and lets them finish and be
// garbage-collected on their own — nothing here is long-lived except the
// bus nodes and (for ambience) the drone oscillators.

type ToneOptions = {
  type: OscillatorType;
  freq: number;
  /** Pitch glides linearly from `freq` to this over `duration`, if set. */
  freqEnd?: number;
  duration: number;
  peakGain: number;
  /** Seconds from "now" this voice starts — lets a chord be staggered. */
  delay?: number;
  bus: GainNode;
};

function tone(audio: AudioContext, opts: ToneOptions) {
  const start = audio.currentTime + (opts.delay ?? 0);
  const end = start + opts.duration;
  const osc = audio.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freq, start);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), end);
  }
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(opts.peakGain, start + Math.min(0.015, opts.duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain);
  gain.connect(opts.bus);
  osc.start(start);
  osc.stop(end + 0.02);
}

type NoiseHitOptions = {
  duration: number;
  peakGain: number;
  filterFreq: number;
  filterFreqEnd?: number;
  filterQ?: number;
  delay?: number;
  bus: GainNode;
};

function noiseHit(audio: AudioContext, opts: NoiseHitOptions) {
  const start = audio.currentTime + (opts.delay ?? 0);
  const end = start + opts.duration;
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer(audio);
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = opts.filterQ ?? 1;
  filter.frequency.setValueAtTime(opts.filterFreq, start);
  if (opts.filterFreqEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, opts.filterFreqEnd), end);
  }
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(opts.peakGain, start + Math.min(0.01, opts.duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(opts.bus);
  source.start(start);
  source.stop(end + 0.02);
}

// ---- event sound effects ----------------------------------------------
// Mirrors `HAPTIC_PATTERNS` in shape (one entry per event) but each entry is
// a little composition rather than a single number, because a listened-to
// cue carries more than a felt one and has room to say more.

const MAJOR_PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50]; // C5 D5 E5 G5 A5 C6

function playImpact(audio: AudioContext) {
  noiseHit(audio, { duration: 0.09, peakGain: 0.5, filterFreq: 900, filterFreqEnd: 220, filterQ: 0.8, bus: sfxBus! });
  tone(audio, { type: "sine", freq: 160, freqEnd: 55, duration: 0.1, peakGain: 0.35, bus: sfxBus! });
}

function playWrongColor(audio: AudioContext) {
  // Two short, slightly-detuned blips — a "no" rather than a "yes", felt as
  // dissonant without being unpleasant.
  tone(audio, { type: "square", freq: 220, duration: 0.07, peakGain: 0.18, bus: sfxBus! });
  tone(audio, { type: "square", freq: 196, duration: 0.09, peakGain: 0.18, delay: 0.08, bus: sfxBus! });
}

function playBodyCleared(audio: AudioContext) {
  // A bright, quick major-third pling — root and its third land almost
  // together, the third a hair behind so the interval is heard forming
  // rather than struck flat.
  tone(audio, { type: "triangle", freq: 783.99, duration: 0.22, peakGain: 0.22, bus: sfxBus! });
  tone(audio, { type: "triangle", freq: 987.77, duration: 0.24, peakGain: 0.16, delay: 0.02, bus: sfxBus! });
}

function playWin(audio: AudioContext) {
  const notes = [MAJOR_PENTATONIC[0], MAJOR_PENTATONIC[2], MAJOR_PENTATONIC[4], MAJOR_PENTATONIC[5]];
  notes.forEach((freq, index) => {
    tone(audio, { type: "triangle", freq, duration: 0.28, peakGain: 0.22, delay: index * 0.1, bus: sfxBus! });
  });
  // A soft sustained chord under the run, landing as the last note arrives.
  tone(audio, { type: "sine", freq: notes[0], duration: 0.9, peakGain: 0.12, delay: notes.length * 0.1, bus: sfxBus! });
  tone(audio, { type: "sine", freq: notes[2], duration: 0.9, peakGain: 0.1, delay: notes.length * 0.1, bus: sfxBus! });
}

function playLose(audio: AudioContext) {
  const notes = [392.0, 349.23, 293.66]; // G4 F4 D4 — a short, unhurried fall
  notes.forEach((freq, index) => {
    tone(audio, { type: "sine", freq, duration: 0.35, peakGain: 0.2, delay: index * 0.18, bus: sfxBus! });
  });
}

const SOUND_EFFECTS: Record<SoundEvent, (audio: AudioContext) => void> = {
  impact: playImpact,
  wrongColor: playWrongColor,
  bodyCleared: playBodyCleared,
  win: playWin,
  lose: playLose,
};

export function sound(event: SoundEvent) {
  if (!enabled) return;
  const audio = getContext();
  if (!audio || !sfxBus) return;
  try {
    SOUND_EFFECTS[event](audio);
  } catch {
    // A synthesis call throwing (a detached context, an exhausted node
    // count) must never interrupt the game over a sound.
  }
}

/** A very soft tick per grain-landing group, capped and decaying exactly the
 * way `hapticSandLanded`'s pulses do — so a tall collapse still reads as
 * pouring rather than turning into a rattle of clicks. */
const LANDING_MAX_TICKS = 6;

export function soundSandLanded(order: number) {
  if (!enabled || order >= LANDING_MAX_TICKS) return;
  const audio = getContext();
  if (!audio || !sfxBus) return;
  try {
    const decay = 1 - order / LANDING_MAX_TICKS;
    noiseHit(audio, {
      duration: 0.035,
      peakGain: 0.07 * decay,
      filterFreq: 2200,
      filterQ: 2,
      bus: sfxBus,
    });
  } catch {
    // Same reasoning as `sound()` — never worth interrupting play over.
  }
}

// ---- ambient background music ------------------------------------------
// A generative pad rather than a fixed loop: a slow two-oscillator drone
// underneath, plus soft bell-like notes dropped in from a pentatonic scale at
// randomised intervals, so the same level does not play back an audibly
// identical few seconds on repeat the way a short loop would.

let droneOscillators: OscillatorNode[] = [];
let droneGain: GainNode | null = null;
let ambienceTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every start/stop; a scheduled note checks it is still current
 * before playing, which is what lets `stopAmbience` cancel the recursive
 * scheduler without having to track a chain of timeout ids. */
let ambienceToken = 0;

const DRONE_NOTES_HZ = [130.81, 196.0]; // C3, G3 — a bare fifth, calm rather than resolved

function scheduleNextPadNote(audio: AudioContext, token: number) {
  if (token !== ambienceToken || !musicBus) return;
  const freq = MAJOR_PENTATONIC[Math.floor(Math.random() * MAJOR_PENTATONIC.length)] / 2;
  tone(audio, { type: "sine", freq, duration: 2.4, peakGain: 0.05, bus: musicBus });
  tone(audio, { type: "triangle", freq: freq * 2, duration: 1.8, peakGain: 0.02, delay: 0.05, bus: musicBus });
  const nextIn = 2600 + Math.random() * 3200;
  ambienceTimer = setTimeout(() => scheduleNextPadNote(audio, token), nextIn);
}

/**
 * Starts the ambient loop, or remembers to once sound/context is available —
 * `setSoundEnabled(true)` and the unlock listeners both call this again once
 * their condition is met, so a level entered before the first tap still gets
 * music the moment audio unlocks.
 */
export function startAmbience() {
  ambienceWanted = true;
  if (!enabled || droneOscillators.length) return;
  const audio = getContext();
  if (!audio || !musicBus) return;

  ambienceToken += 1;
  const token = ambienceToken;

  droneGain = audio.createGain();
  droneGain.gain.setValueAtTime(0, audio.currentTime);
  droneGain.gain.linearRampToValueAtTime(1, audio.currentTime + 3);
  droneGain.connect(musicBus);

  droneOscillators = DRONE_NOTES_HZ.map((freq, index) => {
    const osc = audio.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    // A whisper of detune between the pair so the fifth beats very slowly —
    // the one thing that keeps a static drone from reading as a dead tone.
    osc.detune.value = index === 0 ? -3 : 3;
    const voiceGain = audio.createGain();
    voiceGain.gain.value = index === 0 ? 0.045 : 0.025;
    osc.connect(voiceGain);
    voiceGain.connect(droneGain!);
    osc.start();
    return osc;
  });

  // Musicbus fades in with the drone rather than snapping to its resting
  // volume, so entering a level is not an audible jump-cut into ambience.
  musicBus.gain.cancelScheduledValues(audio.currentTime);
  musicBus.gain.setValueAtTime(musicBus.gain.value, audio.currentTime);
  musicBus.gain.linearRampToValueAtTime(1, audio.currentTime + 2);

  scheduleNextPadNote(audio, token);
}

/**
 * Stops the ambient loop. `immediate` skips the fade-out — used when the
 * player turns sound off entirely, where a lingering tail would contradict
 * the toggle they just flipped; leaving a level normally fades instead.
 */
export function stopAmbience(immediate = false) {
  ambienceWanted = false;
  ambienceToken += 1;
  if (ambienceTimer !== null) {
    clearTimeout(ambienceTimer);
    ambienceTimer = null;
  }
  if (!ctx || !droneOscillators.length) {
    droneOscillators = [];
    return;
  }
  const audio = ctx;
  const oscillators = droneOscillators;
  const gain = droneGain;
  droneOscillators = [];
  droneGain = null;
  const fadeSeconds = immediate ? 0.05 : 1.2;
  const stopAt = audio.currentTime + fadeSeconds;
  if (gain) {
    gain.gain.cancelScheduledValues(audio.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, audio.currentTime);
    gain.gain.linearRampToValueAtTime(0.0001, stopAt);
  }
  for (const osc of oscillators) osc.stop(stopAt + 0.05);
}

/** Suspends the whole audio graph — used when the tab goes hidden, so
 * ambience does not keep playing (and drifting out of its own schedule)
 * behind a background tab. */
export function suspendSound() {
  ctx?.suspend().catch(() => {});
}

/** Resumes after `suspendSound`, only if sound is still enabled — a tab that
 * comes back after the player turned sound off must not turn it back on. */
export function resumeSound() {
  if (!enabled) return;
  ctx?.resume().catch(() => {});
}
