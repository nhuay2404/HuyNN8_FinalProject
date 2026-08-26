// A level as the editor holds it, and the two directions it can travel:
// into the game to be played, and out as TypeScript to be committed.
//
// A draft is deliberately NOT a `SandLevelConfig`. It carries only what an
// author decides — the picture, the wheel, the reach, the budget — while every
// rule the game plays under stays in `RADIUS_GAMEPLAY`. `draftToLevel` is the
// single place the two are joined, so a level tested in the editor and a level
// pasted into `sand-levels.ts` cannot drift apart.

import { KEY_LETTER, parseSandLevel, runGrainSettle } from "./sand-rules.ts";
import {
  RADIUS_GAMEPLAY,
  SAND_COLORS,
  type SandColor,
  type SandLevelConfig,
  type WindConfig,
  type WindPhase,
} from "./sand-types.ts";

const STORAGE_KEY = "sand-cannon:v1:level-drafts";

/** Blueprint bounds. Wide enough to draw with, small enough to stay readable. */
export const MIN_DIMENSION = 6;
export const MAX_WIDTH = 24;
export const MAX_HEIGHT = 28;

/**
 * How many simulated pixels a board may cost.
 *
 * Settling is the expensive part and it grows with the pixel count, so this is
 * the ceiling `autoPixelScale` fits a board under. 4,500 is the size the
 * shipped level runs at (60x70), measured at well under 40ms a settle.
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
};

export const EMPTY_CELL = ".";
/** The key's letter, re-exported so the editor never has to spell it itself. */
export { KEY_LETTER };

/** The same colour, frozen. Lower case is the whole representation of a lock. */
export function lockedLetter(color: SandColor) {
  return LETTER_BY_SAND_COLOR[color].toLowerCase();
}

/** What a cell holds, for an editor that has to draw three different things. */
export function readCell(letter: string): { kind: "empty" } | { kind: "key" }
  | { kind: "sand"; color: SandColor; locked: boolean } {
  if (letter === KEY_LETTER) return { kind: "key" };
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
  ammoQueue: SandColor[];
  sortRadius: number;
  shotLimit: number;
  /** null means "fit it to the pixel budget for me". */
  pixelScale: number | null;
  /** null is still air. */
  wind?: WindConfig | null;
  updatedAt: number;
};

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

/** A sensible phase to add when the author asks for one. Blows right, gently. */
export function defaultWindPhase(): WindPhase {
  return { direction: "right", durationMs: 2000, cooldownMs: 3500, power: 1, zone: null };
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

/** Whether the picture has any frozen sand, and any key to open it with. */
export function fixtureCounts(draft: LevelDraft) {
  let locked = 0;
  let keys = 0;
  for (const letter of draft.rows.join("")) {
    if (letter === KEY_LETTER) keys += 1;
    else if (readCell(letter).kind === "sand" && letter === letter.toLowerCase()) locked += 1;
  }
  return { locked, keys };
}

export function countPaintedCells(draft: LevelDraft) {
  return [...draft.rows.join("")].filter((letter) => letter !== EMPTY_CELL).length;
}

let draftCounter = 0;

export function createDraft(name: string, requestedWidth = 12, requestedHeight = 14): LevelDraft {
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
    sortRadius: 2.5,
    shotLimit: 26,
    pixelScale: null,
    updatedAt: Date.now(),
  };
}

