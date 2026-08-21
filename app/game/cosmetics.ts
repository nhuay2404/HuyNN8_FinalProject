import * as THREE from "three";

// Which skin the player picked. Stored the same way the haptics preference is:
// a file:// page or a privacy mode can refuse storage outright, and the game
// still has to start, so every read and write is guarded and falls back to the
// default rather than throwing.
const STORAGE_KEY = "cannon-sort:v1:cosmetic";

export type CosmeticId = "classic-cannon" | "magic-wand";

// Which family of effects a skin plays. Gunpowder is dust and smoke; magic is
// sparks and light. They are alternatives, never layered: two skins that both
// puff white smoke would read as the same skin wearing a different hat.
export type CosmeticFlavor = "gunpowder" | "magic";

// The groups the aim math owns. A rig only decorates them — it never moves
// them, and above all never moves `muzzleAnchor`, which is where every shot
// starts from. That is what keeps both skins shooting the exact same
// trajectory, so a cosmetic can never be the reason a shot missed.
export type CosmeticRigGroups = {
  cannonRoot: THREE.Group;
  turret: THREE.Group;
  barrelPivot: THREE.Group;
  barrelVisual: THREE.Group;
};

export type CosmeticDef = {
  id: CosmeticId;
  name: string;
  tagline: string;
  flavor: CosmeticFlavor;
  // Returns the objects it added, so swapping a skin can take exactly those
  // back out again.
  build: (groups: CosmeticRigGroups) => THREE.Object3D[];
};

// Where the barrel ends, and where a muzzle ornament therefore has to sit.
const MUZZLE_Z = -2.18;

// Recoil clearance. Firing slides everything on `barrelVisual` back by this
// much — it must match RECOIL_TRAVEL in CannonSortEngine, and a test holds the
// two together.
//
// The rule it creates: **no part of a barrel may cross the housing's surface
// anywhere in that travel.** A part fully inside the housing is fine, a part
// fully outside is fine; one that starts inside and ends outside appears out of
// nowhere every time the player fires and slides back in afterwards, which is
// exactly what a breech cap tucked into the cradle did. Two rules of thumb
// follow, and both are load-bearing:
//   - the housing's half-height must clear `barrelBackRadius + BARREL_LIFT` at
//     z = barrelBackZ + RECOIL_TRAVEL, or the barrel's back rim rises out of it;
//   - rings on the barrel belong clear of the housing, not resting against it.
const RECOIL_TRAVEL = 0.23;
// The barrel pivot sits this far above the housing's centre, so every clearance
// check on a barrel part has to be made against a surface it is offset from.
const BARREL_LIFT = 0.12;

// Empty cards after the two real skins. They are visibly inert rather than
// hidden, the same way the menu's Skin and Shop buttons showed where they were
// going before either screen existed.
export const LOCKED_COSMETIC_SLOTS = 6;

// The housing's vertical squash, solved from the clearance rule instead of
// eyeballed: the flattest housing that still hides a barrel of this back radius
// at the far end of the recoil travel, with a margin so the two surfaces never
// meet exactly. Derived rather than written down, so a later change to a barrel
// cannot quietly bring the popping back.
function housingYScale(barrelBackRadius: number, barrelBackZ: number, housingRadius: number) {
  const reach = barrelBackZ + RECOIL_TRAVEL;
  const widthAtReach = housingRadius * Math.sqrt(Math.max(0.0001, 1 - (reach / housingRadius) ** 2));
  const needed = (barrelBackRadius + BARREL_LIFT) * 1.1;
  return Math.min(1, needed / widthAtReach);
}

type Attach = (parent: THREE.Object3D, child: THREE.Object3D) => THREE.Object3D;

// Every rig builds its own geometries and materials instead of sharing module
// level ones. The engine's teardown walks its scene and disposes what it finds,
// so a shared geometry would be freed under the feet of the next level.
function collector() {
  // Every part is attached straight onto one of the four rig groups, so this
  // list is exactly what has to come back off when the skin is swapped.
  const added: THREE.Object3D[] = [];
  const attach: Attach = (parent, child) => {
    parent.add(child);
    added.push(child);
    return child;
  };
  return { added, attach };
}

