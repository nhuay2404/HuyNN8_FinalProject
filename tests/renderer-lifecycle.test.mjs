import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);
const poolUrl = new URL("../app/game/renderer-pool.ts", import.meta.url);

test("the engine borrows the shared renderer instead of creating a context", async () => {
  const source = await readFile(engineUrl, "utf8");
  assert.doesNotMatch(source, /new THREE\.WebGLRenderer/);
  assert.match(source, /acquireRenderer\(this, this\.host\)/);
  assert.match(source, /releaseRenderer\(this\)/);
  assert.doesNotMatch(source, /this\.renderer\.dispose\(\)/);
});

test("the shared renderer releases its context on full teardown", async () => {
  const source = await readFile(poolUrl, "utf8");
  assert.match(source, /forceContextLoss\(\)/);
  const acquire = source.slice(source.indexOf("export function acquireRenderer"), source.indexOf("export function releaseRenderer"));
  assert.match(acquire, /if \(currentOwner !== null && currentOwner !== owner\) releaseRenderer\(currentOwner\)/);
  const release = source.slice(source.indexOf("export function releaseRenderer"), source.indexOf("export function destroySharedRenderer"));
  assert.match(release, /if \(currentOwner !== owner\) return/);
});

test("projectiles come from a pool and are never disposed per shot", async () => {
  const source = await readFile(engineUrl, "utf8");
  const fireStart = source.indexOf("  private fire(");
  const removeStart = source.indexOf("  private removeProjectile(");
  assert.ok(fireStart >= 0 && removeStart > 0, "could not isolate the projectile paths");

  const fire = source.slice(fireStart, source.indexOf("\n  private ", fireStart + 10));
  assert.match(fire, /takeProjectileMesh\(\)/);
  assert.doesNotMatch(fire, /new THREE\.SphereGeometry|new THREE\.MeshBasicMaterial/);

  const remove = source.slice(removeStart, source.indexOf("\n  private ", removeStart + 10));
  assert.match(remove, /recycleProjectileMesh\(projectile\.mesh\)/);
  assert.doesNotMatch(remove, /dispose\(\)/);
});
