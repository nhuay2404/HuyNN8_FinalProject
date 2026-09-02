import * as THREE from "three";
import { MUZZLE_Z } from "./SandCannonEngine";

// Which skin the player has equipped for the cannon. Stored the same way the
// sound preference is: a file:// page or a privacy mode can refuse storage
// outright, and the game still has to start, so every read and write is
// guarded and falls back to the default rather than throwing.
const STORAGE_KEY = "cannon-sort:v1:costume";

export type CostumeId = "classic-cannon" | "rune-cannon";

/** Which family of extra effects a costume plays. `classic` gets nothing on
 * top of the always-on smoke/sand-spray; `magic` adds the sparkle bling and
 * the rune radius overlay. Nothing else in the engine branches on a specific
 * `CostumeId` — everything asks this one question instead. */
export type CostumeFlavor = "classic" | "magic";

// The groups the aim math owns. A rig only decorates them — it never moves
// them, and above all never touches `muzzleAnchor`, which is where every shot
// starts from. That is what keeps every costume shooting the exact same
// trajectory, so a skin can never be the reason a shot missed.
export type CostumeRigGroups = {
  cannonRoot: THREE.Group;
  turret: THREE.Group;
  barrelPivot: THREE.Group;
  barrelVisual: THREE.Group;
};

export type CostumeDef = {
  id: CostumeId;
  name: string;
  tagline: string;
  flavor: CostumeFlavor;
  // Returns the objects it added, so swapping a costume can take exactly
  // those back out again — see `disposeCostumeParts`.
  build: (groups: CostumeRigGroups) => THREE.Object3D[];
};

type Attach = (parent: THREE.Object3D, child: THREE.Object3D) => THREE.Object3D;

// Every rig builds its own geometries and materials instead of sharing module
// level ones, and none of them go through the engine's own `track()` — a
// costume can be swapped out and disposed while the engine itself keeps
// running, which `track()`'s "free everything on full teardown" model does
// not support.
function collector() {
  const added: THREE.Object3D[] = [];
  const attach: Attach = (parent, child) => {
    parent.add(child);
    added.push(child);
    return child;
  };
  return { added, attach };
}

// The engine's own ammo-tinted ring already occupies radius 0.86 at this
// height (`baseRing`, `SandCannonEngine.ts`) — every decorative ring built
// here has to sit clear of it rather than on top of it.
const AMMO_RING_RADIUS = 0.86;

/**
 * Today's cannon shell, unchanged: a candy-blue barrel on a dark cradle and
 * pedestal, gold muzzle ring. Extracted from `buildCannon()` verbatim so the
 * default costume is pixel-for-pixel what the game already looked like
 * before costumes existed.
 */
function buildClassicCannon(groups: CostumeRigGroups) {
  const { added, attach } = collector();
  // Unlit flat colour — no light-driven shading gradient across the
  // cannon's surfaces, just the smooth, evenly-lit look the game wants.
  const body = new THREE.MeshBasicMaterial({ color: 0x66a9eb });
  const dark = new THREE.MeshBasicMaterial({ color: 0x4a5c8d });
  // Dark gunmetal trim — was gold (0xffb70e); the shell now stays in cool
  // dark tones (near-black, slate, navy) instead of mixing in yellow.
  const accent = new THREE.MeshBasicMaterial({ color: 0x2b3140 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 40), dark);
  attach(groups.cannonRoot, base);

  const cradle = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 18), dark);
  cradle.scale.set(1, 0.86, 1);
  attach(groups.turret, cradle);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 2.35, 28), body);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.98;
  attach(groups.barrelVisual, barrel);

  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 12, 28), accent);
  muzzle.position.z = MUZZLE_Z + 0.06;
  attach(groups.barrelVisual, muzzle);

  return added;
}

/**
 * An arcane cannon on a rune pedestal: the same three masses the classic
 * cannon is built from, at the same sizes, wearing stone and light instead of
 * steel and paint. Styled after an earlier prototype's "Rune Cannon" skin.
 *
 * What carries the magic: the barrel tapers toward the muzzle where the
 * classic one flares, the rings float rather than bolt on, and every light on
 * it is unlit material so it reads as glow instead of paint.
 */