// Segment counts here are what the rig is read at: this model is a few metres
// from the camera and fills a third of the screen, so the low counts the shape
// was blocked out with showed as facets on every silhouette. Everything round is
// built round, and the barrel is capped at both ends rather than stopping on a
// cut face.
function buildClassicCannon(groups: CosmeticRigGroups) {
  const { added, attach } = collector();
  const body = new THREE.MeshLambertMaterial({ color: 0xa2b6ec });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3d4680 });
  const accent = new THREE.MeshLambertMaterial({ color: 0xffd54a });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 44), dark);
  attach(groups.cannonRoot, base);
  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.11, 16, 44), accent);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.27;
  attach(groups.cannonRoot, baseRing);

  // Tall enough to keep swallowing the barrel back rim through the whole recoil
  // travel. The 0.72 squash it used to have did not, which is why the rim rose
  // out of the cradle on every shot.
  const cradle = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 20), dark);
  cradle.scale.set(1, housingYScale(0.24, 0.195, 0.62), 1);
  attach(groups.turret, cradle);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 2.35, 32), body);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.98;
  attach(groups.barrelVisual, barrel);
  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.11, 16, 36), dark);
  muzzle.position.z = MUZZLE_Z + 0.02;
  attach(groups.barrelVisual, muzzle);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 16, 36), accent);
  collar.position.z = -0.18;
  attach(groups.barrelVisual, collar);

  return added;
}

// An arcane gun on a rune pedestal: the same three masses the cannon is built
// from, at the same sizes, wearing stone and light instead of steel and paint.
//
// It was a gloved hand holding a wand for a while, and that was the wrong idea
// twice over. A hand is the one shape a player already knows by heart, so every
// approximation of one reads as a bad hand rather than as a stylised hand —
// while a gun on a mount has no such baseline to fail against. And a hand has to
// be modelled at hand scale, which put it far under the cannon it stands in for,
// so the two skins never looked like the same class of object.
//
// What carries the magic instead: the barrel tapers toward the muzzle where the
// cannon flares, the rings float rather than bolt on, and every light on it is
// unlit material so it reads as glow instead of paint.
function buildMagicWand(groups: CosmeticRigGroups) {
  const { added, attach } = collector();
  const stone = new THREE.MeshLambertMaterial({ color: 0x2c2559 });
  const wood = new THREE.MeshLambertMaterial({ color: 0x55407a });
  // Unlit, so these read as light sources rather than as painted plastic.
  const glow = new THREE.MeshBasicMaterial({ color: 0xc9a3ff });
  const spark = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const ember = new THREE.MeshBasicMaterial({ color: 0xff8ad8 });

  // Pedestal: the cannon's base dimensions exactly, so the two skins are the
  // same size of object on the same footprint.
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 44), stone);
  attach(groups.cannonRoot, pedestal);
  const runeRing = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.11, 16, 44), glow);
  runeRing.rotation.x = Math.PI / 2;
  runeRing.position.y = 0.27;
  attach(groups.cannonRoot, runeRing);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.05, 14, 40), spark);
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.29;
  attach(groups.cannonRoot, innerRing);

  // Housing, where the cannon has its cradle, with a charge crystal on each
  // side. Same proportions as the cradle for the same reason: it has to keep
  // covering the barrel's back rim while the shot pushes it in.
  const housing = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 20), stone);
  housing.scale.set(1, housingYScale(0.26, 0.195, 0.62), 1);
  attach(groups.turret, housing);
  for (const side of [-1, 1]) {
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.19), ember);
    crystal.position.set(side * 0.5, 0.08, 0.06);
    attach(groups.turret, crystal);
  }

  // Barrel: same length and same footprint as the cannon's, tapering **toward**
  // the muzzle where the cannon flares. That one reversal is most of what
  // separates a staff from a gun barrel at a glance.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.19, 2.35, 32), wood);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.98;
  attach(groups.barrelVisual, barrel);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 16, 36), glow);
  collar.position.z = -0.18;
  attach(groups.barrelVisual, collar);
  // Two rings that sit off the barrel rather than around it, so they read as
  // held there by the thing that makes it glow.
  for (const [ringZ, radius] of [[-1.05, 0.33], [-1.72, 0.29]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 14, 36), spark);
    ring.position.z = ringZ;
    attach(groups.barrelVisual, ring);
  }

  // The muzzle crystal sits exactly on the anchor, so a shot leaves the barrel
  // and not the air in front of it. Faceted on purpose: it is the one part of
  // either rig that should not be smooth.
  const focus = new THREE.Mesh(new THREE.OctahedronGeometry(0.24), spark);
  focus.position.z = MUZZLE_Z;
  attach(groups.barrelVisual, focus);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 14, 36), glow);
  halo.position.z = MUZZLE_Z + 0.2;
  attach(groups.barrelVisual, halo);

  return added;
}

