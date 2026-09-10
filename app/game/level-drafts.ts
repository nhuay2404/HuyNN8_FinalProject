// A level as the editor holds it, and the two directions it can travel:
// into the game to be played, and out as TypeScript to be committed.
//
// A draft is deliberately NOT a `SandLevelConfig`. It carries only what an
// author decides — the picture, the wheel, the reach, the budget — while every
// rule the game plays under stays in `RADIUS_GAMEPLAY`. `draftToLevel` is the
// single place the two are joined, so a level tested in the editor and a level
// pasted into `sand-levels.ts` cannot drift apart.

import {
  DEFAULT_FREEZE_DURATION,
  FREEZE_LETTER,
  KEY_LETTER,
  WALL_LETTER,
  expandLevelForPixelBoard,
  parseSandLevel,
  runGrainSettle,
} from "./sand-rules.ts";
import {
  RADIUS_GAMEPLAY,
  SAND_COLORS,
  type BoosterType,
  type SandColor,
  type SandLevelConfig,
} from "./sand-types.ts";

const STORAGE_KEY = "sand-cannon:v1:level-drafts";

/**
 * Board bounds, in **simulated pixels**.
 *
 * The editor draws the real board now, not a small blueprint that gets blown up
 * at load. A blueprint was a lie the author had to keep in their head: they
 * placed a 12-cell picture and the game ran a 60-pixel one, so nothing they
 * drew was quite the thing that would be played. Painting at the true
 * resolution costs a brush-size control and buys an editor that shows the
 * level.
 *
 * `DEFAULT_WIDTH`/`DEFAULT_HEIGHT` are what the shipped levels run at.
 */
export const MIN_DIMENSION = 12;
export const MAX_WIDTH = 90;
export const MAX_HEIGHT = 100;
export const DEFAULT_WIDTH = 60;
export const DEFAULT_HEIGHT = 70;

/**
 * How many simulated pixels a board may cost.
 *
 * Settling is the expensive part and it grows with the pixel count. 4,500 is
 * the size the shipped levels run at (60x70), measured at well under 40ms a
 * settle. Past it the editor warns rather than refuses — it is a comfort
 * budget, not a rule.
 */
export const PIXEL_BUDGET = 4500;
export const MAX_PIXEL_SCALE = 6;

export const LETTER_BY_SAND_COLOR: Record<SandColor, string> = {
  red: "R",
  green: "G",
  yellow: "Y",
  blue: "B",
  purple: "P",
  orange: "O",
  cyan: "C",
  pink: "M",
  lime: "L",
  brown: "N",
  white: "S",
  black: "D",
  // The six added past the original 12 — same free-letter pool R G Y B P O
  // C M L N S D already used up (plus K/W, spoken for by the key and Wall
  // Obstacle).
  grass: "A",
  teal: "T",
  skyblue: "U",
  indigo: "I",
  magenta: "F",
  crimson: "E",
  // A third batch — same free-letter pool reasoning as the six above,
  // against what H J Q V X Z is what was left once R G Y B P O C M L N S D
  // A T U I F E and K/W were all spoken for. See `SAND_COLOR_BY_LETTER`
  // (sand-rules.ts), the reverse direction of this exact same mapping.
  darkbrown: "H",
  violet: "J",
  navy: "Q",
  emerald: "V",
  rust: "X",
  mint: "Z",
};

export const EMPTY_CELL = ".";
/** The key's letter, re-exported so the editor never has to spell it itself. */
export { DEFAULT_FREEZE_DURATION, FREEZE_LETTER, KEY_LETTER, WALL_LETTER };

/** The same colour, frozen. Lower case is the whole representation of a lock. */
export function lockedLetter(color: SandColor) {
  return LETTER_BY_SAND_COLOR[color].toLowerCase();
}