function buildRuneCannon(groups: CostumeRigGroups) {
  const { added, attach } = collector();
  // Same reasoning as the classic rig: flat, unlit colour so the stone and
  // wood read as smooth surfaces rather than lit/shaded ones.
  const stone = new THREE.MeshBasicMaterial({ color: 0x27214e });
  const wood = new THREE.MeshBasicMaterial({ color: 0x4b386b });
  // Unlit, so these read as light sources rather than as painted plastic.
  const glow = new THREE.MeshBasicMaterial({ color: 0xac71ff });
  const spark = new THREE.MeshBasicMaterial({ color: 0xffdc75 });
  const ember = new THREE.MeshBasicMaterial({ color: 0xff5bc8 });

  // Pedestal: the classic cannon's base dimensions exactly, so the two
  // costumes are the same size of object on the same footprint.
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 44), stone);
  attach(groups.cannonRoot, pedestal);

  // A glyph ring around the pedestal rim, deliberately outside the engine's
  // own ammo-tinted ring (radius 0.86) rather than on top of it — the two
  // read as concentric circles instead of one fighting the other for the
  // same pixels.
  const glyphRingRadius = AMMO_RING_RADIUS + 0.12;
  const glyphRing = new THREE.Mesh(new THREE.TorusGeometry(glyphRingRadius, 0.045, 14, 44), glow);
  glyphRing.rotation.x = Math.PI / 2;
  glyphRing.position.y = 0.27;
  attach(groups.cannonRoot, glyphRing);

  const glyphStuds = 8;
  for (let index = 0; index < glyphStuds; index += 1) {
    const angle = (index / glyphStuds) * Math.PI * 2;
    const stud = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), ember);
    stud.position.set(Math.cos(angle) * glyphRingRadius, 0.27, Math.sin(angle) * glyphRingRadius);
    attach(groups.cannonRoot, stud);
  }

  // Housing, where the classic cannon has its cradle, with a charge crystal
  // on each side. Same squash as the classic cradle: it has to keep covering
  // the barrel's back rim through the whole recoil travel, and this barrel's
  // back radius (0.26) is narrower than the classic barrel's (0.38), so the
  // same squash clears it with room to spare.
  const housing = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 20), stone);
  housing.scale.set(1, 0.86, 1);
  attach(groups.turret, housing);
  for (const side of [-1, 1]) {
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.19), ember);
    crystal.position.set(side * 0.5, 0.08, 0.06);
    attach(groups.turret, crystal);
  }

  // Barrel: same length and footprint as the classic one, tapering **toward**
  // the muzzle where the classic barrel flares. That one reversal is most of
  // what separates a wand-like barrel from a gun barrel at a glance.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.19, 2.35, 32), wood);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.98;
  attach(groups.barrelVisual, barrel);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 16, 36), glow);
  collar.position.z = -0.18;
  attach(groups.barrelVisual, collar);

  // Two rings that sit off the barrel rather than around it, so they read as
  // held there by the thing that makes it glow.
  for (const [ringZ, radius] of [
    [-1.05, 0.33],
    [-1.72, 0.29],
  ] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 14, 36), spark);
    ring.position.z = ringZ;
    attach(groups.barrelVisual, ring);
  }

  // The muzzle crystal sits exactly on the anchor, so a shot leaves the
  // barrel and not the air in front of it. The halo sits in the classic
  // muzzle-ring's own slot (`MUZZLE_Z + 0.06`) — clear of the engine's own
  // ammo-tinted muzzle band at `MUZZLE_Z + 0.2`.
  const focus = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), spark);
  focus.position.z = MUZZLE_Z;
  attach(groups.barrelVisual, focus);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 14, 36), glow);
  halo.position.z = MUZZLE_Z + 0.06;
  attach(groups.barrelVisual, halo);

  return added;
}

export const COSTUMES: Record<CostumeId, CostumeDef> = {
  "classic-cannon": {
    id: "classic-cannon",
    name: "Field Cannon",
    tagline: "Load. Aim. Boom.",
    flavor: "classic",
    build: buildClassicCannon,
  },
  "rune-cannon": {
    id: "rune-cannon",
    name: "Rune Cannon",
    tagline: "Charge. Sparkle. Repeat.",
    flavor: "magic",
    build: buildRuneCannon,
  },
};

export const COSTUME_ORDER: CostumeId[] = ["classic-cannon", "rune-cannon"];
export const DEFAULT_COSTUME: CostumeId = "classic-cannon";

export function getCostume(id: CostumeId) {
  return COSTUMES[id] ?? COSTUMES[DEFAULT_COSTUME];
}

