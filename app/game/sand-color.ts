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