/** What a cell holds, for an editor that has to draw five different things. */
export function readCell(letter: string): { kind: "empty" } | { kind: "key" } | { kind: "wall" } | { kind: "freeze" }
  | { kind: "sand"; color: SandColor; locked: boolean } {
  if (letter === KEY_LETTER) return { kind: "key" };
  if (letter === WALL_LETTER) return { kind: "wall" };
  if (letter === FREEZE_LETTER) return { kind: "freeze" };
  const color = SAND_COLORS.find((entry) => LETTER_BY_SAND_COLOR[entry] === letter.toUpperCase());
  if (!color) return { kind: "empty" };
  return { kind: "sand", color, locked: letter === letter.toLowerCase() };
}

export type LevelDraft = {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Top row first, one letter per cell, `.` for empty — the same shape a level uses. */
  rows: string[];
  /** A second grid over the same frame, same shape as `rows` — `@` marks a
   * Freeze trigger hidden behind whatever `rows` draws at that cell (on
   * request: "freeze bị che sau lớp cát"). Absent for every draft that has
   * never used the Freeze tool's hidden mode — see `SandLevelConfig.hiddenFreezeRows`. */
  hiddenFreezeRows?: string[];
  ammoQueue: SandColor[];
  sortRadius: number;
  shotLimit: number;
  /** null means "fit it to the pixel budget for me". */
  pixelScale: number | null;
  /** 0–1, how strongly a key resists rolling sideways. Absent is the same as 0. */
  keyFriction?: number;
  /** How many shots a Freeze Map trigger freezes the board for. Absent (or 0)
   * with no `@` painted means nothing; absent with a trigger painted falls
   * back to `DEFAULT_FREEZE_DURATION` at play time, same as `keyFriction`
   * falling back to 0. */
  freezeDuration?: number;
  /** Pins exact colours to the first N shots of a fresh attempt — see
   * `SandLevelConfig.forcedOpeningQueue`. Not editable from the editor UI
   * (no control writes to it); carried through import/export round-trips
   * only so a hand-authored level that already has one doesn't lose it the
   * next time it's saved from here. */
  forcedOpeningQueue?: SandColor[];
  /** See `SandLevelConfig.ftueFreezeDemo` — same "carried through, not
   * editable here" reasoning as `forcedOpeningQueue` above. */
  ftueFreezeDemo?: boolean;
  /** See `SandLevelConfig.ftueFreezeTargets` — same "carried through, not
   * editable here" reasoning as `forcedOpeningQueue` above. */
  ftueFreezeTargets?: { x: number; y: number }[];
  /** See `SandLevelConfig.forcedBoosterCharges` — same "carried through,
   * not editable here" reasoning as `forcedOpeningQueue` above. */
  forcedBoosterCharges?: Partial<Record<BoosterType, number>>;
  /** See `SandLevelConfig.ftueBoosterDemo` — same "carried through, not
   * editable here" reasoning as `forcedOpeningQueue` above. */
  ftueBoosterDemo?: boolean;
  /** See `SandLevelConfig.ftueBoosterTargets` — same "carried through, not
   * editable here" reasoning as `forcedOpeningQueue` above. */
  ftueBoosterTargets?: { x: number; y: number }[];
  /**
   * Set by `levelToDraft` when this draft came from "Import built-in" — the
   * numeric id of the `SandLevelConfig` it was copied from. What lets the
   * editor's "Update built-in level" button (see LevelEditor.tsx) write back
   * to that same hand-authored const in sand-levels.ts instead of shipping
   * as a brand new level the way an ordinary draft does. Absent for every
   * other draft (a fresh "+ New", an image import, a duplicate of one of
   * those) — those have no built-in level to write back to.
   */
  importedFromId?: number;
  updatedAt: number;
};

/** Bounds the friction slider is allowed to reach. */
export const MIN_KEY_FRICTION = 0;
export const MAX_KEY_FRICTION = 1;

