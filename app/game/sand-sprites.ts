// The two things on the board that are pictures rather than sand.
//
// Both live here, because both are drawn twice: the engine paints them onto the
// real pixel board, and the editor paints them onto its preview canvas. A key
// that was a different shape in the tool than in the game would be a key the
// author could not actually place.

/** Rows top-first. `#` is a filled cell, anything else is a hole. */
export type PixelSprite = readonly string[];

/**
 * The key.
 *
 * A plain filled disc — solid all the way through, no notch or tooth for a
 * blown-up pixel to turn into a stray hole. Every filled cell is 4-connected
 * to the rest, which matters — `parseSandLevel` groups key cells by
 * connectivity, so a shape with a detached pixel would silently become two
 * keys.
 */
export const KEY_SPRITE: PixelSprite = [
  "..###..",
  ".#####.",
  "#######",
  "#######",
  "#######",
  ".#####.",
  "..###..",
];

/**
 * The padlock drawn over frozen sand.
 *
 * Never authored, never part of the grid — this is a label the renderer puts on
 * a locked region so the player can name what they are looking at without a
 * legend.
 */
export const PADLOCK_SPRITE: PixelSprite = [
  ".###.",
  ".#.#.",
  "#####",
  "##.##",
  "#####",
];

export function spriteWidth(sprite: PixelSprite) {
  return sprite.reduce((widest, row) => Math.max(widest, row.length), 0);
}

export function spriteHeight(sprite: PixelSprite) {
  return sprite.length;
}

/**
 * A sprite as cell offsets, blown up `scale` times in both axes.
 *
 * Offsets are (0,0)-based with **y counting up from the bottom**, the way the
 * grid does — the sprite is written top-first because that is how a person
 * draws one, and the flip happens here rather than at every call site.
 */
export function spriteCells(sprite: PixelSprite, scale: number) {
  const step = Math.max(1, Math.round(scale));
  const height = spriteHeight(sprite);
  const cells: Array<{ x: number; y: number }> = [];
  sprite.forEach((row, rowIndex) => {
    [...row].forEach((mark, column) => {
      if (mark !== "#") return;
      const baseY = (height - 1 - rowIndex) * step;
      const baseX = column * step;
      for (let dy = 0; dy < step; dy += 1) {
        for (let dx = 0; dx < step; dx += 1) cells.push({ x: baseX + dx, y: baseY + dy });
      }
    });
  });
  return cells;
}
