// Mostly procedural sound effects, synthesised live — same reasoning as
// `haptics.ts`'s vibration patterns. The exceptions are the five recordings
// layered in below (`public/shop` already set the precedent of shipping
// binary assets): `soundSandPour` under the settle animation,
// `playBulletOnSand` under `playImpact`, `soundButtonClick` for the bottom
// hub nav, `playWrongColor` for a shot that sorted nothing, and
// `playChestOpen` for the progression chest's lid — each because a
// synthesised stand-in never quite sold the real thing the way these do.
// There is no background music of any kind here (2026-09ae ask: "Xóa BGM
// luôn" — pulled outright, both the Freeze-phase loop and the always-on hub
// loop that had replaced the original always-on generative drone; see
// CHANGELOG-prototype.md).

const SFX_VOLUME_KEY = "cannon-sort:v1:sfx-volume";
const DEFAULT_VOLUME = 1;

export type SoundEvent =
  | "impact"
  | "wrongColor"
  | "bodyCleared"
  | "win"
  | "frameCleared"
  | "lose"
  | "uiClick"
  | "purchase"
  | "chestOpen"
  | "boosterRadius"
  | "boosterPrism"
  | "boosterChain";

// ---- per-source mixer (GameDevOption's Sound Editor) -----------------
// One multiplier per distinct sound source, on top of the player-facing SFX
// slider above (there is no Music slider any more — no BGM left to balance
// against it). Dev-only: a tester reaching for "make the pour louder"
// shouldn't have to touch code.

export const SOUND_SOURCE_IDS = [
  "impact",
  "wrongColor",
  "bodyCleared",
  "win",
  "frameCleared",
  "lose",
  "sandLanded",
  "sandPour",
  "buttonClick",
  "uiClick",
  "purchase",
  "chestOpen",
  "boosterRadius",
  "boosterPrism",
  "boosterChain",
] as const;

export type SoundSourceId = (typeof SOUND_SOURCE_IDS)[number];

const SOURCE_GAIN_KEY = "cannon-sort:v1:source-gains";
const DEFAULT_SOURCE_GAIN = 1;
/** How far past "authored volume" the editor's sliders reach — loud enough
 * to fix an undersized source (the ask that started this) without a slider
 * that is mostly empty headroom nobody uses. */
export const MAX_SOURCE_GAIN = 3;

function defaultSourceGains(): Record<SoundSourceId, number> {
  const gains = {} as Record<SoundSourceId, number>;
  for (const id of SOUND_SOURCE_IDS) gains[id] = DEFAULT_SOURCE_GAIN;
  // The pour recording and the per-grain landing ticks both read as quieter
  // than the synthesised one-shots at the same nominal gain — a real
  // recording vs. hand-tuned oscillator peaks never quite line up by ear —
  // so their *defaults* start boosted rather than relying on every tester
  // to discover and raise the same two sliders.
  gains.sandPour = 1.8;
  gains.sandLanded = 1.6;
  return gains;
}

function loadSourceGains(): Record<SoundSourceId, number> {
  const gains = defaultSourceGains();
  if (typeof window === "undefined") return gains;
  try {
    const raw = window.localStorage.getItem(SOURCE_GAIN_KEY);
    if (!raw) return gains;
    const parsed = JSON.parse(raw) as Partial<Record<SoundSourceId, unknown>>;
    for (const id of SOUND_SOURCE_IDS) {
      const value = parsed[id];
      if (typeof value === "number" && Number.isFinite(value)) {
        gains[id] = Math.min(MAX_SOURCE_GAIN, Math.max(0, value));
      }
    }
  } catch {
    // Same reasoning as `readStoredVolume` — corrupt/refused storage just
    // means every source starts at its own default.
  }
  return gains;
}

let sourceGains = loadSourceGains();

export function getSourceGain(id: SoundSourceId) {
  return sourceGains[id];
}

export function setSourceGain(id: SoundSourceId, value: number) {
  sourceGains[id] = Math.min(MAX_SOURCE_GAIN, Math.max(0, value));
  persistSourceGains();
}

/** Back to the shipped defaults (including the pour/landing boosts above) —
 * the editor's own "Reset" action. */
export function resetSourceGains() {
  sourceGains = defaultSourceGains();
  persistSourceGains();
}

function persistSourceGains() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOURCE_GAIN_KEY, JSON.stringify(sourceGains));
  } catch {
    // The mix just will not survive a reload.
  }
}

function clampVolume(value: number) {
  return Math.min(1, Math.max(0, value));
}