/**
 * The biggest whole-number scale that keeps a board inside the pixel budget.
 *
 * Integer only, because `expandLevelForPixelBoard` relies on uniform integer
 * upscaling to leave the puzzle untouched — a fractional scale would resample
 * the picture and could merge or split regions.
 */
export function autoPixelScale(width: number, height: number) {
  const cells = Math.max(1, width * height);
  const fit = Math.floor(Math.sqrt(PIXEL_BUDGET / cells));
  return Math.max(1, Math.min(MAX_PIXEL_SCALE, fit));
}

export function effectivePixelScale(draft: LevelDraft) {
  return draft.pixelScale ?? autoPixelScale(draft.width, draft.height);
}

/** The editor's bounds, applied wherever a dimension enters the model. */
export function clampDimensions(width: number, height: number) {
  return {
    width: Math.max(MIN_DIMENSION, Math.min(MAX_WIDTH, Math.round(width))),
    height: Math.max(MIN_DIMENSION, Math.min(MAX_HEIGHT, Math.round(height))),
  };
}

export function blankRows(width: number, height: number) {
  return Array.from({ length: height }, () => EMPTY_CELL.repeat(width));
}

/**
 * Colours actually painted in the picture, in palette order.
 *
 * Locked sand counts. It is only frozen for now — the moment a key opens it,
 * that colour needs a bullet, so it belongs in the wheel from the start.
 */
export function coloursUsed(draft: LevelDraft): SandColor[] {
  const present = new Set(draft.rows.join(""));
  return SAND_COLORS.filter((color) =>
    present.has(LETTER_BY_SAND_COLOR[color]) || present.has(lockedLetter(color)));
}

/** Whether the picture has any frozen sand, any key to open it with, and any
 * Freeze Map trigger. */
export function fixtureCounts(draft: LevelDraft) {
  let locked = 0;
  let keys = 0;
  let freeze = 0;
  for (const letter of draft.rows.join("")) {
    if (letter === KEY_LETTER) keys += 1;
    else if (letter === FREEZE_LETTER) freeze += 1;
    else if (readCell(letter).kind === "sand" && letter === letter.toLowerCase()) locked += 1;
  }
  let hiddenFreeze = 0;
  for (const letter of (draft.hiddenFreezeRows ?? []).join("")) {
    if (letter === FREEZE_LETTER) hiddenFreeze += 1;
  }
  return { locked, keys, freeze, hiddenFreeze };
}

export function countPaintedCells(draft: LevelDraft) {
  return [...draft.rows.join("")].filter((letter) => letter !== EMPTY_CELL).length;
}

let draftCounter = 0;

export function createDraft(
  name: string,
  requestedWidth = DEFAULT_WIDTH,
  requestedHeight = DEFAULT_HEIGHT,
): LevelDraft {
  draftCounter += 1;
  const { width, height } = clampDimensions(requestedWidth, requestedHeight);
  return {
    // Date.now alone collides when two drafts are made in the same millisecond,
    // which duplicating a level does.
    id: `draft-${Date.now().toString(36)}-${draftCounter.toString(36)}`,
    name,
    width,
    height,
    rows: blankRows(width, height),
    ammoQueue: [],
    // In pixels, like everything else the editor now measures.
    sortRadius: 12,
    shotLimit: 26,
    // Always 1: what the editor holds IS the board the game runs.
    pixelScale: 1,
    updatedAt: Date.now(),
  };
}

