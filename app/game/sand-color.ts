// The one texture trick the sand renderer uses, and the only place it lives.
//
// Both the game canvas (SandCannonEngine) and the editor's preview canvas draw
// the same jittered grain colour, so this has no dependency on three.js or on
// either renderer — plain hex in, plain RGB bytes out. A colour computed here
// once and reused everywhere is what keeps "what a level looks like in the
// editor" from drifting away from "what it looks like in the game".

/**
 * How far a pixel's colour is nudged from its cell's base colour when it is
 * spawned. Presentation only — it never reaches the grid.
 *
 * Ported from a reference falling-sand renderer (UniSand, MIT), which nudges
 * every grain by up to ±0.1. Turned down well below that reference value:
 * with ten palette colours now instead of six, a couple of them sit close
 * enough in hue (e.g. red and pink) that a wide swing could drift one
 * colour's grains into the other's saturation/lightness band and blur the
 * two together — and player feedback was that even the first cut of this
 * (±0.06/±0.05) still read as too noisy at a glance. A smaller nudge still
 * reads as poured grains rather than a flat swatch, without eating into the
 * room between neighbouring colours.
 *
 * The one pair of numbers both renderers draw from — the game canvas and the
 * editor's preview — so a level looks the same texture in both places.
 */
export const SAND_SATURATION_JITTER = 0.03;
export const SAND_LIGHTNESS_JITTER = 0.025;

/** Deterministic pseudo-random unit value from a seed — no `Math.random`. */
export function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function rgbToHsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / delta + 2) / 6;
  else h = ((r - g) / delta + 4) / 6;
  return { h, s, l };
}

function hueToRgb(p: number, q: number, t: number) {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number) {
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hueToRgb(p, q, h + 1 / 3),
    g: hueToRgb(p, q, h),
    b: hueToRgb(p, q, h - 1 / 3),
  };
}

/**
 * Nudges a colour's saturation and lightness by up to `range`, hue untouched.
 *
 * Ported from a reference falling-sand renderer (UniSand, MIT): every grain
 * gets a one-time random nudge to its saturation and lightness, fixed at
 * spawn rather than animated. That is what turns a field of one flat colour
 * into something that reads as poured grains instead of a painted swatch —
 * real sand looks textured because countless grains catch the light very
 * slightly differently, not because any one grain is shaded. Hue is never
 * touched: a jitter big enough to see would start reading as a different
 * gameplay colour, which a coincidence of tint must never be able to fake.
 *
 * Returns 0–255 integer channels, ready for a canvas `fillStyle` or an
 * `ImageData` write — the two places this is ever drawn.
 */
export function jitterColor(hex: number, seed: number, saturationRange: number, lightnessRange: number) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  if (saturationRange <= 0 && lightnessRange <= 0) {
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)] as const;
  }
  const hsl = rgbToHsl(r, g, b);
  const s = clamp01(hsl.s + (seededUnit(seed) - 0.5) * 2 * saturationRange);
  const l = clamp01(hsl.l + (seededUnit(seed + 3) - 0.5) * 2 * lightnessRange);
  const jittered = hslToRgb(hsl.h, s, l);
  return [
    Math.round(jittered.r * 255),
    Math.round(jittered.g * 255),
    Math.round(jittered.b * 255),
  ] as const;
}

