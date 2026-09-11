import * as THREE from "three";
import { MUZZLE_Z } from "./SandCannonEngine";
import { getEconomyConfigOverride } from "./economy-config.ts";

// Which skin the player has equipped for the cannon. Stored the same way the
// sound preference is: a file:// page or a privacy mode can refuse storage
// outright, and the game still has to start, so every read and write is
// guarded and falls back to the default rather than throwing.
const STORAGE_KEY = "cannon-sort:v1:costume";
// Which skins have been bought. Same guarded-storage contract as the equipped
// skin above — a browser that refuses storage just means the player owns the
// free skins and nothing else, which is the safe direction to fail in.
const OWNED_KEY = "cannon-sort:v1:owned-costumes";
// Which skins' "you can afford this" dot the player has already dismissed —
// see `unseenAffordableSkins`'s own comment for what dismissing one means.
// Same guarded-storage contract as the two keys above.
const BADGE_SEEN_KEY = "cannon-sort:v1:skin-badge-seen";

export type CostumeId = "classic-cannon" | "rune-cannon" | "hero-cannon" | "frost-cannon";

/** Which family of extra effects a costume plays. `classic` gets nothing on
 * top of the always-on smoke/sand-spray; `magic` adds the sparkle bling and
 * the rune radius overlay; `frost` adds its own icy-white/cyan sparkle bling
 * (`FROST_SPARKLE_COLORS`, `SandCannonEngine.ts`) — same shard system as
 * `magic`, just a different palette, the same way `hero-cannon` draws its own
 * palette from that system without needing to be `magic` itself. Nothing else
 * in the engine branches on a specific `CostumeId` — everything asks this one
 * question instead. */
export type CostumeFlavor = "classic" | "magic" | "frost";

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
  /** Blue Emerald to unlock, or 0 for a skin every player already owns —
   * unless `unlockLevel` is set, in which case this is unused (see below).
   * Priced here rather than in `economy.ts` because the price belongs to the
   * skin the same way its name and tagline do — and `economy.ts` importing
   * this file back for it would be a cycle. The CSV override still goes
   * through `costumePrice` below, so a designer tunes it in the same sheet
   * as every other number. */
  price: number;
  /** The built-in level id (`sand-levels.ts`'s own `id`, 1-based) that hands
   * this skin to the player for free on its first clear, instead of it being
   * for sale. When set, `price` is ignored entirely: `isCostumeOwned` never
   * treats this skin as free-by-default the way a `price: 0` skin normally
   * is, and the Skin screen shows a "Progression" badge instead of a Buy
   * button. Undefined for every currency-purchasable skin. */
  unlockLevel?: number;
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