/** Resize the picture, keeping whatever still fits in the new bounds. */
export function resizeDraft(draft: LevelDraft, width: number, height: number): LevelDraft {
  const { width: clampedWidth, height: clampedHeight } = clampDimensions(width, height);
  // Rows are top-first but the picture is anchored to the floor, so growing or
  // shrinking has to happen at the TOP — otherwise the sand appears to jump.
  const resize = (source: readonly string[]) => {
    const out: string[] = [];
    for (let row = 0; row < clampedHeight; row += 1) {
      const sourceRow = row - (clampedHeight - draft.height);
      const sourceLine = sourceRow >= 0 && sourceRow < source.length ? source[sourceRow] : "";
      out.push((sourceLine + EMPTY_CELL.repeat(clampedWidth)).slice(0, clampedWidth));
    }
    return out;
  };
  const rows = resize(draft.rows);
  // Same top-anchored resize as `rows` above, so a hidden trigger never
  // drifts out from under whatever it was authored beneath.
  const hiddenFreezeRows = draft.hiddenFreezeRows ? resize(draft.hiddenFreezeRows) : draft.hiddenFreezeRows;
  return { ...draft, width: clampedWidth, height: clampedHeight, rows, hiddenFreezeRows };
}

/**
 * Join a draft to the one gameplay policy, producing something the game can run.
 *
 * `id` is passed in because a draft's identity is a string while a level's is a
 * number the HUD shows; the caller owns that numbering.
 */
export function draftToLevel(draft: LevelDraft, id: number): SandLevelConfig {
  return {
    ...RADIUS_GAMEPLAY,
    id,
    name: draft.name.trim() || "Untitled",
    frame: { width: draft.width, height: draft.height },
    rows: draft.rows,
    hiddenFreezeRows: draft.hiddenFreezeRows,
    ammoQueue: [...draft.ammoQueue],
    sortRadius: draft.sortRadius,
    shotLimit: draft.shotLimit,
    pixelScale: effectivePixelScale(draft),
    keyFriction: draft.keyFriction ?? 0,
    freezeDuration: draft.freezeDuration ?? 0,
    forcedOpeningQueue: draft.forcedOpeningQueue,
    ftueFreezeDemo: draft.ftueFreezeDemo,
    ftueFreezeTargets: draft.ftueFreezeTargets,
    forcedBoosterCharges: draft.forcedBoosterCharges,
    ftueBoosterDemo: draft.ftueBoosterDemo,
    ftueBoosterTargets: draft.ftueBoosterTargets,
  };
}

/**
 * The reverse of `draftToLevel` — turns a hand-authored (or previously
 * shipped) `SandLevelConfig` into a fresh, editable draft.
 *
 * Only the fields a draft actually has room for come along: `tutorial`,
 * `ftueGesture`, `requiresBooster` and `notes` have no equivalent slot on
 * `LevelDraft` and are dropped, same as `draftToLevel` re-spreads
 * `RADIUS_GAMEPLAY` fresh rather than keeping a level's own policy fields.
 * Expanded to true pixel resolution via `expandDraftToPixels` immediately,
 * the same translation a blueprint-era draft gets on load — a hand-authored
 * level's `rows` is still a small blueprint scaled by `pixelScale`, but "what
 * the editor holds IS the board the game runs" (see `createDraft`'s own
 * comment), so nothing outside this function ever sees the blueprint size.
 */
export function levelToDraft(level: SandLevelConfig): LevelDraft {
  draftCounter += 1;
  const draft: LevelDraft = {
    id: `draft-${Date.now().toString(36)}-${draftCounter.toString(36)}`,
    name: level.name,
    width: level.frame.width,
    height: level.frame.height,
    rows: [...level.rows],
    hiddenFreezeRows: level.hiddenFreezeRows ? [...level.hiddenFreezeRows] : undefined,
    ammoQueue: [...level.ammoQueue],
    sortRadius: level.sortRadius,
    shotLimit: level.shotLimit,
    pixelScale: level.pixelScale,
    keyFriction: level.keyFriction,
    freezeDuration: level.freezeDuration,
    forcedOpeningQueue: level.forcedOpeningQueue ? [...level.forcedOpeningQueue] : undefined,
    ftueFreezeDemo: level.ftueFreezeDemo,
    ftueFreezeTargets: level.ftueFreezeTargets ? level.ftueFreezeTargets.map((t) => ({ ...t })) : undefined,
    forcedBoosterCharges: level.forcedBoosterCharges ? { ...level.forcedBoosterCharges } : undefined,
    ftueBoosterDemo: level.ftueBoosterDemo,
    ftueBoosterTargets: level.ftueBoosterTargets ? level.ftueBoosterTargets.map((t) => ({ ...t })) : undefined,
    importedFromId: level.id,
    updatedAt: Date.now(),
  };
  return expandDraftToPixels(draft);
}

