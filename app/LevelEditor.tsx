"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { SAND_COLOR_HEX } from "./game/SandCannonEngine";
import { analyseLevel, type LevelAnalysis } from "./game/level-analysis";
import { computeDifficulty, type DifficultyResult } from "./game/level-difficulty";
import { SAND_LIGHTNESS_JITTER, SAND_SATURATION_JITTER, jitterColorHex } from "./game/sand-color";
import {
  EMPTY_CELL,
  KEY_LETTER,
  LETTER_BY_SAND_COLOR,
  MAX_HEIGHT,
  MAX_KEY_FRICTION,
  MAX_WIDTH,
  MIN_DIMENSION,
  MIN_KEY_FRICTION,
  blankRows,
  coloursUsed,
  countPaintedCells,
  createDraft,
  draftToLevel,
  draftToTypeScript,
  defaultWindPhase,
  effectivePixelScale,
  fixtureCounts,
  loadDrafts,
  lockedLetter,
  readCell,
  resizeDraft,
  saveDrafts,
  settleDraft,
  syncQueueToPicture,
  validateDraft,
  type LevelDraft,
} from "./game/level-drafts";
import { groupCells } from "./game/sand-rules";
import { KEY_SPRITE, PADLOCK_SPRITE, spriteCells, spriteHeight, spriteWidth } from "./game/sand-sprites";
import { SAND_COLORS, type SandColor, type WindConfig, type WindPhase } from "./game/sand-types";
import { finishLoading } from "./loading-screen";

type Tool = "brush" | "eraser" | "bucket" | "key";

const COLOR_NAME: Record<SandColor, string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
  purple: "Purple",
  orange: "Orange",
  cyan: "Cyan",
  pink: "Pink",
  lime: "Lime",
  brown: "Brown",
};

function hex(color: SandColor) {
  return `#${SAND_COLOR_HEX[color].toString(16).padStart(6, "0")}`;
}

const DIFFICULTY_NAME: Record<DifficultyResult["label"], string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  "very-hard": "Very hard",
};

/**
 * One colour per difficulty tier, borrowed straight from the sand palette
 * rather than invented — green through red already reads as "fine → careful"
 * everywhere else on the web, and reusing the gameplay colours means no new
 * hue has to be introduced just for a chart.
 */
const DIFFICULTY_HEX: Record<DifficultyResult["label"], SandColor> = {
  easy: "green",
  medium: "yellow",
  hard: "orange",
  "very-hard": "red",
};

/** The key's gold, matching what the engine paints on the board. */
const KEY_HEX = "#ffd654";
/**
 * Key size, as an integer multiple of `KEY_SPRITE`'s own pixels.
 *
 * The sprite is a fixed hand-drawn silhouette, not a formula like a circle's —
 * there is no "one pixel bigger" version of a jagged shape that still reads as
 * the same shape. Whole-number scaling is what `spriteCells` already does for
 * the padlock, and it is the only way to grow this key that cannot warp it.
 */
const DEFAULT_KEY_SCALE = 4;
const MAX_KEY_SCALE = 16;

/** Brush nib width in board pixels, and its bounds. */
const DEFAULT_BRUSH_SIZE = 5;
const MAX_BRUSH_SIZE = 24;

/**
 * Below this many screen pixels per board pixel, the per-cell grid stops being
 * a guide and becomes a grey wash — at that point only the coarse guide is
 * drawn.
 */
const FINE_GRID_MIN_PX = 9;
/** How many board pixels between the heavier guide lines. */
const GUIDE_GRID_STEP = 10;

/**
 * The biggest key scale that actually fits this board.
 *
 * Offering a size the frame cannot hold would stamp a key with an edge quietly
 * cut off — and a clipped silhouette is a different shape, not a bigger one.
 */
function maxKeyScale(draft: LevelDraft) {
  return Math.max(1, Math.min(
    MAX_KEY_SCALE,
    Math.floor(draft.width / spriteWidth(KEY_SPRITE)),
    Math.floor(draft.height / spriteHeight(KEY_SPRITE)),
  ));
}
/** Matches `LOCK_DARKEN` in the engine — the same sand should look the same. */
const LOCK_DARKEN = 0.62;

/**
 * Padlock placements for the editor's preview, one per frozen region.
 *
 * Computed at the **board's real resolution**, not at blueprint size, and then
 * divided back down for drawing. The game stamps this icon onto the expanded
 * pixel board, so sizing it against the small blueprint here would put a
 * padlock in the editor where the game shows none — or, more often, none in
 * the editor where the game shows one. The whole point of the preview is that
 * it is not a diagram of the level.
 *
 * Returned in units of *one blueprint cell*, so a value of 0.2 is a fifth of a
 * cell across at `pixelScale: 5`.
 */
function lockedRegions(draft: LevelDraft) {
  const scale = effectivePixelScale(draft);
  const frozen: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < draft.height; y += 1) {
    for (let x = 0; x < draft.width; x += 1) {
      const cell = readCell(letterAt(draft.rows, x, y, draft.height));
      if (cell.kind === "sand" && cell.locked) frozen.push({ x, y });
    }
  }

  const iconWide = spriteWidth(PADLOCK_SPRITE);
  const iconTall = spriteHeight(PADLOCK_SPRITE);
  return groupCells(frozen).map((region) => {
    const inside = new Set(region.map((cell) => `${cell.x},${cell.y}`));
    const left = Math.min(...region.map((cell) => cell.x)) * scale;
    const bottom = Math.min(...region.map((cell) => cell.y)) * scale;
    const width = (Math.max(...region.map((cell) => cell.x)) + 1) * scale - left;
    const height = (Math.max(...region.map((cell) => cell.y)) + 1) * scale - bottom;

    // The same margin the engine leaves, so the two agree on "too small".
    const iconScale = Math.floor(Math.min(width / (iconWide + 2), height / (iconTall + 2)));
    if (iconScale < 1) return [];
    const originX = left + Math.floor((width - iconWide * iconScale) / 2);
    const originY = bottom + Math.floor((height - iconTall * iconScale) / 2);
    return spriteCells(PADLOCK_SPRITE, iconScale)
      .map((cell) => ({ x: originX + cell.x, y: originY + cell.y }))
      .filter((cell) => inside.has(`${Math.floor(cell.x / scale)},${Math.floor(cell.y / scale)}`))
      // Back into blueprint units, which is what the canvas is drawn in.
      .map((cell) => ({ x: cell.x / scale, y: cell.y / scale, size: 1 / scale }));
  }).filter((region) => region.length > 0);
}

