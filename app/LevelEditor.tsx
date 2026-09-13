"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { SAND_COLOR_HEX } from "./game/SandCannonEngine";
import { analyseLevel, type LevelAnalysis } from "./game/level-analysis";
import { computeDifficulty, type DifficultyResult } from "./game/level-difficulty";
import { adviseLevel, type Suggestion } from "./game/level-advisor";
import {
  SAND_LIGHTNESS_JITTER,
  SAND_SATURATION_JITTER,
  freezeBevelHex,
  jitterColorHex,
  keyBevelHex,
  wallBevelHex,
} from "./game/sand-color";
import {
  DEFAULT_FREEZE_DURATION,
  EMPTY_CELL,
  FREEZE_LETTER,
  KEY_LETTER,
  LETTER_BY_SAND_COLOR,
  MAX_HEIGHT,
  MAX_KEY_FRICTION,
  MAX_WIDTH,
  MIN_DIMENSION,
  MIN_KEY_FRICTION,
  WALL_LETTER,
  blankRows,
  coloursUsed,
  countPaintedCells,
  createDraft,
  draftToLevel,
  draftToTypeScript,
  effectivePixelScale,
  fixtureCounts,
  levelToDraft,
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
import { BUILT_IN_LEVELS } from "../design/levels/sand-levels";
import { groupCells } from "./game/sand-rules";
import { FREEZE_SPRITE, KEY_SPRITE, PADLOCK_SPRITE, spriteCells, spriteHeight, spriteWidth } from "./game/sand-sprites";
import { SAND_COLORS, type SandColor } from "./game/sand-types";
import { finishLoading } from "./loading-screen";

type Tool = "brush" | "bucket" | "key" | "freeze";

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
  white: "White",
  black: "Black",
  grass: "Grass",
  teal: "Teal",
  skyblue: "Sky Blue",
  indigo: "Indigo",
  magenta: "Magenta",
  crimson: "Crimson",
  darkbrown: "Dark Brown",
  violet: "Violet",
  navy: "Navy",
  emerald: "Emerald",
  rust: "Rust",
  mint: "Mint",
};

function hex(color: SandColor) {
  return `#${SAND_COLOR_HEX[color].toString(16).padStart(6, "0")}`;
}

/** A colour's hue, 0-360, computed straight from its RGB hex — used only to
 * sort the swatch grid below (`SORTED_SWATCH_COLORS`). A flat grey (equal
 * R/G/B) has no real hue and lands on 0, but none of the palette's greys are
 * perfectly flat (`white`/`black` both carry a faint warm/cool tint), so
 * nothing here actually needs a special case for one. */
function hueOf(colorHex: number): number {
  const r = ((colorHex >> 16) & 0xff) / 255;
  const g = ((colorHex >> 8) & 0xff) / 255;
  const b = (colorHex & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / delta + 2) / 6;
  else h = ((r - g) / delta + 4) / 6;
  return h * 360;
}

/**
 * The swatch grid's own order — ascending hue, round the colour wheel once —
 * kept entirely separate from `SAND_COLORS` itself.
 *
 * `SAND_COLORS`'s order is not cosmetic: `shootableColors` (sand-rules.ts)
 * indexes into it with a seeded random pick to draw the next bullet, so
 * reordering that array would reshuffle every already-shipped level's ammo
 * sequence for the same seed (see `SAND_COLORS`'s own comment in
 * sand-types.ts). This is a picker, free to read in whatever order helps an
 * author find a colour by eye, computed once since the palette itself is a
 * fixed, static list.
 */
const SORTED_SWATCH_COLORS: readonly SandColor[] = [...SAND_COLORS].sort(
  (a, b) => hueOf(SAND_COLOR_HEX[a]) - hueOf(SAND_COLOR_HEX[b]),
);

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

/** SVG viewBox for the difficulty-progression chart, in its own local units. */
const CHART_WIDTH = 280;
const CHART_HEIGHT = 64;
const CHART_PAD = 6;

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

/** Same reasoning as `DEFAULT_KEY_SCALE`/`MAX_KEY_SCALE`, for the Freeze
 * trigger's own fixed crystal-key silhouette. */
const DEFAULT_FREEZE_SCALE = 4;
const MAX_FREEZE_SCALE = 16;

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

/** `maxKeyScale`, for the Freeze trigger's own sprite. */
function maxFreezeScale(draft: LevelDraft) {
  return Math.max(1, Math.min(
    MAX_FREEZE_SCALE,
    Math.floor(draft.width / spriteWidth(FREEZE_SPRITE)),
    Math.floor(draft.height / spriteHeight(FREEZE_SPRITE)),
  ));
}
/** Matches `LOCK_DARKEN` in the engine — the same sand should look the same. */
const LOCK_DARKEN = 0.62;
/** How hard a cell dims once some other colour is highlighted (Ammo wheel) —
 * darker than `LOCK_DARKEN` so "not the colour I'm hunting for" reads as a
 * clearly different state from "locked", never confusable with it. */
const HIGHLIGHT_DIM_STYLE = "rgba(0,0,0,.72)";

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

/** `keyCellsAt`, for the Freeze trigger's own sprite. */
function freezeCellsAt(draft: LevelDraft, x: number, y: number, scale: number) {
  const cells = spriteCells(FREEZE_SPRITE, scale);
  const width = spriteWidth(FREEZE_SPRITE) * scale;
  const height = spriteHeight(FREEZE_SPRITE) * scale;
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
 * How many screen pixels one board pixel draws at, given the panel's fixed
 * budget (560x620) — shared by the main canvas draw effect and the brush
 * preview overlay, which has to line up with it exactly cell for cell.
 */
function boardCellPx(draft: LevelDraft) {
  return Math.max(4, Math.floor(Math.min(560 / draft.width, 620 / draft.height)));
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

/**
 * The cells the cursor would stamp down right now, one tool at a time — what
 * the brush-preview overlay outlines under the cursor before the player
 * commits to a click. Mirrors `paintAt`'s own per-tool shape exactly (brush's
 * square nib, the key/Freeze sprites at their current scale) so the preview
 * never promises a footprint the actual stroke does not deliver. `bucket` has
 * no cheap preview of its own — the region it would fill is not known until
 * the flood actually runs — so it just marks the one cell the fill starts
 * from.
 */
function previewCellsAt(
  draft: LevelDraft,
  tool: Tool,
  x: number,
  y: number,
  options: { brushSize: number; keyScale: number; freezeScale: number },
): Array<{ x: number; y: number }> {
  if (tool === "key") {
    return keyCellsAt(draft, x, y, Math.min(options.keyScale, maxKeyScale(draft)));
  }
  if (tool === "freeze") {
    return freezeCellsAt(draft, x, y, Math.min(options.freezeScale, maxFreezeScale(draft)));
  }
  if (tool === "bucket") {
    return [{ x, y }];
  }
  return brushCells(draft, x, y, options.brushSize);
}

/** The whole connected group of same-letter cells under (x, y) in `rows`, or
 * null — shared by the key tool (`KEY_LETTER`), the Freeze tool
 * (`FREEZE_LETTER` on `draft.rows`), and the Freeze tool's own hidden mode
 * (`FREEZE_LETTER` on `draft.hiddenFreezeRows` instead), since all three
 * stamp a rigid shape the same way and lift it the same way. */
function letterGroupAtRows(rows: string[], height: number, x: number, y: number, letter: string) {
  if (letterAt(rows, x, y, height) !== letter) return null;
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
      if (letterAt(rows, next.x, next.y, height) !== letter) continue;
      seen.add(at);
      queue.push(next);
    }
  }
  return found;
}

function letterGroupAt(draft: LevelDraft, x: number, y: number, letter: string) {
  return letterGroupAtRows(draft.rows, draft.height, x, y, letter);
}

/** Stamps or clears `letter` into an arbitrary rows grid — the shared
 * primitive behind `stampCells`/`stampFreezeCells`/`clearCells` below, and
 * behind the Freeze tool's own hidden-mode painting (SandGame.tsx's
 * `paintAt`), which targets `draft.hiddenFreezeRows` instead of `draft.rows`
 * and so cannot go through those three directly. */
