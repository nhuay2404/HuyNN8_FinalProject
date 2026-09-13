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

export type CostumeId =
  | "classic-cannon"
  | "rune-cannon"
  | "hero-cannon"
  | "frost-cannon"
  | "spider-cannon"
  | "viking-cannon"
  | "cat-cannon";

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
 * A frost-rimed cannon: the same three masses every other costume is built
 * from, at the same sizes and footprint (aim math never has to know a skin
 * is equipped), but the masses themselves are no longer smooth cylinders and
 * spheres wearing a different palette — on request ("thêm yếu tố để khiến
 * nó khác hơn chứ không phải thay màu"): a plain colour swap over the
 * classic shell wasn't enough, this needed shapes none of the other three
 * costumes use.
 *
 * What actually carries "carved out of a glacier" now: a faceted, low-poly
 * pedestal (8-sided, not smoothly round like every other costume's base) with
 * one big asymmetric glacier spike bursting out of one edge — this skin's
 * own signature accessory, the same role the rune costume's floating studs
 * or the hero costume's satchel play; a housing built from an icosahedron
 * instead of a sphere, so it reads as a hewn crystal knuckle rather than a
 * smooth ball; and a ragged accretion of ice spikes creeping up one whole
 * side of the barrel in place of the old two symmetric bands — real ice
 * grows lopsided and clumped, not in two even rings. The icicle rim and
 * muzzle crystal cluster from the previous pass earn their keep and stay.
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

  // Pedestal: the classic cannon's own base dimensions (radius/height), so
  // the footprint every costume shares stays identical — but only 8
  // radial segments instead of the smooth 40 every other costume's pedestal
  // uses, so this one alone reads as a hewn, faceted block of ice rather
  // than a turned disc. The cheapest possible shape change that still reads
  // instantly, before a single accessory is added.
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 8), frost);
  attach(groups.cannonRoot, pedestal);

  // The one shape none of the other three costumes have anywhere on them: a
  // single oversized glacier spike bursting out of one edge of the pedestal,
  // asymmetric on purpose (real ice does not grow in tidy radial symmetry) —
  // this costume's own signature accessory, the same job the rune costume's
  // floating glyph studs or the hero costume's satchel do for theirs. Tall
  // enough to read past the icicle rim below it, angled outward and up so
  // it clears the turret's own rotation without ever intersecting it.
  const glacierSpike = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.05, 7), ice);
  glacierSpike.position.set(0.92, 0.28, 0.62);
  glacierSpike.rotation.set(0.3, 0, -0.55);
  attach(groups.cannonRoot, glacierSpike);
  // A smaller shard leaning against the big spike's own base — a real ice
  // formation is never just one clean spike, it is a cluster.
  const glacierSpikeSmall = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.5, 6), ice);
  glacierSpikeSmall.position.set(1.05, 0.18, 0.42);
  glacierSpikeSmall.rotation.set(0.2, 0, -0.3);
  attach(groups.cannonRoot, glacierSpikeSmall);

  // Icicles hanging off the pedestal rim — kept from the previous pass, still
  // clear of the engine's own ammo-tinted ring (radius 0.86, see
  // `AMMO_RING_RADIUS`), same clearance the rune costume's glyph ring keeps.
  const icicleRadius = AMMO_RING_RADIUS + 0.24;
  const icicleCount = 10;
  for (let index = 0; index < icicleCount; index += 1) {
    const angle = (index / icicleCount) * Math.PI * 2;
    const icicle = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 8), ice);
    icicle.position.set(Math.cos(angle) * icicleRadius, 0.12, Math.sin(angle) * icicleRadius);
    icicle.rotation.x = Math.PI; // point tip down, base against the pedestal rim
    attach(groups.cannonRoot, icicle);
  }

  // Housing, where the classic cannon has its smooth cradle sphere: an
  // icosahedron instead, so it reads as a hewn crystal knuckle rather than a
  // ball with a different paint job — the same faceted-not-round idea the
  // pedestal above uses, on the shape every other costume's cradle shares.
  // Radius bumped slightly (0.62 -> 0.66) to cover the same ground a sphere
  // of 0.62 would: an icosahedron's faces sit closer to its centre than its
  // vertices do, so matching the old radius exactly would have let the
  // barrel's own back rim (radius 0.38) peek through between facets during
  // recoil. Same squash as every other rig's cradle either way.
  const housing = new THREE.Mesh(new THREE.IcosahedronGeometry(0.66, 0), ice);
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

  // A ragged accretion of ice spikes crawling up ONE side of the barrel,
  // replacing the old two symmetric glow bands — a smooth ring reads as trim
  // bolted onto a barrel; a lopsided cluster of jagged spikes reads as ice
  // that actually grew there, clumped and uneven the way real accretion
  // always is, never in two tidy rings. Every spike sits within a narrow
  // angular wedge (roughly the barrel's underside) rather than scattered
  // all the way around, so the buildup reads as one continuous frozen
  // drift down that side instead of an evenly-spaced belt.
  const spikeSpots: { z: number; angle: number; length: number; radius: number }[] = [
    { z: -0.4, angle: 3.6, length: 0.26, radius: 0.05 },
    { z: -0.58, angle: 4.0, length: 0.4, radius: 0.07 },
    { z: -0.82, angle: 3.75, length: 0.3, radius: 0.055 },
    { z: -1.05, angle: 4.15, length: 0.46, radius: 0.075 },
    { z: -1.3, angle: 3.85, length: 0.24, radius: 0.05 },
    { z: -1.5, angle: 4.05, length: 0.34, radius: 0.06 },
    { z: -1.7, angle: 3.7, length: 0.22, radius: 0.045 },
  ];
  for (const spot of spikeSpots) {
    // The barrel tapers from 0.38 at the back to 0.24 at the front — each
    // spike's base has to sit flush against the barrel's own radius at its
    // own z, interpolated the same way the cylinder geometry itself does,
    // or the spikes would either float off the surface or bury themselves
    // inside it as they march toward the muzzle.
    const barrelT = (spot.z - (-0.98 - 1.175)) / 2.35;
    const barrelRadiusHere = 0.38 + (0.24 - 0.38) * Math.min(1, Math.max(0, barrelT));
    const spike = new THREE.Mesh(new THREE.ConeGeometry(spot.radius, spot.length, 6), glow);
    spike.position.set(Math.cos(spot.angle) * barrelRadiusHere, Math.sin(spot.angle) * barrelRadiusHere, spot.z);
    // A cone's tip points along its own local +Y by default; rotating it
    // `angle - 90°` around Z aims that +Y straight along the same
    // `(cos(angle), sin(angle))` radial direction the position above already
    // uses, so the spike reads as growing straight OUT of the barrel's
    // surface at its own spot rather than at some unrelated tilt.
    spike.rotation.z = spot.angle - Math.PI / 2;
    attach(groups.barrelVisual, spike);
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

/**
 * Orients and stretches a Y-axis mesh (a cylinder or cone, whose default long
 * axis is +Y) so it exactly spans `from` to `to` — three.js has no built-in
 * "stretch this between two points" primitive, and the spider costume below
 * is the first rig here that needs struts at arbitrary angles rather than
 * ones fixed to a rotation tuple. `baseLength` is the geometry's own
 * unscaled length (its Y extent before any scale is applied).
 */
function strutBetween(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, baseLength: number) {
  const delta = new THREE.Vector3().subVectors(to, from);
  const length = delta.length();
  mesh.position.copy(from).addScaledVector(delta, 0.5);
  mesh.scale.y = length / baseLength;
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
}

/**
 * A web-slinger's cannon: the same three masses every other costume is built
 * from, at the same footprint (aim math never has to know a skin is
 * equipped), but wearing an arachnid's own silhouette rather than a recolour
 * of the classic shell — same bar `buildFrostCannon`'s own doc comment holds
 * itself to (on request: "thiết kế sao cho nó khác biệt với các loại súng
 * khác, không chỉ thay đổi màu skin"). An ORIGINAL spider/web design, not a
 * licensed character's likeness: no logo, no named suit, nothing here reads
 * as a specific copyrighted costume — just the general "red carapace, bent
 * leg struts, big paired eye-lenses, a web instead of a ring" arachnid read.
 *
 * What carries "spider" specifically: six bent, two-segment leg struts
 * ringing the pedestal (this skin's own signature accessory, the same role
 * the rune costume's glyph studs or frost's glacier spike play for theirs);
 * a radial spoke web standing in for the usual smooth trim ring; and a pair
 * of oversized white eye-lenses on the housing — the one cue that reads as
 * "spider-themed" at a glance without copying any single character's mask
 * graphic. Fanged mandibles flank the muzzle in place of a plain ring.
 */
function buildSpiderCannon(groups: CostumeRigGroups) {
  const { added, attach } = collector();
  const ramp = getCannonToonRamp();
  const shell = new THREE.MeshToonMaterial({ color: 0xb31217, gradientMap: ramp });
  const trim = new THREE.MeshToonMaterial({ color: 0x1b1b1f, gradientMap: ramp });
  const lens = new THREE.MeshToonMaterial({ color: 0xf4f4f4, gradientMap: ramp });
  // Unlit, like every other costume's glow bits — the web strands read as
  // strung silk catching light, not painted plastic a scene light would flatten.
  const silk = new THREE.MeshBasicMaterial({ color: 0xe9e9e9 });

  // Pedestal: the classic cannon's own base dimensions, so the footprint
  // every costume shares stays identical.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 40), shell);
  attach(groups.cannonRoot, base);

  // Six bent leg struts ringing the pedestal — the shape none of the other
  // three costumes have anywhere on them. Each leg is two segments meeting
  // at a raised "knee" then back down to a foot on the ground, the actual
  // joint silhouette that reads as a bent leg rather than a straight spike
  // (contrast `buildFrostCannon`'s single-cone glacier spike, which is
  // deliberately NOT jointed since ice does not have knees).
  const legGeometry = new THREE.CylinderGeometry(0.045, 0.075, 1, 8);
  const legCount = 6;
  for (let index = 0; index < legCount; index += 1) {
    const angle = (index / legCount) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const hip = dir.clone().multiplyScalar(1.18).setY(-0.08);
    const knee = dir.clone().multiplyScalar(1.82).setY(0.24);
    const foot = dir.clone().multiplyScalar(2.28).setY(-0.34);

    const thigh = new THREE.Mesh(legGeometry, trim);
    strutBetween(thigh, hip, knee, 1);
    attach(groups.cannonRoot, thigh);

    const shin = new THREE.Mesh(legGeometry, trim);
    strutBetween(shin, knee, foot, 1);
    attach(groups.cannonRoot, shin);
  }

  // A radial spoke web standing in for the usual smooth trim ring — same
  // "outside the engine's own ammo-tinted ring" clearance the rune costume's
  // glyph ring keeps (`AMMO_RING_RADIUS`), but spokes instead of studs, so it
  // reads as a web strung across the pedestal rather than a jewelled band.
  const webRingRadius = AMMO_RING_RADIUS + 0.16;
  const webRing = new THREE.Mesh(new THREE.TorusGeometry(webRingRadius, 0.02, 10, 40), silk);
  webRing.rotation.x = Math.PI / 2;
  webRing.position.y = 0.25;
  attach(groups.cannonRoot, webRing);
  const spokeGeometry = new THREE.CylinderGeometry(0.016, 0.016, 1, 6);
  const spokeCount = 8;
  for (let index = 0; index < spokeCount; index += 1) {
    const angle = (index / spokeCount) * Math.PI * 2;
    const hub = new THREE.Vector3(0, 0.25, 0);
    const rim = new THREE.Vector3(Math.cos(angle) * webRingRadius, 0.25, Math.sin(angle) * webRingRadius);
    const spoke = new THREE.Mesh(spokeGeometry, silk);
    strutBetween(spoke, hub, rim, 1);
    attach(groups.cannonRoot, spoke);
  }

  // Housing, where the classic cannon has its plain cradle sphere — same
  // squash, same radius, just red instead of blue. The eye-lenses below are
  // what actually carry the "spider" read here, not the housing shape itself.
  const housing = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 18), shell);
  housing.scale.set(1, 0.86, 1);
  attach(groups.turret, housing);

  // A pair of oversized white eye-lenses on the housing's front face — the
  // single most legible "this is spider-themed" cue a silhouette can carry
  // without copying any one character's actual mask graphic (no logo, no
  // named shape, just two large pale lenses, the same general idea every
  // arachnid/insect-themed design reaches for). A thin dark rim ring on each
  // gives them an edge to read against the red housing behind them.
  for (const side of [-1, 1]) {
    const lensMesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), lens);
    lensMesh.scale.set(1, 1.15, 0.6);
    lensMesh.position.set(side * 0.27, 0.16, 0.48);
    attach(groups.turret, lensMesh);
    const lensRim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 10, 24), trim);
    lensRim.scale.set(1, 1.15, 1);
    lensRim.position.copy(lensMesh.position);
    attach(groups.turret, lensRim);
  }

  // Barrel: the classic cannon's own length, footprint and flare — still a
  // cannon barrel, not a leg. Ridged with a run of thin dark rings standing
  // in for the classic's plain paint job, the closest a smooth cylinder gets
  // to reading as a segmented exoskeleton without a bespoke ribbed geometry.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 2.35, 28), shell);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.98;
  attach(groups.barrelVisual, barrel);

  const ridgeCount = 5;
  for (let index = 0; index < ridgeCount; index += 1) {
    const t = index / (ridgeCount - 1);
    const z = -0.05 + t * (-1.85);
    const radius = THREE.MathUtils.lerp(0.385, 0.245, t);
    const ridge = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.028, 8, 24), trim);
    ridge.position.z = z;
    attach(groups.barrelVisual, ridge);
  }

  // Muzzle: two curved fang-like mandibles flanking a dark ring, in place of
  // the classic cannon's plain gold band — sits exactly on the anchor, so a
  // shot still leaves the barrel and not the air in front of it.
  const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 12, 28), trim);
  muzzleRing.position.z = MUZZLE_Z + 0.05;
  attach(groups.barrelVisual, muzzleRing);
  for (const side of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.32, 8), lens);
    fang.position.set(side * 0.18, -0.1, MUZZLE_Z + 0.02);
    fang.rotation.x = Math.PI;
    fang.rotation.z = side * 0.22;
    attach(groups.barrelVisual, fang);
  }

  return added;
}

