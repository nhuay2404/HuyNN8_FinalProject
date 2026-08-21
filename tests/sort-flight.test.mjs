import assert from "node:assert/strict";
import test from "node:test";
import { FLIGHT_EDGE_MARGIN, planSortFlight } from "../app/game/sort-flight.ts";

// The real frame at the smallest supported size.
const BOUNDS = { width: 430, height: 680 };

function assertInsideFrame(path, bounds = BOUNDS) {
  for (const [name, point] of Object.entries(path)) {
    assert.ok(
      point.x >= FLIGHT_EDGE_MARGIN && point.x <= bounds.width - FLIGHT_EDGE_MARGIN,
      `${name}.x = ${point.x} is outside the frame`,
    );
    assert.ok(
      point.y >= FLIGHT_EDGE_MARGIN && point.y <= bounds.height - FLIGHT_EDGE_MARGIN,
      `${name}.y = ${point.y} is outside the frame`,
    );
  }
}

test("a flight into a goal card near the top edge stays inside the frame", () => {
  // A goal card centre sits around y = 40: the old arc lifted 48px above the
  // higher end of the flight, which put the apex above the top of the screen.
  const path = planSortFlight({ x: 215, y: 300 }, { x: 96, y: 40 }, 0, BOUNDS);
  assertInsideFrame(path);
  assert.ok(path.middle.y < path.target.y, "the flight should still arc above its target");
});

test("every sprite in a burst stays inside the frame, whatever its order", () => {
  for (let order = 0; order < 12; order += 1) {
    for (const target of [{ x: 96, y: 40 }, { x: 268, y: 40 }, { x: 60, y: 96 }, { x: 300, y: 96 }]) {
      assertInsideFrame(planSortFlight({ x: 215, y: 300 }, target, order, BOUNDS));
    }
  }
});

test("a source projected outside the frame is pulled back to the edge", () => {
  const path = planSortFlight({ x: -240, y: -180 }, { x: 96, y: 40 }, 1, BOUNDS);
  assertInsideFrame(path);
  assert.equal(path.source.x, FLIGHT_EDGE_MARGIN);
  assert.equal(path.source.y, FLIGHT_EDGE_MARGIN);
});

test("a source below the frame is pulled back up to the bottom edge", () => {
  const path = planSortFlight({ x: 900, y: 1200 }, { x: 268, y: 40 }, 2, BOUNDS);
  assertInsideFrame(path);
  assert.equal(path.source.x, BOUNDS.width - FLIGHT_EDGE_MARGIN);
  assert.equal(path.source.y, BOUNDS.height - FLIGHT_EDGE_MARGIN);
});

test("a frame narrower than two margins still produces points inside it", () => {
  const tiny = { width: 20, height: 20 };
  const path = planSortFlight({ x: 5, y: 18 }, { x: 15, y: 2 }, 0, tiny);
  for (const point of Object.values(path)) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(point.x >= 0 && point.x <= tiny.width, `x = ${point.x} escaped a tiny frame`);
    assert.ok(point.y >= 0 && point.y <= tiny.height, `y = ${point.y} escaped a tiny frame`);
  }
});

test("a flight with room above its target still arcs upward", () => {
  const path = planSortFlight({ x: 200, y: 500 }, { x: 200, y: 300 }, 0, BOUNDS);
  assertInsideFrame(path);
  assert.equal(path.middle.y, 300 - 48, "the apex should keep its full lift when there is room");
});

test("handleSort plans every sprite through the clamped flight helper", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/GamePrototype.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const handleSort =");
  const end = source.indexOf("\n    const engine = new CannonSortEngine", start);
  assert.ok(start >= 0 && end > start, "could not isolate handleSort");

  const handleSort = source.slice(start, end);
  assert.match(handleSort, /planSortFlight\(/, "sprites must be planned by the clamped helper");
  assert.match(handleSort, /width: frameRect\.width, height: frameRect\.height/, "the helper needs the frame as its bounds");
  for (const field of ["sourceX: flight.source.x", "sourceY: flight.source.y", "middleX: flight.middle.x", "middleY: flight.middle.y", "targetX: flight.target.x", "targetY: flight.target.y"]) {
    assert.ok(handleSort.includes(field), `sprite field must come from the plan: ${field}`);
  }
  assert.doesNotMatch(handleSort, /Math\.min\(sourceY, targetY\) - 48/, "the unclamped arc apex must be gone");
});