// A soft 4-band ramp so the cannon's shell — unlike the flat, unlit picture,
// frame, and sand around it — actually catches the scene's lights: a gentle
// stepped falloff from shadow to highlight, styled after Animal Crossing/A
// Short Hike's soft toon shading rather than a hard graphic-novel cel edge.
// One texture shared by every `MeshToonMaterial` the cannon uses (both
// costumes and the engine's own trim), lazily built once like the thumbnail
// cache below.
let toonRamp: THREE.DataTexture | null = null;
export function getCannonToonRamp(): THREE.DataTexture {
  if (toonRamp) return toonRamp;
  const bands = new Uint8Array([96, 150, 200, 255]);
  const texture = new THREE.DataTexture(bands, bands.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  toonRamp = texture;
  return texture;
}

/**
 * Today's cannon shell, unchanged: a candy-blue barrel on a dark cradle and
 * pedestal, gold muzzle ring. Extracted from `buildCannon()` verbatim so the
 * default costume is pixel-for-pixel what the game already looked like
 * before costumes existed.
 */
function buildClassicCannon(groups: CostumeRigGroups) {
  const { added, attach } = collector();
  // Toon-shaded, not flat — the shell now catches the scene's lights in a
  // soft, stepped falloff (see `getCannonToonRamp`) instead of reading as one
  // even colour regardless of angle.
  const ramp = getCannonToonRamp();
  const body = new THREE.MeshToonMaterial({ color: 0x66a9eb, gradientMap: ramp });
  const dark = new THREE.MeshToonMaterial({ color: 0x4a5c8d, gradientMap: ramp });
  // Dark gunmetal trim — was gold (0xffb70e); the shell now stays in cool
  // dark tones (near-black, slate, navy) instead of mixing in yellow.
  const accent = new THREE.MeshToonMaterial({ color: 0x2b3140, gradientMap: ramp });

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
  // Same reasoning as the classic rig: toon-shaded stone and wood so they
  // read as lit, faceted surfaces rather than flat paint.
  const ramp = getCannonToonRamp();
  const stone = new THREE.MeshToonMaterial({ color: 0x27214e, gradientMap: ramp });
  const wood = new THREE.MeshToonMaterial({ color: 0x4b386b, gradientMap: ramp });
  // Still unlit, unlike the stone and wood above: these read as light
  // sources rather than as painted plastic, and a light source shaded by the
  // scene's own lights would stop reading as one.
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

/**
 * A hero's cannon: the same three masses the classic cannon is built from, at
 * the same sizes, wearing a tunic-green and gold palette — the same
 * green-and-gold read as a storybook adventurer's gear, without naming or
 * modelling any specific character. `classic` flavor, not `magic`: the sparkle
 * bling and rune overlay are the Rune Cannon's own signature, and this skin
 * reads as sturdy travelling gear rather than as spellcraft.
 */
function buildHeroCannon(groups: CostumeRigGroups) {
  const { added, attach } = collector();
  // Same toon shading as the other two rigs, so this one catches the scene's
  // lights instead of reading as a flat cutout next to them.
  const ramp = getCannonToonRamp();
  const tunic = new THREE.MeshToonMaterial({ color: 0x3fae5a, gradientMap: ramp });
  const boots = new THREE.MeshToonMaterial({ color: 0x1f5c34, gradientMap: ramp });
  const gold = new THREE.MeshToonMaterial({ color: 0xf4c430, gradientMap: ramp });
  // Two more materials than the plain green/gold pair above, purely for the
  // accessories below — a satchel needs to read as leather and not as more
  // tunic, and a chest gem needs to read as a gem and not as more gold trim.
  const leather = new THREE.MeshToonMaterial({ color: 0x6b4226, gradientMap: ramp });
  const gemColor = new THREE.MeshToonMaterial({ color: 0x2fd0c4, gradientMap: ramp });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 40), boots);
  attach(groups.cannonRoot, base);

  const cradle = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 18), tunic);
  cradle.scale.set(1, 0.86, 1);
  attach(groups.turret, cradle);

  // A gold belt band around the cradle — the one accent that reads as
  // "adventurer's gear" rather than "green cannon". Sits on the turret, not
  // the pedestal, so it never competes with the engine's own ammo-tinted ring
  // (`baseRing`, `SandCannonEngine.ts`) at the pedestal's radius.
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.045, 12, 32), gold);
  belt.rotation.x = Math.PI / 2;
  attach(groups.turret, belt);

  // A small gem set in a gold ring on the chest — the "you've earned this"
  // detail every adventurer skin needs one of. Embedded a hair into the
  // cradle's own surface (radius 0.62) rather than floating in front of it.
  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), gemColor);
  emblem.position.set(0, 0.04, 0.58);
  attach(groups.turret, emblem);
  const emblemRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 10, 24), gold);
  emblemRing.position.copy(emblem.position);
  attach(groups.turret, emblemRing);

  // A travelling satchel slung on the pedestal's flank, with its own gold
  // strap buckle — the one accessory that isn't green or gold at all, so the
  // whole skin doesn't read as a single flat hue. Sits just proud of the
  // pedestal's own surface (radius ~1.17 at this height) so it reads as
  // hanging off it rather than buried inside.
  const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.18), leather);
  pouch.position.set(0.92, 0.03, 0.72);
  pouch.rotation.y = 0.65;
  attach(groups.cannonRoot, pouch);
  const pouchStrap = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 20), gold);
  pouchStrap.position.set(0.92, 0.17, 0.72);
  pouchStrap.rotation.x = Math.PI / 2;
  pouchStrap.rotation.z = 0.65;
  attach(groups.cannonRoot, pouchStrap);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 2.35, 28), tunic);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.98;
  attach(groups.barrelVisual, barrel);

  // A leather grip wrap partway down the barrel, between the turret and the
  // muzzle — the same idea as a bow's own handgrip, and what turns a plain
  // green tube into "gear" rather than just a recoloured barrel. Sized to the
  // barrel's own radius at this point along its taper (it widens from 0.24 at
  // the turret to 0.38 at the muzzle) so it reads as wrapped onto the barrel,
  // not floating around it.
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.35, 0.34, 24), leather);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = -1.5;
  attach(groups.barrelVisual, grip);

  // Two gold bands pinning the grip's edges — no rotation needed, unlike the
  // belt/emblem rings on the cradle above: a torus already lies flat in the
  // XY plane by default, which is exactly "wrapped around the Z-axis barrel"
  // with no reorientation. Radii follow the barrel's own taper at each z, the
  // same way the grip's own two radii do.
  const gripBandNear = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.035, 10, 28), gold);
  gripBandNear.position.z = -1.33;
  attach(groups.barrelVisual, gripBandNear);
  const gripBandFar = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 10, 28), gold);
  gripBandFar.position.z = -1.67;
  attach(groups.barrelVisual, gripBandFar);

  // A small gold stud on top of the grip, like a rivet — the one asymmetric
  // accent on the barrel, so it doesn't read as a perfectly plain sleeve from
  // every angle.
  const gripStud = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), gold);
  gripStud.position.set(0, 0.35, -1.5);
  attach(groups.barrelVisual, gripStud);

  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 12, 28), gold);
  muzzle.position.z = MUZZLE_Z + 0.06;
  attach(groups.barrelVisual, muzzle);

  return added;
}

