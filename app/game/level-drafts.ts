// A level as the editor holds it, and the two directions it can travel:
// into the game to be played, and out as TypeScript to be committed.
//
// A draft is deliberately NOT a `SandLevelConfig`. It carries only what an
// author decides — the picture, the wheel, the reach, the budget — while every
// rule the game plays under stays in `RADIUS_GAMEPLAY`. `draftToLevel` is the
// single place the two are joined, so a level tested in the editor and a level
// pasted into `sand-levels.ts` cannot drift apart.

import { parseSandLevel, runGrainSettle } from "./sand-rules.ts";
import { RADIUS_GAMEPLAY, SAND_COLORS, type SandColor, type SandLevelConfig } from "./sand-types.ts";

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

/** Colours actually painted in the picture, in palette order. */
export function coloursUsed(draft: LevelDraft): SandColor[] {
  const present = new Set(draft.rows.join(""));
  return SAND_COLORS.filter((color) => present.has(LETTER_BY_SAND_COLOR[color]));
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
  // what the player sees is not what was drawn.
  const level = draftToLevel(draft, 0);
  const { bodies } = parseSandLevel(level);
  const settled = runGrainSettle(bodies, level.frame);
  if (settled.steps.some((step) => step.kind === "GRAIN_PASS")) {
    issues.push({
      severity: "warning",
      message: "This sand is not at rest — it will slump the moment the level loads, so the player will not see what you drew.",
      fix: "settle",
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

/** Drop the picture to rest, so the drawing and the opening board are the same. */
export function settleDraft(draft: LevelDraft): LevelDraft {
  const level = draftToLevel(draft, 0);
  const { bodies } = parseSandLevel(level);
  const settled = runGrainSettle(bodies, level.frame);

  const grid = new Map<string, SandColor>();
  for (const body of settled.bodies) {
    for (const cell of body.cells) grid.set(`${cell.x},${cell.y}`, body.color);
  }
  const rows = Array.from({ length: draft.height }, (_, row) => {
    const y = draft.height - 1 - row;
    let line = "";
    for (let x = 0; x < draft.width; x += 1) {
      const color = grid.get(`${x},${y}`);
      line += color ? LETTER_BY_SAND_COLOR[color] : EMPTY_CELL;
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

export function loadDrafts(): LevelDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Anything that does not round-trip is dropped rather than crashing the
    // editor: a half-written draft must never make the tool unopenable.
    return Array.isArray(parsed) ? parsed.filter(isDraft) : [];
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
};
`;
}
