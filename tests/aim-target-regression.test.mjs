import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);

test("solveAimAtScreenPoint aims at the block under the crosshair, not a fixed depth plane", async () => {
  const source = await readFile(engineUrl, "utf8");
  const start = source.indexOf("  private solveAimAtScreenPoint(");
  const end = source.indexOf("\n  private ", start + 10);
  assert.ok(start >= 0 && end > start, "could not isolate solveAimAtScreenPoint");

  const solve = source.slice(start, end);
  assert.match(
    solve,
    /raycastBlockSurfacePoint\(screenX, screenY\) \?\? this\.targetPlanePoint\(screenX, screenY\)/,
    "the ballistic solve must prefer the real block under the cursor and only fall back to the flat plane when no block is there",
  );
});

test("the block raycast walks model-local space so a rotated cluster is still hit correctly", async () => {
  const source = await readFile(engineUrl, "utf8");
  const start = source.indexOf("  private raycastBlockSurfacePoint(");
  const end = source.indexOf("\n  private ", start + 10);
  assert.ok(start >= 0 && end > start, "could not isolate raycastBlockSurfacePoint");

  const raycast = source.slice(start, end);
  assert.match(raycast, /inverseModel/, "must transform the ray into the rotated model's own space");
  assert.match(raycast, /rayAabbEntry\(/, "must test against each block's box, not a single flat plane");
});