/**
 * A frost-rimed cannon: the same three masses the classic cannon is built
 * from, at the same sizes, wearing pale ice-blue and frost-white instead of
 * steel and paint. `frost` flavor — its own sparkle bling palette
 * (`FROST_SPARKLE_COLORS`, `SandCannonEngine.ts`) rather than the rune
 * costume's violet/gold, so a shot reads as flung ice glinting in the air.
 *
 * What carries the "frozen over" read: icicles hanging off the pedestal rim
 * (the one shape none of the other three costumes use), a barrel banded in
 * ice rather than smooth steel, and a muzzle crystal cluster standing in for
 * the classic cannon's plain ring.
 */
function buildFrostCannon(groups: CostumeRigGroups) {
  const { added, attach } = collector();
  // Toon-shaded ice, same reasoning as every other rig's shell: it has to
  // catch the scene's lights, not read as a flat cutout.
  const ramp = getCannonToonRamp();
  const ice = new THREE.MeshToonMaterial({ color: 0xd8eefc, gradientMap: ramp });
  const frost = new THREE.MeshToonMaterial({ color: 0x7fb8d8, gradientMap: ramp });
  // Unlit, like every other costume's glow bits — these read as the cold
  // itself glinting, not as painted plastic a scene light would flatten.
  const glow = new THREE.MeshBasicMaterial({ color: 0xbdf3ff });
  const crystal = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // Pedestal: the classic cannon's own base dimensions, same footprint as
  // every other costume.
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 40), frost);
  attach(groups.cannonRoot, pedestal);

  // Icicles hanging off the pedestal rim — the one shape unique to this
  // costume. Deliberately outside the engine's own ammo-tinted ring (radius
  // 0.86, see `AMMO_RING_RADIUS`), same clearance the rune costume's glyph
  // ring keeps.
  const icicleRadius = AMMO_RING_RADIUS + 0.24;
  const icicleCount = 10;
  for (let index = 0; index < icicleCount; index += 1) {
    const angle = (index / icicleCount) * Math.PI * 2;
    const icicle = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 8), ice);
    icicle.position.set(Math.cos(angle) * icicleRadius, 0.12, Math.sin(angle) * icicleRadius);
    icicle.rotation.x = Math.PI; // point tip down, base against the pedestal rim
    attach(groups.cannonRoot, icicle);
  }

  // Housing, where the classic cannon has its cradle, with a frost crystal on
  // each side in place of the rune costume's ember ones. Same squash as every
  // other rig's cradle, so it keeps covering the barrel's back rim through
  // the whole recoil travel.
  const housing = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 18), ice);
  housing.scale.set(1, 0.86, 1);
  attach(groups.turret, housing);
  for (const side of [-1, 1]) {
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), crystal);
    shard.position.set(side * 0.5, 0.08, 0.06);
    attach(groups.turret, shard);
  }

  // Barrel: the classic cannon's own length, footprint and flare (unlike the
  // rune costume's wand-taper) — this is still a cannon, just an iced-over
  // one, not a staff.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 2.35, 28), frost);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.98;
  attach(groups.barrelVisual, barrel);

  // Two frozen bands along the barrel, glowing rather than painted — reads
  // as ice that formed there rather than a trim ring bolted on.
  for (const ringZ of [-0.55, -1.55] as const) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 14, 32), glow);
    band.position.z = ringZ;
    attach(groups.barrelVisual, band);
  }

  // Muzzle: a small cluster of crystal shards standing in for the classic
  // cannon's plain ring — sits exactly on the anchor, so a shot still leaves
  // the barrel and not the air in front of it.
  const muzzleShards = 6;
  for (let index = 0; index < muzzleShards; index += 1) {
    const angle = (index / muzzleShards) * Math.PI * 2;
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), crystal);
    shard.position.set(Math.cos(angle) * 0.24, Math.sin(angle) * 0.24, MUZZLE_Z + 0.04);
    attach(groups.barrelVisual, shard);
  }
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
    price: 0,
    build: buildClassicCannon,
  },
  "rune-cannon": {
    id: "rune-cannon",
    name: "Rune Cannon",
    tagline: "Charge. Sparkle. Repeat.",
    flavor: "magic",
    // The reward track's very first node pays exactly this (`MILESTONE_EMERALDS[0]`
    // in `economy.ts`) — the skin is meant to read as "the thing the track is
    // for", not as a number a player has to do arithmetic about.
    price: 500,
    build: buildRuneCannon,
  },
  "hero-cannon": {
    id: "hero-cannon",
    name: "Hero Cannon",
    tagline: "Quest. Aim. Onward.",
    flavor: "classic",
    // Not for sale at any price — `unlockLevel` below is what actually gates
    // it, and `isCostumeOwned` ignores `price` entirely once that is set.
    // Kept at 0 rather than removed only because `price` itself is still a
    // required field on `CostumeDef`.
    price: 0,
    // Level 20 (`sand-levels.ts`'s `twentiethLevel`, `id: 20`) is the built-in
    // level that hands this skin over on its first clear — see
    // `costumeUnlockedByLevel` below for the lookup this powers.
    unlockLevel: 20,
    build: buildHeroCannon,
  },
  "frost-cannon": {
    id: "frost-cannon",
    name: "Frost Cannon",
    tagline: "Chill. Aim. Shatter.",
    flavor: "frost",
    // Not for sale at any price, same reasoning as `hero-cannon` above —
    // `unlockLevel` is what actually gates it.
    price: 0,
    // Level 40 (`sand-levels.ts`'s `fortiethLevel`, `id: 40`) — the capstone
    // of the Freeze Map arc (31-40), so a frost-themed reward for clearing it
    // first is the level's own payoff, not an arbitrary pairing.
    unlockLevel: 40,
    build: buildFrostCannon,
  },
};