/** `jitterColor`, as a canvas-ready `#rrggbb` string. */
export function jitterColorHex(hex: number, seed: number, saturationRange: number, lightnessRange: number) {
  const [r, g, b] = jitterColor(hex, seed, saturationRange, lightnessRange);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** Wall Obstacle's flat base tone — jet black with just enough lift that
 * `wallBevelRgb`'s highlight/shadow have room to move away from it in both
 * directions; pure #000 would leave the shadow side with nowhere to go. */
const WALL_BASE_RGB: readonly [number, number, number] = [30, 30, 34];
/** How far a beveled edge pixel moves from `WALL_BASE_RGB`, toward light on
 * a highlighted side and toward black on a shadowed one. Symmetric on
 * purpose: a corner that is both a highlighted side and a shadowed side
 * (e.g. an outward corner with light on one face, shade on the other) should
 * land back near the flat base rather than reading as one or the other. */
const WALL_EDGE_DELTA = 34;

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Wall Obstacle's colour: flat matte black, embossed at its own outline.
 *
 * A pixel on the shape's top or left edge (no wall neighbour on that side)
 * lightens toward a highlight; one on its bottom or right edge darkens
 * toward black — the cheapest way to sell "this is one solid raised block"
 * without an actual repeating texture, as if lit from the upper-left the way
 * a bevel/emboss filter would light it. A pixel with a wall on all four
 * sides (the interior of a large wall shape) gets none of this and stays
 * flat, same as a single-pixel wall gets it on all four.
 *
 * `hasUp`/`hasDown`/`hasLeft`/`hasRight` mean "this cell's screen-space
 * neighbour on that side is also a wall cell" — deliberately booleans, not
 * coordinates, so both renderers can answer that from their own data (the
 * engine's live wall set, the editor's own `rows`) without this function
 * caring how. "Screen-space" matters here: the engine's grid y runs opposite
 * to screen rows, so its caller is the one that has to flip `hasUp`/
 * `hasDown` to match — this function only ever reasons about what is
 * visually above/below/left/right.
 */
export function wallBevelRgb(
  hasUp: boolean,
  hasDown: boolean,
  hasLeft: boolean,
  hasRight: boolean,
): readonly [number, number, number] {
  let delta = 0;
  if (!hasUp) delta += WALL_EDGE_DELTA;
  if (!hasLeft) delta += WALL_EDGE_DELTA;
  if (!hasDown) delta -= WALL_EDGE_DELTA;
  if (!hasRight) delta -= WALL_EDGE_DELTA;
  return [
    clampByte(WALL_BASE_RGB[0] + delta),
    clampByte(WALL_BASE_RGB[1] + delta),
    clampByte(WALL_BASE_RGB[2] + delta),
  ];
}

/** `wallBevelRgb`, as a canvas-ready `#rrggbb` string. */
export function wallBevelHex(hasUp: boolean, hasDown: boolean, hasLeft: boolean, hasRight: boolean) {
  const [r, g, b] = wallBevelRgb(hasUp, hasDown, hasLeft, hasRight);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** The key's flat gold base tone, same value `KEY_RGB` used to be the whole
 * drawing on its own. */
const KEY_BASE_RGB: readonly [number, number, number] = [255, 214, 84];
/** Wider than `WALL_EDGE_DELTA`: a coin's polish reads as shinier the more
 * its highlight and shadow sides actually contrast, unlike stone's much
 * subtler catch of the light. */
const KEY_EDGE_DELTA = 46;

/**
 * The key's colour: flat gold, embossed at its own outline into a coin —
 * same "highlight the missing-neighbour sides, shadow the others" bevel as
 * `wallBevelRgb`, just gold instead of black. Because gold's red channel is
 * already maxed at 255, a highlighted edge cannot brighten further on that
 * channel — only green and blue climb toward white, which is exactly what
 * lightening a warm gold toward pale cream looks like; a shadowed edge dims
 * all three toward a duller brass. The single rotating glint pixel
 * (`KEY_GLINT_RGB`, SandCannonEngine.ts) still rides on top of this as an
 * extra sparkle, not instead of it — the coin's whole face is embossed, one
 * point of it also catches a moving highlight as the key rolls.
 */
export function keyBevelRgb(
  hasUp: boolean,
  hasDown: boolean,
  hasLeft: boolean,
  hasRight: boolean,
): readonly [number, number, number] {
  let delta = 0;
  if (!hasUp) delta += KEY_EDGE_DELTA;
  if (!hasLeft) delta += KEY_EDGE_DELTA;
  if (!hasDown) delta -= KEY_EDGE_DELTA;
  if (!hasRight) delta -= KEY_EDGE_DELTA;
  return [
    clampByte(KEY_BASE_RGB[0] + delta),
    clampByte(KEY_BASE_RGB[1] + delta),
    clampByte(KEY_BASE_RGB[2] + delta),
  ];
}

/** `keyBevelRgb`, as a canvas-ready `#rrggbb` string. */
export function keyBevelHex(hasUp: boolean, hasDown: boolean, hasLeft: boolean, hasRight: boolean) {
  const [r, g, b] = keyBevelRgb(hasUp, hasDown, hasLeft, hasRight);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** The Freeze Map trigger's flat base tone — an icy cyan-blue, deliberately
 * far from both Wall Obstacle's near-black and the key's gold (spec: "hình
 * dạng/màu riêng biệt để không nhầm với chìa khoá thật"). */
const FREEZE_BASE_RGB: readonly [number, number, number] = [92, 200, 232];
/** Same magnitude as `KEY_EDGE_DELTA`: a trigger reads as a hard, glassy
 * button, not soft stone. */
const FREEZE_EDGE_DELTA = 46;

/**
 * The Freeze Map trigger's colour: flat icy blue, embossed at its own
 * outline — identical "highlight the missing-neighbour sides, shadow the
 * others" bevel as `wallBevelRgb`/`keyBevelRgb`, just its own base tone. Kept
 * as its own function (rather than parameterising one of the other two) so a
 * future change to any one of the three bevels can never accidentally
 * reshade the other two.
 */
export function freezeBevelRgb(
  hasUp: boolean,
  hasDown: boolean,
  hasLeft: boolean,
  hasRight: boolean,
): readonly [number, number, number] {
  let delta = 0;
  if (!hasUp) delta += FREEZE_EDGE_DELTA;
  if (!hasLeft) delta += FREEZE_EDGE_DELTA;
  if (!hasDown) delta -= FREEZE_EDGE_DELTA;
  if (!hasRight) delta -= FREEZE_EDGE_DELTA;
  return [
    clampByte(FREEZE_BASE_RGB[0] + delta),
    clampByte(FREEZE_BASE_RGB[1] + delta),
    clampByte(FREEZE_BASE_RGB[2] + delta),
  ];
}

/** `freezeBevelRgb`, as a canvas-ready `#rrggbb` string. */
export function freezeBevelHex(hasUp: boolean, hasDown: boolean, hasLeft: boolean, hasRight: boolean) {
  const [r, g, b] = freezeBevelRgb(hasUp, hasDown, hasLeft, hasRight);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Darkens a colour toward black while also boosting its saturation, hue
 * untouched — used by the sort-radius lift highlight (`SandCannonEngine`) so
 * a grain the aim radius currently reaches reads as a richer, more vivid
 * shade of its own colour rather than just a flat tint toward black (which
 * washes the hue out instead of intensifying it).
 *
 * `r`/`g`/`b` are 0-255 bytes in, 0-255 bytes out. `darken` and
 * `saturationBoost` are both 0-1 fractions of the way to "fully darkened" /
 * "fully saturated".
 */
export function darkenAndSaturate(r: number, g: number, b: number, darken: number, saturationBoost: number) {
  const hsl = rgbToHsl(r / 255, g / 255, b / 255);
  const s = clamp01(hsl.s + (1 - hsl.s) * saturationBoost);
  const l = clamp01(hsl.l * (1 - darken));
  const result = hslToRgb(hsl.h, s, l);
  return [
    Math.round(result.r * 255),
    Math.round(result.g * 255),
    Math.round(result.b * 255),
  ] as const;
}