export type DraftIssue = {
  severity: "error" | "warning";
  message: string;
  /** Set when the editor can repair this itself. */
  fix?: "settle" | "syncQueue";
};

/**
 * Everything that would make a draft unplayable or misleading.
 *
 * The two hard rules both come from the cycling wheel. A colour painted but
 * left out of the queue can never be shot at, so the board can never be
 * emptied; a colour queued but never painted hands the player an opening bullet
 * with no target. Both are silent unwinnable states in-game, so both are errors
 * here — and both are repairable in one click, because the queue is derivable
 * from the picture.
 */
export function validateDraft(draft: LevelDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const painted = countPaintedCells(draft);
  const used = coloursUsed(draft);

  if (painted === 0) {
    issues.push({ severity: "error", message: "The picture is empty — paint some sand first." });
    return issues;
  }

  const queued = new Set(draft.ammoQueue);
  const missingFromQueue = used.filter((color) => !queued.has(color));
  if (missingFromQueue.length) {
    issues.push({
      severity: "error",
      message: `${missingFromQueue.join(", ")} ${missingFromQueue.length === 1 ? "is" : "are"} in the picture but not in the ammo wheel — that sand could never be shot, so the level can never be cleared.`,
      fix: "syncQueue",
    });
  }
  const unpainted = draft.ammoQueue.filter((color) => !used.includes(color));
  if (unpainted.length) {
    issues.push({
      severity: "error",
      message: `${[...new Set(unpainted)].join(", ")} ${unpainted.length === 1 ? "is" : "are"} in the ammo wheel but not in the picture — that bullet would have nothing to shoot.`,
      fix: "syncQueue",
    });
  }
  if (new Set(draft.ammoQueue).size !== draft.ammoQueue.length) {
    issues.push({
      severity: "warning",
      message: "A colour appears twice in the wheel. It comes round again on its own while any of it is left, so a duplicate only delays the other colours.",
    });
  }

  if (draft.shotLimit < 1) {
    issues.push({ severity: "error", message: "The shot budget has to be at least 1." });
  }
  if (draft.sortRadius <= 0) {
    issues.push({ severity: "error", message: "The sort radius has to be greater than 0." });
  }

  // A picture that is not already at rest slumps on the very first frame, so
  // what the player sees is not what was drawn. Locks and keys are handed to
  // the solver here for the same reason the game hands them over: a slab that
  // is only still because it is frozen must not be reported as slumping.
  const level = draftToLevel(draft, 0);
  const { bodies, locked, keys, walls, freezeTriggers } = parseSandLevel(level);
  const settled = runGrainSettle(bodies, level.frame, { locked, keys, walls, freezeTriggers });
  if (settled.steps.some((step) => step.kind !== "REINDEX")) {
    issues.push({
      severity: "warning",
      message: "This sand is not at rest — it will slump the moment the level loads, so the player will not see what you drew.",
      fix: "settle",
    });
  }

  // The two ways a lock-and-key picture can be nonsense. A lock with no key is
  // sand that can never be freed, which quietly makes the level unwinnable; a
  // key with nothing to open is a prop the player will chase for no reason.
  const fixtures = fixtureCounts(draft);
  if (fixtures.locked && !fixtures.keys) {
    issues.push({
      severity: "error",
      message: "There is locked sand but no key. That sand could never be freed, so the frame could never be cleared.",
    });
  }
  if (fixtures.keys && !fixtures.locked) {
    issues.push({
      severity: "warning",
      message: "There is a key but nothing locked for it to open.",
    });
  }
  // A duration with no trigger is a rule for a button that does not exist —
  // harmless, but almost always a stray edit left over from a deleted one.
  if ((draft.freezeDuration ?? 0) > 0 && !fixtures.freeze) {
    issues.push({
      severity: "warning",
      message: "A freeze duration is set but there is no Freeze trigger painted for it to belong to.",
    });
  }

  const pixels = draft.width * draft.height * effectivePixelScale(draft) ** 2;
  if (pixels > PIXEL_BUDGET * 1.6) {
    issues.push({
      severity: "warning",
      message: `${pixels.toLocaleString()} simulated pixels is above the measured comfort budget — settling may visibly stutter.`,
    });
  }

  return issues;
}