export const COSTUME_ORDER: CostumeId[] = ["classic-cannon", "rune-cannon", "hero-cannon", "frost-cannon"];
export const DEFAULT_COSTUME: CostumeId = "classic-cannon";

export function getCostume(id: CostumeId) {
  return COSTUMES[id] ?? COSTUMES[DEFAULT_COSTUME];
}

function isCostumeId(value: string | null): value is CostumeId {
  return value !== null && value in COSTUMES;
}

/** `id`'s actual Blue Emerald price — the def's own `price` unless
 * `public/design/economy.csv` overrides it, the same shape `boosterPrice` uses
 * for the Shop. Read this rather than `COSTUMES[id].price` anywhere a number
 * is shown or charged, so a sheet edit moves the label and the spend
 * together. */
export function costumePrice(id: CostumeId): number {
  return getEconomyConfigOverride(`costumePrice_${id}`) ?? getCostume(id).price;
}

/** A free skin is owned by everyone from the first launch — only a priced one
 * has to be bought. Keeps `OWNED_KEY` holding just the purchases, so a skin
 * whose price is later dropped to 0 becomes free for existing players too
 * rather than staying locked behind a stored list they are not on.
 *
 * A `unlockLevel` skin skips that "price 0 means free for everyone" rule
 * entirely — it is never owned until `unlockCostume` actually adds it to
 * `OWNED_KEY`, which only the level-clear handler in `SandGame.tsx` does
 * (on that level's first win), never a purchase. */