function isCostumeId(value: string | null): value is CostumeId {
  return value !== null && value in COSTUMES;
}

export function getSelectedCostume(): CostumeId {
  if (typeof window === "undefined") return DEFAULT_COSTUME;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isCostumeId(stored) ? stored : DEFAULT_COSTUME;
  } catch {
    return DEFAULT_COSTUME;
  }
}

export function setSelectedCostume(id: CostumeId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The choice just will not survive a reload.
  }
}

// Rig parts leaving a scene take their own geometry and material with them:
// nothing here is shared with anything still on screen.
export function disposeCostumeParts(parts: THREE.Object3D[]) {
  for (const part of parts) {
    part.parent?.remove(part);
    part.traverse((node) => {
      const renderable = node as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      renderable.geometry?.dispose();
      const material = renderable.material;
      if (!material) return;
      for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
    });
  }
}

// ---- thumbnails ------------------------------------------------------------
// One small offscreen render per costume for the picker's tray — a live shot
// of the actual rig rather than a hand-drawn icon, so a card never drifts out
// of sync with what equipping it actually looks like.
const THUMBNAIL_SIZE = 192;
// Rendered once per page and cached: the picker can be opened and closed all
// day, and the rigs themselves never change between visits.
let thumbnailCache: Record<CostumeId, string> | null = null;

function buildThumbnailRig(costume: CostumeDef) {
  const cannonRoot = new THREE.Group();
  const turret = new THREE.Group();
  const barrelPivot = new THREE.Group();
  const barrelVisual = new THREE.Group();
  // The same nesting and the same offsets the engine's own `buildCannon`
  // uses, so a card shows the rig the way the game actually holds it.
  turret.position.y = 0.46;
  barrelPivot.position.y = 0.12;
  cannonRoot.add(turret);
  turret.add(barrelPivot);
  barrelPivot.add(barrelVisual);
  const parts = costume.build({ cannonRoot, turret, barrelPivot, barrelVisual });
  // Turned three-quarters on so the barrel reads as a barrel rather than a
  // circle, and pulled down so the base is not jammed against the card edge.
  cannonRoot.rotation.y = 0.62;
  barrelPivot.rotation.x = 0.18;
  cannonRoot.position.set(0, -0.62, 0);
  return { root: cannonRoot, parts };
}

/**
 * Renders every costume to a small square PNG data URL, using the engine's
 * own `WebGLRenderer` — a page keeps exactly one WebGL context, and a second
 * one for the picker would eventually cost the game its own canvas.
 */
export function getCostumeThumbnails(renderer: THREE.WebGLRenderer): Record<CostumeId, string> {
  if (thumbnailCache) return thumbnailCache;

  const size = THUMBNAIL_SIZE;
  const target = new THREE.WebGLRenderTarget(size, size);
  // Without this the target keeps linear output while the canvas is sRGB,
  // and the cards would come out darker than the rig looks on screen.
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // Its own lights: an Object3D belongs to one parent, so the engine's own
  // lights cannot be borrowed into a second scene.
  const hemisphere = new THREE.HemisphereLight(0xf2f2f2, 0x8fa8ab, 1.5);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(-4, 7.5, 6.5);
  scene.add(hemisphere, key);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  camera.position.set(0, 0.75, 4.6);
  camera.lookAt(0, -0.1, 0);

  const previousTarget = renderer.getRenderTarget();
  const previousAlpha = renderer.getClearAlpha();
  // Transparent, so a card shows the rig and not a black square.
  renderer.setClearAlpha(0);

  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const thumbnails = {} as Record<CostumeId, string>;

  for (const id of COSTUME_ORDER) {
    const rig = buildThumbnailRig(getCostume(id));
    scene.add(rig.root);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    scene.remove(rig.root);
    disposeCostumeParts(rig.parts);

    // WebGL hands rows back bottom-up; a canvas wants them top-down.
    const image = context.createImageData(size, size);
    const stride = size * 4;
    for (let row = 0; row < size; row += 1) {
      const from = (size - 1 - row) * stride;
      image.data.set(pixels.subarray(from, from + stride), row * stride);
    }
    context.putImageData(image, 0, 0);
    thumbnails[id] = canvas.toDataURL("image/png");
  }

  renderer.setRenderTarget(previousTarget);
  renderer.setClearAlpha(previousAlpha);
  target.dispose();
  hemisphere.dispose();
  key.dispose();

  thumbnailCache = thumbnails;
  return thumbnails;
}