/**
 * A Viking/medieval-European cannon: an iron gun barrel on a wooden keg
 * carriage, the same three masses every other costume shares at the same
 * footprint, but built from shapes none of the others use — same bar
 * `buildFrostCannon`/`buildSpiderCannon`'s own doc comments hold themselves
 * to (on request: "khác biệt với các loại súng khác, không chỉ thay đổi màu
 * skin"). Nothing here names or copies a specific culture's protected
 * emblem — just the generic "horns, chain, dragon-head, shield boss" read
 * period settings and games reach for, the same way `buildSpiderCannon`
 * reaches for "legs, web, big eyes" for its theme instead of a licensed
 * character's actual likeness.
 *
 * What carries the theme: the pedestal is a barrel/keg profile built with
 * `LatheGeometry` (bulging in the middle, cinched at both rims) rather than
 * a straight or faceted cylinder — no other costume's base is anything but
 * a plain cylinder; a pair of curved, tapering horns mounted on the housing,
 * this skin's own signature accessory; a round shield boss emblem on the
 * housing's face; a spiral of rivets winding down the barrel in place of a
 * smooth ring or band; and a stylised dragon-head snout framing the muzzle,
 * jaw open around the hole a shot actually leaves from.
 */
function buildVikingCannon(groups: CostumeRigGroups) {
  const { added, attach } = collector();
  const ramp = getCannonToonRamp();
  const wood = new THREE.MeshToonMaterial({ color: 0x7a4a24, gradientMap: ramp });
  const iron = new THREE.MeshToonMaterial({ color: 0x3f4247, gradientMap: ramp });
  const bronze = new THREE.MeshToonMaterial({ color: 0xb8862b, gradientMap: ramp });
  const bone = new THREE.MeshToonMaterial({ color: 0xe3d7b4, gradientMap: ramp });
  const paint = new THREE.MeshToonMaterial({ color: 0xa8281f, gradientMap: ramp });
  // Unlit, like every other costume's glow bits — a dragon's eyes read as a
  // glint, not as painted plastic a scene light would flatten.
  const glint = new THREE.MeshBasicMaterial({ color: 0xffd76a });

  // Pedestal: a keg/barrel profile — bulging in the middle, cinched at both
  // rims — instead of the plain cylinder every other costume's base is,
  // built with a lathe (a profile curve spun around Y) rather than a fixed
  // top/bottom radius. Same overall height and outer reach as the classic
  // pedestal (radius 1.08-1.3, height 0.48) so the footprint every costume
  // shares stays identical.
  const kegProfile = [
    new THREE.Vector2(1.14, -0.24),
    new THREE.Vector2(1.38, -0.12),
    new THREE.Vector2(1.42, 0.0),
    new THREE.Vector2(1.32, 0.13),
    new THREE.Vector2(1.08, 0.24),
  ];
  const keg = new THREE.Mesh(new THREE.LatheGeometry(kegProfile, 28), wood);
  attach(groups.cannonRoot, keg);

  // Iron hoop bands cinching the keg — a real cask is held together by
  // bands at the rim and the bulge, not smooth wood alone.
  for (const [y, radius] of [
    [-0.12, 1.38],
    [0.0, 1.42],
    [0.13, 1.32],
  ] as const) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.01, 0.035, 10, 36), iron);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    attach(groups.cannonRoot, band);
  }

  // Rivets studding the widest hoop — outside the engine's own ammo-tinted
  // ring (`AMMO_RING_RADIUS`), same clearance every other costume's rim trim
  // keeps.
  const rivetCount = 12;
  for (let index = 0; index < rivetCount; index += 1) {
    const angle = (index / rivetCount) * Math.PI * 2;
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), bronze);
    rivet.position.set(Math.cos(angle) * 1.43, 0.0, Math.sin(angle) * 1.43);
    attach(groups.cannonRoot, rivet);
  }

  // Housing, where the classic cannon has its plain cradle sphere — iron
  // instead of painted steel, reading as a real gun's own metal knuckle.
  const housing = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 18), iron);
  housing.scale.set(1, 0.86, 1);
  attach(groups.turret, housing);

  // A round shield boss on the housing's face — a bronze rim and centre
  // stud around a painted disc, the "you've earned this" detail every
  // adventurer skin gets one of (contrast `buildHeroCannon`'s gem-in-a-ring
  // emblem, which this deliberately does not copy the shape of).
  const shieldDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24), paint);
  shieldDisc.rotation.x = Math.PI / 2;
  shieldDisc.position.set(0, 0.05, 0.58);
  attach(groups.turret, shieldDisc);
  const shieldRim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.028, 10, 28), bronze);
  shieldRim.position.copy(shieldDisc.position);
  attach(groups.turret, shieldRim);
  const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), bronze);
  shieldBoss.position.set(0, 0.05, 0.62);
  attach(groups.turret, shieldBoss);

  // A pair of curved, tapering horns mounted on the housing — the shape
  // none of the other costumes have anywhere on them, this skin's own
  // signature accessory. Each horn is three shrinking segments curving up,
  // back and in, the same jointed-strut technique `buildSpiderCannon`'s legs
  // use, just fewer, longer segments for a smooth sweep instead of a bent
  // knee.
  for (const side of [-1, 1]) {
    const hornPoints = [
      new THREE.Vector3(side * 0.32, 0.34, -0.12),
      new THREE.Vector3(side * 0.56, 0.64, -0.34),
      new THREE.Vector3(side * 0.64, 0.9, -0.64),
      new THREE.Vector3(side * 0.54, 1.1, -0.92),
    ];
    const hornRadii = [
      [0.095, 0.07],
      [0.07, 0.048],
      [0.048, 0.022],
    ] as const;
    for (let segment = 0; segment < 3; segment += 1) {
      const [radiusBottom, radiusTop] = hornRadii[segment];
      const piece = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, 10), bone);
      strutBetween(piece, hornPoints[segment], hornPoints[segment + 1], 1);
      attach(groups.turret, piece);
    }
  }

  // Barrel: the classic cannon's own length, footprint and flare — bronze
  // gun-metal instead of painted steel.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 2.35, 28), bronze);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.98;
  attach(groups.barrelVisual, barrel);

  // A spiral of iron rivets winding down the barrel, standing in for the
  // smooth ring/band every other costume's barrel trim uses — reads as a
  // riveted iron sleeve wound on rather than a belt bolted around it.
  const spiralStuds = 16;
  for (let index = 0; index < spiralStuds; index += 1) {
    const t = index / (spiralStuds - 1);
    const z = -0.1 + t * -1.7;
    const angle = index * 2.3;
    const barrelRadiusHere = THREE.MathUtils.lerp(0.385, 0.245, t);
    const stud = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), iron);
    stud.position.set(Math.cos(angle) * barrelRadiusHere, Math.sin(angle) * barrelRadiusHere, z);
    attach(groups.barrelVisual, stud);
  }

  // Muzzle: a stylised dragon-head snout framing the hole, in place of the
  // classic cannon's plain ring — the barrel's own opening is the mouth a
  // shot actually leaves from, not a separate hole cut into the head.
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.5, 8), wood);
  snout.rotation.x = Math.PI / 2;
  snout.position.z = MUZZLE_Z + 0.18;
  attach(groups.barrelVisual, snout);
  const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 12, 28), iron);
  muzzleRing.position.z = MUZZLE_Z + 0.02;
  attach(groups.barrelVisual, muzzleRing);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), glint);
    eye.position.set(side * 0.16, 0.14, MUZZLE_Z + 0.32);
    attach(groups.barrelVisual, eye);
    const earHorn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 8), bone);
    earHorn.position.set(side * 0.15, 0.28, MUZZLE_Z + 0.4);
    earHorn.rotation.z = side * 0.35;
    attach(groups.barrelVisual, earHorn);
  }

  return added;
}