function readStoredVolume(key: string) {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return DEFAULT_VOLUME;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampVolume(parsed) : DEFAULT_VOLUME;
  } catch {
    // A file:// page or a privacy mode can refuse storage outright; sound
    // stays at its default rather than silently turning itself off.
    return DEFAULT_VOLUME;
  }
}

let sfxVolume = readStoredVolume(SFX_VOLUME_KEY);

export function getSfxVolume() {
  return sfxVolume;
}

export function soundSupported() {
  return typeof window !== "undefined" && Boolean(audioContextCtor());
}

export function setSfxVolume(next: number) {
  sfxVolume = clampVolume(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SFX_VOLUME_KEY, String(sfxVolume));
    } catch {
      // The preference just will not survive a reload.
    }
  }
  if (sfxVolumeGain) sfxVolumeGain.gain.value = sfxVolume;
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
/** The player-facing volume knob, downstream of `sfxBus`'s own internal
 * balance gain rather than replacing it, so the settings slider never
 * fights with `soundSandPour`'s own fade-out — it just multiplies whatever
 * that already produces. */
let sfxVolumeGain: GainNode | null = null;
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
  sfxVolumeGain = ctx.createGain();
  sfxVolumeGain.gain.value = sfxVolume;
  sfxBus.connect(sfxVolumeGain);
  sfxVolumeGain.connect(master);
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
  /** Defaults to "bandpass" — the resonant, slightly metallic character
   * everything but `playImpact` below wants. `playImpact` uses "lowpass"
   * instead: no resonant peak, so the noise reads as a dull, muffled thump
   * rather than something with an edge to it. */
  filterType?: BiquadFilterType;
  delay?: number;
  bus: GainNode;
};

