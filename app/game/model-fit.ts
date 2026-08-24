type GridPosition = Readonly<{ x: number; y: number; z: number }>;

// Just above the full 3D diagonal of the existing 4x3x2 Prism (5.326). Using
// the diagonal, rather than only its longest axis, keeps a large experiment in
// frame even after the player turns any axis towards the camera.
export const MODEL_PLAY_MAX_DIAMETER = 5.4;

function occupiedAxisSpan(
  blocks: readonly GridPosition[],
  axis: keyof GridPosition,
  blockSize: number,
  blockSpacing: number,
) {
  const coordinates = blocks.map((block) => block[axis]);
  return (Math.max(...coordinates) - Math.min(...coordinates)) * blockSpacing + blockSize;
}

export function computeModelPlayScale(
  blocks: readonly GridPosition[],
  blockSize: number,
  blockSpacing: number,
) {
  if (!blocks.length) return 1;
  const rotationDiameter = Math.hypot(
    occupiedAxisSpan(blocks, "x", blockSize, blockSpacing),
    occupiedAxisSpan(blocks, "y", blockSize, blockSpacing),
    occupiedAxisSpan(blocks, "z", blockSize, blockSpacing),
  );
  return Math.min(1, MODEL_PLAY_MAX_DIAMETER / rotationDiameter);
}