export const COSMETICS: Record<CosmeticId, CosmeticDef> = {
  "classic-cannon": {
    id: "classic-cannon",
    name: "Field Cannon",
    tagline: "Load. Aim. Boom.",
    flavor: "gunpowder",
    build: buildClassicCannon,
  },
  "magic-wand": {
    // The id stays as it is even though the rig is a gun now: it is what sits in
    // a player's storage, and renaming it would silently reset their choice.
    id: "magic-wand",
    name: "Rune Cannon",
    tagline: "Charge. Sparkle. Repeat.",
    flavor: "magic",
    build: buildMagicWand,
  },
};

export const COSMETIC_ORDER: CosmeticId[] = ["classic-cannon", "magic-wand"];
export const DEFAULT_COSMETIC: CosmeticId = "classic-cannon";

export function getCosmetic(id: CosmeticId) {
  return COSMETICS[id] ?? COSMETICS[DEFAULT_COSMETIC];
}

function isCosmeticId(value: string | null): value is CosmeticId {
  return value !== null && value in COSMETICS;
}

function readStoredCosmetic(): CosmeticId {
  if (typeof window === "undefined") return DEFAULT_COSMETIC;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isCosmeticId(stored) ? stored : DEFAULT_COSMETIC;
  } catch {
    return DEFAULT_COSMETIC;
  }
}

let selected = readStoredCosmetic();

export function getSelectedCosmetic() {
  return selected;
}

export function setSelectedCosmetic(next: CosmeticId) {
  selected = next in COSMETICS ? next : DEFAULT_COSMETIC;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, selected);
  } catch {
    // The choice just will not survive a reload.
  }
}

// Rig parts leaving a scene take their own geometry and material with them:
// nothing here is shared with anything still on screen.
export function disposeCosmeticParts(parts: THREE.Object3D[]) {
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

const THUMBNAIL_SIZE = 192;
// Two renders of a 192px square, once per page. Cached because the picker can
// be opened and closed all day and the rigs never change.
let thumbnailCache: Record<CosmeticId, string> | null = null;

function buildThumbnailRig(cosmetic: CosmeticDef) {
  const cannonRoot = new THREE.Group();
  const turret = new THREE.Group();
  const barrelPivot = new THREE.Group();
  const barrelVisual = new THREE.Group();
  // The same nesting and the same offsets the engine uses, so a card shows the
  // rig the way the game holds it.
  turret.position.y = 0.46;
  barrelPivot.position.y = 0.12;
  cannonRoot.add(turret);
  turret.add(barrelPivot);
  barrelPivot.add(barrelVisual);
  const parts = cosmetic.build({ cannonRoot, turret, barrelPivot, barrelVisual });
  // Turned three quarters on so the barrel reads as a barrel rather than as a
  // circle, and pulled down so the base is not jammed against the card edge.
  cannonRoot.rotation.y = 0.62;
  barrelPivot.rotation.x = 0.22;
  // Centred by measuring the rendered card: the alpha bounding box of both rigs
  // has to sit inside the frame with room on every side.
  cannonRoot.position.set(0, -0.72, 0);
  return { root: cannonRoot, parts };
}

export function getCosmeticThumbnails(renderer: THREE.WebGLRenderer) {
  if (thumbnailCache) return thumbnailCache;

  const size = THUMBNAIL_SIZE;
  const target = new THREE.WebGLRenderTarget(size, size);
  // Without this the target keeps linear output while the canvas is sRGB, and
  // the cards would come out darker than the model on screen.
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // Its own lights: an Object3D belongs to one parent, so the engine's lights
  // cannot be borrowed into a second scene.
  const hemisphere = new THREE.HemisphereLight(0xe8f4ff, 0x4b3bb0, 1.9);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(-3.4, 5.2, 6);
  scene.add(hemisphere, key);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  camera.position.set(0, 0.9, 5.1);
  camera.lookAt(0, -0.15, 0);

  const previousTarget = renderer.getRenderTarget();
  const previousAlpha = renderer.getClearAlpha();
  // Transparent, so a card shows the rig and not a black square.
  renderer.setClearAlpha(0);

  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const thumbnails = {} as Record<CosmeticId, string>;

  for (const id of COSMETIC_ORDER) {
    const rig = buildThumbnailRig(getCosmetic(id));
    scene.add(rig.root);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    scene.remove(rig.root);
    disposeCosmeticParts(rig.parts);

    // WebGL hands back rows bottom up; a canvas wants them top down.
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
