import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);

function isolateMethod(source, signature) {
  const start = source.indexOf(signature);
  const end = source.indexOf("\n  private ", start + signature.length);
  return source.slice(start, end);
}

test("aiming no longer waits on the model-rotate finger", async () => {
  const source = await readFile(engineUrl, "utf8");
  const canStartAim = isolateMethod(source, "private canStartAim() {");
  assert.ok(canStartAim, "could not isolate canStartAim");
  assert.doesNotMatch(canStartAim, /modelPointer/, "a right-hand aim gesture must not check the left-hand rotate finger");
  assert.match(canStartAim, /this\.aimPointer === null/, "still only one aim gesture at a time");
});

test("rotating no longer waits on the aim finger, but still waits out a shot in flight", async () => {
  const source = await readFile(engineUrl, "utf8");
  const canRotateModel = isolateMethod(source, "private canRotateModel() {");
  assert.ok(canRotateModel, "could not isolate canRotateModel");
  assert.doesNotMatch(canRotateModel, /aimPointer/, "a left-hand rotate gesture must not check the right-hand aim finger");
  assert.match(
    canRotateModel,
    /this\.projectiles\.length === 0/,
    "rotation must still block while a shot is airborne, or the model could spin a different block under an already-fired shot",
  );
});