/**
 * Drop the picture to rest, so the drawing and the opening board are the same.
 *
 * Locks and keys are carried through the settle and written back where they
 * ended up. A key that was floating lands, a frozen slab stays exactly where it
 * was drawn — and if the key happened to reach the lock, the settle opens it,
 * which is the honest answer: that level starts already unlocked.
 */
export function settleDraft(draft: LevelDraft): LevelDraft {
  const level = draftToLevel(draft, 0);
  const { bodies, locked, keys, walls, freezeTriggers } = parseSandLevel(level);
  const settled = runGrainSettle(bodies, level.frame, { locked, keys, walls, freezeTriggers });

  const grid = new Map<string, SandColor>();
  for (const body of settled.bodies) {
    for (const cell of body.cells) grid.set(`${cell.x},${cell.y}`, body.color);
  }
  const frozen = new Set(settled.locked.map((cell) => `${cell.x},${cell.y}`));
  const keyCells = new Set(settled.keys.flatMap((key) => key.cells.map((cell) => `${cell.x},${cell.y}`)));
  const wallCells = new Set(settled.walls.map((cell) => `${cell.x},${cell.y}`));
  const freezeCells = new Set(
    settled.freezeTriggers.flatMap((trigger) => trigger.cells.map((cell) => `${cell.x},${cell.y}`)),
  );

  const rows = Array.from({ length: draft.height }, (_, row) => {
    const y = draft.height - 1 - row;
    let line = "";
    for (let x = 0; x < draft.width; x += 1) {
      const at = `${x},${y}`;
      if (keyCells.has(at)) {
        line += KEY_LETTER;
        continue;
      }
      if (wallCells.has(at)) {
        line += WALL_LETTER;
        continue;
      }
      if (freezeCells.has(at)) {
        line += FREEZE_LETTER;
        continue;
      }
      const color = grid.get(at);
      if (!color) {
        line += EMPTY_CELL;
        continue;
      }
      line += frozen.has(at) ? lockedLetter(color) : LETTER_BY_SAND_COLOR[color];
    }
    return line;
  });
  return { ...draft, rows };
}

/** Rebuild the wheel from the picture, keeping the order already chosen. */
export function syncQueueToPicture(draft: LevelDraft): LevelDraft {
  const used = coloursUsed(draft);
  const kept = draft.ammoQueue.filter((color, index) =>
    used.includes(color) && draft.ammoQueue.indexOf(color) === index);
  const added = used.filter((color) => !kept.includes(color));
  return { ...draft, ammoQueue: [...kept, ...added] };
}

// ---- persistence ---------------------------------------------------------

function isDraft(value: unknown): value is LevelDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<LevelDraft>;
  return typeof draft.id === "string"
    && typeof draft.name === "string"
    && typeof draft.width === "number"
    && typeof draft.height === "number"
    && Array.isArray(draft.rows)
    && draft.rows.every((row) => typeof row === "string")
    && Array.isArray(draft.ammoQueue)
    && typeof draft.sortRadius === "number"
    && typeof draft.shotLimit === "number";
}