export function isCostumeOwned(id: CostumeId): boolean {
  const def = getCostume(id);
  if (def.unlockLevel !== undefined) return readOwnedCostumes().has(id);
  if (costumePrice(id) <= 0) return true;
  return readOwnedCostumes().has(id);
}

/** The skin, if any, that clearing built-in level `levelId` for the first
 * time hands the player — the id `SandGame.tsx`'s WIN handler checks after
 * `markLevelCleared` succeeds, so a progression skin's own unlock level lives
 * only here rather than being hardcoded a second time at the call site. */
export function costumeUnlockedByLevel(levelId: number): CostumeId | undefined {
  return COSTUME_ORDER.find((id) => COSTUMES[id].unlockLevel === levelId);
}

function readOwnedCostumes(): Set<CostumeId> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(OWNED_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is CostumeId => isCostumeId(id as string)) : []);
  } catch {
    return new Set();
  }
}

/**
 * Marks `id` bought. Deliberately does NOT touch the wallet: the caller
 * (`buySkin` in `SandGame.tsx`) spends the emerald first and only unlocks on
 * a spend that actually went through, so this file never has to know what a
 * skin is paid for with.
 */
export function unlockCostume(id: CostumeId) {
  const owned = readOwnedCostumes();
  if (owned.has(id)) return;
  owned.add(id);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OWNED_KEY, JSON.stringify([...owned]));
  } catch {
    // The purchase holds for this session but not across a reload. Nothing
    // better is available on storage that refuses writes, and the alternative
    // (refusing the sale) would take the emerald and give nothing back.
  }
}

/** Dev-only, alongside the Settings screen's other economy resets: puts every
 * priced skin back behind its price so the buy flow can be tested again. */
export function resetOwnedCostumes() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OWNED_KEY);
    // A relocked skin should be able to earn its dot back too, not stay
    // silently dismissed from a run before the reset.
    window.localStorage.removeItem(BADGE_SEEN_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

function readSeenBadges(): Set<CostumeId> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(BADGE_SEEN_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is CostumeId => isCostumeId(id as string)) : []);
  } catch {
    return new Set();
  }
}

/**
 * Marks `id`'s afford-notification dot dismissed — call the moment the
 * player taps that skin's card in the picker, whether or not they go on to
 * buy it. Buying makes the dot moot on its own (`isCostumeOwned` excludes it
 * from `unseenAffordableSkins` from then on); this is what stops it coming
 * back on its own for a skin the player looked at and chose not to buy yet.
 */
export function markSkinBadgeSeen(id: CostumeId) {
  const seen = readSeenBadges();
  if (seen.has(id)) return;
  seen.add(id);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BADGE_SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // The dot just reappears next time — nothing worse than showing it twice.
  }
}

/**
 * Every skin the player can afford right now, does not already own, and has
 * not already dismissed the dot for (`markSkinBadgeSeen`). Drives both the
 * Skin tab's own red dot (non-empty) and which card(s) in the picker wear
 * one — the tab's dot is "there is at least one of these", a card's is "this
 * is one of them".
 *
 * A skin dropped from this list by `markSkinBadgeSeen` stays dropped even if
 * the balance never changes — the notification means "you can afford *a*
 * skin you have not seen", not "you can afford this particular one", so it
 * only comes back once saving up further makes a *different*, still-unseen
 * skin affordable too.
 */
export function unseenAffordableSkins(emeralds: number): CostumeId[] {
  const seen = readSeenBadges();
  // A `unlockLevel` skin is excluded outright, not just filtered by price:
  // its price is an unused 0 (see `CostumeDef.unlockLevel`'s own comment),
  // which would otherwise read as "affordable" to every wallet, emerald or not.
  return COSTUME_ORDER.filter(
    (id) => getCostume(id).unlockLevel === undefined && !isCostumeOwned(id) && emeralds >= costumePrice(id) && !seen.has(id),
  );
}

export function getSelectedCostume(): CostumeId {
  if (typeof window === "undefined") return DEFAULT_COSTUME;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Never hands back a skin the player does not own — the dev Settings
    // screen can wipe the owned list out from under an equipped purchase,
    // and the free default is the only safe thing to fall back to.
    return isCostumeId(stored) && isCostumeOwned(stored) ? stored : DEFAULT_COSTUME;
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