/**
 * A cat-themed cannon: the same three masses every other costume shares, at
 * the same footprint, but built as a cute cat's face and body rather than a
 * recolour of the classic shell — same bar every other costume's own doc
 * comment holds itself to (on request: "khác biệt với các loại súng khác,
 * không chỉ thay đổi màu skin"). A soft, chosen-by-design pastel palette
 * (pink, cream, peach/orange — no grey, on request: "tui muốn ụ súng màu
 * khác ngoài xám") rather than any specific existing character's exact
 * colours or markings.
 *
 * What carries "cat" specifically: the housing becomes an actual face —
 * two triangular ears (with a nested pink inner-ear), big round eyes with a
 * highlight speck, a small pink nose, and three whisker rods per cheek; a
 * curled, tapering tail sweeps up off the pedestal, this skin's own
 * signature accessory; the pedestal's rim is studded with paw-print
 * clusters instead of a smooth band; and the muzzle is framed by an actual
 * paw pad (a centre pad plus four toe beans) instead of a plain ring.
 */
function buildCatCannon(groups: CostumeRigGroups) {
  const { added, attach } = collector();
  const ramp = getCannonToonRamp();
  const cream = new THREE.MeshToonMaterial({ color: 0xfff3ea, gradientMap: ramp });
  const peach = new THREE.MeshToonMaterial({ color: 0xffc599, gradientMap: ramp });
  const pink = new THREE.MeshToonMaterial({ color: 0xffb9d6, gradientMap: ramp });
  // A second, deeper rose next to the bright bubblegum `pink` above — on
  // request ("tui muốn ụ súng màu khác ngoài xám"), the barrel and the tail's
  // own stripe rings moved off the original pastel grey onto this instead,
  // so the whole rig reads as one pink/peach/cream cat rather than mixing in
  // a cooler neutral tone.
  const rose = new THREE.MeshToonMaterial({ color: 0xffaed0, gradientMap: ramp });
  const dark = new THREE.MeshToonMaterial({ color: 0x3a343c, gradientMap: ramp });
  // Unlit, like every other costume's glow bits — the eye highlight reads
  // as a glint of light, not painted plastic a scene light would flatten.
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // Pedestal: the classic cannon's own base dimensions, cream instead of
  // dark steel.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.3, 0.48, 40), cream);
  attach(groups.cannonRoot, base);

  // Paw-print clusters around the rim — outside the engine's own
  // ammo-tinted ring (`AMMO_RING_RADIUS`), same clearance every other
  // costume's rim trim keeps — standing in for a smooth studded band with
  // an actual paw shape: one bigger pad plus three small toe beans.
  const pawCount = 6;
  const pawRadius = AMMO_RING_RADIUS + 0.2;
  for (let index = 0; index < pawCount; index += 1) {
    const angle = (index / pawCount) * Math.PI * 2;
    const cx = Math.cos(angle) * pawRadius;
    const cz = Math.sin(angle) * pawRadius;
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), pink);
    pad.scale.set(1, 0.6, 1.2);
    pad.position.set(cx, 0.25, cz);
    attach(groups.cannonRoot, pad);
    for (const toeOffset of [-0.06, 0, 0.06]) {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), pink);
      // The three toe beans sit in a little arc just outside (radially
      // further from centre than) the main pad, the same relative layout a
      // real paw print's toes sit above its pad.
      const toeAngle = angle + toeOffset * 0.6;
      toe.position.set(Math.cos(toeAngle) * (pawRadius + 0.09), 0.26, Math.sin(toeAngle) * (pawRadius + 0.09));
      attach(groups.cannonRoot, toe);
    }
  }

  // A curled, tapering tail sweeping up off the pedestal's flank — the
  // shape none of the other costumes have anywhere on them, this skin's own
  // signature accessory (the same role the hero costume's satchel or the
  // viking costume's horns play for theirs). Four shrinking segments curl
  // it into a "C", the same jointed-strut technique the viking horns use.
  const tailPoints = [
    new THREE.Vector3(0.95, 0.05, 0.55),
    new THREE.Vector3(1.28, 0.32, 0.68),
    new THREE.Vector3(1.32, 0.66, 0.5),
    new THREE.Vector3(1.08, 0.86, 0.28),
    new THREE.Vector3(0.82, 0.88, 0.18),
  ];
  const tailRadii = [
    [0.1, 0.09],
    [0.09, 0.075],
    [0.075, 0.06],
    [0.06, 0.045],
  ] as const;
  for (let segment = 0; segment < 4; segment += 1) {
    const [radiusBottom, radiusTop] = tailRadii[segment];
    const piece = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, 12), peach);
    strutBetween(piece, tailPoints[segment], tailPoints[segment + 1], 1);
    attach(groups.cannonRoot, piece);
  }
  // A fluffy cream tip, and two thin stripes partway down — a plain solid
  // tail reads as a smooth handle; a tip colour change plus a couple of
  // tabby stripes is what actually reads as fur.
  const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), cream);
  tailTip.position.copy(tailPoints[4]);
  attach(groups.cannonRoot, tailTip);
  for (let index = 0; index < 2; index += 1) {
    const t = 0.35 + index * 0.3;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.085 - index * 0.012, 0.018, 8, 16), rose);
    const along = new THREE.Vector3().lerpVectors(tailPoints[1], tailPoints[2], t);
    stripe.position.copy(along);
    strutBetween(stripe, along, new THREE.Vector3().lerpVectors(tailPoints[1], tailPoints[2], t + 0.001), 1);
    attach(groups.cannonRoot, stripe);
  }

  // Housing, where the classic cannon has its plain cradle sphere — this
  // IS the cat's face, not just a recoloured ball: everything below is
  // mounted on it.
  const housing = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 18), peach);
  housing.scale.set(1, 0.86, 1);
  attach(groups.turret, housing);

  // Two triangular ears with a nested pink inner-ear — a low radial-segment
  // cone (3 sides) reads as a triangular ear rather than a round horn, the
  // same low-poly-for-a-silhouette trick the viking costume's dragon snout
  // and the frost costume's faceted pedestal both use.
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.32, 3), peach);
    ear.position.set(side * 0.36, 0.62, -0.05);
    ear.rotation.z = side * -0.32;
    ear.rotation.y = side * 0.5;
    attach(groups.turret, ear);
    const innerEar = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.18, 3), pink);
    innerEar.position.set(side * 0.36, 0.58, 0.02);
    innerEar.rotation.copy(ear.rotation);
    attach(groups.turret, innerEar);
  }

  // Big round eyes with a highlight speck — the single most legible "cute
  // cat" cue a silhouette can carry. Flattened toward the housing (scale.z)
  // so they read as sitting ON the face rather than floating off it.
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 16), cream);
    eye.scale.set(1, 1.1, 0.55);
    eye.position.set(side * 0.26, 0.1, 0.52);
    attach(groups.turret, eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), dark);
    pupil.scale.set(1, 1.2, 0.6);
    pupil.position.set(side * 0.26, 0.09, 0.58);
    attach(groups.turret, pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), shine);
    glint.position.set(side * 0.26 + 0.03, 0.14, 0.62);
    attach(groups.turret, glint);
  }

  // A small pink nose, and three whisker rods per cheek radiating out and
  // slightly back — thin enough to read as whiskers rather than spikes.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.07, 8), pink);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.04, 0.63);
  attach(groups.turret, nose);
  const whiskerGeometry = new THREE.CylinderGeometry(0.008, 0.008, 0.42, 6);
  for (const side of [-1, 1]) {
    for (const tilt of [-0.22, 0, 0.22]) {
      const whisker = new THREE.Mesh(whiskerGeometry, cream);
      whisker.position.set(side * 0.4, -0.02 + tilt * 0.05, 0.42);
      whisker.rotation.z = Math.PI / 2;
      whisker.rotation.y = side * 0.12 + tilt * side;
      attach(groups.turret, whisker);
    }
  }

  // Barrel: the classic cannon's own length and footprint, rose pink with
  // two thin peach tabby stripe rings — plain paint would read as
  // "recoloured classic barrel", the stripes are what keep it reading as fur.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 2.35, 28), rose);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.98;
  attach(groups.barrelVisual, barrel);
  for (const z of [-0.7, -1.4]) {
    const t = (z - (-0.98 - 1.175)) / 2.35;
    const stripeRadius = THREE.MathUtils.lerp(0.385, 0.245, t) + 0.01;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(stripeRadius, 0.035, 10, 28), peach);
    stripe.position.z = z;
    attach(groups.barrelVisual, stripe);
  }

  // Muzzle: an actual paw pad — a centre pad plus four toe beans — framing
  // the hole, in place of the classic cannon's plain ring. The barrel's own
  // opening stays the hole a shot leaves from; the pad sits flush around it.
  const pawPad = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), pink);
  pawPad.scale.set(1, 0.85, 0.35);
  pawPad.position.z = MUZZLE_Z + 0.03;
  attach(groups.barrelVisual, pawPad);
  const toeAngles = [-0.55, -0.2, 0.2, 0.55];
  for (const angle of toeAngles) {
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), pink);
    toe.scale.set(1, 1, 0.5);
    toe.position.set(Math.sin(angle) * 0.19, Math.cos(angle) * 0.19 + 0.08, MUZZLE_Z + 0.08);
    attach(groups.barrelVisual, toe);
  }

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
  "spider-cannon": {
    id: "spider-cannon",
    name: "Web-Slinger Cannon",
    tagline: "Sling. Aim. Web 'em up.",
    // `classic` — no flavor VFX of its own kind is needed for this skin to
    // read as distinct (the rig itself carries the whole read); it still
    // gets its own bling palette below via `sparkleBlingColors`' per-id
    // check, the same way `hero-cannon` layers one on top of `classic`.
    flavor: "classic",
    // On request: 1000 Blue Emerald — double the Rune Cannon's price, the
    // most expensive purchasable skin so far. The CSV override below still
    // goes through `costumePrice`, same as every other skin's price.
    price: 1000,
    build: buildSpiderCannon,
  },
  "viking-cannon": {
    id: "viking-cannon",
    name: "Viking Cannon",
    tagline: "Raid. Aim. Plunder.",
    // `classic` — same reasoning as `spider-cannon` above: the rig carries
    // the whole read, and it still gets its own bling palette below via
    // `sparkleBlingColors`' per-id check.
    flavor: "classic",
    // On request: 1300 Blue Emerald — the most expensive purchasable skin
    // so far. The CSV override below still goes through `costumePrice`,
    // same as every other skin's price.
    price: 1300,
    build: buildVikingCannon,
  },
  "cat-cannon": {
    id: "cat-cannon",
    name: "Cat Cannon",
    tagline: "Pounce. Aim. Purr.",
    // `classic` — same reasoning as the other two shape-first skins above:
    // the rig carries the whole read, and it still gets its own bling
    // palette below via `sparkleBlingColors`' per-id check.
    flavor: "classic",
    // On request: 1800 Blue Emerald — the most expensive purchasable skin
    // so far. The CSV override below still goes through `costumePrice`,
    // same as every other skin's price.
    price: 1800,
    build: buildCatCannon,
  },
};

/**
 * The Skin screen's tray order (SandGame.tsx's `skin-grid`) — on request,
 * the default skin leads, its two `unlockLevel` progression skins (earned by
 * playing, never bought) sit right after it, and every skin actually bought
 * with Blue Emerald follows, in ascending price. Price order itself is not
 * derived here (`COSTUMES[id].price` would need `costumePrice`'s own CSV
 * override to stay accurate anyway) — it is just hand-ordered to match the
 * registry's own prices (500 / 1000 / 1300 / 1800) so a re-price only has to
 * update the number in `COSTUMES`, not this list too.
 */
export const COSTUME_ORDER: CostumeId[] = [
  "classic-cannon",
  "hero-cannon",
  "frost-cannon",
  "rune-cannon",
  "spider-cannon",
  "viking-cannon",
  "cat-cannon",
];
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
