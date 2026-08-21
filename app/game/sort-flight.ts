// Geometry for the little cubes that fly from a destroyed cluster into a goal
// card or batch slot. The flight layer covers the whole game frame and clips to
// it, so a sprite is only visible while its centre stays inside the frame.
//
// The arc apex used to be "a fixed lift above the higher end of the flight".
// Goal cards sit near the top edge of the frame, so that apex landed above
// y = 0 and the cube flew out through the top of the screen, vanished, then
// dropped back in. Every point is now kept inside the frame, and the apex only
// rises as far as there is room for.
export type FlightPoint = { x: number; y: number };
export type FlightBounds = { width: number; height: number };
export type SortFlightPath = { source: FlightPoint; middle: FlightPoint; target: FlightPoint };

// Half a sprite is 7px, so this leaves a little air between the cube and the
// frame edge, and clears the frame's rounded corners near the goal cards.
export const FLIGHT_EDGE_MARGIN = 14;
const ARC_LIFT = 48;
const ARC_LIFT_STEP = 5;
const ARC_SIDE_SHIFT = 18;

function clamp(value: number, min: number, max: number) {
  // `max` is guarded because a frame narrower than two margins would otherwise
  // invert the range and push every sprite to the same edge.
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export type BatchFlightPlan = {
  index: number;
  path: SortFlightPath;
  delayMs: number;
};

// One cube per unit leaving the batch, fanned slightly so a stack of three does
// not travel as a single blob, and staggered so they read as a count.
export function planBatchFlight(
  from: FlightPoint,
  to: FlightPoint,
  count: number,
  staggerMs: number,
  bounds: FlightBounds,
): BatchFlightPlan[] {
  const plans: BatchFlightPlan[] = [];
  for (let index = 0; index < count; index += 1) {
    plans.push({
      index,
      delayMs: index * staggerMs,
      path: planSortFlight(
        { x: from.x + ((index % 3) - 1) * 4, y: from.y },
        { x: to.x + ((index % 3) - 1) * 3, y: to.y + ((index % 2) - 0.5) * 3 },
        index,
        bounds,
      ),
    });
  }
  return plans;
}

export function planSortFlight(
  source: FlightPoint,
  target: FlightPoint,
  order: number,
  bounds: FlightBounds,
): SortFlightPath {
  const insideX = (value: number) => clamp(value, FLIGHT_EDGE_MARGIN, bounds.width - FLIGHT_EDGE_MARGIN);
  const insideY = (value: number) => clamp(value, FLIGHT_EDGE_MARGIN, bounds.height - FLIGHT_EDGE_MARGIN);

  // A projected block can land outside the frame (edge of the scene, or a block
  // already flying away), so the start is clamped too instead of popping in.
  const start = { x: insideX(source.x), y: insideY(source.y) };
  const end = { x: insideX(target.x), y: insideY(target.y) };
  const lift = ARC_LIFT + (order % 3) * ARC_LIFT_STEP;
  const sideShift = order % 2 === 0 ? -ARC_SIDE_SHIFT : ARC_SIDE_SHIFT;

  return {
    source: start,
    middle: {
      x: insideX((start.x + end.x) * 0.5 + sideShift),
      y: insideY(Math.min(start.y, end.y) - lift),
    },
    target: end,
  };
}
