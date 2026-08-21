import * as THREE from "three";

// One WebGL context for the whole page. Every level load and every restart
// borrows the same renderer instead of constructing one: browsers keep only
// about 16 live contexts, and `renderer.dispose()` does not release a context
// on its own, so a 50 level run with retries would otherwise run the tab out
// of contexts and lose the oldest canvas mid-game.
let sharedRenderer: THREE.WebGLRenderer | null = null;
let currentOwner: object | null = null;
let createdCount = 0;

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.domElement.setAttribute("aria-hidden", "true");
  createdCount += 1;
  return renderer;
}

export function acquireRenderer(owner: object, host: HTMLElement) {
  if (currentOwner !== null && currentOwner !== owner) releaseRenderer(currentOwner);
  if (!sharedRenderer) sharedRenderer = createRenderer();
  currentOwner = owner;
  sharedRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  host.appendChild(sharedRenderer.domElement);
  return sharedRenderer;
}

export function releaseRenderer(owner: object) {
  // A stale owner releasing late must not pull the canvas out of whoever holds
  // it now, so ownership is checked before touching the DOM.
  if (currentOwner !== owner) return;
  currentOwner = null;
  sharedRenderer?.domElement.remove();
}

// Full teardown for the page shutdown path. `dispose()` frees the GPU objects
// but keeps the context alive until garbage collection, so the context is
// dropped explicitly here.
export function destroySharedRenderer() {
  if (!sharedRenderer) return;
  sharedRenderer.domElement.remove();
  sharedRenderer.dispose();
  sharedRenderer.forceContextLoss();
  sharedRenderer = null;
  currentOwner = null;
}

// QA hook: `created` must stay at 1 no matter how many levels or restarts a
// session goes through.
export function getRendererStats() {
  return { created: createdCount, inUse: currentOwner !== null };
}