function stampInto(rows: string[], height: number, cells: Array<{ x: number; y: number }>, letter: string) {
  return cells.reduce((acc, cell) => withCell(acc, cell.x, cell.y, height, letter), rows);
}

function stampCells(draft: LevelDraft, cells: Array<{ x: number; y: number }>) {
  return stampInto(draft.rows, draft.height, cells, KEY_LETTER);
}

function stampFreezeCells(draft: LevelDraft, cells: Array<{ x: number; y: number }>) {
  return stampInto(draft.rows, draft.height, cells, FREEZE_LETTER);
}

function clearCells(draft: LevelDraft, cells: Array<{ x: number; y: number }>) {
  return stampInto(draft.rows, draft.height, cells, EMPTY_CELL);
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

/** Whichever of `candidates` is closest to an RGB triple, by plain squared distance. */
function nearestColorAmong(r: number, g: number, b: number, candidates: readonly SandColor[]): SandColor {
  let best: SandColor = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
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
 * Every `SAND_COLOR_HEX` entry is a fully-saturated candy colour (see that
 * const's own comments) — a real photo's pixels almost never are. Matching
 * a muted pixel to the palette by raw RGB distance alone systematically
 * favours the FEW desaturated entries the palette happens to have (`white`,
 * `black`, `brown`, `blue`, `darkbrown`) over the correct hue family: a
 * muted sage green sits numerically closer to `brown` or `white` in plain
 * RGB space than to `grass`, even though it plainly reads as green to a
 * person looking at it. This surfaced importing `ZenModeThumbnail.png` (a
 * muted-green pixel-art scene) into a Zen draft — the result came back
 * brown/grey/purple instead of green.
 *
 * `boostSaturation` below exaggerates whatever hue a pixel already leans
 * toward (a plain HSL round-trip with S multiplied up) BEFORE it is matched,
 * so a muted-but-clearly-green pixel gets pushed back toward green's own
 * corner of RGB space instead of quietly sitting in a desaturated palette
 * colour's — `SATURATION_BOOST` is picked empirically high enough to fix
 * that real photo without needing to be exact science.
 */
const SATURATION_BOOST = 3;

function rgbToHsl(r: number, g: number, b: number): [h: number, s: number, l: number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hueChannel(p: number, q: number, tRaw: number): number {
  let t = tRaw;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [r: number, g: number, b: number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueChannel(p, q, h + 1 / 3) * 255),
    Math.round(hueChannel(p, q, h) * 255),
    Math.round(hueChannel(p, q, h - 1 / 3) * 255),
  ];
}

/** A pixel's own colour, saturation pushed up before matching — see
 * `SATURATION_BOOST`'s own comment. */
function boostSaturation(r: number, g: number, b: number): [r: number, g: number, b: number] {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(h, Math.min(1, s * SATURATION_BOOST), l);
}

/** The full-palette colour whose RGB is closest to a pixel, once that
 * pixel's own saturation has been boosted (see `boostSaturation`) so the
 * match favours the right hue family over an accidentally-closer
 * desaturated palette colour. */
function nearestSandColor(r: number, g: number, b: number): SandColor {
  const [br, bg, bb] = boostSaturation(r, g, b);
  return nearestColorAmong(br, bg, bb, SAND_COLORS);
}

/**
 * Rasterise a bitmap onto the board, one board pixel at a time.
 *
 * The image is scaled to *cover* the frame — fill it completely, cropping
 * whatever spills past the shorter axis — the same as CSS `background-size:
 * cover`. Fitting it inside the frame instead would leave empty bars an
 * author has to notice and paint over by hand, and covering never does.
 * Smoothing is off for that scale: a browser's default bilinear resize blends
 * neighbouring pixels together at every edge, which is exactly backwards for
 * pixel art — it manufactures in-between colours the source image never had,
 * right where a clean block boundary should be. Nearest-neighbour sampling
 * keeps every output pixel a real colour that was actually in the source.
 *
 * Every opaque pixel is then matched to the nearest palette colour by RGB
 * distance — the same "which colour is this closest to" a human eye does,
 * just run once per pixel instead of by hand — with no distance cutoff: a
 * pixel that came from the source image is real information about it, not
 * noise to be filtered out, so it always becomes the sand colour closest to
 * it rather than being discarded. A pixel counts as background, and is left
 * empty, only when it is transparent or (with `trimWhite`) nearly white —
 * an imported picture almost always has one of those two, and either one
 * filled in solid would bury the picture under a slab of one colour.
 *
 * `maxColors` caps how many distinct colours the result uses. The first pass
 * always matches against the full palette and counts how often each colour
 * actually gets used; only if that count exceeds the cap does a second pass
 * keep the most-used colours and reassign every pixel that lost its colour to
 * whichever survivor is closest to it — never to empty, since a cut colour
 * means "call it something else", not "erase it".
 *
 * Also returns `palette`: for every `SandColor` bucket that ended up with at
 * least one pixel, the TRUE average RGB of the actual source pixels that
 * landed in it (not the shared candy hex `SAND_COLOR_HEX` would otherwise
 * draw). Matching still has to snap every pixel to one of the 24 finite
 * buckets — that is load-bearing for the "shoot same colour" mechanic, see
 * `nearestSandColor`'s own comment — but once a pixel's bucket is decided,
 * nothing requires that bucket to render as the shared candy colour rather
 * than this picture's own colour for it. A caller that stores `palette` as
 * the level's `customPalette` (`SandLevelConfig`) gets a picture whose ONLY
 * loss versus the source is pixels of different true colours that happened
 * to share a bucket — everything else renders exactly as imported.
 */
function imageToRows(
  img: HTMLImageElement,
  width: number,
  height: number,
  trimWhite: boolean,
  maxColors: number,
): { rows: string[]; palette: Partial<Record<SandColor, number>> } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { rows: blankRows(width, height), palette: {} };
  context.imageSmoothingEnabled = false;
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const drawWidth = img.naturalWidth * scale;
  const drawHeight = img.naturalHeight * scale;
  context.drawImage(img, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

  const { data } = context.getImageData(0, 0, width, height);
  const colors: (SandColor | null)[] = new Array(width * height);
  // Each opaque pixel's own true RGB, kept alongside which bucket it snapped
  // to — needed after the fact to compute each bucket's real average colour
  // for `palette` (`imageToRows`'s own doc comment).
  const trueRgb: ([r: number, g: number, b: number] | null)[] = new Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const at = i * 4;
    const r = data[at];
    const g = data[at + 1];
    const b = data[at + 2];
    const a = data[at + 3];
    const isBackground = a < 24 || (trimWhite && r > 240 && g > 240 && b > 240);
    colors[i] = isBackground ? null : nearestSandColor(r, g, b);
    trueRgb[i] = isBackground ? null : [r, g, b];
  }

  const counts = new Map<SandColor, number>();
  for (const color of colors) {
    if (color !== null) counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  const remap = new Map<SandColor, SandColor>();
  if (counts.size > maxColors) {
    const kept = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(1, maxColors))
      .map(([color]) => color);
    const keptSet = new Set(kept);
    for (const color of counts.keys()) {
      if (keptSet.has(color)) continue;
      const rgb = SAND_COLOR_HEX[color];
      remap.set(color, nearestColorAmong((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, kept));
    }
  }

  const sums = new Map<SandColor, [r: number, g: number, b: number, n: number]>();
  const rows: string[] = [];
  for (let row = 0; row < height; row += 1) {
    let line = "";
    for (let x = 0; x < width; x += 1) {
      const i = row * width + x;
      const color = colors[i];
      if (color === null) {
        line += EMPTY_CELL;
        continue;
      }
      const finalColor = remap.get(color) ?? color;
      line += LETTER_BY_SAND_COLOR[finalColor];
      const rgb = trueRgb[i];
      if (rgb) {
        const sum = sums.get(finalColor) ?? [0, 0, 0, 0];
        sum[0] += rgb[0];
        sum[1] += rgb[1];
        sum[2] += rgb[2];
        sum[3] += 1;
        sums.set(finalColor, sum);
      }
    }
    rows.push(line);
  }

  const palette: Partial<Record<SandColor, number>> = {};
  for (const [color, [r, g, b, n]] of sums) {
    palette[color] = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  }
  return { rows, palette };
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

/**
 * Every grid point on the straight line from `(x0, y0)` to `(x1, y1)`,
 * inclusive of both ends — Bresenham's algorithm, the standard way to walk a
 * line one grid cell at a time with no gaps and no float rounding drift.
 * Feeds the Shift-click "straight line from the last point" gesture below,
 * the same as Photoshop's own brush: each point in order gets stamped with
 * the brush nib, so a thick brush still draws a solid straight bar rather
 * than a dotted one.
 */
function linePoints(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
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
  /** Whether the brush lays down Wall Obstacle instead of sand — a colourless
   * material, not a colour, so this is a modifier alongside `locking` rather
   * than a fifth `Tool`. Mutually exclusive with it: a cell cannot be both a
   * wall and locked sand. */
  const [wallMode, setWallMode] = useState(false);
  /** Whether Brush/Fill clears cells instead of painting them — a modifier
   * rather than its own tool so it composes with Fill: Erase alone rubs out
   * a brush-sized patch, Erase+Fill clears a whole connected region in one
   * click. Mutually exclusive with `locking`/`wallMode`, since a cell cannot
   * be erased and also painted down as something. */
  const [erasing, setErasing] = useState(false);
  /** The key tool's radius, in board pixels. */
  const [keyScale, setKeyScale] = useState(DEFAULT_KEY_SCALE);
  /** The Freeze tool's radius, in board pixels. */
  const [freezeScale, setFreezeScale] = useState(DEFAULT_FREEZE_SCALE);
  // The Freeze tool's own second mode (on request: "freeze bị che sau lớp
  // cát") — while on, a click stamps/clears `draft.hiddenFreezeRows` instead
  // of `draft.rows`, burying the trigger behind whatever sand is already
  // there rather than painting it into the open. Its own state, not folded
  // into `tool`, because it is a modifier on the Freeze tool specifically
  // (same footing as `locking`/`wallMode` are modifiers on the brush) —
  // switching tools away and back keeps whichever mode was last chosen.
  const [freezeHidden, setFreezeHidden] = useState(false);
  /** Width of the square brush nib, in board pixels. */
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [color, setColor] = useState<SandColor>("blue");
  /** Which colour the picture is dimming everything else against — set by
   * clicking a colour in the Ammo wheel, so an author can find where it
   * actually is in the picture without having to hunt the canvas by eye.
   * Null means "no dimming", the ordinary view. */
  const [highlightColor, setHighlightColor] = useState<SandColor | null>(null);
  const [analysis, setAnalysis] = useState<LevelAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [shipping, setShipping] = useState(false);
  /** In-flight state for "Update built-in level" — separate from `shipping`
   * since the two hit different endpoints and can't run at the same time
   * anyway (both write the same file), but sharing one flag would disable
   * the wrong button's label while the other request is in flight. */
  const [updatingBuiltIn, setUpdatingBuiltIn] = useState(false);
  /** In-flight state for "Ship all Zen levels to zen-custom-levels.ts" — its
   * own flag for the same reason `updatingBuiltIn` has one: a different
   * endpoint, a different file, shouldn't share a busy flag with `shipping`
   * (the main list's own "Ship all"). */
  const [shippingZen, setShippingZen] = useState(false);
  const [importing, setImporting] = useState(false);
  /** Whether a near-white pixel imports as empty rather than as sand. */
  const [trimWhite, setTrimWhite] = useState(true);
  /** How many distinct colours "Import image" is allowed to use — the full
   * palette by default, so this only ever narrows the result until an author
   * turns it down. */
  const [importMaxColors, setImportMaxColors] = useState(SAND_COLORS.length);
  /** Which built-in level the "Import built-in" row would bring in next. */
  const [importLevelId, setImportLevelId] = useState<number | null>(BUILT_IN_LEVELS[3]?.id ?? null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const painting = useRef(false);
  const history = useRef<{ past: LevelDraft[]; future: LevelDraft[] }>({ past: [], future: [] });
  /** Where the brush last painted — Photoshop's own "Shift-click to connect
   * a straight line to the last point" reads off this. Cleared whenever a
   * fresh stroke starts somewhere a line couldn't sensibly continue from
   * (switching levels, undo/redo), so a stray Shift-click never draws a line
   * back to a point that picture no longer has any relation to. */
  const lastBrushPoint = useRef<{ x: number; y: number } | null>(null);
  /** The cell the cursor is over right now — drives the brush-preview
   * overlay (see `previewCellsAt`/the overlay draw effect below). State, not
   * a ref: the overlay is a separate small canvas that only this needs to
   * repaint, so re-rendering the whole panel on every mouse move costs
   * nothing extra it wasn't already going to cost. `null` whenever the
   * cursor is off the canvas entirely (or there is no board yet), which
   * hides the preview outright rather than freezing it at its last spot. */
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);

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
   * `drafts`, for display only, sorted by the built-in level id each was
   * imported from — never by when it happened to be imported.
   *
   * "Import built-in" (and duplicate/+New) always append to `drafts`
   * itself, so pulling in Level 13 then Level 12 left 13 sitting above 12
   * everywhere that just mapped over `drafts` in storage order — the Levels
   * roster, the difficulty chart, and its bar-list underneath. Sorting a
   * copy for display, rather than reordering `drafts`/localStorage itself,
   * keeps every id-based lookup (`selectedId`, `history`, the Delete
   * button's "select whatever was next to it" fallback) working off the
   * order things actually happened in — only the three read-only listings
   * below ever read this one. A level with no `importedFromId` (a fresh
   * "+ New" or a duplicate) has no built-in id to sort by, so it sorts
   * after every imported one; `Array.prototype.sort` is stable, so two such
   * levels still keep whatever order they were created in relative to each
   * other.
   */
  const orderedDrafts = useMemo(
    () => [...drafts].sort((a, b) => (a.importedFromId ?? Infinity) - (b.importedFromId ?? Infinity)),
    [drafts],
  );

  /**
   * Local text buffers for the Width/Height fields, decoupled from `draft`
   * itself.
   *
   * Wiring the input straight to `draft.width`/`resizeDraft` fired on every
   * keystroke — clearing "60" to type "45" committed the empty field as `0`
   * immediately, `resizeDraft` clamped that to `MIN_DIMENSION` and rebuilt
   * the whole picture, and the field snapped to "12" out from under the very
   * next digit being typed. These buffers only sync FROM the draft (picking
   * a different level, or after a commit clamps the value) and only commit
   * back TO it on blur or Enter, so an in-progress edit is free to pass
   * through "", "4", "45" without any of them being clamped or fought over
   * mid-keystroke.
   */
  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  useEffect(() => {
    if (!draft) return;
    setWidthText(String(draft.width));
    setHeightText(String(draft.height));
  }, [draft?.id, draft?.width, draft?.height]);

  // A highlight names a colour in THIS picture — switching levels leaves it
  // pointing at a colour the new picture may not even have, so it is cleared
  // rather than carried over.
  useEffect(() => setHighlightColor(null), [draft?.id]);

  /**
   * `drafts` itself stays undeferred — the canvas, the form fields, undo/redo
   * all read it directly and have to track every keystroke and every sampled
   * point of a stroke with zero lag. The difficulty bar doesn't need that:
   * `computeDifficulty` walks the whole picture (`parseSandLevel`'s 4-connected
   * body split), tens of milliseconds on an 80x90 board — cheap once, but a
   * fast drag fires dozens of pointermove events a second, and paying that
   * cost synchronously on every single one is what would make the *painting*
   * itself start dropping frames, not just the bar lag behind it. Deferring
   * this one read is what keeps the bar auto-updating (React catches it up
   * the moment the main thread has spare cycles, no click required) without
   * ever competing with the stroke that is still actually in progress.
   */
  const deferredDrafts = useDeferredValue(drafts);

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
    () => new Map(deferredDrafts.map((entry) => [entry.id, difficultyFor(entry)] as const)),
    [deferredDrafts],
  );

  /**
   * Plot points for the difficulty-progression chart: one per level, in the
   * same list order the roster and the bar-list below both use, so a point
   * on the chart and a row in the list always mean the same level.
   */
  const difficultyChartPoints = useMemo(() => {
    const width = CHART_WIDTH - CHART_PAD * 2;
    const height = CHART_HEIGHT - CHART_PAD * 2;
    return orderedDrafts.map((entry, index) => {
      const result = difficultyById.get(entry.id);
      const score = result?.score ?? 0;
      const x = orderedDrafts.length <= 1 ? CHART_WIDTH / 2 : CHART_PAD + (index / (orderedDrafts.length - 1)) * width;
      const y = CHART_PAD + (1 - score / 100) * height;
      return { id: entry.id, name: entry.name || "Untitled", score, label: result?.label ?? "easy", x, y };
    });
  }, [orderedDrafts, difficultyById]);

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

  /** Commits the Width/Height text buffers above — see their own comment.
   * An unparseable field (empty, mid-edit) reverts to the draft's current
   * value instead of resizing to 0; a parseable-but-out-of-range one still
   * goes through, so `resizeDraft`'s own clamp is what the field settles on. */
  const commitWidth = useCallback(() => {
    if (!draft) return;
    const parsed = Number(widthText);
    if (!Number.isFinite(parsed)) {
      setWidthText(String(draft.width));
      return;
    }
    update((current) => resizeDraft(current, parsed, current.height));
  }, [draft, widthText, update]);

  const commitHeight = useCallback(() => {
    if (!draft) return;
    const parsed = Number(heightText);
    if (!Number.isFinite(parsed)) {
      setHeightText(String(draft.height));
      return;
    }
    update((current) => resizeDraft(current, current.width, parsed));
  }, [draft, heightText, update]);

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
        const existing = letterGroupAt(current, x, y, KEY_LETTER);
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

    // The Freeze trigger, same stamp/lift gesture as the key — a rigid shape
    // the game groups by connectivity, not a smear a freehand brush could
    // ever produce faithfully. `freezeHidden` sends the exact same gesture
    // at `hiddenFreezeRows` instead of `rows` — see that field's own comment
    // and `freezeHidden`'s own state comment.
    if (tool === "freeze") {
      update((current) => {
        const scale = Math.min(freezeScale, maxFreezeScale(current));
        if (freezeHidden) {
          const hiddenRows = current.hiddenFreezeRows ?? blankRows(current.width, current.height);
          const existing = letterGroupAtRows(hiddenRows, current.height, x, y, FREEZE_LETTER);
          const hiddenFreezeRows = existing
            ? stampInto(hiddenRows, current.height, existing, EMPTY_CELL)
            : stampInto(hiddenRows, current.height, freezeCellsAt(current, x, y, scale), FREEZE_LETTER);
          return hiddenFreezeRows === hiddenRows ? current : { ...current, hiddenFreezeRows };
        }
        const existing = letterGroupAt(current, x, y, FREEZE_LETTER);
        const rows = existing
          ? clearCells(current, existing)
          : stampFreezeCells(current, freezeCellsAt(current, x, y, scale));
        return rows === current.rows ? current : { ...current, rows };
      }, true);
      return;
    }

    const letter = erasing
      ? EMPTY_CELL
      : wallMode ? WALL_LETTER
      : locking ? lockedLetter(color) : LETTER_BY_SAND_COLOR[color];
    update((current) => {
      if (tool === "bucket") {
        const rows = bucketFill(current.rows, current.width, current.height, x, y, letter);
        return rows === current.rows ? current : { ...current, rows };
      }
      // A square nib centred on the cursor. The board is pixels now, so a
      // one-cell brush would make painting a hillside a thousand clicks.
      // On request ("nút freeze có thể bị che sau lớp cát"): an ordinary
      // colour/wall/lock stroke skips any cell that is already part of a
      // Freeze trigger instead of blindly overwriting it — the brush is a
      // blunt square stamp with no idea what it is about to cover, so
      // without this a stroke that merely passes near a trigger silently
      // buries it under sand, with nothing on screen to say so until the
      // level is played and the mechanic just is not there any more.
      // `erasing` is exempt — that is how a trigger gets cleared this way
      // on purpose, on top of the Freeze tool's own click-to-clear gesture.
      const rows = brushCells(current, x, y, brushSize)
        .filter((cell) => erasing || readCell(letterAt(current.rows, cell.x, cell.y, current.height)).kind !== "freeze")
        .reduce((acc, cell) => withCell(acc, cell.x, cell.y, current.height, letter), current.rows);
      return rows === current.rows ? current : { ...current, rows };
    }, record);
  }, [tool, color, locking, wallMode, erasing, keyScale, freezeScale, freezeHidden, brushSize, update]);

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
    // Shift-click connects a straight brush stroke from wherever the brush
    // last painted to here — Photoshop's own gesture for a straight line
    // without needing a steady drag. Scoped to the brush tool: a "line" of
    // bucket fills or key stamps is not a line, it is one click repeated.
    if (event.shiftKey && tool === "brush" && lastBrushPoint.current) {
      const points = linePoints(lastBrushPoint.current.x, lastBrushPoint.current.y, cell.x, cell.y);
      // record only on the line's first point — like a drag, the whole line
      // is one undo step, not one per point it passes through.
      points.forEach((point, index) => paintAt(point.x, point.y, index === 0));
    } else {
      paintAt(cell.x, cell.y, true);
    }
    lastBrushPoint.current = cell;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = cellFromEvent(event);
    // Tracked independently of the paint stroke below — the preview has to
    // follow the cursor whether or not a stroke is in progress, so a player
    // can see the brush's footprint before ever clicking.
    setHoverCell(cell);
    if (!painting.current || tool === "bucket") return;
    if (!cell) return;
    // record: false — the whole drag is one undo step.
    paintAt(cell.x, cell.y, false);
    lastBrushPoint.current = cell;
  };

  /** Hides the preview the instant the cursor leaves the canvas — otherwise
   * it would sit frozen over the last cell visited, implying a brush that is
   * no longer actually there. */
  const onPointerLeaveCanvas = () => setHoverCell(null);

  const endStroke = () => {
    painting.current = false;
  };

  // ---- canvas ------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !draft) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const cellPx = boardCellPx(draft);
    canvas.width = draft.width * cellPx;
    canvas.height = draft.height * cellPx;

    context.fillStyle = "#150e28";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Screen-space wall/key checks for the two bevel passes below —
    // out-of-bounds reads as "not there", so a shape sitting flush against
    // the board's own edge is beveled on that side too, same as any other
    // edge of its shape.
    const isWallAt = (r: number, c: number) => readCell(draft.rows[r]?.[c] ?? EMPTY_CELL).kind === "wall";
    const isKeyAt = (r: number, c: number) => readCell(draft.rows[r]?.[c] ?? EMPTY_CELL).kind === "key";
    const isFreezeAt = (r: number, c: number) => readCell(draft.rows[r]?.[c] ?? EMPTY_CELL).kind === "freeze";

    for (let row = 0; row < draft.height; row += 1) {
      for (let x = 0; x < draft.width; x += 1) {
        const cell = readCell(draft.rows[row]?.[x] ?? EMPTY_CELL);
        if (cell.kind === "empty") continue;
        const left = x * cellPx;
        const top = row * cellPx;
        // A wheel entry is highlighted: every cell that is not THAT sand
        // colour dims, walls and keys included, so the one colour being
        // hunted for is the only thing that still reads at full strength.
        const dimmed = highlightColor !== null && !(cell.kind === "sand" && cell.color === highlightColor);

        if (cell.kind === "key") {
          context.fillStyle = keyBevelHex(
            isKeyAt(row - 1, x),
            isKeyAt(row + 1, x),
            isKeyAt(row, x - 1),
            isKeyAt(row, x + 1),
          );
          context.fillRect(left, top, cellPx, cellPx);
          if (dimmed) {
            context.fillStyle = HIGHLIGHT_DIM_STYLE;
            context.fillRect(left, top, cellPx, cellPx);
          }
          continue;
        }

        if (cell.kind === "wall") {
          context.fillStyle = wallBevelHex(
            isWallAt(row - 1, x),
            isWallAt(row + 1, x),
            isWallAt(row, x - 1),
            isWallAt(row, x + 1),
          );
          context.fillRect(left, top, cellPx, cellPx);
          if (dimmed) {
            context.fillStyle = HIGHLIGHT_DIM_STYLE;
            context.fillRect(left, top, cellPx, cellPx);
          }
          continue;
        }

        if (cell.kind === "freeze") {
          context.fillStyle = freezeBevelHex(
            isFreezeAt(row - 1, x),
            isFreezeAt(row + 1, x),
            isFreezeAt(row, x - 1),
            isFreezeAt(row, x + 1),
          );
          context.fillRect(left, top, cellPx, cellPx);
          if (dimmed) {
            context.fillStyle = HIGHLIGHT_DIM_STYLE;
            context.fillRect(left, top, cellPx, cellPx);
          }
          continue;
        }

        // The same per-grain jitter the game paints, from the same seed
        // formula — a flat swatch here would read as fewer, bigger blocks
        // than the same picture does once it is actually poured as sand.
        const y = draft.height - 1 - row;
        const seed = x * 733 + y * 197;
        context.fillStyle = jitterColorHex(
          draft.customPalette?.[cell.color] ?? SAND_COLOR_HEX[cell.color],
          seed,
          SAND_SATURATION_JITTER,
          SAND_LIGHTNESS_JITTER,
        );
        context.fillRect(left, top, cellPx, cellPx);
        if (cell.locked) {
          // Shaded down rather than tinted, exactly as the engine does it: the
          // colour underneath still has to be readable, because it is the
          // bullet the wheel hands out once the lock opens.
          context.fillStyle = `rgba(0,0,0,${LOCK_DARKEN})`;
          context.fillRect(left, top, cellPx, cellPx);
        }
        if (dimmed) {
          context.fillStyle = HIGHLIGHT_DIM_STYLE;
          context.fillRect(left, top, cellPx, cellPx);
        }
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

    // A hidden Freeze trigger (on request: "freeze bị che sau lớp cát") is
    // deliberately invisible in the real game — it is buried, that is the
    // whole point — but the AUTHOR still has to be able to see where they
    // put one, or there is no way to line it up with the sand meant to
    // cover it. Drawn as a translucent cyan hatch over whatever `rows`
    // already painted there (not the trigger's own bright bevel — that
    // would read as "this is visible in-game", which is exactly wrong),
    // after everything else so it always shows through.
    if (draft.hiddenFreezeRows) {
      context.fillStyle = "rgba(92,200,232,.4)";
      context.strokeStyle = "rgba(236,250,255,.85)";
      context.lineWidth = Math.max(1, cellPx * 0.12);
      draft.hiddenFreezeRows.forEach((row, r) => {
        [...row].forEach((letter, x) => {
          if (letter !== FREEZE_LETTER) return;
          const left = x * cellPx;
          const top = r * cellPx;
          context.fillRect(left, top, cellPx, cellPx);
          context.beginPath();
          context.moveTo(left + 2, top + 2);
          context.lineTo(left + cellPx - 2, top + cellPx - 2);
          context.moveTo(left + cellPx - 2, top + 2);
          context.lineTo(left + 2, top + cellPx - 2);
          context.stroke();
        });
      });
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
  }, [draft, highlightColor]);

  // The brush-preview overlay: a second, much cheaper canvas kept the exact
  // same size as the real one (see `.editor-canvas-wrap`), redrawn on every
  // mouse move instead of the whole board — see `hoverCell`'s own comment for
  // why this is a separate layer rather than folded into the effect above.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !draft) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const cellPx = boardCellPx(draft);
    canvas.width = draft.width * cellPx;
    canvas.height = draft.height * cellPx;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!hoverCell) return;

    const cells = previewCellsAt(draft, tool, hoverCell.x, hoverCell.y, { brushSize, keyScale, freezeScale });
    // Erasing gets its own warning tint (on request, effectively — a preview
    // that looked identical to painting would make a stray Erase stroke as
    // easy to miss as it was before this existed at all) rather than the
    // ordinary "here is where the brush lands" tint every other mode shares.
    const tint = tool === "brush" && erasing ? "rgba(240,90,90,.38)" : "rgba(255,255,255,.32)";
    const outline = tool === "brush" && erasing ? "rgba(255,214,214,.9)" : "rgba(255,255,255,.9)";
    context.fillStyle = tint;
    context.strokeStyle = outline;
    context.lineWidth = Math.max(1, cellPx * 0.1);
    for (const cell of cells) {
      // Same top-down/bottom-up flip every other draw call here makes —
      // `cell.y` is game-space (bottom-up), the canvas row is top-down.
      const left = cell.x * cellPx;
      const top = (draft.height - 1 - cell.y) * cellPx;
      context.fillRect(left, top, cellPx, cellPx);
      context.strokeRect(left + 0.5, top + 0.5, cellPx - 1, cellPx - 1);
    }
  }, [draft, tool, hoverCell, brushSize, keyScale, freezeScale, erasing]);

  // ---- derived -----------------------------------------------------------

  const issues = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);
  const errors = issues.filter((issue) => issue.severity === "error");
  const used = draft ? coloursUsed(draft) : [];
  const painted = draft ? countPaintedCells(draft) : 0;
  const fixtures = draft ? fixtureCounts(draft) : { locked: 0, keys: 0, freeze: 0, hiddenFreeze: 0, hiddenKey: 0 };
  // Resizing the board can leave the chosen key size too big for it, so the
  // limit is applied on the way out rather than only when the button is pressed.
  const keyScaleLimit = draft ? maxKeyScale(draft) : 1;
  const freezeScaleLimit = draft ? maxFreezeScale(draft) : 1;
  const scale = draft ? effectivePixelScale(draft) : 1;
  const pixels = draft ? draft.width * draft.height * scale * scale : 0;

  /**
   * Edit suggestions for the selected level — the heuristic and progression
   * checks run every render (cheap, no solver involved), the solver-backed
   * one only once `analysis` exists (i.e. "Measure difficulty" was clicked).
   */
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!draft) return [];
    const result = difficultyById.get(draft.id);
    if (!result) return [];
    const index = drafts.findIndex((entry) => entry.id === draft.id);
    const prevScore = index > 0 ? difficultyById.get(drafts[index - 1].id)?.score ?? null : null;
    return adviseLevel({ result, analysis, prevScore });
  }, [draft, drafts, difficultyById, analysis]);

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
        // Zen levels always import at full accuracy — every pixel already
        // matches the CLOSEST of the 24 sand colours (`nearestSandColor`,
        // `imageToRows`'s own comment); `importMaxColors` merely throws some
        // of that accuracy away afterward to keep a level's own palette
        // small, which a Zen level (no difficulty/readability budget to
        // respect — it is not part of the main roster) has no reason to do.
        // On request: "tool sẽ ráng lấy màu chính xác nhất từ ảnh".
        const maxColors = current.mode === "zen" ? SAND_COLORS.length : importMaxColors;
        const { rows, palette } = imageToRows(img, current.width, current.height, trimWhite, maxColors);
        // Only a Zen draft keeps `palette` — see `SandLevelConfig.customPalette`'s
        // own comment: it renders the level with this picture's own colours
        // instead of the shared candy hex, which is what "100% chính xác"
        // (full colour accuracy) means once a finite, shootable palette of
        // buckets is still required. The main 50-level roster keeps the
        // shared candy palette on purpose (consistent look across levels).
        return syncQueueToPicture({ ...current, rows, customPalette: current.mode === "zen" ? palette : undefined });
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
            {orderedDrafts.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={entry.id === draft.id ? "is-active" : ""}
                  onClick={() => {
                    setPickedId(entry.id);
                    setAnalysis(null);
                    history.current = { past: [], future: [] };
                    lastBrushPoint.current = null;
                  }}
                >
                  <strong>{entry.mode === "zen" ? "🧘 " : ""}{entry.name || "Untitled"}</strong>
                  <small>{entry.width}×{entry.height} · {entry.mode === "zen" ? "unlimited shots" : `${entry.shotLimit} shots`}</small>
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
                lastBrushPoint.current = null;
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
                  mode: draft.mode,
                };
                persist([...drafts, duplicated]);
                setPickedId(duplicated.id);
                history.current = { past: [], future: [] };
                lastBrushPoint.current = null;
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
                lastBrushPoint.current = null;
              }}
            >
              Delete
            </button>
          </div>

          {/* Pulls one of the hand-authored built-in levels in as a fresh,
              editable draft (via `levelToDraft`) — a copy, not a live link:
              shipping it writes a new level, it does not overwrite the
              original hand-authored const in sand-levels.ts. Reconciling the
              two (deleting the old hand-authored entry, renumbering the
              shipped one back to the same id) is a manual follow-up in that
              file, the same as any other hand-edit there.

              `level.id >= 4` on purpose, not a fixed upper bound: levels 1-3
              are the hand-tuned FTUE arc and stay off this list, but every
              level from 4 onward — the beatchart run (4-30) and whatever
              gets hand-authored past it — should always be editable here
              without this filter needing to be revisited. */}
          <div className="editor-row">
            <select
              className="editor-import-select"
              aria-label="Built-in level to import"
              value={importLevelId ?? ""}
              onChange={(event) => setImportLevelId(Number(event.target.value))}
            >
              {BUILT_IN_LEVELS.filter((level) => level.id >= 4).map((level) => (
                <option key={level.id} value={level.id}>{level.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="editor-button"
              disabled={importLevelId === null}
              onClick={() => {
                const source = BUILT_IN_LEVELS.find((level) => level.id === importLevelId);
                if (!source) return;
                const imported = levelToDraft(source);
                persist([...drafts, imported]);
                setPickedId(imported.id);
                history.current = { past: [], future: [] };
                lastBrushPoint.current = null;
              }}
            >
              Import built-in
            </button>
          </div>

          {/* ---- difficulty overview ---- */}
          <h2>Difficulty overview</h2>
          <p className="editor-note">
            A quick read on every level&apos;s shape — board size, colour count, how mixed those
            colours are, and how tight the shot budget and radius are against all of it. Not the
            solver: that lives below as &quot;Measure difficulty&quot; and only runs one level at a time.
          </p>
          {drafts.length > 1 && (
            <svg
              className="editor-difficulty-chart"
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Difficulty score across every level, in list order"
            >
              {[25, 50, 75].map((tier) => (
                <line
                  key={tier}
                  x1={0}
                  x2={CHART_WIDTH}
                  y1={CHART_PAD + (1 - tier / 100) * (CHART_HEIGHT - CHART_PAD * 2)}
                  y2={CHART_PAD + (1 - tier / 100) * (CHART_HEIGHT - CHART_PAD * 2)}
                  stroke="rgba(255,255,255,.1)"
                  strokeWidth={1}
                />
              ))}
              <polyline
                points={difficultyChartPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="rgba(255,255,255,.35)"
                strokeWidth={1.5}
              />
              {difficultyChartPoints.map((point) => {
                const active = point.id === draft?.id;
                return (
                  <circle
                    key={point.id}
                    cx={point.x}
                    cy={point.y}
                    r={active ? 3.4 : 2}
                    fill={hex(DIFFICULTY_HEX[point.label])}
                    stroke={active ? "#fff" : "none"}
                    strokeWidth={active ? 1 : 0}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setPickedId(point.id);
                      setAnalysis(null);
                      history.current = { past: [], future: [] };
                      lastBrushPoint.current = null;
                    }}
                  >
                    <title>{`${point.name}: ${point.score} (${DIFFICULTY_NAME[point.label]})`}</title>
                  </circle>
                );
              })}
            </svg>
          )}
          <ol className="editor-difficulty-list">
            {orderedDrafts.map((entry) => {
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
                      lastBrushPoint.current = null;
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
            {/* Zen levels swap the 24-swatch grid for a free colour picker —
                on request ("không còn bảng màu nữa mà color picker rồi tô").
                Painting still only ever writes one of the 24 `SandColor`
                letters (the picture has to stay a small, discrete alphabet
                for the wheel/matching rules to work at all — see
                `nearestSandColor`'s own comment), so whatever the picker
                returns snaps to the closest one of those the instant it is
                picked, same algorithm image import already uses. The swatch
                preview next to the picker shows that SNAPPED colour, not the
                raw picker value, so what is about to be painted is never a
                surprise. */}
            {draft.mode === "zen" ? (
              <div className="editor-swatches editor-zen-picker">
                <input
                  type="color"
                  className="editor-zen-color-input"
                  value={hex(color)}
                  onChange={(event) => {
                    const hexValue = event.target.value;
                    const r = parseInt(hexValue.slice(1, 3), 16);
                    const g = parseInt(hexValue.slice(3, 5), 16);
                    const b = parseInt(hexValue.slice(5, 7), 16);
                    setColor(nearestSandColor(r, g, b));
                    setWallMode(false);
                    setErasing(false);
                  }}
                  title="Pick any colour — it snaps to the closest of the game's 24 sand colours"
                />
                <span
                  className={`editor-swatch is-active editor-zen-picker-preview${erasing || wallMode ? " is-dim" : ""}`}
                  style={{ "--swatch": hex(color) } as React.CSSProperties}
                  aria-label={COLOR_NAME[color]}
                  title={`Painting: ${COLOR_NAME[color]}`}
                />
              </div>
            ) : (
              <div className="editor-swatches">
                {SORTED_SWATCH_COLORS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className={`editor-swatch${entry === color && !erasing && !wallMode ? " is-active" : ""}`}
                    style={{ "--swatch": hex(entry) } as React.CSSProperties}
                    onClick={() => {
                      setColor(entry);
                      setWallMode(false);
                      setErasing(false);
                    }}
                    aria-label={COLOR_NAME[entry]}
                    title={COLOR_NAME[entry]}
                  />
                ))}
              </div>
            )}
            <div className="editor-row">
              {(["brush", "bucket", "key", "freeze"] as Tool[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={`editor-button${tool === entry ? " is-active" : ""}`}
                  onClick={() => setTool(entry)}
                  title={
                    entry === "key" ? "Paint the key that opens locked sand"
                    : entry === "freeze" ? "Paint a Freeze trigger: shot by any colour, pauses the whole board's gravity for a set number of shots"
                    : undefined
                  }
                >
                  {entry === "brush" ? "Brush" : entry === "bucket" ? "Fill" : entry === "key" ? "Key" : "❄️ Freeze"}
                </button>
              ))}
              {/* A modifier on the brush rather than a tool of its own: a lock
                  is a state of a colour, so it has to be painted with one. */}
              <button
                type="button"
                className={`editor-button${locking ? " is-active" : ""}`}
                onClick={() => {
                  setLocking((value) => !value);
                  setWallMode(false);
                  setErasing(false);
                  if (tool === "key") setTool("brush");
                }}
                title="Paint this colour frozen: it hangs in the frame and cannot be shot until a key reaches it"
              >
                🔒 Locked
              </button>
              {/* Also a modifier, not a tool: Wall Obstacle is a material, not
                  a colour, so it slots in beside "Locked" rather than beside
                  Brush/Fill/Key — mutually exclusive with locking a colour
                  down, since a cell cannot be both. */}
              <button
                type="button"
                className={`editor-button${wallMode ? " is-active" : ""}`}
                onClick={() => {
                  setWallMode((value) => !value);
                  setLocking(false);
                  setErasing(false);
                  if (tool === "key") setTool("brush");
                }}
                title="Paint a Wall Obstacle: a permanent, colourless cell no shot can ever reach or remove"
              >
                🧱 Wall
              </button>
              {/* Also a modifier, not a tool of its own — this is what lets it
                  combine with Fill: Erase alone rubs out a brush-sized patch,
                  Erase+Fill clears a whole connected region in one click. */}
              <button
                type="button"
                className={`editor-button${erasing ? " is-active" : ""}`}
                onClick={() => {
                  setErasing((value) => !value);
                  setLocking(false);
                  setWallMode(false);
                  if (tool === "key") setTool("brush");
                }}
                title="Erase instead of paint — combine with Fill to clear a whole connected region at once"
              >
                🧽 Erase
              </button>
              {/* Each tool's size dial, shown only while that tool is up — a
                  dial for a tool nobody is holding is a control with nothing
                  to do. */}
              {tool === "brush" && (
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
              {tool === "freeze" && (
                <span className="editor-key-size">
                  <button
                    type="button"
                    className="editor-mini"
                    onClick={() => setFreezeScale((value) => Math.max(1, value - 1))}
                    disabled={freezeScale <= 1}
                    aria-label="Smaller freeze trigger"
                  >
                    −
                  </button>
                  <b title={`ratio ×${Math.min(freezeScale, freezeScaleLimit)} of the ${spriteWidth(FREEZE_SPRITE)}×${spriteHeight(FREEZE_SPRITE)} freeze sprite`}>
                    freeze {spriteWidth(FREEZE_SPRITE) * Math.min(freezeScale, freezeScaleLimit)}×
                    {spriteHeight(FREEZE_SPRITE) * Math.min(freezeScale, freezeScaleLimit)}px
                    {" "}·{" "}×{Math.min(freezeScale, freezeScaleLimit)}
                  </b>
                  <button
                    type="button"
                    className="editor-mini"
                    onClick={() => setFreezeScale((value) => Math.min(freezeScaleLimit, value + 1))}
                    disabled={freezeScale >= freezeScaleLimit}
                    aria-label="Bigger freeze trigger"
                    title={freezeScale >= freezeScaleLimit ? "A bigger trigger would not fit this frame" : undefined}
                  >
                    +
                  </button>
                  {/* On request ("freeze bị che sau lớp cát"): while on, a
                      click stamps/clears `draft.hiddenFreezeRows` instead of
                      the ordinary, in-the-open trigger grid — see
                      `freezeHidden`'s own state comment. The hatch overlay
                      the canvas draws for it (author-only — invisible in the
                      real game) is the one place this placement is visible
                      at all once painted, so the label says so up front. */}
                  <label className="editor-freeze-hidden" title="Buries the trigger behind whatever sand is already there — invisible and inert until every one of its cells is uncovered">
                    <input
                      type="checkbox"
                      checked={freezeHidden}
                      onChange={(event) => setFreezeHidden(event.target.checked)}
                    />
                    Hidden (under sand)
                  </label>
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
              {/* Ignored for a Zen draft — see `importImageFile`'s own
                  comment — so shown as a plain note there instead of a
                  control that would quietly do nothing. */}
              {draft.mode === "zen" ? (
                <span className="editor-import-max-colors" title="Zen levels always import at full accuracy — every pixel matches the closest of all 24 sand colours, nothing gets merged down.">
                  🧘 Full colour accuracy
                </span>
              ) : (
                <label
                  className="editor-import-max-colors"
                  title="Caps how many distinct colours the imported picture uses. The most-used colours in the image survive; every other pixel is reassigned to whichever surviving colour is closest to it."
                >
                  <span>Max colours</span>
                  <input
                    type="number"
                    min={1}
                    max={SAND_COLORS.length}
                    value={importMaxColors}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isFinite(value)) return;
                      setImportMaxColors(Math.min(SAND_COLORS.length, Math.max(1, Math.round(value))));
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="editor-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="editor-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerLeave={() => { endStroke(); onPointerLeaveCanvas(); }}
              onPointerCancel={() => { endStroke(); onPointerLeaveCanvas(); }}
            />
            {/* The brush-preview outline — a separate canvas laid exactly over
                the real one (see `.editor-canvas-overlay`), so a mouse move
                only ever has to repaint this small, cheap layer instead of the
                whole board underneath it. `pointer-events: none` so it never
                steals the drag/click events the real canvas needs. */}
            <canvas ref={overlayCanvasRef} className="editor-canvas-overlay" />
          </div>

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

          <label className="editor-check editor-zen-check" title="Zen levels always play with unlimited shots and unlimited booster charges — the Shots field below (and any forced booster charges this draft carries) is ignored the moment this is checked. They show up on their own separate 'Zen Mode' list in-game, never mixed with the main level roster.">
            <input
              type="checkbox"
              checked={draft.mode === "zen"}
              onChange={(event) => update((current) => ({ ...current, mode: event.target.checked ? "zen" : undefined }))}
            />
            <span>🧘 Zen Mode level (unlimited shots &amp; boosters, own separate list)</span>
          </label>

          <div className="editor-field-row">
            <label className="editor-field">
              <span>Width</span>
              <input
                type="number"
                min={MIN_DIMENSION}
                max={MAX_WIDTH}
                value={widthText}
                onChange={(event) => setWidthText(event.target.value)}
                onBlur={commitWidth}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
            <label className="editor-field">
              <span>Height</span>
              <input
                type="number"
                min={MIN_DIMENSION}
                max={MAX_HEIGHT}
                value={heightText}
                onChange={(event) => setHeightText(event.target.value)}
                onBlur={commitHeight}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
          </div>

          <h2>Key friction</h2>
          <p className="editor-note">
            How much a key resists rolling sideways down a slope. Low friction rolls the instant
            a slope offers it; high friction waits, so it reads as heavier. It never slows a
            straight drop, only a sideways one.
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

          <h2>Freeze duration</h2>
          <p className="editor-note">
            How many shots the whole board&apos;s gravity pauses for once a Freeze trigger is hit —
            the shot that hits it is itself the first frozen one. Only matters if the picture has a
            Freeze trigger ({FREEZE_LETTER}) painted; left at 0 it falls back to{" "}
            {DEFAULT_FREEZE_DURATION} shots the moment a trigger exists.
          </p>
          <label className="editor-field">
            <span>Shots frozen {(draft.freezeDuration ?? 0) || `(default ${DEFAULT_FREEZE_DURATION})`}</span>
            <input
              type="number"
              min={0}
              max={20}
              value={draft.freezeDuration ?? 0}
              onChange={(event) => update((current) => ({
                ...current,
                freezeDuration: Math.max(0, Math.round(Number(event.target.value) || 0)),
              }))}
            />
          </label>

          <h2>Ammo wheel</h2>
          <p className="editor-note">
            Only colours you have painted can be loaded, and every painted colour has to be here —
            otherwise that sand could never be shot at. Frozen sand counts: it needs a bullet the
            moment a key frees it.
            {fixtures.locked > 0 && ` This picture has ${fixtures.locked} frozen cells and ${fixtures.keys} key cells.`}
            {fixtures.freeze > 0 && ` This picture has ${fixtures.freeze} Freeze trigger cells.`}
            {fixtures.hiddenFreeze > 0
              && ` This picture also has ${fixtures.hiddenFreeze} Freeze trigger cells hidden under sand — invisible in-game until every one of them is uncovered.`}
            {fixtures.hiddenKey > 0
              && ` This picture also has ${fixtures.hiddenKey} key cells hidden under sand — no editor tool paints these yet (hand-author \`hiddenKeyRows\` on the level), but they peek through cell by cell as the sand above them clears, then fall and open locks normally once every one of them is uncovered.`}
          </p>
          <ol className="editor-queue">
            {draft.ammoQueue.map((entry, position) => (
              <li key={`${entry}-${position}`}>
                <button
                  type="button"
                  className="editor-queue-swatch"
                  onClick={() => {
                    setHighlightColor((current) => (current === entry ? null : entry));
                    canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  title={`Highlight every ${COLOR_NAME[entry]} cell in the picture above`}
                >
                  <i className="editor-pip" style={{ "--swatch": hex(entry) } as React.CSSProperties} />
                  <span>{COLOR_NAME[entry]}</span>
                </button>
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
              <span>Shots{draft.mode === "zen" ? " (ignored — Zen is unlimited)" : ""}</span>
              <input
                type="number"
                min={1}
                disabled={draft.mode === "zen"}
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

          {/* ---- suggestions ---- */}
          <h2>Suggestions</h2>
          <p className="editor-note">
            Every line here traces back to one measured number crossing one named threshold — the
            breakdown above, the solver&apos;s verdict once you&apos;ve measured it, and how this
            level&apos;s score compares to the one before it in the chart above.
          </p>
          {suggestions.length === 0 ? (
            <p className="editor-ok">No changes suggested for this level right now.</p>
          ) : (
            <ul className="editor-suggestions">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id} className={`is-${suggestion.severity}`}>
                  <span>{suggestion.text}</span>
                  {suggestion.apply && (
                    <button
                      type="button"
                      className="editor-mini"
                      onClick={() => update(suggestion.apply!)}
                    >
                      {suggestion.applyLabel ?? "Apply"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* ---- ship it ---- */}
          <h2>Use this level</h2>
          <div className="editor-row">
            {draft.mode === "zen" ? (
              // The `?level=` deep link below only searches the MAIN list
              // (`readBoot`/`collectPlayables`, SandGame.tsx) — a Zen draft
              // is never in it, so that link would silently land on a
              // different level instead of this one. Rather than a
              // misleading link, this just points at where the level
              // actually shows up: save here, then find it in-game.
              <>
                <p className="editor-note">
                  🧘 Saved automatically. Play it in-game: Modes → Zen Mode.
                </p>
                <button
                  type="button"
                  className="editor-button is-primary"
                  disabled={shippingZen}
                  title={"Writes every Zen-mode level in the list on the left into design/levels/zen-custom-levels.ts — its own file, on request (\"level editor cho Zen Mode, nó nên lưu vào 1 file ts riêng\"), never sand-levels.ts. Replaces that file's own shipped block wholesale with exactly the editor's current Zen list, so a Zen level deleted here disappears from it on the next ship."}
                  onClick={async () => {
                    setShippingZen(true);
                    // Same "skip broken drafts rather than block the rest"
                    // rule `shipping` (below) uses for the main list, scoped
                    // to just the Zen ones — this button never touches a
                    // non-Zen draft.
                    const shippableZen = drafts.filter((entry) =>
                      entry.mode === "zen" && !validateDraft(entry).some((issue) => issue.severity === "error"));
                    try {
                      const response = await fetch("http://localhost:4787/ship-zen-levels", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ drafts: shippableZen }),
                      });
                      const payload = await response.json().catch(() => null);
                      if (!response.ok) {
                        throw new Error(payload?.error || "The level writer could not write the file.");
                      }
                      const skipped = drafts.filter((entry) => entry.mode === "zen").length - shippableZen.length;
                      flash(`Shipped ${payload.count} Zen level${payload.count === 1 ? "" : "s"} to zen-custom-levels.ts`
                        + (skipped ? ` (${skipped} skipped for errors)` : ""));
                    } catch {
                      flash("Couldn't reach the level writer — run `npm run level-writer` in a terminal, then try again.");
                    }
                    setShippingZen(false);
                  }}
                >
                  {shippingZen ? "Writing…" : "Ship all Zen levels to zen-custom-levels.ts"}
                </button>
              </>
            ) : errors.length ? (
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
            {draft.importedFromId !== undefined && (
              <button
                type="button"
                className="editor-button is-primary"
                disabled={updatingBuiltIn || errors.length > 0}
                title={`Writes this level back into its own "export const" in sand-levels.ts (id ${draft.importedFromId}) — the same block "Import built-in" copied it from — instead of shipping it as a new level. If that level's picture is its own separate const (every hand-authored level's is), this deletes that const too, since nothing would reference it any more.`}
                onClick={async () => {
                  const id = draft.importedFromId;
                  if (id === undefined) return;
                  setUpdatingBuiltIn(true);
                  try {
                    const response = await fetch("http://localhost:4787/update-level", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id, draft }),
                    });
                    const payload = await response.json().catch(() => null);
                    if (!response.ok) {
                      throw new Error(payload?.error || "The level writer could not write the file.");
                    }
                    flash(`Updated ${payload.constName} (id ${id}) in sand-levels.ts`
                      + (payload.orphanRemoved ? ` — removed the now-unused ${payload.pictureConstName}` : ""));
                  } catch {
                    flash("Couldn't reach the level writer — run `npm run level-writer` in a terminal, then try again.");
                  }
                  setUpdatingBuiltIn(false);
                }}
              >
                {updatingBuiltIn ? "Writing…" : `Update Level ${draft.importedFromId} in sand-levels.ts`}
              </button>
            )}
            <button
              type="button"
              className="editor-button is-primary"
              disabled={shipping}
              title="Writes every non-Zen level in the list on the left into sand-levels.ts. A level you brought in with Import built-in updates its own existing const, wherever it lives — everything else (genuinely new levels only) replaces what was there before in the editor-shipped block, so a level you delete here disappears from the file on the next ship."
              onClick={async () => {
                setShipping(true);
                // Every non-Zen draft ships — the level writer itself is what
                // keeps this from piling up duplicates: a draft imported from
                // an existing level (`importedFromId` set) updates that
                // level's own const in place, at its own id, rather than
                // being handed a new one. Only what is left over (genuinely
                // new levels) replaces the editor-shipped block wholesale.
                // Broken drafts are left out rather than blocking the rest.
                // A Zen draft (`mode: "zen"`) never belongs in this file at
                // all — on request ("level editor cho Zen Mode, nó nên lưu
                // vào 1 file ts riêng"), it ships separately, via "Ship all
                // Zen levels to zen-custom-levels.ts" above instead.
                const shippable = drafts.filter((entry) =>
                  entry.mode !== "zen" && !validateDraft(entry).some((issue) => issue.severity === "error"));
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
                  // Zen drafts are excluded above on purpose, not "skipped
                  // for errors" — only an actually-invalid non-Zen draft
                  // counts toward this message.
                  const skipped = drafts.filter((entry) => entry.mode !== "zen").length - shippable.length;
                  flash(`Shipped ${payload.count} level${payload.count === 1 ? "" : "s"} — `
                    + `${payload.created} new, ${payload.updatedInPlace} updated in place`
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
                  () => flash("Copied — paste it into design/levels/sand-levels.ts"),
                  () => flash("Copy it from the box below"),
                );
              }}
            >
              Copy TypeScript
            </button>
          </div>
          <p className="editor-note">
            Saved levels already show up in the game&apos;s level switcher (or, for a Zen-mode level, in
            Modes → Zen Mode), and stay in this editor, because they live in your browser. Every level
            has exactly one id: shipping a level you brought in with &quot;Import built-in&quot; updates
            that same id&apos;s own const, in place, wherever it lives — never a second, unrelated one on
            top of it. Only what is left over, genuinely new levels, replaces the file&apos;s
            editor-shipped block wholesale, so that block always has exactly the new levels the editor
            has, not every level ever shipped. A single level&apos;s own &quot;Update Level N in
            sand-levels.ts&quot; button does the same update-by-id for just that one, without touching
            the rest of the list. A Zen-mode level never ships into sand-levels.ts at all — its own
            &quot;Ship all Zen levels&quot; button writes to <code>design/levels/zen-custom-levels.ts</code>{" "}
            instead, its own file, so a Zen level never mixes into the main list. All of this needs{" "}
            <code>npm run level-writer</code> running once in a terminal alongside the dev server; then
            nothing needs copy-paste and everything survives clearing your browser or a fresh checkout.
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