function noiseHit(audio: AudioContext, opts: NoiseHitOptions) {
  const start = audio.currentTime + (opts.delay ?? 0);
  const end = start + opts.duration;
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer(audio);
  const filter = audio.createBiquadFilter();
  filter.type = opts.filterType ?? "bandpass";
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

function playImpact(audio: AudioContext, scale = 1) {
  // The ball landing on sand: a low synthesised "punch" (kept from the
  // 2026-09h/i "thục nhẹ vào canvas dày" passes — sub-bass, always available
  // with zero load delay, so even the very first shot of a session has
  // *some* weight under it) layered under `playBulletOnSand` below, the
  // actual recorded texture (2026-09l ask: "chọn file BulletOnSand để sử
  // dụng"). The old synthesised noise layer (a lowpass "poke") is gone —
  // once the recording is doing the textured half of the sound, keeping a
  // second synthesised texture under it just muddies the two together.
  //
  // `scale` (2026-09y ask: "sound impact khi sort cát sẽ lớn - nhỏ (100% -
  // 10%) dựa trên số cát xấp xỉ sort được") — the caller (`handleImpact` in
  // SandCannonEngine.ts) works out that 0.1..1 fraction from how many cells
  // this shot actually cleared and passes it through `sound(event, scale)`;
  // multiplying it into `g` here scales both layers together rather than
  // needing its own thread through `playBulletOnSand` separately.
  const g = getSourceGain("impact") * scale;
  tone(audio, { type: "sine", freq: 55, freqEnd: 24, duration: 0.2, peakGain: 0.34 * g, bus: sfxBus! });
  playBulletOnSand(audio, g);
}

// ---- the other recorded sample: a bullet landing in sand ---------------

const BULLET_ON_SAND_URL = "/sounds/bullet-on-sand.mp3";
/**
 * The chosen excerpt from the 44.7s source file (a long take of ~15 near-
 * identical hits back to back). Picked by measuring each hit's peak RMS and
 * picking the loudest, cleanest one — full silence on both sides (no bleed
 * from a neighbouring hit to trim around) and no clipping (peak sample
 * ~0.64 of full scale). Ends right as the transient's own decay trails into
 * a faint sandy hiss, before a second, smaller resettle "tick" a beat later
 * in the source — that tick is left out on purpose: the engine already has
 * its own synthesised per-grain landing ticks (`soundSandLanded`) for that
 * texture, so keeping this source's own here would double up on it.
 */
const BULLET_ON_SAND_OFFSET_S = 38.388;
const BULLET_ON_SAND_DURATION_S = 0.27;

let bulletOnSandBuffer: AudioBuffer | null = null;
let bulletOnSandLoading: Promise<AudioBuffer | null> | null = null;

function loadBulletOnSandBuffer(audio: AudioContext): Promise<AudioBuffer | null> {
  if (bulletOnSandBuffer) return Promise.resolve(bulletOnSandBuffer);
  if (bulletOnSandLoading) return bulletOnSandLoading;
  bulletOnSandLoading = fetch(BULLET_ON_SAND_URL)
    .then((res) => res.arrayBuffer())
    .then((data) => audio.decodeAudioData(data))
    .then((buffer) => {
      bulletOnSandBuffer = buffer;
      return buffer;
    })
    .catch(() => null);
  return bulletOnSandLoading;
}

/**
 * Layers the chosen excerpt of `bullet-on-sand.mp3` on top of `playImpact`'s
 * own synthesised thump. Same fire-and-forget shape as `soundSandPour`: the
 * decode is async, so the very first shot of a session can arrive without
 * this layer while the buffer loads (the sine thump above still plays, so
 * it is never silent), and a failed fetch/decode just means no texture that
 * one time.
 */
function playBulletOnSand(audio: AudioContext, sourceGain: number) {
  loadBulletOnSandBuffer(audio).then((buffer) => {
    if (!buffer || sfxVolume <= 0 || !sfxBus) return;
    try {
      const start = audio.currentTime;
      const dur = BULLET_ON_SAND_DURATION_S;
      const peak = 0.9 * sourceGain;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      const gain = audio.createGain();
      // A quick fade in/out rather than a hard start/stop — the excerpt
      // itself starts and ends in near-silence (see the comment on the
      // offset/duration above), so this is mostly insurance against a
      // sample-accurate click, not doing the real shaping work.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.005);
      gain.gain.setValueAtTime(peak, start + dur - 0.03);
      gain.gain.linearRampToValueAtTime(0.0001, start + dur);
      source.connect(gain);
      gain.connect(sfxBus);
      source.start(start, BULLET_ON_SAND_OFFSET_S, dur);
      source.stop(start + dur + 0.02);
    } catch {
      // Same reasoning as every other voice here.
    }
  });
}

// ---- the fourth recorded sample: a shot that found nothing to sort -------

const MISS_SHOT_URL = "/sounds/miss-shot.mp3";
/** The file is 4.7s but only one real event lives in it, from ~1.0s to
 * ~3.2s (measured the same peak-RMS way as `BULLET_ON_SAND_OFFSET_S`) — dead
 * air before and after. `MISS_SHOT_MAX_MS` is that event's own natural decay
 * length, not an arbitrary trim: the sound is a single swoosh-thud that
 * fades out on its own over ~2.2s, so this just skips the silence around it
 * rather than cutting the tail short. */
const MISS_SHOT_OFFSET_S = 1.0;
const MISS_SHOT_MAX_MS = 2200;

let missShotBuffer: AudioBuffer | null = null;
let missShotLoading: Promise<AudioBuffer | null> | null = null;

function loadMissShotBuffer(audio: AudioContext): Promise<AudioBuffer | null> {
  if (missShotBuffer) return Promise.resolve(missShotBuffer);
  if (missShotLoading) return missShotLoading;
  missShotLoading = fetch(MISS_SHOT_URL)
    .then((res) => res.arrayBuffer())
    .then((data) => audio.decodeAudioData(data))
    .then((buffer) => {
      missShotBuffer = buffer;
      return buffer;
    })
    .catch(() => null);
  return missShotLoading;
}

/**
 * Plays `miss-shot.mp3` for a shot that landed on sand but matched none of
 * it (2026-09w ask: "dùng sound này khi người chơi hit 1 phát bắn nhưng
 * không sort được bất cứ thứ gì") — replaces the old two-blip synthesised
 * "no" outright, the same way `bullet-on-sand.mp3` replaced `playImpact`'s
 * own noise layer. No synthesised fallback this time: `NO_MATCH` already has
 * a visible tell (the disc-shake beat in SandCannonEngine.ts), so a session's
 * very first miss arriving silent while the buffer loads is not a player
 * ever left with zero feedback, just one cue short of two for a beat.
 */
function playWrongColor(audio: AudioContext) {
  const g = getSourceGain("wrongColor");
  loadMissShotBuffer(audio).then((buffer) => {
    if (!buffer || sfxVolume <= 0 || !sfxBus) return;
    try {
      const start = audio.currentTime;
      const playMs = Math.min(MISS_SHOT_MAX_MS, (buffer.duration - MISS_SHOT_OFFSET_S) * 1000);
      const end = start + playMs / 1000;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      const peak = 0.7 * g;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(peak, start);
      // The recording already decays to near-silence on its own by `end` —
      // this fade is just insurance against a sample-accurate click on cut.
      gain.gain.setValueAtTime(peak, Math.max(start, end - 0.15));
      gain.gain.linearRampToValueAtTime(0.0001, end);
      source.connect(gain);
      gain.connect(sfxBus);
      source.start(start, MISS_SHOT_OFFSET_S, playMs / 1000);
      source.stop(end + 0.02);
    } catch {
      // Same reasoning as every other voice here.
    }
  });
}

function playBodyCleared(audio: AudioContext) {
  // A quick major-third pling — root and its third land almost together, the
  // third a hair behind so the interval is heard forming rather than struck
  // flat. Two octaves lower than the original G5/B5 (2026-09k ask: "tiếng
  // bíp khi trái bóng sort được cát trầm hơn") — same interval, same shape,
  // just sitting in G3/B3 instead of up where it read as a bright "beep".
  // A touch longer than before too: a low triangle wave needs more time to
  // actually sound like a pitch instead of a soft thud.
  const g = getSourceGain("bodyCleared");
  tone(audio, { type: "triangle", freq: 196.0, duration: 0.26, peakGain: 0.24 * g, bus: sfxBus! });
  tone(audio, { type: "triangle", freq: 246.94, duration: 0.28, peakGain: 0.18 * g, delay: 0.02, bus: sfxBus! });
}

function playWin(audio: AudioContext) {
  const g = getSourceGain("win");
  const notes = [MAJOR_PENTATONIC[0], MAJOR_PENTATONIC[2], MAJOR_PENTATONIC[4], MAJOR_PENTATONIC[5]];
  notes.forEach((freq, index) => {
    tone(audio, { type: "triangle", freq, duration: 0.28, peakGain: 0.22 * g, delay: index * 0.1, bus: sfxBus! });
  });
  // A soft sustained chord under the run, landing as the last note arrives.
  tone(audio, { type: "sine", freq: notes[0], duration: 0.9, peakGain: 0.12 * g, delay: notes.length * 0.1, bus: sfxBus! });
  tone(audio, { type: "sine", freq: notes[2], duration: 0.9, peakGain: 0.1 * g, delay: notes.length * 0.1, bus: sfxBus! });
}

/**
 * The "FRAME CLEARED!" card's own fanfare (2026-09ac ask: "UI frame cleared
 * thiếu sound... sound kiểu hân hoan, kèn vang lên") — `playWin` above
 * already fires the instant a WIN result comes back, but that is well before
 * the card itself appears: `SandGame.tsx` holds the card off screen for the
 * engine's own spin reveal (`playWinReveal`/`WIN_REVEAL_HOLD_MS`), so by the
 * time the card is on screen `playWin`'s own run has long since finished and
 * the card lands in silence. This plays instead, timed to that reveal
 * ending (see the `sound("frameCleared")` call next to `setWinReveal(false)`
 * in SandGame.tsx) — a short brassy trumpet-style fanfare (sawtooth voices,
 * not `playWin`'s soft triangle pentatonic) so the moment the card actually
 * appears gets its own distinct "ta-da" rather than reusing the same run.
 */
function playFrameCleared(audio: AudioContext) {
  const g = getSourceGain("frameCleared");
  const fanfare = [523.25, 523.25, 659.25, 783.99]; // C5 C5 E5 G5 — a short herald call
  fanfare.forEach((freq, index) => {
    tone(audio, {
      type: "sawtooth",
      freq,
      duration: index === fanfare.length - 1 ? 0.5 : 0.11,
      peakGain: 0.2 * g,
      delay: index * 0.12,
      bus: sfxBus!,
    });
    // A fifth stacked on top of each herald note for a brassier, chord-like
    // body instead of a single bare tone — quieter than the root so it reads
    // as harmonic shimmer, not a second competing melody.
    tone(audio, {
      type: "square",
      freq: freq * 1.5,
      duration: index === fanfare.length - 1 ? 0.5 : 0.11,
      peakGain: 0.09 * g,
      delay: index * 0.12,
      bus: sfxBus!,
    });
  });
  // A bright noise "shimmer" under the final held note, like a light cymbal
  // crash landing with the last horn blast.
  noiseHit(audio, {
    duration: 0.4,
    peakGain: 0.1 * g,
    filterType: "bandpass",
    filterFreq: 5000,
    filterFreqEnd: 3000,
    filterQ: 0.8,
    delay: (fanfare.length - 1) * 0.12,
    bus: sfxBus!,
  });
}

function playLose(audio: AudioContext) {
  const g = getSourceGain("lose");
  const notes = [392.0, 349.23, 293.66]; // G4 F4 D4 — a short, unhurried fall
  notes.forEach((freq, index) => {
    tone(audio, { type: "sine", freq, duration: 0.35, peakGain: 0.2 * g, delay: index * 0.18, bus: sfxBus! });
  });
}

/**
 * The generic "cạch" for every plain `<button>` in the app OTHER than the
 * bottom hub nav (2026-09o: "là sound tự tạo khác chứ không phải là nút ở
 * thanh tác vụ" — a *different*, synthesised click, not the hub nav's own
 * `button-click-menuhub.mp3` recording). Short and crisp on purpose: a
 * plasticky noise tick with a small pitched pop underneath, closer to a
 * mouse-click than any of the game's other cues — nothing here should be
 * mistaken for `wrongColor`'s dissonant blips or `sandLanded`'s soft ticks.
 */
function playUiClick(audio: AudioContext) {
  const g = getSourceGain("uiClick");
  noiseHit(audio, {
    duration: 0.03,
    peakGain: 0.22 * g,
    filterType: "bandpass",
    filterFreq: 3200,
    filterFreqEnd: 2000,
    filterQ: 1.4,
    bus: sfxBus!,
  });
  tone(audio, { type: "square", freq: 1200, freqEnd: 700, duration: 0.025, peakGain: 0.12 * g, bus: sfxBus! });
}

/**
 * A quick "ka-ching" for anything that spends or offers to spend currency —
 * boosters, skins, coin/heart packs, bundles, offers (2026-09p: "những nút
 * có liên quan đến việc mua, giao dịch, trao đổi... thì có sound 'kaching'
 * nhanh"). Two bright, fast tones (the "ka" then a higher "ching") plus a
 * short metallic shimmer of noise under the second one for a coin-like
 * sparkle — the whole thing done in well under 150ms, snappy rather than a
 * drawn-out fanfare (`playWin`'s job already, for the much rarer level-clear
 * moment).
 */
function playPurchase(audio: AudioContext) {
  const g = getSourceGain("purchase");
  tone(audio, { type: "square", freq: 1568.0, duration: 0.05, peakGain: 0.16 * g, bus: sfxBus! }); // G6 — "ka"
  tone(audio, { type: "triangle", freq: 2093.0, duration: 0.09, peakGain: 0.2 * g, delay: 0.045, bus: sfxBus! }); // C7 — "ching"
  noiseHit(audio, {
    duration: 0.05,
    peakGain: 0.14 * g,
    filterType: "bandpass",
    filterFreq: 6000,
    filterFreqEnd: 4000,
    filterQ: 3,
    delay: 0.045,
    bus: sfxBus!,
  });
}

// ---- the three booster buttons' own tap sounds ---------------------------
// One distinct cue per booster (2026-09ae ask: "Thêm SFX khi nhấn vào 3
// booster, mỗi booster có SFX khác nhau") — each shaped after what the
// booster actually does rather than reusing `playUiClick`'s generic "cạch",
// so a player can start to recognise which one they just armed by ear alone.
// Fires on every tap of a booster's own button (arming OR cancelling it —
// `armBooster` in SandGame.tsx toggles either way), not gated on the arm
// actually taking effect: same reasoning as `playUiClick`, a button that
// visibly cannot respond already reads as disabled, so tapping it staying
// silent (rather than these) is fine — see the `disabled` condition next to
// the booster buttons themselves.

/**
 * Radius Overcharge: a rising, widening "power up" sweep — a low sawtooth
 * gliding up in pitch alongside a noise swell opening its own filter, both
 * landing together at the top. Reads as something *expanding*, matching the
 * booster's own bigger-blast-radius effect.
 */
function playBoosterRadius(audio: AudioContext) {
  const g = getSourceGain("boosterRadius");
  tone(audio, { type: "sawtooth", freq: 140, freqEnd: 420, duration: 0.22, peakGain: 0.22 * g, bus: sfxBus! });
  noiseHit(audio, {
    duration: 0.22,
    peakGain: 0.14 * g,
    filterType: "bandpass",
    filterFreq: 500,
    filterFreqEnd: 2400,
    filterQ: 1.2,
    bus: sfxBus!,
  });
}

/**
 * Prism Shot: three quick, bright triangle notes in rapid succession
 * (rather than `playWin`'s slower stagger) each a little higher than the
 * last, plus a light high-frequency shimmer — a small "sparkle" run
 * matching the booster's own rainbow/multi-colour shot.
 */
function playBoosterPrism(audio: AudioContext) {
  const g = getSourceGain("boosterPrism");
  const notes = [1046.5, 1318.5, 1568.0]; // C6 E6 G6 — a bright rising sparkle
  notes.forEach((freq, index) => {
    tone(audio, { type: "triangle", freq, duration: 0.09, peakGain: 0.2 * g, delay: index * 0.05, bus: sfxBus! });
  });
  noiseHit(audio, {
    duration: 0.15,
    peakGain: 0.08 * g,
    filterType: "bandpass",
    filterFreq: 7000,
    filterFreqEnd: 9000,
    filterQ: 2,
    delay: notes.length * 0.05,
    bus: sfxBus!,
  });
}

/**
 * Chain Sort: a fast, rattling run of short percussive ticks (like links
 * clacking one after another) that snaps into a single lower, held note —
 * the "chain" catching and pulling taut — rather than either other
 * booster's smooth tone-based shape.
 */
function playBoosterChain(audio: AudioContext) {
  const g = getSourceGain("boosterChain");
  const tickCount = 4;
  for (let i = 0; i < tickCount; i += 1) {
    noiseHit(audio, {
      duration: 0.04,
      peakGain: 0.16 * g,
      filterType: "bandpass",
      filterFreq: 1800,
      filterQ: 3,
      delay: i * 0.045,
      bus: sfxBus!,
    });
  }
  tone(audio, { type: "square", freq: 220, freqEnd: 110, duration: 0.16, peakGain: 0.18 * g, delay: tickCount * 0.045, bus: sfxBus! });
}

// ---- the fifth recorded sample: a treasure chest opening -----------------

const TREASURE_CHEST_URL = "/sounds/treasure-chest-open.mp3";
/**
 * The whole 16s file, uncut: a creak-thud (0-0.8s), a beat of near-silence,
 * the actual lid-and-reveal swell (~1.1-2s, the loudest moment in the file),
 * then an 11+ second glinting reverb tail that decays gradually and
 * naturally to true silence on its own well before the buffer ends —
 * measured the same peak-RMS way as the other recordings here, nothing to
 * excerpt out of it. `MAX_MS` is only insurance (a fade-out, not a trim),
 * matching `buffer.duration` almost exactly.
 */
const TREASURE_CHEST_MAX_MS = 16000;

let treasureChestBuffer: AudioBuffer | null = null;
let treasureChestLoading: Promise<AudioBuffer | null> | null = null;

function loadTreasureChestBuffer(audio: AudioContext): Promise<AudioBuffer | null> {
  if (treasureChestBuffer) return Promise.resolve(treasureChestBuffer);
  if (treasureChestLoading) return treasureChestLoading;
  treasureChestLoading = fetch(TREASURE_CHEST_URL)
    .then((res) => res.arrayBuffer())
    .then((data) => audio.decodeAudioData(data))
    .then((buffer) => {
      treasureChestBuffer = buffer;
      return buffer;
    })
    .catch(() => null);
  return treasureChestLoading;
}

/**
 * The progression chest's lid opening (2026-09u ask: "Thêm âm thanh vào
 * progression chest khi chest được mở ra"; 2026-09aa follow-up: "Thêm sound
 * treasure chest opening, canh sao cho sound bật khi anim bật nắp chest
 * được thực hiện" — replaces the synthesised creak+sparkle from the first
 * pass with this recording outright). Triggered from the exact same call
 * site as before (`SandGame.tsx`'s chest state machine, the instant
 * `phase` flips to `"opening"`), which is also the exact instant
 * `ChestStage.setPhase` in chest-model.ts resets `this.time = 0` and starts
 * the lid's own 0.55s swing (`LID_SECONDS`) — so the recording's own
 * creak-thud onset and the lid's first visible movement land together.
 * No synthesised fallback: same reasoning as `playWrongColor`, the chest's
 * own spin-then-open animation is already a strong enough visual tell that
 * a session's very first chest opening slightly before the buffer finishes
 * loading is not a player left with zero feedback.
 */
/** Tracked so `stopChestOpen` can cut this specific voice short — the only
 * one-shot recording here long enough (up to 16s) that leaving the screen it
 * plays for needs to silence it rather than letting it ring out on its own. */
let chestOpenSource: AudioBufferSourceNode | null = null;
let chestOpenGain: GainNode | null = null;

function playChestOpen(audio: AudioContext) {
  const g = getSourceGain("chestOpen");
  loadTreasureChestBuffer(audio).then((buffer) => {
    if (!buffer || sfxVolume <= 0 || !sfxBus) return;
    try {
      const start = audio.currentTime;
      const playMs = Math.min(TREASURE_CHEST_MAX_MS, buffer.duration * 1000);
      const end = start + playMs / 1000;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      const peak = 0.8 * g;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(peak, start);
      gain.gain.setValueAtTime(peak, Math.max(start, end - 0.2));
      gain.gain.linearRampToValueAtTime(0.0001, end);
      source.connect(gain);
      gain.connect(sfxBus);
      source.start(start);
      source.stop(end + 0.02);
      chestOpenSource = source;
      chestOpenGain = gain;
      // Once it finishes on its own (Collect never tapped, or the source
      // outlives `stopChestOpen`'s own fade), drop the references so a
      // later `stopChestOpen` call is not fading out a dead, disconnected
      // node — `onended` fires for a natural end exactly like a forced
      // `.stop()`, so this alone is enough to keep the two in sync.
      source.onended = () => {
        if (chestOpenSource === source) {
          chestOpenSource = null;
          chestOpenGain = null;
        }
      };
    } catch {
      // Same reasoning as every other voice here.
    }
  });
}

/**
 * Cuts the chest-opening recording short (2026-09ab ask: "Khi thoát khỏi
 * chest progression thì lập tức tắt sound") — called from the "Collect"
 * button's own handler in SandGame.tsx, since that is the only way off the
 * reward screen and the file itself can otherwise still be ringing out its
 * long reverb tail (up to 16s) well after the player has already left. A
 * quick fade rather than an instant cut, so leaving does not read as an
 * audible click.
 */
export function stopChestOpen() {
  if (!ctx || !chestOpenSource) return;
  const audio = ctx;
  const source = chestOpenSource;
  const gain = chestOpenGain;
  chestOpenSource = null;
  chestOpenGain = null;
  const stopAt = audio.currentTime + 0.08;
  if (gain) {
    gain.gain.cancelScheduledValues(audio.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, audio.currentTime);
    gain.gain.linearRampToValueAtTime(0.0001, stopAt);
  }
  try {
    source.stop(stopAt + 0.02);
  } catch {
    // Already stopped/never started — nothing to do.
  }
}

const SOUND_EFFECTS: Record<SoundEvent, (audio: AudioContext, scale?: number) => void> = {
  impact: playImpact,
  wrongColor: playWrongColor,
  bodyCleared: playBodyCleared,
  win: playWin,
  frameCleared: playFrameCleared,
  lose: playLose,
  chestOpen: playChestOpen,
  uiClick: playUiClick,
  purchase: playPurchase,
  boosterRadius: playBoosterRadius,
  boosterPrism: playBoosterPrism,
  boosterChain: playBoosterChain,
};

/**
 * `scale` (default 1, i.e. every existing call site is unaffected) is only
 * read by `playImpact` today — see its own comment — but lives on the
 * shared dispatcher rather than a one-off second `sound()` export so any
 * other event that later wants the same "how much of this shot mattered"
 * volume scaling gets it for free.
 */
export function sound(event: SoundEvent, scale = 1) {
  if (sfxVolume <= 0) return;
  const audio = getContext();
  if (!audio || !sfxBus) return;
  try {
    SOUND_EFFECTS[event](audio, scale);
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
  if (sfxVolume <= 0 || order >= LANDING_MAX_TICKS) return;
  const audio = getContext();
  if (!audio || !sfxBus) return;
  try {
    const decay = 1 - order / LANDING_MAX_TICKS;
    noiseHit(audio, {
      duration: 0.035,
      peakGain: 0.07 * decay * getSourceGain("sandLanded"),
      filterFreq: 2200,
      filterQ: 2,
      bus: sfxBus,
    });
  } catch {
    // Same reasoning as `sound()` — never worth interrupting play over.
  }
}

// ---- the one recorded sample: a pour ----------------------------------
// `soundSandLanded` above already ticks per landing group; this plays
// underneath it, once per settle sequence, as the sustained "whoosh" a
// handful of noise-hits can't really fake.

const SAND_POUR_URL = "/sounds/sand-pour.mp3";
/**
 * Longest a single pour is allowed to ring on for. Matches the engine's own
 * `SETTLE_TOTAL_MS + SETTLE_TAIL_MS` (350 + 130 — the fall plus its settle
 * beat, timed from the same first-grain-pass moment this fires on): the
 * original 900ms outlasted that by a good margin, so the recording's own
 * hiss/noise tail kept ringing on its own for a few hundred ms *after* the
 * board visibly stopped moving — heard, isolated with nothing else playing
 * over it, as a leftover "xoẹt" scratch rather than part of the pour.
 */
const SAND_POUR_MAX_MS = 480;

let sandPourBuffer: AudioBuffer | null = null;
let sandPourLoading: Promise<AudioBuffer | null> | null = null;

function loadSandPourBuffer(audio: AudioContext): Promise<AudioBuffer | null> {
  if (sandPourBuffer) return Promise.resolve(sandPourBuffer);
  if (sandPourLoading) return sandPourLoading;
  sandPourLoading = fetch(SAND_POUR_URL)
    .then((res) => res.arrayBuffer())
    .then((data) => audio.decodeAudioData(data))
    .then((buffer) => {
      sandPourBuffer = buffer;
      return buffer;
    })
    .catch(() => null);
  return sandPourLoading;
}

/**
 * Plays `sand-pour.mp3` once, timed to the start of a settle sequence's
 * falling. Fire-and-forget like every other cue here: the decode is async
 * (so the very first pour of a session can arrive a beat late while the
 * buffer loads), and a failed fetch/decode just means no whoosh that time —
 * never worth surfacing to the player.
 */
export function soundSandPour() {
  if (sfxVolume <= 0) return;
  const audio = getContext();
  if (!audio || !sfxBus) return;
  loadSandPourBuffer(audio).then((buffer) => {
    if (!buffer || sfxVolume <= 0 || !sfxBus) return;
    try {
      const start = audio.currentTime;
      const playMs = Math.min(SAND_POUR_MAX_MS, buffer.duration * 1000);
      const end = start + playMs / 1000;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      const peak = 0.5 * getSourceGain("sandPour");
      const gain = audio.createGain();
      gain.gain.setValueAtTime(peak, start);
      // A fade-out rather than a hard cutoff, so trimming a longer recording
      // down to `SAND_POUR_MAX_MS` never reads as a clipped edit — wide
      // enough (0.2s of a 0.48s window) that the recording's own tail is
      // well into silence rather than merely quieter by the time it ends.
      gain.gain.setValueAtTime(peak, Math.max(start, end - 0.2));
      gain.gain.linearRampToValueAtTime(0.0001, end);
      source.connect(gain);
      gain.connect(sfxBus);
      source.start(start);
      source.stop(end + 0.02);
    } catch {
      // Same reasoning as every other voice here.
    }
  });
}

// ---- the third recorded sample: a UI button click ----------------------
// The bottom hub nav's own tap sound (2026-09m ask: "trong file có button-
// click-menuhub là âm thanh khi người chơi nhấn vào thanh tác vụ dưới đáy,
// hãy áp dụng vào"). One clean 0.24s click, already silent on both ends —
// unlike `bullet-on-sand.mp3` there was nothing to excerpt, the whole file
// is the sound.

const BUTTON_CLICK_URL = "/sounds/button-click-menuhub.mp3";
/** The recording sits very quiet on its own (peak sample ≈0.05 of full
 * scale) — this brings it up to roughly the same order of magnitude as the
 * other one-shots' own `peakGain` constants before `sfxBus`'s shared 0.55
 * balance and the player's own SFX slider apply on top. */
const BUTTON_CLICK_PEAK = 5;

let buttonClickBuffer: AudioBuffer | null = null;
let buttonClickLoading: Promise<AudioBuffer | null> | null = null;

function loadButtonClickBuffer(audio: AudioContext): Promise<AudioBuffer | null> {
  if (buttonClickBuffer) return Promise.resolve(buttonClickBuffer);
  if (buttonClickLoading) return buttonClickLoading;
  buttonClickLoading = fetch(BUTTON_CLICK_URL)
    .then((res) => res.arrayBuffer())
    .then((data) => audio.decodeAudioData(data))
    .then((buffer) => {
      buttonClickBuffer = buffer;
      return buffer;
    })
    .catch(() => null);
  return buttonClickLoading;
}

/**
 * Plays `button-click-menuhub.mp3` in full. Fire-and-forget like the other
 * two recordings: the decode is async, so the very first tap of a session
 * can arrive silent while the buffer loads, and a failed fetch/decode just
 * means no click that time — a UI tap sound is the least of these three
 * worth ever surfacing a failure for.
 */
export function soundButtonClick() {
  if (sfxVolume <= 0) return;
  const audio = getContext();
  if (!audio || !sfxBus) return;
  loadButtonClickBuffer(audio).then((buffer) => {
    if (!buffer || sfxVolume <= 0 || !sfxBus) return;
    try {
      const start = audio.currentTime;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      const gain = audio.createGain();
      gain.gain.value = BUTTON_CLICK_PEAK * getSourceGain("buttonClick");
      source.connect(gain);
      gain.connect(sfxBus);
      source.start(start);
      source.stop(start + buffer.duration + 0.02);
    } catch {
      // Same reasoning as every other voice here.
    }
  });
}

/** Suspends the whole audio graph — used when the tab goes hidden, so a
 * still-decaying one-shot does not keep ringing on (and drifting out of its
 * own schedule) behind a background tab. */
export function suspendSound() {
  ctx?.suspend().catch(() => {});
}

/** Resumes after `suspendSound` — harmless to resume unconditionally now that
 * muting is per-channel volume rather than one context-wide switch; a
 * context at 0/0 volume just resumes into silence. */
export function resumeSound() {
  ctx?.resume().catch(() => {});
}