/**
 * Where a key of this scale lands when the author clicks (x, y).
 *
 * Centred on the click and then pushed back inside the frame, so a key stamped
 * near an edge arrives whole rather than clipped. Being nudged is much easier
 * to understand than half a key appearing.
 */
function keyCellsAt(draft: LevelDraft, x: number, y: number, scale: number) {
  const cells = spriteCells(KEY_SPRITE, scale);
  const width = spriteWidth(KEY_SPRITE) * scale;
  const height = spriteHeight(KEY_SPRITE) * scale;
  const originX = clamp(x - Math.floor(width / 2), 0, Math.max(0, draft.width - width));
  const originY = clamp(y - Math.floor(height / 2), 0, Math.max(0, draft.height - height));
  return cells
    .map((cell) => ({ x: originX + cell.x, y: originY + cell.y }))
    .filter((cell) => cell.x < draft.width && cell.y < draft.height);
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

/**
 * The cells one dab of the brush covers.
 *
 * A square nib, centred on the cursor and biased up-left on even sizes so the
 * cursor always sits inside its own brush. Clipped to the frame rather than
 * wrapped, so painting along an edge does not spray the opposite one.
 */
function brushCells(draft: LevelDraft, x: number, y: number, size: number) {
  const nib = Math.max(1, Math.round(size));
  const back = Math.floor((nib - 1) / 2);
  const cells: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < nib; dy += 1) {
    for (let dx = 0; dx < nib; dx += 1) {
      const cell = { x: x - back + dx, y: y - back + dy };
      if (cell.x < 0 || cell.x >= draft.width || cell.y < 0 || cell.y >= draft.height) continue;
      cells.push(cell);
    }
  }
  return cells;
}

/** The whole connected group of key cells under (x, y), or null. */
function keyGroupAt(draft: LevelDraft, x: number, y: number) {
  if (letterAt(draft.rows, x, y, draft.height) !== KEY_LETTER) return null;
  const found: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>([`${x},${y}`]);
  const queue = [{ x, y }];
  while (queue.length) {
    const cell = queue.pop()!;
    found.push(cell);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      const at = `${next.x},${next.y}`;
      if (seen.has(at)) continue;
      if (letterAt(draft.rows, next.x, next.y, draft.height) !== KEY_LETTER) continue;
      seen.add(at);
      queue.push(next);
    }
  }
  return found;
}

function stampCells(draft: LevelDraft, cells: Array<{ x: number; y: number }>) {
  return cells.reduce((rows, cell) => withCell(rows, cell.x, cell.y, draft.height, KEY_LETTER), draft.rows);
}

function clearCells(draft: LevelDraft, cells: Array<{ x: number; y: number }>) {
  return cells.reduce((rows, cell) => withCell(rows, cell.x, cell.y, draft.height, EMPTY_CELL), draft.rows);
}

/** Replace one phase of a wind loop, leaving the rest of the list alone. */
function editWindPhase(wind: WindConfig | null | undefined, index: number, patch: Partial<WindPhase>) {
  if (!wind) return wind ?? null;
  return { phases: wind.phases.map((phase, at) => (at === index ? { ...phase, ...patch } : phase)) };
}

/** Move one phase up or down the loop. Order is the whole point of a loop. */
function moveWindPhase(wind: WindConfig | null | undefined, index: number, delta: number) {
  if (!wind) return wind ?? null;
  const target = index + delta;
  if (target < 0 || target >= wind.phases.length) return wind;
  const phases = [...wind.phases];
  [phases[index], phases[target]] = [phases[target], phases[index]];
  return { phases };
}

/** Reading a cell out of the row strings, and writing one back. */
function letterAt(rows: string[], x: number, y: number, height: number) {
  const row = rows[height - 1 - y];
  return row?.[x] ?? EMPTY_CELL;
}

function withCell(rows: string[], x: number, y: number, height: number, letter: string) {
  const rowIndex = height - 1 - y;
  const row = rows[rowIndex];
  if (row === undefined || x < 0 || x >= row.length) return rows;
  if (row[x] === letter) return rows;
  const next = [...rows];
  next[rowIndex] = row.slice(0, x) + letter + row.slice(x + 1);
  return next;
}

