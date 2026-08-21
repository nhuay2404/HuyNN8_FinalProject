import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);

function numberConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = ([0-9.]+);`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
}

test("crosshair follows the joystick candidate and never snaps to a block", async () => {
  const source = await readFile(engineUrl, "utf8");
  const start = source.indexOf("  private updateAimPreview() {");
  const end = source.indexOf("\n  private fire(", start);
  assert.ok(start >= 0 && end > start, "could not isolate updateAimPreview");

  const preview = source.slice(start, end);
  assert.match(preview, /candidateTargetValid = true/);
  assert.match(preview, /this\.aimCursor\.copy\(candidateCursor\)/);
  assert.doesNotMatch(preview, /screenPointForWorldPoint|impactCursor|displayedCursor\.copy/);
});

test("vertical aim envelope matches the final usable solver range", async () => {
  const source = await readFile(engineUrl, "utf8");
  assert.equal(numberConstant(source, "AIM_CURSOR_UP_RATIO"), 0.4);
  assert.equal(numberConstant(source, "AIM_CURSOR_DOWN_RATIO"), 0.15);
  assert.match(
    source,
    /this\.aimStick\.y \* \(this\.aimStick\.y < 0 \? upwardRange : downwardRange\)/,
  );
});

test("release requires both current and displayed aim to remain armed", async () => {
  const source = await readFile(engineUrl, "utf8");
  const start = source.indexOf("    const shouldFire = canRelease");
  const end = source.indexOf(";", start);
  assert.ok(start >= 0 && end > start, "could not isolate release guard");

  const releaseGuard = source.slice(start, end);
  assert.match(releaseGuard, /this\.aimArmed/);
  assert.match(releaseGuard, /this\.displayedAimArmed/);
  assert.match(releaseGuard, /releaseDistance > JOYSTICK_CANCEL_RADIUS/);
});