/**
 * Blow a blueprint-era draft up to the resolution it was always going to run at.
 *
 * Drafts used to be small pictures with a `pixelScale` the game applied at
 * load. The editor authors the real board now, so an old draft is translated
 * rather than dropped: it is expanded by exactly the factor the game would have
 * expanded it by, which is the same picture the author was already playing.
 * `sortRadius` comes along too, because `expandLevelForPixelBoard` scales that.
 */
export function expandDraftToPixels(draft: LevelDraft): LevelDraft {
  const scale = effectivePixelScale(draft);
  if (scale <= 1) return { ...draft, pixelScale: 1 };
  const expanded = expandLevelForPixelBoard(draftToLevel(draft, 0));
  return {
    ...draft,
    width: expanded.frame.width,
    height: expanded.frame.height,
    rows: expanded.rows,
    hiddenFreezeRows: expanded.hiddenFreezeRows ? [...expanded.hiddenFreezeRows] : expanded.hiddenFreezeRows,
    sortRadius: expanded.sortRadius,
    ftueFreezeTargets: expanded.ftueFreezeTargets ? expanded.ftueFreezeTargets.map((t) => ({ ...t })) : expanded.ftueFreezeTargets,
    ftueBoosterTargets: expanded.ftueBoosterTargets ? expanded.ftueBoosterTargets.map((t) => ({ ...t })) : expanded.ftueBoosterTargets,
    pixelScale: 1,
  };
}

export function loadDrafts(): LevelDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Anything that does not round-trip is dropped rather than crashing the
    // editor: a half-written draft must never make the tool unopenable.
    if (!Array.isArray(parsed)) return [];
    // A draft saved before wind was removed may still carry a stray `wind`
    // property in storage — harmless, since nothing here reads it any more.
    return parsed.filter(isDraft).map(expandDraftToPixels);
  } catch {
    return [];
  }
}

export function saveDrafts(drafts: LevelDraft[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // A private-mode browser can refuse storage outright. The editor keeps
    // working in memory; only persistence is lost.
  }
}

// ---- export --------------------------------------------------------------

function quoted(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The draft as a block to paste into `sand-levels.ts`.
 *
 * It spreads `RADIUS_GAMEPLAY` rather than restating those eight policy fields,
 * so an exported level stays as short as the thing it actually describes — and
 * a later change to a shared rule reaches it.
 */
/** The identifier an exported draft's `SandLevelConfig` const is written under. */
export function levelExportName(draft: LevelDraft) {
  return (draft.name.trim() || "untitled")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join("") || "untitled";
}

export function draftToTypeScript(draft: LevelDraft, id: number) {
  const scale = effectivePixelScale(draft);
  const pixels = draft.width * draft.height * scale * scale;
  const constName = levelExportName(draft);

  const rows = draft.rows.map((row) => `    ${quoted(row)},`).join("\n");
  const queue = draft.ammoQueue.map((color) => quoted(color)).join(", ");
  // Omitted when there is nothing for it to act on, or when it is 0 — the
  // default already means "no resistance".
  const friction = (draft.keyFriction ?? 0) > 0 ? `\n  keyFriction: ${draft.keyFriction},\n` : "";
  const freeze = (draft.freezeDuration ?? 0) > 0 ? `\n  freezeDuration: ${draft.freezeDuration},\n` : "";

  return `export const ${constName}: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: ${id},
  name: ${quoted(draft.name.trim() || "Untitled")},

  frame: { width: ${draft.width}, height: ${draft.height} },
  rows: [
${rows}
  ],

  // The starting rotation only — under the cycling rule this is a wheel, not a
  // budget: colours come round again until they are gone.
  ammoQueue: [${queue}],

  sortRadius: ${draft.sortRadius},
  shotLimit: ${draft.shotLimit},

  // ${draft.width} x ${draft.height} blueprint at ${scale}x = ${pixels.toLocaleString()} simulated pixels.
  pixelScale: ${scale},
${friction}${freeze}};
`;
}