/** Resize the picture, keeping whatever still fits in the new bounds. */
export function resizeDraft(draft: LevelDraft, width: number, height: number): LevelDraft {
  const { width: clampedWidth, height: clampedHeight } = clampDimensions(width, height);
  // Rows are top-first but the picture is anchored to the floor, so growing or
  // shrinking has to happen at the TOP — otherwise the sand appears to jump.
  const rows: string[] = [];
  for (let row = 0; row < clampedHeight; row += 1) {
    const sourceRow = row - (clampedHeight - draft.height);
    const source = sourceRow >= 0 && sourceRow < draft.rows.length ? draft.rows[sourceRow] : "";
    rows.push((source + EMPTY_CELL.repeat(clampedWidth)).slice(0, clampedWidth));
  }
  return { ...draft, width: clampedWidth, height: clampedHeight, rows };
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
    ammoQueue: [...draft.ammoQueue],
    sortRadius: draft.sortRadius,
    shotLimit: draft.shotLimit,
    pixelScale: effectivePixelScale(draft),
    wind: draft.wind ? { ...draft.wind } : null,
  };
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
  const { bodies, locked, keys } = parseSandLevel(level);
  const settled = runGrainSettle(bodies, level.frame, { locked, keys });
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

  if (draft.wind && !draft.wind.phases.length) {
    issues.push({
      severity: "error",
      message: "Wind is on but has no phases. Add one, or turn wind off.",
    });
  }
  draft.wind?.phases.forEach((phase, index) => {
    const label = `Wind phase ${index + 1}`;
    if (phase.power < 1) {
      issues.push({ severity: "error", message: `${label}: power has to be at least 1 cell, or its gusts move nothing.` });
    }
    if (phase.durationMs < 200) {
      issues.push({ severity: "error", message: `${label}: it has to blow for at least 0.2s to do anything.` });
    }
    if (phase.cooldownMs < 600) {
      issues.push({
        severity: "warning",
        message: `${label}: less than 0.6s of still air leaves the player almost no settled board to aim at.`,
      });
    }
    const zone = phase.zone;
    if (!zone) return;
    const clipped = zone.x < 0 || zone.y < 0
      || zone.x + zone.width > draft.width || zone.y + zone.height > draft.height;
    if (clipped) {
      issues.push({ severity: "warning", message: `${label}: its zone reaches outside the frame, so part of it does nothing.` });
    }
    if (zone.width < 1 || zone.height < 1) {
      issues.push({ severity: "error", message: `${label}: an empty zone means the phase can never move anything.` });
    }
  });

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
  const { bodies, locked, keys } = parseSandLevel(level);
  const settled = runGrainSettle(bodies, level.frame, { locked, keys });

  const grid = new Map<string, SandColor>();
  for (const body of settled.bodies) {
    for (const cell of body.cells) grid.set(`${cell.x},${cell.y}`, body.color);
  }
  const frozen = new Set(settled.locked.map((cell) => `${cell.x},${cell.y}`));
  const keyCells = new Set(settled.keys.flatMap((key) => key.cells.map((cell) => `${cell.x},${cell.y}`)));

  const rows = Array.from({ length: draft.height }, (_, row) => {
    const y = draft.height - 1 - row;
    let line = "";
    for (let x = 0; x < draft.width; x += 1) {
      const at = `${x},${y}`;
      if (keyCells.has(at)) {
        line += KEY_LETTER;
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
 * Bring a stored draft's wind up to the current shape.
 *
 * Wind was once a single `{ everyMs, direction, strength }` gust. A draft
 * written then is still a real level someone drew, so it is translated rather
 * than dropped: the old gust becomes a one-phase loop that blows for a moment
 * and then waits out the rest of the interval, which is what it always did.
 */
function normaliseWind(wind: unknown): WindConfig | null {
  if (!wind || typeof wind !== "object") return null;
  const current = wind as Partial<WindConfig>;
  if (Array.isArray(current.phases)) return { phases: current.phases };

  const legacy = wind as { everyMs?: unknown; direction?: unknown; strength?: unknown };
  if (typeof legacy.everyMs !== "number") return null;
  const everyMs = Math.max(1000, legacy.everyMs);
  return {
    phases: [{
      direction: legacy.direction === "left" ? "left" : "right",
      durationMs: 800,
      cooldownMs: Math.max(600, everyMs - 800),
      power: typeof legacy.strength === "number" ? Math.max(1, legacy.strength) : 1,
      zone: null,
    }],
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
    return parsed.filter(isDraft).map((draft) => ({ ...draft, wind: normaliseWind(draft.wind) }));
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
export function draftToTypeScript(draft: LevelDraft, id: number) {
  const scale = effectivePixelScale(draft);
  const pixels = draft.width * draft.height * scale * scale;
  const constName = (draft.name.trim() || "untitled")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join("") || "untitled";

  const rows = draft.rows.map((row) => `    ${quoted(row)},`).join("\n");
  const queue = draft.ammoQueue.map((color) => quoted(color)).join(", ");
  // Omitted entirely on a still level, so a level that has no weather does not
  // carry a line saying so.
  const phaseLines = (draft.wind?.phases ?? []).map((phase) => {
    const zone = phase.zone
      ? `{ x: ${phase.zone.x}, y: ${phase.zone.y}, width: ${phase.zone.width}, height: ${phase.zone.height} }`
      : "null";
    return `      { direction: ${quoted(phase.direction)}, durationMs: ${phase.durationMs}, `
      + `cooldownMs: ${phase.cooldownMs}, power: ${phase.power}, zone: ${zone} },`;
  }).join("\n");
  const wind = draft.wind
    ? `\n  wind: {\n    phases: [\n${phaseLines}\n    ],\n  },\n`
    : "";

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
${wind}};
`;
}