/** The palette colour whose RGB is closest to a pixel, by plain squared distance. */
function nearestSandColor(r: number, g: number, b: number): SandColor {
  let best: SandColor = SAND_COLORS[0];
  let bestDistance = Infinity;
  for (const candidate of SAND_COLORS) {
    const rgb = SAND_COLOR_HEX[candidate];
    const cr = (rgb >> 16) & 0xff;
    const cg = (rgb >> 8) & 0xff;
    const cb = rgb & 0xff;
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Rasterise a bitmap onto the board, one board pixel at a time.
 *
 * The image is scaled to *cover* the frame — fill it completely, cropping
 * whatever spills past the shorter axis — the same as CSS `background-size:
 * cover`. Fitting it inside the frame instead would leave empty bars an
 * author has to notice and paint over by hand, and covering never does.
 *
 * Every opaque pixel is matched to the nearest palette colour by RGB
 * distance — the same "which colour is this closest to" a human eye does,
 * just run once per pixel instead of by hand. A pixel counts as background,
 * and is left empty, when it is transparent or (with `trimWhite`) nearly
 * white — an imported picture almost always has one of those two, and either
 * one filled in solid would bury the picture under a slab of one colour.
 */
function imageToRows(img: HTMLImageElement, width: number, height: number, trimWhite: boolean): string[] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return blankRows(width, height);
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const drawWidth = img.naturalWidth * scale;
  const drawHeight = img.naturalHeight * scale;
  context.drawImage(img, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

  const { data } = context.getImageData(0, 0, width, height);
  const rows: string[] = [];
  for (let row = 0; row < height; row += 1) {
    let line = "";
    for (let x = 0; x < width; x += 1) {
      const at = (row * width + x) * 4;
      const r = data[at];
      const g = data[at + 1];
      const b = data[at + 2];
      const a = data[at + 3];
      const isBackground = a < 24 || (trimWhite && r > 240 && g > 240 && b > 240);
      line += isBackground ? EMPTY_CELL : LETTER_BY_SAND_COLOR[nearestSandColor(r, g, b)];
    }
    rows.push(line);
  }
  return rows;
}

/** Flood fill over cells of the same starting letter, four-connected. */
function bucketFill(rows: string[], width: number, height: number, x: number, y: number, letter: string) {
  const target = letterAt(rows, x, y, height);
  if (target === letter) return rows;
  let next = rows;
  const queue: Array<[number, number]> = [[x, y]];
  const seen = new Set<string>([`${x},${y}`]);
  while (queue.length) {
    const [cx, cy] = queue.pop()!;
    if (letterAt(next, cx, cy, height) !== target) continue;
    next = withCell(next, cx, cy, height, letter);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return next;
}

const HISTORY_LIMIT = 60;

/**
 * The drafts already in the browser, read once.
 *
 * localStorage does not exist during the server pass, so this goes through
 * `useSyncExternalStore` rather than an effect that calls setState: the server
 * renders nothing, the browser hydrates with the real list, and React is told
 * about the difference instead of being surprised by it.
 *
 * Cached because the snapshot is compared by identity — rebuilding the array on
 * every call would loop forever.
 */
const SERVER_DRAFTS: LevelDraft[] = [];
let cachedDrafts: LevelDraft[] | null = null;

function readStoredDrafts(): LevelDraft[] {
  if (!cachedDrafts) {
    const stored = loadDrafts();
    cachedDrafts = stored.length ? stored : [syncQueueToPicture(starterDraft())];
  }
  return cachedDrafts;
}

/** Nothing to subscribe to: the snapshot is read once and never changes. */
const noopSubscribe = () => () => {};

/** Scores by draft object identity — see the comment on `difficultyById` below. */
const DIFFICULTY_CACHE = new WeakMap<LevelDraft, DifficultyResult>();

function difficultyFor(draft: LevelDraft): DifficultyResult {
  let result = DIFFICULTY_CACHE.get(draft);
  if (!result) {
    result = computeDifficulty(draft);
    DIFFICULTY_CACHE.set(draft, result);
  }
  return result;
}

export default function LevelEditor() {
  const stored = useSyncExternalStore(noopSubscribe, readStoredDrafts, () => SERVER_DRAFTS);
  // null until the first edit, so the stored list is what shows until then.
  const [edited, setEdited] = useState<LevelDraft[] | null>(null);
  const drafts = edited ?? stored;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selectedId = pickedId ?? drafts[0]?.id ?? null;
  const [tool, setTool] = useState<Tool>("brush");
  /** Whether the brush lays sand down frozen. A modifier, not a tool. */
  const [locking, setLocking] = useState(false);
  /** Which wind phase's zone is drawn over the picture. */
  const [phaseIndex, setPhaseIndex] = useState(0);
  /** The key tool's radius, in board pixels. */
  const [keyScale, setKeyScale] = useState(DEFAULT_KEY_SCALE);
  /** Width of the square brush nib, in board pixels. */
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [color, setColor] = useState<SandColor>("blue");
  const [analysis, setAnalysis] = useState<LevelAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [shipping, setShipping] = useState(false);
  const [importing, setImporting] = useState(false);
  /** Whether a near-white pixel imports as empty rather than as sand. */
  const [trimWhite, setTrimWhite] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const painting = useRef(false);
  const history = useRef<{ past: LevelDraft[]; future: LevelDraft[] }>({ past: [], future: [] });

  // The loading screen is painted by the root layout for every route, and only
  // the game knows when its first frame is up. The editor has no such moment,
  // so it dismisses the screen as soon as it is mounted — otherwise the tool
  // sits behind it forever.
  useEffect(() => finishLoading(), []);

  const draft = useMemo(
    () => drafts.find((entry) => entry.id === selectedId) ?? null,
    [drafts, selectedId],
  );

  /**
   * The whole roster's difficulty, for the overview chart in the Levels
   * panel — cached per draft *object* in `DIFFICULTY_CACHE` (module scope,
   * same pattern as `cachedDrafts` above), not just recomputed whenever the
   * list changes. Editing one level replaces only that one entry in `drafts`
   * (see `update`); every other draft keeps its old object identity, so this
   * reuses their scores instead of re-walking every other level's picture on
   * every stroke of the one actually being painted. A `WeakMap` rather than a
   * `Map` so a deleted or edited-away draft's entry is reclaimed on its own,
   * with nothing here having to notice and evict it.
   */
  const difficultyById = useMemo(
    () => new Map(drafts.map((entry) => [entry.id, difficultyFor(entry)] as const)),
    [drafts],
  );

  const persist = useCallback((next: LevelDraft[]) => {
    setEdited(next);
    saveDrafts(next);
  }, []);

  /**
   * Replace the selected draft.
   *
   * `record` is what separates a stroke from a settings tweak: a paint stroke
   * pushes one history entry when it starts and none while it continues, so
   * undo steps back a whole stroke rather than a pixel.
   */
  const update = useCallback((change: (current: LevelDraft) => LevelDraft, record = true) => {
    setEdited((currentEdited) => {
      const current = currentEdited ?? readStoredDrafts();
      const target = current.find((entry) => entry.id === selectedId);
      if (!target) return current;
      const next = { ...change(target), updatedAt: Date.now() };
      if (record) {
        history.current.past = [...history.current.past, target].slice(-HISTORY_LIMIT);
        history.current.future = [];
      }
      const list = current.map((entry) => (entry.id === selectedId ? next : entry));
      saveDrafts(list);
      return list;
    });
    setAnalysis(null);
  }, [selectedId]);

  const undo = useCallback(() => {
    const previous = history.current.past.at(-1);
    if (!previous) return;
    history.current.past = history.current.past.slice(0, -1);
    setEdited((currentEdited) => {
      const current = currentEdited ?? readStoredDrafts();
      const target = current.find((entry) => entry.id === previous.id);
      if (target) history.current.future = [...history.current.future, target];
      const list = current.map((entry) => (entry.id === previous.id ? previous : entry));
      saveDrafts(list);
      return list;
    });
    setAnalysis(null);
  }, []);

  const redo = useCallback(() => {
    const nextDraft = history.current.future.at(-1);
    if (!nextDraft) return;
    history.current.future = history.current.future.slice(0, -1);
    setEdited((currentEdited) => {
      const current = currentEdited ?? readStoredDrafts();
      const target = current.find((entry) => entry.id === nextDraft.id);
      if (target) history.current.past = [...history.current.past, target];
      const list = current.map((entry) => (entry.id === nextDraft.id ? nextDraft : entry));
      saveDrafts(list);
      return list;
    });
    setAnalysis(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---- painting ----------------------------------------------------------

  const cellFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !draft) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * draft.width);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * draft.height);
    if (x < 0 || x >= draft.width || row < 0 || row >= draft.height) return null;
    return { x, y: draft.height - 1 - row };
  }, [draft]);

  const paintAt = useCallback((x: number, y: number, record: boolean) => {
    // The key is stamped, not painted. A key is a *shape* — the game groups
    // connected `K` cells into one object, so a freehand smear would be a key
    // whose silhouette the author never chose. Stamping on top of an existing
    // key lifts it instead, which is how you resize one: lift, change the size,
    // put it back down.
    if (tool === "key") {
      update((current) => {
        const existing = keyGroupAt(current, x, y);
        // Clamped against the draft being edited, not against whatever the
        // board was when the size was chosen — a board can shrink afterwards.
        const scale = Math.min(keyScale, maxKeyScale(current));
        const rows = existing
          ? clearCells(current, existing)
          : stampCells(current, keyCellsAt(current, x, y, scale));
        return rows === current.rows ? current : { ...current, rows };
      }, true);
      return;
    }

    const letter = tool === "eraser"
      ? EMPTY_CELL
      : locking ? lockedLetter(color) : LETTER_BY_SAND_COLOR[color];
    update((current) => {
      if (tool === "bucket") {
        const rows = bucketFill(current.rows, current.width, current.height, x, y, letter);
        return rows === current.rows ? current : { ...current, rows };
      }
      // A square nib centred on the cursor. The board is pixels now, so a
      // one-cell brush would make painting a hillside a thousand clicks.
      const rows = brushCells(current, x, y, brushSize)
        .reduce((acc, cell) => withCell(acc, cell.x, cell.y, current.height, letter), current.rows);
      return rows === current.rows ? current : { ...current, rows };
    }, record);
  }, [tool, color, locking, keyScale, brushSize, update]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = cellFromEvent(event);
    if (!cell) return;
    // Capture throws on a pointer the browser is not tracking, and losing the
    // whole stroke to that is not worth it: without capture a drag simply stops
    // following a finger that leaves the canvas.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Not capturable — carry on with the stroke.
    }
    painting.current = true;
    paintAt(cell.x, cell.y, true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!painting.current || tool === "bucket") return;
    const cell = cellFromEvent(event);
    if (!cell) return;
    // record: false — the whole drag is one undo step.
    paintAt(cell.x, cell.y, false);
  };

  const endStroke = () => {
    painting.current = false;
  };

  // ---- canvas ------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !draft) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const cellPx = Math.max(4, Math.floor(Math.min(560 / draft.width, 620 / draft.height)));
    canvas.width = draft.width * cellPx;
    canvas.height = draft.height * cellPx;

    context.fillStyle = "#150e28";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < draft.height; row += 1) {
      for (let x = 0; x < draft.width; x += 1) {
        const cell = readCell(draft.rows[row]?.[x] ?? EMPTY_CELL);
        if (cell.kind === "empty") continue;
        const left = x * cellPx;
        const top = row * cellPx;

        if (cell.kind === "key") {
          context.fillStyle = KEY_HEX;
          context.fillRect(left, top, cellPx, cellPx);
          continue;
        }

        // The same per-grain jitter the game paints, from the same seed
        // formula — a flat swatch here would read as fewer, bigger blocks
        // than the same picture does once it is actually poured as sand.
        const y = draft.height - 1 - row;
        const seed = x * 733 + y * 197;
        context.fillStyle = jitterColorHex(
          SAND_COLOR_HEX[cell.color],
          seed,
          SAND_SATURATION_JITTER,
          SAND_LIGHTNESS_JITTER,
        );
        context.fillRect(left, top, cellPx, cellPx);
        if (!cell.locked) continue;
        // Shaded down rather than tinted, exactly as the engine does it: the
        // colour underneath still has to be readable, because it is the bullet
        // the wheel hands out once the lock opens.
        context.fillStyle = `rgba(0,0,0,${LOCK_DARKEN})`;
        context.fillRect(left, top, cellPx, cellPx);
      }
    }

    // A padlock per locked region, the same icon the game draws, so the editor
    // is showing the level rather than a diagram of it.
    context.fillStyle = "rgba(236,243,255,.94)";
    for (const region of lockedRegions(draft)) {
      for (const cell of region) {
        const size = cell.size * cellPx;
        // +1 on the size so neighbouring icon pixels never leave a hairline gap
        // between them at fractional sizes.
        context.fillRect(
          cell.x * cellPx,
          (draft.height - cell.y - cell.size) * cellPx,
          size + 1,
          size + 1,
        );
      }
    }

    // Grid lines last, so they sit over the paint rather than under it. At the
    // board's real resolution a line per pixel is not a grid, it is a grey
    // wash — so the fine grid only appears once cells are big enough to be
    // aimed at, and a coarser guide is always drawn to count along.
    const rule = (step: number, style: string) => {
      context.strokeStyle = style;
      context.lineWidth = 1;
      for (let x = 0; x <= draft.width; x += step) {
        context.beginPath();
        context.moveTo(x * cellPx + 0.5, 0);
        context.lineTo(x * cellPx + 0.5, canvas.height);
        context.stroke();
      }
      for (let row = 0; row <= draft.height; row += step) {
        context.beginPath();
        context.moveTo(0, row * cellPx + 0.5);
        context.lineTo(canvas.width, row * cellPx + 0.5);
        context.stroke();
      }
    };
    if (cellPx >= FINE_GRID_MIN_PX) rule(1, "rgba(255,255,255,.10)");
    rule(GUIDE_GRID_STEP, "rgba(255,255,255,.16)");

    // The selected wind phase's reach, over everything. Four numbers in a
    // sidebar are impossible to picture; the rectangle on the drawing is not.
    const zone = draft.wind?.phases[phaseIndex]?.zone;
    if (!zone) return;
    // Grid y counts up from the floor, canvas rows count down from the top.
    const top = (draft.height - (zone.y + zone.height)) * cellPx;
    const left = zone.x * cellPx;
    const width = zone.width * cellPx;
    const height = zone.height * cellPx;
    context.fillStyle = "rgba(120,200,255,.14)";
    context.fillRect(left, top, width, height);
    context.strokeStyle = "rgba(150,215,255,.95)";
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.strokeRect(left + 1, top + 1, width - 2, height - 2);
    context.setLineDash([]);
  }, [draft, phaseIndex]);

  // ---- derived -----------------------------------------------------------

  const issues = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);
  const errors = issues.filter((issue) => issue.severity === "error");
  const used = draft ? coloursUsed(draft) : [];
  const painted = draft ? countPaintedCells(draft) : 0;
  const fixtures = draft ? fixtureCounts(draft) : { locked: 0, keys: 0 };
  // Resizing the board can leave the chosen key size too big for it, so the
  // limit is applied on the way out rather than only when the button is pressed.
  const keyScaleLimit = draft ? maxKeyScale(draft) : 1;
  const scale = draft ? effectivePixelScale(draft) : 1;
  const pixels = draft ? draft.width * draft.height * scale * scale : 0;

  const flash = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 4000);
  };

  const runAnalysis = () => {
    if (!draft || errors.length) return;
    setAnalysing(true);
    // Yield a frame so the button can show its busy state before the solver
    // takes the thread — this runs to completion synchronously.
    window.setTimeout(() => {
      setAnalysis(analyseLevel(draftToLevel(draft, 0)));
      setAnalysing(false);
    }, 16);
  };

  /**
   * Replace the picture with a pixelated version of an imported PNG/JPEG.
   *
   * The image loads asynchronously, so the board it is rasterised onto is
   * whatever the draft's width/height are *when the image finishes loading*
   * — read inside `update`'s callback, not captured up front — in case the
   * author changes the size while the file is still decoding.
   */
  const importImageFile = (file: File) => {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      flash("Only PNG or JPEG images can be imported.");
      return;
    }
    setImporting(true);
    const url = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => {
      URL.revokeObjectURL(url);
      setImporting(false);
    };
    img.onload = () => {
      update((current) => {
        const rows = imageToRows(img, current.width, current.height, trimWhite);
        return syncQueueToPicture({ ...current, rows });
      }, true);
      flash(`Imported ${file.name} as the picture`);
      cleanup();
    };
    img.onerror = () => {
      flash("Couldn't read that image file.");
      cleanup();
    };
    img.src = url;
  };

  if (!draft) {
    return (
      <main className="editor-shell">
        <p className="editor-empty">Loading the level editor…</p>
      </main>
    );
  }

  const index = drafts.findIndex((entry) => entry.id === draft.id);

  return (
    <main className="editor-shell">
      <header className="editor-top">
        <h1>Sand level editor</h1>
        <div className="editor-top-actions">
          <Link className="editor-button" href="/">← Back to the game</Link>
        </div>
      </header>

      <div className="editor-body">
        {/* ---- levels ---- */}
        <aside className="editor-panel editor-levels">
          <h2>Levels</h2>
          <ul className="editor-level-list">
            {drafts.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={entry.id === draft.id ? "is-active" : ""}
                  onClick={() => {
                    setPickedId(entry.id);
                    setAnalysis(null);
                    history.current = { past: [], future: [] };
                  }}
                >
                  <strong>{entry.name || "Untitled"}</strong>
                  <small>{entry.width}×{entry.height} · {entry.shotLimit} shots</small>
                </button>
              </li>
            ))}
          </ul>
          <div className="editor-row">
            <button
              type="button"
              className="editor-button"
              onClick={() => {
                const created = syncQueueToPicture(starterDraft(`Level ${drafts.length + 1}`));
                persist([...drafts, created]);
                setPickedId(created.id);
                history.current = { past: [], future: [] };
              }}
            >
              + New
            </button>
            <button
              type="button"
              className="editor-button"
              onClick={() => {
                const copy = { ...createDraft(`${draft.name} copy`, draft.width, draft.height) };
                const duplicated: LevelDraft = {
                  ...copy,
                  rows: [...draft.rows],
                  ammoQueue: [...draft.ammoQueue],
                  sortRadius: draft.sortRadius,
                  shotLimit: draft.shotLimit,
                  pixelScale: draft.pixelScale,
                };
                persist([...drafts, duplicated]);
                setPickedId(duplicated.id);
                history.current = { past: [], future: [] };
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="editor-button is-danger"
              disabled={drafts.length <= 1}
              onClick={() => {
                const remaining = drafts.filter((entry) => entry.id !== draft.id);
                persist(remaining);
                setPickedId(remaining[Math.max(0, index - 1)]?.id ?? null);
                history.current = { past: [], future: [] };
              }}
            >
              Delete
            </button>
          </div>

          {/* ---- difficulty overview ---- */}
          <h2>Difficulty overview</h2>
          <p className="editor-note">
            A quick read on every level&apos;s shape — board size, colour count, how mixed those
            colours are, and how tight the shot budget and radius are against all of it. Not the
            solver: that lives below as &quot;Measure difficulty&quot; and only runs one level at a time.
          </p>
          <ol className="editor-difficulty-list">
            {drafts.map((entry) => {
              const result = difficultyById.get(entry.id);
              if (!result) return null;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={entry.id === draft.id ? "is-active" : ""}
                    onClick={() => {
                      setPickedId(entry.id);
                      setAnalysis(null);
                      history.current = { past: [], future: [] };
                    }}
                    title={[
                      `Board ${Math.round(result.breakdown.size * 100)}%`,
                      `Colours ${Math.round(result.breakdown.colors * 100)}%`,
                      `Mixing ${Math.round(result.breakdown.interleaving * 100)}%`,
                      `Ammo ${Math.round(result.breakdown.ammo * 100)}%`,
                      `Radius ${Math.round(result.breakdown.radius * 100)}%`,
                    ].join(" · ")}
                  >
                    <span className="editor-difficulty-name">{entry.name || "Untitled"}</span>
                    <span className="editor-difficulty-bar">
                      <i style={{ width: `${result.score}%`, "--swatch": hex(DIFFICULTY_HEX[result.label]) } as React.CSSProperties} />
                    </span>
                    <span className="editor-difficulty-score">
                      {result.score}
                      <small>{DIFFICULTY_NAME[result.label]}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        {/* ---- canvas ---- */}
        <section className="editor-panel editor-canvas-panel">
          <div className="editor-tools">
            <div className="editor-swatches">
              {SAND_COLORS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={`editor-swatch${entry === color && tool !== "eraser" ? " is-active" : ""}`}
                  style={{ "--swatch": hex(entry) } as React.CSSProperties}
                  onClick={() => {
                    setColor(entry);
                    if (tool === "eraser") setTool("brush");
                  }}
                  aria-label={COLOR_NAME[entry]}
                  title={COLOR_NAME[entry]}
                />
              ))}
            </div>
            <div className="editor-row">
              {(["brush", "bucket", "eraser", "key"] as Tool[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={`editor-button${tool === entry ? " is-active" : ""}`}
                  onClick={() => setTool(entry)}
                  title={entry === "key" ? "Paint the key that opens locked sand" : undefined}
                >
                  {entry === "brush" ? "Brush" : entry === "bucket" ? "Fill" : entry === "eraser" ? "Eraser" : "Key"}
                </button>
              ))}
              {/* A modifier on the brush rather than a tool of its own: a lock
                  is a state of a colour, so it has to be painted with one. */}
              <button
                type="button"
                className={`editor-button${locking ? " is-active" : ""}`}
                onClick={() => {
                  setLocking((value) => !value);
                  if (tool === "eraser" || tool === "key") setTool("brush");
                }}
                title="Paint this colour frozen: it hangs in the frame and cannot be shot until a key reaches it"
              >
                🔒 Locked
              </button>
              {/* Each tool's size dial, shown only while that tool is up — a
                  dial for a tool nobody is holding is a control with nothing
                  to do. */}
              {(tool === "brush" || tool === "eraser") && (
                <span className="editor-key-size">
                  <button
                    type="button"
                    className="editor-mini"
                    onClick={() => setBrushSize((value) => Math.max(1, value - 1))}
                    disabled={brushSize <= 1}
                    aria-label="Smaller brush"
                  >
                    −
                  </button>
                  <b title={`${brushSize}×${brushSize} board pixels`}>brush {brushSize}px</b>
                  <button
                    type="button"
                    className="editor-mini"
                    onClick={() => setBrushSize((value) => Math.min(MAX_BRUSH_SIZE, value + 1))}
                    disabled={brushSize >= MAX_BRUSH_SIZE}
                    aria-label="Bigger brush"
                  >
                    +
                  </button>
                </span>
              )}
              {tool === "key" && (
                <span className="editor-key-size">
                  <button
                    type="button"
                    className="editor-mini"
                    onClick={() => setKeyScale((value) => Math.max(1, value - 1))}
                    disabled={keyScale <= 1}
                    aria-label="Smaller key"
                  >
                    −
                  </button>
                  {/* Both numbers: the ratio is what the control changes, the
                      pixel size is what the author is actually picturing. */}
                  <b title={`ratio ×${Math.min(keyScale, keyScaleLimit)} of the ${spriteWidth(KEY_SPRITE)}×${spriteHeight(KEY_SPRITE)} key sprite`}>
                    key {spriteWidth(KEY_SPRITE) * Math.min(keyScale, keyScaleLimit)}×
                    {spriteHeight(KEY_SPRITE) * Math.min(keyScale, keyScaleLimit)}px
                    {" "}·{" "}×{Math.min(keyScale, keyScaleLimit)}
                  </b>
                  <button
                    type="button"
                    className="editor-mini"
                    onClick={() => setKeyScale((value) => Math.min(keyScaleLimit, value + 1))}
                    disabled={keyScale >= keyScaleLimit}
                    aria-label="Bigger key"
                    title={keyScale >= keyScaleLimit ? "A bigger key would not fit this frame" : undefined}
                  >
                    +
                  </button>
                </span>
              )}
              <button type="button" className="editor-button" onClick={undo}>Undo</button>
              <button type="button" className="editor-button" onClick={redo}>Redo</button>
              <button
                type="button"
                className="editor-button"
                onClick={() => update((current) => ({ ...current, rows: blankRows(current.width, current.height) }))}
              >
                Clear
              </button>
            </div>
            <div className="editor-row">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="editor-file-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Cleared even on a cancelled picker, so re-choosing the
                  // exact same file still fires a change event.
                  event.target.value = "";
                  if (file) importImageFile(file);
                }}
              />
              <button
                type="button"
                className="editor-button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                title="Pixelate a PNG or JPEG onto this level's picture, matching each pixel to the nearest palette colour"
              >
                {importing ? "Importing…" : "🖼️ Import image"}
              </button>
              <label className="editor-check editor-import-check">
                <input
                  type="checkbox"
                  checked={trimWhite}
                  onChange={(event) => setTrimWhite(event.target.checked)}
                />
                <span>Skip white background</span>
              </label>
            </div>
          </div>

          <canvas
            ref={canvasRef}
            className="editor-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
            onPointerCancel={endStroke}
          />

          <p className="editor-hint">
            {painted.toLocaleString()} grains painted · {draft.width}×{draft.height} pixels
            ({pixels.toLocaleString()} simulated) · guide grid every {GUIDE_GRID_STEP}
          </p>
        </section>

        {/* ---- settings ---- */}
        <aside className="editor-panel editor-settings">
          <label className="editor-field">
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <div className="editor-field-row">
            <label className="editor-field">
              <span>Width</span>
              <input
                type="number"
                min={MIN_DIMENSION}
                max={MAX_WIDTH}
                value={draft.width}
                onChange={(event) => update((current) => resizeDraft(current, Number(event.target.value), current.height))}
              />
            </label>
            <label className="editor-field">
              <span>Height</span>
              <input
                type="number"
                min={MIN_DIMENSION}
                max={MAX_HEIGHT}
                value={draft.height}
                onChange={(event) => update((current) => resizeDraft(current, current.width, Number(event.target.value)))}
              />
            </label>
          </div>

          <h2>Wind</h2>
          <p className="editor-note">
            A loop of phases. Each one blows one way for a while, then leaves the air still, then
            hands over to the next — and the list starts again. Frozen sand never moves; a key does,
            so wind can open a lock on its own.
          </p>
          <label className="editor-check">
            <input
              type="checkbox"
              checked={Boolean(draft.wind)}
              onChange={(event) => update((current) => ({
                ...current,
                wind: event.target.checked ? { phases: [defaultWindPhase()] } : null,
              }))}
            />
            <span>This level has wind</span>
          </label>

          {draft.wind && (
            <ol className="editor-phases">
              {draft.wind.phases.map((phase, index) => (
                <li
                  key={index}
                  className={index === phaseIndex ? "is-active" : ""}
                  // Selecting a phase is what puts its zone on the canvas, so
                  // the rectangle being edited is the one being looked at.
                  // Focus, not click: touching any field in the card selects
                  // it, by mouse or by keyboard, and a click handler on the
                  // card itself would be a control that only a mouse can reach.
                  onFocusCapture={() => setPhaseIndex(index)}
                >
                  <header>
                    {/* A real button, so showing a phase's zone on the picture
                        is something a keyboard can do too. */}
                    <button
                      type="button"
                      className="editor-phase-pick"
                      onClick={() => setPhaseIndex(index)}
                      aria-pressed={index === phaseIndex}
                      title="Show this phase's zone on the picture"
                    >
                      <b>Phase {index + 1}</b>
                      <span className="editor-phase-summary">
                        {phase.direction === "right" ? "→" : "←"} {(phase.durationMs / 1000).toFixed(1)}s
                        {" · "}rest {(phase.cooldownMs / 1000).toFixed(1)}s
                        {" · "}power {phase.power}
                        {phase.zone ? " · zoned" : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="editor-mini"
                      disabled={index === 0}
                      onClick={() => update((current) => ({ ...current, wind: moveWindPhase(current.wind, index, -1) }))}
                      aria-label={`Move phase ${index + 1} earlier`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="editor-mini"
                      disabled={index === (draft.wind?.phases.length ?? 0) - 1}
                      onClick={() => update((current) => ({ ...current, wind: moveWindPhase(current.wind, index, 1) }))}
                      aria-label={`Move phase ${index + 1} later`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="editor-mini"
                      onClick={() => update((current) => ({
                        ...current,
                        wind: current.wind
                          ? { phases: current.wind.phases.filter((_, at) => at !== index) }
                          : current.wind,
                      }))}
                      aria-label={`Remove phase ${index + 1}`}
                    >
                      ✕
                    </button>
                  </header>

                  <div className="editor-field-row">
                    <label className="editor-field">
                      <span>Blows</span>
                      <select
                        value={phase.direction}
                        onChange={(event) => update((current) => ({
                          ...current,
                          wind: editWindPhase(current.wind, index, {
                            direction: event.target.value === "left" ? "left" : "right",
                          }),
                        }))}
                      >
                        {/* Named for where the sand goes, which is what the
                            field stores — labelling it by where the wind comes
                            from would read as the opposite of the value. */}
                        <option value="right">right →</option>
                        <option value="left">← left</option>
                      </select>
                    </label>
                    <label className="editor-field">
                      <span>For (s)</span>
                      <input
                        type="number"
                        min={0.2}
                        max={30}
                        step={0.2}
                        value={phase.durationMs / 1000}
                        onChange={(event) => update((current) => ({
                          ...current,
                          wind: editWindPhase(current.wind, index, {
                            durationMs: Math.round(Number(event.target.value) * 1000),
                          }),
                        }))}
                      />
                    </label>
                    <label className="editor-field">
                      <span>Rest (s)</span>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        step={0.2}
                        value={phase.cooldownMs / 1000}
                        onChange={(event) => update((current) => ({
                          ...current,
                          wind: editWindPhase(current.wind, index, {
                            cooldownMs: Math.round(Number(event.target.value) * 1000),
                          }),
                        }))}
                      />
                    </label>
                    <label className="editor-field">
                      <span>Power</span>
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={phase.power}
                        onChange={(event) => update((current) => ({
                          ...current,
                          wind: editWindPhase(current.wind, index, {
                            power: Math.max(1, Math.round(Number(event.target.value))),
                          }),
                        }))}
                      />
                    </label>
                  </div>

                  <label className="editor-check">
                    <input
                      type="checkbox"
                      checked={phase.zone !== null}
                      onChange={(event) => update((current) => ({
                        ...current,
                        wind: editWindPhase(current.wind, index, {
                          zone: event.target.checked
                            ? { x: 0, y: Math.floor(current.height / 2), width: current.width, height: Math.ceil(current.height / 2) }
                            : null,
                        }),
                      }))}
                    />
                    <span>Only part of the frame</span>
                  </label>

                  {phase.zone && (
                    <div className="editor-field-row">
                      {(["x", "y", "width", "height"] as const).map((field) => (
                        <label className="editor-field" key={field}>
                          <span>{field === "x" ? "Left" : field === "y" ? "Bottom" : field === "width" ? "Wide" : "Tall"}</span>
                          <input
                            type="number"
                            min={field === "x" || field === "y" ? 0 : 1}
                            max={field === "x" || field === "width" ? draft.width : draft.height}
                            value={phase.zone![field]}
                            onChange={(event) => update((current) => ({
                              ...current,
                              wind: editWindPhase(current.wind, index, {
                                zone: { ...phase.zone!, [field]: Math.max(0, Math.round(Number(event.target.value))) },
                              }),
                            }))}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </li>
              ))}
              <li className="editor-phase-add">
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => update((current) => ({
                    ...current,
                    wind: { phases: [...(current.wind?.phases ?? []), defaultWindPhase()] },
                  }))}
                >
                  + Add phase
                </button>
              </li>
            </ol>
          )}

          <h2>Key friction</h2>
          <p className="editor-note">
            How much a key resists rolling sideways — down a slope or in the wind. Low friction
            rolls the instant a slope offers it; high friction waits, so it reads as heavier. It
            never slows a straight drop, only a sideways one.
          </p>
          <label className="editor-field">
            <span>Friction {(draft.keyFriction ?? 0).toFixed(1)}</span>
            <input
              type="range"
              min={MIN_KEY_FRICTION}
              max={MAX_KEY_FRICTION}
              step={0.1}
              value={draft.keyFriction ?? 0}
              onChange={(event) => update((current) => ({ ...current, keyFriction: Number(event.target.value) }))}
            />
          </label>

          <h2>Ammo wheel</h2>
          <p className="editor-note">
            Only colours you have painted can be loaded, and every painted colour has to be here —
            otherwise that sand could never be shot at. Frozen sand counts: it needs a bullet the
            moment a key frees it.
            {fixtures.locked > 0 && ` This picture has ${fixtures.locked} frozen cells and ${fixtures.keys} key cells.`}
          </p>
          <ol className="editor-queue">
            {draft.ammoQueue.map((entry, position) => (
              <li key={`${entry}-${position}`}>
                <i className="editor-pip" style={{ "--swatch": hex(entry) } as React.CSSProperties} />
                <span>{COLOR_NAME[entry]}</span>
                <button
                  type="button"
                  className="editor-mini"
                  disabled={position === 0}
                  onClick={() => update((current) => {
                    const queue = [...current.ammoQueue];
                    [queue[position - 1], queue[position]] = [queue[position], queue[position - 1]];
                    return { ...current, ammoQueue: queue };
                  })}
                  aria-label="Move earlier"
                >↑</button>
                <button
                  type="button"
                  className="editor-mini"
                  disabled={position === draft.ammoQueue.length - 1}
                  onClick={() => update((current) => {
                    const queue = [...current.ammoQueue];
                    [queue[position + 1], queue[position]] = [queue[position], queue[position + 1]];
                    return { ...current, ammoQueue: queue };
                  })}
                  aria-label="Move later"
                >↓</button>
                <button
                  type="button"
                  className="editor-mini is-danger"
                  onClick={() => update((current) => ({
                    ...current,
                    ammoQueue: current.ammoQueue.filter((_, at) => at !== position),
                  }))}
                  aria-label="Remove"
                >×</button>
              </li>
            ))}
            {draft.ammoQueue.length === 0 && <li className="editor-queue-empty">The wheel is empty.</li>}
          </ol>
          <div className="editor-row">
            {used.filter((entry) => !draft.ammoQueue.includes(entry)).map((entry) => (
              <button
                key={entry}
                type="button"
                className="editor-button"
                onClick={() => update((current) => ({ ...current, ammoQueue: [...current.ammoQueue, entry] }))}
              >
                + {COLOR_NAME[entry]}
              </button>
            ))}
            <button
              type="button"
              className="editor-button"
              onClick={() => update((current) => syncQueueToPicture(current))}
            >
              Match picture
            </button>
          </div>

          <div className="editor-field-row">
            <label className="editor-field">
              <span>Shots</span>
              <input
                type="number"
                min={1}
                value={draft.shotLimit}
                onChange={(event) => update((current) => ({ ...current, shotLimit: Math.max(1, Number(event.target.value) || 1) }))}
              />
            </label>
            <label className="editor-field">
              <span>Radius</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={draft.sortRadius}
                onChange={(event) => update((current) => ({ ...current, sortRadius: Math.max(0.5, Number(event.target.value) || 0.5) }))}
              />
            </label>
          </div>

          {/* No pixel-scale control any more: the picture IS the board, so
              there is no factor left to choose between what is drawn and what
              is played. */}

          {/* ---- validation ---- */}
          {issues.length > 0 && (
            <ul className="editor-issues">
              {issues.map((issue, at) => (
                <li key={at} className={`is-${issue.severity}`}>
                  <span>{issue.message}</span>
                  {issue.fix === "settle" && (
                    <button type="button" className="editor-mini" onClick={() => update(settleDraft)}>
                      Settle it
                    </button>
                  )}
                  {issue.fix === "syncQueue" && (
                    <button type="button" className="editor-mini" onClick={() => update(syncQueueToPicture)}>
                      Fix wheel
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {issues.length === 0 && <p className="editor-ok">This level is ready to play.</p>}

          {/* ---- difficulty ---- */}
          <h2>Difficulty</h2>
          <p className="editor-note">
            The shot budget IS the difficulty here, so it is worth measuring rather than guessing.
            Both models play the real solver.
          </p>
          <button
            type="button"
            className="editor-button"
            disabled={analysing || errors.length > 0}
            onClick={runAnalysis}
          >
            {analysing ? "Measuring…" : "Measure difficulty"}
          </button>
          {analysis && (
            <div className={`editor-analysis is-${analysis.verdict}`}>
              {analysis.strongShots === null ? (
                <p>Strong play could not clear this inside {draft.shotLimit} shots.</p>
              ) : (
                <>
                  <p>
                    Strong play clears it in <strong>{analysis.strongShots}</strong> shots
                    {" "}({analysis.slack} to spare).
                  </p>
                  <p>
                    Careless play wins <strong>{analysis.carelessWins}</strong> of {analysis.carelessRuns} runs.
                  </p>
                  <p className="editor-verdict">
                    {analysis.verdict === "good" && "Well judged — there is room to misplay, and lazy play still loses."}
                    {analysis.verdict === "too-tight" && "Very tight — a good player has almost no slack."}
                    {analysis.verdict === "too-easy" && "Too generous — even careless play always wins."}
                  </p>
                  {analysis.suggestedShotLimit !== null && analysis.suggestedShotLimit !== draft.shotLimit && (
                    <button
                      type="button"
                      className="editor-mini"
                      onClick={() => update((current) => ({ ...current, shotLimit: analysis.suggestedShotLimit! }))}
                    >
                      Use {analysis.suggestedShotLimit} shots
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ---- ship it ---- */}
          <h2>Use this level</h2>
          <div className="editor-row">
            {errors.length ? (
              <button type="button" className="editor-button is-primary" disabled>
                Test in game
              </button>
            ) : (
              <Link
                className="editor-button is-primary"
                href={`/?level=${encodeURIComponent(draft.name.trim() || "Untitled")}`}
              >
                Test in game
              </Link>
            )}
            <button
              type="button"
              className="editor-button is-primary"
              disabled={shipping}
              title="Writes every level in the list on the left into sand-levels.ts, replacing what was there before — a level you delete here disappears from the file on the next ship."
              onClick={async () => {
                setShipping(true);
                // The whole list ships together and replaces the file's
                // editor-shipped section wholesale, so the game never ends up
                // with more built-in levels than the editor actually has.
                // Broken drafts are left out rather than blocking the rest.
                const shippable = drafts.filter((entry) =>
                  !validateDraft(entry).some((issue) => issue.severity === "error"));
                try {
                  const response = await fetch("http://localhost:4787/ship-levels", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ drafts: shippable }),
                  });
                  const payload = await response.json().catch(() => null);
                  if (!response.ok) {
                    throw new Error(payload?.error || "The level writer could not write the file.");
                  }
                  const skipped = drafts.length - shippable.length;
                  flash(`Shipped ${payload.count} level${payload.count === 1 ? "" : "s"} to sand-levels.ts`
                    + (skipped ? ` (${skipped} skipped for errors)` : ""));
                } catch {
                  flash("Couldn't reach the level writer — run `npm run level-writer` in a terminal, then try again.");
                }
                setShipping(false);
              }}
            >
              {shipping ? "Writing…" : "Ship all levels to sand-levels.ts"}
            </button>
            <button
              type="button"
              className="editor-button"
              onClick={() => {
                const code = draftToTypeScript(draft, index + 2);
                setExported(code);
                navigator.clipboard?.writeText(code).then(
                  () => flash("Copied — paste it into app/game/sand-levels.ts"),
                  () => flash("Copy it from the box below"),
                );
              }}
            >
              Copy TypeScript
            </button>
          </div>
          <p className="editor-note">
            Saved levels already show up in the game&apos;s level switcher, and stay in this editor,
            because they live in your browser. &quot;Ship all levels to sand-levels.ts&quot; writes
            the whole list on the left into the source file, replacing what was there before — so the
            file always has exactly the levels the editor has, not every level ever shipped. Run{" "}
            <code>npm run level-writer</code> once in a terminal alongside the dev server; then this
            button needs no copy-paste and survives clearing your browser or a fresh checkout.
            &quot;Copy TypeScript&quot; exports just this one level&apos;s block, for the manual fallback
            if that terminal isn&apos;t running.
          </p>
          {status && <p className="editor-ok">{status}</p>}
          {exported && (
            <textarea className="editor-export" readOnly value={exported} onFocus={(event) => event.currentTarget.select()} />
          )}
        </aside>
      </div>
    </main>
  );
}

/**
 * A filled bed on the floor — legal from the first frame, and obvious to paint
 * over. At the board's own resolution, so a new draft never needs converting.
 */
function starterDraft(name = "New level"): LevelDraft {
  const draft = createDraft(name);
  const rows = blankRows(draft.width, draft.height);
  const bed = Math.max(1, Math.round(draft.height * 0.28));
  for (let row = draft.height - bed; row < draft.height; row += 1) {
    rows[row] = "B".repeat(draft.width);
  }
  return { ...draft, rows, shotLimit: 20 };
}
