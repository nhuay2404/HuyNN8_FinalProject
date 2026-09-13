import * as THREE from "three";

/**
 * The reward screen's stage, as a real 3D rig: a treasure chest that spins,
 * settles, throws its lid open on a shaft of light, and spits Blue Emeralds
 * that arc out, bounce and come to rest on the ground around it.
 *
 * Built to the blueprint in `public/icons/ChestIcon.png` and its three-view
 * breakdown — front (X), right (Y) and top (Z) — rather than to a guess:
 *
 *  - The lid is arched in BOTH the front and the side view, which a plain
 *    half-cylinder is not (that reads as a rectangle side-on). It is a
 *    rounded box: full-size across the middle, rounding off over the last
 *    third of each half-depth. `domeGeometry` below is that surface, and
 *    because it is parameterised by "position along the arch" it can also cut
 *    the gold straps and plank seams straight out of the same surface, so
 *    they hug the curve instead of floating over it.
 *  - Proportions come off the blueprint's own pixel measurements — see the
 *    dimension block.
 *  - Gold sits exactly where the three views agree it does: two edge bands and
 *    two inner straps over the lid, a thick band on the lid/body seam, another
 *    at the base, a post up all four vertical corners with studs, and the blue
 *    shield lock straddling the seam on the front face alone.
 *
 * Its own file rather than more of `SandCannonEngine.ts` for the same reason
 * `costumes.ts` is: this is a prop the engine happens to be able to show, not
 * part of how the game plays. Nothing here touches gameplay geometry.
 *
 * Everything is `MeshBasicMaterial` — the engine's scene has no lights at all,
 * and every rig in this codebase is flat, unlit colour. Depth comes from
 * giving each face of a box its own shade instead, the way the blueprint draws
 * its own front and side faces.
 */

/** Which beat of the opening the stage is on, or `null` for "off screen".
 * Mirrors the reward screen's own state machine in SandGame.tsx. */
export type ChestPhase = "spinning" | "opening" | "revealed";

// ---- palette, sampled off the blueprint ------------------------------------
const WOOD_LID = 0x8a5e3c;
const WOOD_LID_SEAM = 0x6f4a2c;
const WOOD_BODY = 0xa5703f;
const WOOD_BODY_SIDE = 0x8d5f34;
const WOOD_BODY_SEAM = 0x7c5230;
const GOLD = 0xf3c34a;
const GOLD_DARK = 0xdca934;
const STUD = 0xffe08a;
const LOCK_BLUE = 0x4a7fe0;
const LOCK_BLUE_DARK = 0x3766c4;
const KEYHOLE = 0x1d2c4a;

// ---- dimensions ------------------------------------------------------------
// Straight off the blueprint. The front view measures 587 × 495 px overall
// with the seam band at y=520 of 295..790, and the right view is drawn at 0.6
// the front view's scale, which puts the depth at 410 front-view px. Taking
// the width as 2.1 world units, that is:
const BODY_W = 2.1;
const BODY_D = 1.47;
const BODY_H = 0.97;
const LID_H = 0.8;
/** The seam band's own thickness — 45px of 587 in the front view. */
const RIM_H = 0.16;
/** Fraction of each half-depth over which the lid rounds off. Sized so the
 * front view still shows a full-width arch (the middle is a straight sweep)
 * while the side view reads as the arch the blueprint draws there. */
const LID_EDGE = 0.34;
/** How square the arch is. 1 would be a half-ellipse; below 1 pulls the
 * shoulders out and flattens the top, which is the rounded-box silhouette the
 * blueprint's front view actually has. */
const LID_SQUARE = 0.55;
/** Where the lid hinges: the back top edge of the body. */
const HINGE_Z = -BODY_D / 2;

/**
 * The four gold runs over the lid, as spans of the arch parameter `u` — 0 at
 * the left edge of the arch, 1 at the right. The outer two sit hard on the
 * edges, where the blueprint has them wrapping the corner and continuing down
 * the body as its corner posts; the inner two are the straps the front view
 * spaces across the dome.
 */
// `u` is NOT linear in x — the superellipse profile crowds most of its range
// into the shoulders — so these spans are solved backwards from where the
// blueprint puts each strap ACROSS the width, not guessed on the parameter.
// The inner pair lands at +-0.41 of the half-width, which is the 30%/70%
// spacing the front and top views both show.
const LID_STRAPS: Array<[number, number]> = [
  [0, 0.09],
  [0.405, 0.462],
  [0.538, 0.595],
  [0.91, 1],
];
/** Plank seams ruled across the lid — the blueprint's horizontal lines. Each
 * band is one line's showing on one side of the top, so they come in mirrored
 * pairs; the FIRST half of the list is one line each, which is what
 * `buildLidCapDetail` rules across the flat end. Solved back from evenly
 * spaced heights, for the same reason the straps are. */
const LID_SEAMS: Array<[number, number]> = [
  [0.105, 0.125],
  [0.208, 0.228],
  [0.325, 0.345],
  [0.655, 0.675],
  [0.772, 0.792],
  [0.875, 0.895],
];

// ---- emeralds --------------------------------------------------------------
/** How many stones the chest throws. Not tied to the reward amount: eight
 * reads as "a handful" at any payout, and a chest worth 1250 should not bury
 * the screen in gems. */
const GEM_COUNT = 8;
/**
 * The stone, to its own blueprint's three views (front X, side Y, top Z): an
 * emerald cut, taller than it is wide and much thinner than either.
 *
 * The shape those three views describe is NOT a gem-cut cone. The front view
 * is an octagon with an octagonal table inside it; the side and top views are
 * both a flat slab with chamfered ends. That is one solid: an octagonal girdle
 * at the widest point, with a smaller octagonal face set back from it on each
 * side and a ring of chamfer facets joining them. `buildEmerald` builds
 * exactly that — see its own comment.
 *
 * Ratios come off the blueprint: height is 1.2x the width, depth about half of
 * it, and the corners are cut back by a fifth of the width.
 */
const GEM_W = 0.3;
const GEM_H = 0.36;
const GEM_D = 0.15;
const GEM_CUT = 0.063;
/** How far each face is set back from the girdle — the chamfer's own width. */
const GEM_BEVEL = 0.046;
/**
 * How high a resting stone's centre sits: half its THICKNESS, because it comes
 * to rest lying flat on one of its faces rather than standing up. The extra
 * hair absorbs the couple of degrees of lean `flatOnFloor` gives each stone,
 * so a tilted corner does not sink through the floor.
 */
const GEM_REST_Y = GEM_D / 2 + 0.012;
/** The height a stone BOUNCES off, which is higher: mid-tumble it is landing
 * on a corner, not on a face. */
const GEM_LAND_Y = GEM_W * 0.38;
const GRAVITY = -9.4;
/** How much of its speed a stone keeps through a bounce, and the speed below
 * which it stops bouncing and settles. */
const GEM_BOUNCE = 0.36;
const GEM_SETTLE_SPEED = 0.9;

// ---- the shaft of light ----------------------------------------------------
/** How far up the cone throws. Sized to overshoot the chest by a good margin
 * but still leave dark frame around the edges — light that reaches every
 * corner stops reading as a beam and starts reading as a background. */
const CONE_REACH = 2.5;
/** Half the cone's opening angle. */
const CONE_SPREAD = 0.44;
/** How much dimmer the cone's own edge is than its middle. Never 0: a cone
 * that fades to nothing at the sides has no silhouette left, and the
 * silhouette is the shape. */
const CONE_EDGE = 0.5;
/**
 * Where the plane the cone is drawn on sits, in Z.
 *
 * This is the whole placement, and it is a narrow window. In FRONT of the
 * raised lid, which is tipped back into negative Z, so the cone crosses over
 * the lid instead of being cut off behind it. BEHIND the chest's own front
 * wall at `BODY_D / 2`, so that wall clips the bottom of the cone and the
 * light reads as welling up out of the inside rather than pasted on the front.
 */
const CONE_Z = 0.42;

function flat(color: number, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
}

/** Same flat colour, but visible from behind too. The lid is a shell one face
 * thick: once it swings open the camera is looking at its UNDERSIDE, which
 * back-face culling would drop entirely — the chest would read as having no
 * lid at all rather than an open one. */
function flatShell(color: number) {
  return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
}

/**
 * Six materials in `BoxGeometry`'s own face order (+x, -x, +y, -y, +z, -z).
 * `front` goes on +z (the camera side at rest), `side` on the two x faces,
 * `top` on +y and -y — the three shades that do all the work of making an
 * unlit box look solid.
 */
function boxShades(front: number, side: number, top: number) {
  return [flat(side), flat(side), flat(top), flat(top), flat(front), flat(side)];
}

/** Half the lid's depth, and the radius its four top edges round off at. */
const LID_HALF_D = BODY_D / 2;
const LID_ROUND = LID_EDGE * LID_HALF_D;

/**
 * The lid's surface, or any band of it.
 *
 * Two parameters, and the whole shape falls out of them:
 *  - `u` runs along the ARCH, 0 at the left edge of the lid to 1 at the right.
 *    The profile it traces is a superellipse of width `BODY_W` and height
 *    `LID_H` — see `LID_SQUARE` for why not a plain ellipse.
 *  - `v` runs along the DEPTH, back to front. The profile is swept at full
 *    size across the middle, then INSET along its own inward normal over the
 *    last `LID_ROUND` at each end, by the amount a circle of that radius would
 *    cut back — which is exactly what rounds the four top edges and the four
 *    corners.
 *
 * Inset, not scaled: scaling the profile toward the origin (the obvious
 * shortcut) tapers each end to a point at the hinge line, so the lid reads as
 * a tent rather than a rounded box, and any band drawn on it converges to a
 * star at the middle instead of running front to back.
 *
 * Restricting `u` cuts a band that follows the arch — which is how the gold
 * straps and the plank seams are made, `lift`ed a hair along the outward
 * normal so they sit proud of the wood rather than z-fighting with it.
 */
function arch(u: number) {
  // `u` of 0 is the left edge, so the angle runs down from a half turn.
  const angle = Math.PI * (1 - u);
  const cos = Math.cos(angle);
  const sin = Math.max(0, Math.sin(angle));
  return {
    x: (BODY_W / 2) * Math.sign(cos) * Math.pow(Math.abs(cos), LID_SQUARE),
    y: LID_H * Math.pow(sin, LID_SQUARE),
  };
}

/** The profile's inward normal at `u`, from the tangent either side of it.
 * "Inward" is settled by pointing it at a spot inside the arch rather than by
 * working out which perpendicular is which per segment. */
function archInward(u: number) {
  const step = 0.004;
  const before = arch(Math.max(0, u - step));
  const after = arch(Math.min(1, u + step));
  const tx = after.x - before.x;
  const ty = after.y - before.y;
  const length = Math.hypot(tx, ty) || 1;
  let nx = -ty / length;
  let ny = tx / length;
  const here = arch(u);
  if (nx * (0 - here.x) + ny * (LID_H * 0.4 - here.y) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny };
}

/** How far the profile is cut back at this depth, and where that depth is. */
function lidDepth(v: number) {
  const t = 2 * v - 1;
  const z = LID_HALF_D * t;
  const over = Math.abs(z) - (LID_HALF_D - LID_ROUND);
  const inset = over <= 0 ? 0 : LID_ROUND - Math.sqrt(Math.max(0, LID_ROUND ** 2 - over ** 2));
  return { z, inset };
}

function domeGeometry(uFrom: number, uTo: number, lift = 0, uSegments = 20, vSegments = 30): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const depth = lidDepth;
  const inward = archInward;

  for (let i = 0; i <= uSegments; i += 1) {
    const u = uFrom + (uTo - uFrom) * (i / uSegments);
    const { x, y } = arch(u);
    const { nx, ny } = inward(u);
    for (let j = 0; j <= vSegments; j += 1) {
      const { z, inset } = depth(j / vSegments);
      const offset = inset - lift;
      positions.push(x + nx * offset, y + ny * offset, z);
    }
  }
  for (let i = 0; i < uSegments; i += 1) {
    for (let j = 0; j < vSegments; j += 1) {
      const a = i * (vSegments + 1) + j;
      const b = a + vSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The disc that closes off one end of that swept surface. Without it the lid
 * is a shell one face thick with a hole straight through it, and the camera —
 * looking at the front of a closed chest — sees the dark scene through the
 * arch instead of wood.
 *
 * The outline is the profile inset by `LID_ROUND`, which is exactly where the
 * swept surface has got to by the time it reaches the end, so the two meet
 * with no seam. Fanned from a point inside the arch rather than triangulated
 * properly: the outline is convex, so a fan is the whole answer.
 */
function domeCapGeometry(atFront: boolean, segments = 40): THREE.BufferGeometry {
  const z = atFront ? LID_HALF_D : -LID_HALF_D;
  const positions: number[] = [0, LID_H * 0.34, z];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const { x, y } = arch(u);
    const { nx, ny } = archInward(u);
    positions.push(x + nx * LID_ROUND, y + ny * LID_ROUND, z);
    if (i > 0) indices.push(0, i, i + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The soft glow at the mouth — the bright point the rays come out of, and the
 * only part of the effect that sits in FRONT of the chest.
 *
 * A radial-gradient texture on one quad rather than rings of geometry: a fan of
 * triangles interpolating vertex colours shows its own seams as faint spokes
 * (visibly so, additively blended over a dark background), and no amount of
 * extra rings hides them. A 128px gradient is smooth by construction, costs
 * one small texture, and is generated here rather than shipped as an asset.
 */
function buildGlowSprite(size = 128): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,248,222,1)");
  gradient.addColorStop(0.22, "rgba(255,226,160,0.72)");
  gradient.addColorStop(0.55, "rgba(226,150,70,0.22)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 1.9),
    new THREE.MeshBasicMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
}

/**
 * The blue shield lock, extruded from its own outline: flat top, straight
 * sides, and a bottom that sweeps to a rounded point — the blueprint's shape,
 * which no combination of boxes gets right. Kept on the BODY rather than the
 * lid, so it stays put while the lid swings away from it: that is what makes
 * the chest read as unlocked rather than as one solid piece hinging.
 */
function buildLock(): THREE.Group {
  const group = new THREE.Group();

  const w = 0.23;
  const shape = new THREE.Shape();
  shape.moveTo(-w, 0.26);
  shape.lineTo(w, 0.26);
  shape.lineTo(w, -0.08);
  shape.quadraticCurveTo(w, -0.3, 0, -0.34);
  shape.quadraticCurveTo(-w, -0.3, -w, -0.08);
  shape.closePath();

  const shield = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false }),
    [flat(LOCK_BLUE), flat(LOCK_BLUE_DARK)],
  );
  group.add(shield);

  // The keyhole: a round bore over a tapering slot, standing just off the
  // shield's face so it reads as cut into it.
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 16), flat(KEYHOLE));
  bore.rotation.x = Math.PI / 2;
  bore.position.set(0, 0.09, 0.11);
  group.add(bore);

  const slot = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.055, 0.15, 12), flat(KEYHOLE));
  slot.rotation.x = Math.PI / 2;
  slot.rotation.z = Math.PI;
  slot.position.set(0, -0.02, 0.11);
  group.add(slot);

  return group;
}

/**
 * One Blue Emerald, cut the way `public/icons/BlueEmeraldIcon.png` draws it:
 * an eight-sided emerald cut with a flat table on top, a short crown flaring
 * out to the girdle, and a long pavilion tapering to a point. Four shades,
 * lightest on the table and darkest at the keel, so an unlit stone still
 * reads as faceted while it tumbles.
 */
function buildEmerald(): THREE.Group {
  const gem = new THREE.Group();

  /** The eight corners of an emerald cut, width `w` by height `h`, with the
   * four corners cut back by `cut`. Wound counter-clockwise from the top-right
   * flat, in the XY plane. */
  const outline = (w: number, h: number, cut: number) => {
    const x = w / 2;
    const y = h / 2;
    return [
      [x - cut, y],
      [x, y - cut],
      [x, -(y - cut)],
      [x - cut, -y],
      [-(x - cut), -y],
      [-x, -(y - cut)],
      [-x, y - cut],
      [-(x - cut), y],
    ] as Array<[number, number]>;
  };

  const girdle = outline(GEM_W, GEM_H, GEM_CUT);
  const face = outline(GEM_W - GEM_BEVEL * 2, GEM_H - GEM_BEVEL * 2, GEM_CUT);

  const positions: number[] = [];
  const colors: number[] = [];

  // The light every facet is shaded against — up, to the left, and toward the
  // camera, which is where the icon's own highlight sits. Baked in at build
  // time: the scene has no lights, so this IS the shading.
  const light = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();
  const dark = new THREE.Color(0x0d55b4);
  const mid = new THREE.Color(0x2e94ef);
  const bright = new THREE.Color(0x9adcff);
  const shade = new THREE.Color();

  /** One flat triangle, shaded by where its own face points. */
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tint?: THREE.Color) => {
    if (tint) {
      shade.copy(tint);
    } else {
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      // Two-stop ramp through the mid blue rather than one dark-to-bright
      // lerp: a single stop washes the lit facets out to near-white and
      // crushes the rest to one flat navy.
      const lit = Math.max(0, normal.dot(light));
      shade.copy(lit < 0.5 ? dark.clone().lerp(mid, lit * 2) : mid.clone().lerp(bright, (lit - 0.5) * 2));
    }
    for (const point of [a, b, c]) {
      positions.push(point.x, point.y, point.z);
      colors.push(shade.r, shade.g, shade.b);
    }
  };

  const at = (ring: Array<[number, number]>, index: number, z: number) =>
    new THREE.Vector3(ring[index % 8][0], ring[index % 8][1], z);

  const halfD = GEM_D / 2;
  const tableFront = new THREE.Color(0x4aa9f6);
  const tableBack = new THREE.Color(0x1a6fd6);

  for (const front of [true, false]) {
    const z = front ? halfD : -halfD;
    const centre = new THREE.Vector3(0, 0, z);
    const tint = front ? tableFront : tableBack;
    for (let i = 0; i < 8; i += 1) {
      // The flat table, fanned from the middle.
      const p = at(face, i, z);
      const q = at(face, i + 1, z);
      triangle(centre, front ? p : q, front ? q : p, tint);

      // And the chamfer from the girdle out at the widest point, back to that
      // table — the ring of facets the front view draws around its middle.
      const g = at(girdle, i, 0);
      const gNext = at(girdle, i + 1, 0);
      if (front) {
        triangle(g, gNext, q);
        triangle(g, q, p);
      } else {
        triangle(gNext, g, p);
        triangle(gNext, p, q);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  gem.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true })));

  // A thin dark outline standing just off the girdle, which is what gives the
  // icon its crisp edge — and, on a stone this small, what keeps two of them
  // overlapping on the ground from merging into one blue blob.
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i += 1) rim.push(at(girdle, i, 0));
  gem.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(rim),
      new THREE.LineBasicMaterial({ color: 0x0b4ea8 }),
    ),
  );

  return gem;
}

/**
 * The shaft of light that fires out of the open lid — the radial sunburst from
/**
 * The shaft of light that comes up out of the open chest — a cone, and a still
 * one: it fades and grows in behind the lid as the lid swings, then holds
 * exactly where it is. Nothing about it turns or pulses afterwards.
 *
 * A FLAT mesh with a cone silhouette, not a real 3D cone. A cone solid of this
 * width spans well over a unit in Z, so its near half would poke out in front
 * of the chest's front wall — and the whole point of where this sits is that
 * the front wall cuts the bottom off, so the light reads as welling up from
 * inside. A flat billboard at one fixed Z can be placed between the raised lid
 * and that wall exactly; a volume cannot.
 *
 * The falloff is carried in VERTEX COLOURS rather than a texture: additive
 * blending makes black transparent, so the far end of the cone fading to black
 * IS its fade-out, with no image asset involved. Across the cone the ramp only
 * goes down to `CONE_EDGE`, never to zero — a soft-edged cone stops reading as
 * a cone, and a defined edge is the shape being asked for.
 */
function buildLightCone(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Cream at the mouth through warm amber to nothing at the far end. The amber
  // stop is dark on purpose: this plane is nearer the camera than the lid, so
  // whatever it carries is added straight onto that wood, and a bright wide
  // middle turns the lid into frosted glass instead of catching light.
  // Front-loaded: most of the brightness is spent in the first quarter, and
  // the rest of the cone is nearly gone by halfway. An evenly spaced ramp
  // leaves a broad brown wedge hanging over the top of the frame, which reads
  // as a painted shape rather than as light falling off.
  const stops: Array<[number, THREE.Color]> = [
    [0, new THREE.Color(0xffeeb0)],
    [0.22, new THREE.Color(0xb07128)],
    [0.55, new THREE.Color(0x40260e)],
    [1, new THREE.Color(0x000000)],
  ];
  const across = 16;

  for (const [at, shade] of stops) {
    const distance = at * CONE_REACH;
    for (let i = 0; i <= across; i += 1) {
      const side = (i / across) * 2 - 1;
      const angle = side * CONE_SPREAD;
      // Measured off straight up, so the cone opens upward out of the mouth.
      positions.push(Math.sin(angle) * distance, Math.cos(angle) * distance, 0);
      const fade = CONE_EDGE + (1 - CONE_EDGE) * Math.pow(Math.cos(side * (Math.PI / 2)), 1.3);
      colors.push(shade.r * fade, shade.g * fade, shade.b * fade);
    }
  }
  for (let ring = 0; ring < stops.length - 1; ring += 1) {
    for (let i = 0; i < across; i += 1) {
      const a = ring * (across + 1) + i;
      const b = a + across + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);

  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Reads the depth buffer — that is what lets the chest's front wall cut
      // the bottom of the cone off — but never writes to it, or the stones
      // flying through would clip against a sheet of light.
      depthWrite: false,
      side: THREE.DoubleSide,
      /**
       * Additive on COLOUR, but the alpha channel left alone. Plain
       * `AdditiveBlending` adds both, and the canvas is transparent where
       * nothing is drawn: the cone's faded-to-black far end was contributing no
       * colour but a full `opacity` of alpha, which turned the canvas OPAQUE
       * BLACK there and painted a dark wedge over the screen's own backdrop —
       * the one thing additive blending is supposed to be incapable of.
       *
       * Holding `dstAlpha` means the premultiplied canvas composites as
       * `added colour + backdrop`, which is what additive was meant to be.
       */
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    }),
  );
}


/** The blob of shade a thing sitting on the ground casts. Flat, unlit, and
 * laid in the ground plane — the only thing that tells the eye there IS a
 * ground for the stones to land on. */
function buildGroundShadow(radius: number, opacity: number): THREE.Mesh {
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), flat(0x000000, opacity));
  shadow.rotation.x = -Math.PI / 2;
  return shadow;
}

type Gem = {
  group: THREE.Group;
  shadow: THREE.Mesh;
  velocity: THREE.Vector3;
  /** Angular velocity while it tumbles, in world axes, radians per second. */
  spin: THREE.Vector3;
  /**
   * The pose it comes to rest in: face down on the floor, turned to its own
   * yaw and leaning a degree or two off flat. A quaternion, not an Euler —
   * "lay this face down AND spin it in the floor plane" is two rotations about
   * two different axes, which Euler angles only compose correctly in one
   * particular order, and the tumble that runs before it would have to agree
   * on that order too.
   */
  restPose: THREE.Quaternion;
  resting: boolean;
};

// Scratch objects for the per-frame tumble, so eight stones turning every
// frame do not allocate a quaternion each.
const TUMBLE = new THREE.Quaternion();
const TUMBLE_AXIS = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_X = new THREE.Vector3(1, 0, 0);

/**
 * A pose for a stone lying flat on the floor: face down (either face, picked
 * at random), turned to any yaw, and leaning a degree or two off true so eight
 * of them do not read as decals stamped on the ground.
 *
 * Composed outward from the stone: lay the face down first, then yaw it in the
 * floor plane, then tip the whole thing slightly. The stone's own geometry is
 * an octagon in its XY plane with its thickness along Z, so "face down" is a
 * quarter turn about X.
 */
function flatOnFloor(random: () => number): THREE.Quaternion {
  const faceUp = random() < 0.5 ? -Math.PI / 2 : Math.PI / 2;
  const pose = new THREE.Quaternion()
    .setFromAxisAngle(WORLD_UP, random() * Math.PI * 2)
    .multiply(new THREE.Quaternion().setFromAxisAngle(WORLD_X, faceUp));
  TUMBLE_AXIS.set(random() * 2 - 1, 0, random() * 2 - 1).normalize();
  return pose.premultiply(new THREE.Quaternion().setFromAxisAngle(TUMBLE_AXIS, (random() - 0.5) * 0.22));
}

/**
 * A tiny seeded generator, so one chest's throw is a spread rather than eight
 * stones on the same arc, and re-opening gives a different spread — without
 * `Math.random()` making the animation impossible to reason about frame to
 * frame (every value is drawn once, at launch).
 */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * The whole reward stage, phase-driven. The engine owns one of these and does
 * nothing but hand it phases and elapsed time — every piece of "what does the
 * chest do when it opens" lives here.
 *
 * `root` is planted ON the ground: y=0 in stage space is the surface the chest
 * stands on and the stones land on. The chest itself is a child that bobs, so
 * that bob never drags the ground out from under a resting stone.
 */
export class ChestStage {
  readonly root = new THREE.Group();

  private readonly chest = new THREE.Group();
  private readonly lid = new THREE.Group();
  private readonly burst = new THREE.Group();
  // Typed to their own material, not `Material | Material[]`, so the per-frame
  // opacity ramp in `updateBurst` does not need a cast every time it runs.
  private readonly rays: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly gems: Gem[] = [];
  /** Height of the lid's hinge line — where the mouth is, and where the light
   * and the stones come from. */
  private readonly mouthY = BODY_H + 0.1;

  private phase: ChestPhase | null = null;
  private time = 0;
  private opens = 0;

  constructor() {
    this.root.add(this.chest);
    this.buildBody();
    this.buildLid();

    // No disc standing in for the floor — just the shade the chest casts on
    // it. The surface is implied by the shadows and by where things come to
    // rest, which is enough: a literal oval under everything read as a plinth
    // the chest was standing on rather than as ground.
    this.root.add(buildGroundShadow(BODY_W * 0.62, 0.34));

    // Both pieces sit on the same plane — see `CONE_Z` for why that plane is
    // where it is. The cone's apex is set BELOW the mouth line so its point is
    // one of the parts the front wall hides: light with a visible starting
    // point reads as a decal, light coming from somewhere out of sight does
    // not.
    this.rays = buildLightCone();
    this.rays.position.set(0, this.mouthY - 0.3, CONE_Z);
    this.core = buildGlowSprite();
    this.core.position.set(0, this.mouthY + 0.02, CONE_Z);
    this.burst.add(this.rays, this.core);
    this.burst.visible = false;
    this.root.add(this.burst);

    for (let i = 0; i < GEM_COUNT; i += 1) {
      const group = buildEmerald();
      group.visible = false;
      const shadow = buildGroundShadow(GEM_W * 0.56, 0.32);
      shadow.visible = false;
      this.root.add(group, shadow);
      this.gems.push({
        group,
        shadow,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        restPose: new THREE.Quaternion(),
        resting: false,
      });
    }

    this.root.visible = false;
  }

  // ---- construction --------------------------------------------------------

  private buildBody() {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D),
      boxShades(WOOD_BODY, WOOD_BODY_SIDE, WOOD_BODY_SEAM),
    );
    body.position.y = BODY_H / 2;
    this.chest.add(body);

    // The blueprint rules three plank lines across the body; two of them read
    // at this size. Thin dark slabs standing a hair proud of the face rather
    // than a texture, since the whole scene is untextured flat colour.
    for (const y of [BODY_H * 0.36, BODY_H * 0.68]) {
      const seam = new THREE.Mesh(
        new THREE.BoxGeometry(BODY_W * 1.004, 0.035, BODY_D * 1.004),
        flat(WOOD_BODY_SEAM),
      );
      seam.position.y = y;
      this.chest.add(seam);
    }

    // The band on the lid/body seam — the blueprint's thickest gold line, and
    // the thing that reads as the chest's rim.
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(BODY_W * 1.03, RIM_H, BODY_D * 1.03),
      boxShades(GOLD, GOLD_DARK, GOLD),
    );
    rim.position.y = BODY_H - RIM_H / 2 + 0.02;
    this.chest.add(rim);

    // And the one at the base, which the front and side views both show.
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(BODY_W * 1.03, 0.125, BODY_D * 1.03),
      boxShades(GOLD, GOLD_DARK, GOLD),
    );
    base.position.y = 0.0625;
    this.chest.add(base);

    // A post up all four vertical corners, with a stud at the two heights the
    // front view puts them. The top view confirms all four corners are capped,
    // not just the two the front view can show.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.15, BODY_H, 0.15),
          boxShades(GOLD, GOLD_DARK, GOLD),
        );
        post.position.set((sx * (BODY_W - 0.12)) / 2, BODY_H / 2, (sz * (BODY_D - 0.12)) / 2);
        this.chest.add(post);

        for (const y of [BODY_H * 0.76, BODY_H * 0.2]) {
          const stud = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 8), flat(STUD));
          stud.position.set(post.position.x * 1.03, y, post.position.z * 1.03);
          this.chest.add(stud);
        }
      }
    }

    const lock = buildLock();
    lock.position.set(0, BODY_H, BODY_D / 2 + 0.01);
    this.chest.add(lock);
  }

  /**
   * The gold and the plank lines on ONE END of the lid — the arch face the
   * camera looks straight at when the chest is closed.
   *
   * They cannot come out of `domeGeometry` the way the ones over the top do:
   * that surface is the sweep between the two ends, and each end is a flat cap
   * (`domeCapGeometry`) it never reaches. So the same straps continue here as
   * flat strips laid on the cap — vertical at each strap's own x, which is
   * where the blueprint's front view draws them, and horizontal for the plank
   * lines it rules across.
   */
  private buildLidCapDetail(atFront: boolean) {
    const sign = atFront ? 1 : -1;
    const z = BODY_D / 2 + sign * (LID_HALF_D + 0.012);

    /** The cap's own outline at `u` — the arch inset by the rounding radius. */
    const outline = (u: number) => {
      const { x, y } = arch(u);
      const { nx, ny } = archInward(u);
      return { x: x + nx * LID_ROUND, y: y + ny * LID_ROUND };
    };

    for (const [from, to] of LID_STRAPS) {
      const a = outline(from);
      const b = outline(to);
      const width = Math.abs(b.x - a.x) + 0.02;
      // The shorter of the two ends, so a strap on the curve stays inside the
      // outline rather than poking through the top of it.
      const height = Math.max(0.04, Math.min(a.y, b.y));
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(width, height), flatShell(GOLD));
      strip.position.set((a.x + b.x) / 2, height / 2, z);
      this.lid.add(strip);
    }

    // One plank line per PAIR of seam bands — the two in a pair are the same
    // height either side of the top, so they are one line, and on a flat cap
    // that line is a single strip spanning the outline's width there.
    for (const [from, to] of LID_SEAMS.slice(0, LID_SEAMS.length / 2)) {
      const at = outline((from + to) / 2);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(at.x) * 2, 0.035), flatShell(WOOD_LID_SEAM));
      line.position.set(0, at.y, z - sign * 0.004);
      this.lid.add(line);
    }
  }

  private buildLid() {
    this.lid.position.set(0, BODY_H, HINGE_Z);
    this.chest.add(this.lid);

    // The wood, then the seams on top of it, then the gold over both — three
    // passes of the same surface at increasing scale, so each sits proud of
    // the one under it instead of z-fighting with it.
    const wood = flatShell(WOOD_LID);
    const shell = new THREE.Mesh(domeGeometry(0, 1), wood);
    shell.position.z = BODY_D / 2;
    this.lid.add(shell);

    for (const atFront of [true, false]) {
      const cap = new THREE.Mesh(domeCapGeometry(atFront), wood);
      cap.position.z = BODY_D / 2;
      this.lid.add(cap);
    }

    for (const [from, to] of LID_SEAMS) {
      const seam = new THREE.Mesh(domeGeometry(from, to, 0.006, 3), flatShell(WOOD_LID_SEAM));
      seam.position.z = BODY_D / 2;
      this.lid.add(seam);
    }

    // The lid's underside, closing off the bottom of that shell. Two jobs: it
    // is what the camera actually looks at once the lid is open, and — tipped
    // back with the lid — it is what stops the ray burst BEHIND the chest from
    // showing through the gap between the rim and the raised lid, which reads
    // as stripes floating in the opening.
    const underside = new THREE.Mesh(
      new THREE.PlaneGeometry(BODY_W - LID_ROUND, BODY_D - LID_ROUND),
      flatShell(0x543822),
    );
    underside.rotation.x = -Math.PI / 2;
    underside.position.set(0, 0.004, BODY_D / 2);
    this.lid.add(underside);

    for (const atFront of [true, false]) this.buildLidCapDetail(atFront);

    for (const [from, to] of LID_STRAPS) {
      const strap = new THREE.Mesh(domeGeometry(from, to, 0.02, 6), flatShell(GOLD));
      strap.position.z = BODY_D / 2;
      this.lid.add(strap);
    }
  }

  // ---- phases --------------------------------------------------------------

  /** Spin: three full turns, eased so it is quick out of the gate and settles
   * rather than stopping dead, landing on a whole number of turns so the chest
   * faces camera at the end with nothing left to correct. */
  private static readonly SPIN_TURNS = 3;
  static readonly SPIN_SECONDS = 1.5;
  /** How far the lid swings, and how long it takes. Just past a right angle:
   * far enough to read as thrown open, not so far that it folds back over the
   * front of the chest and hides what is coming out of it. */
  private static readonly LID_OPEN = -1.02;
  static readonly LID_SECONDS = 0.55;

  /**
   * Re-entrant per phase: the reward screen hands this over on every phase
   * change and on every re-render, so a repeated call with the phase already
   * set must not restart anything.
   */
  setPhase(phase: ChestPhase | null) {
    if (this.phase === phase) return;
    const previous = this.phase;
    this.phase = phase;

    if (phase === null) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    /**
     * "opening" and "revealed" are two labels on ONE continuous beat: the lid
     * swings, the light comes up, the stones fly, and partway through all of
     * that the screen starts showing the amount. `updateLid`/`updateBurst`
     * drive the lid angle and the light's ramp off `time`, so restarting the
     * clock on that hand-off snapped the lid shut and replayed the whole
     * opening — the loop this used to have. Only a genuinely new beat
     * (arriving from off screen, or from the spin) restarts it.
     */
    const opening = phase !== "spinning";
    const wasOpening = previous === "opening" || previous === "revealed";
    if (opening && wasOpening) return;

    // Coming up already revealed — a re-render after the animation has been
    // and gone — starts the clock PAST the lid's own duration, so the chest is
    // simply open rather than opening again for nobody.
    this.time = phase === "revealed" ? ChestStage.LID_SECONDS : 0;

    const spinning = phase === "spinning";
    this.chest.rotation.y = spinning ? 0 : Math.PI * 2 * ChestStage.SPIN_TURNS;
    this.chest.scale.setScalar(spinning ? 0.86 : 1);
    this.chest.position.y = 0;
    this.lid.rotation.x = spinning ? 0 : ChestStage.LID_OPEN;
    this.burst.visible = !spinning;

    if (spinning) this.hideGems();
    else this.launchGems(phase === "revealed");
  }

  private hideGems() {
    for (const gem of this.gems) {
      gem.group.visible = false;
      gem.shadow.visible = false;
      gem.resting = false;
    }
  }

  /**
   * Throws the stones out of the mouth. Biased toward the camera so they land
   * in FRONT of the chest, where they can be seen, rather than behind it — and
   * spread across a fan so eight stones do not fly one arc.
   *
   * `settled` short-circuits the flight for a stage that came up already
   * revealed (a re-render after the fact): the stones are placed at rest
   * instead of being launched into an animation nobody was watching.
   */
  private launchGems(settled: boolean) {
    this.opens += 1;
    const random = seededRandom(0x9e3779b9 ^ (this.opens * 2654435761));

    this.gems.forEach((gem, index) => {
      gem.group.visible = true;
      gem.shadow.visible = true;
      gem.resting = false;
      // Where it ends up lying: flat on the floor on one face or the other, at
      // its own yaw, leaning a couple of degrees off. Drawn here, at launch,
      // rather than when it lands, so the one instant snap into it
      // (`updateGems`) picks a pose decided in advance, not one read off
      // whatever orientation the stone happened to be tumbling through that
      // frame.
      gem.restPose.copy(flatOnFloor(random));

      // Fanned across the front half only — a heading with `sin > 0` throws
      // the stone toward the camera, and one thrown the other way would land
      // behind the chest where the body hides it.
      const heading = Math.PI * (0.1 + 0.8 * ((index + 0.5) / GEM_COUNT));
      const reach = 1 + random() * 1.15;
      gem.group.position.set(random() * 0.3 - 0.15, this.mouthY, random() * 0.2 - 0.1);
      gem.velocity.set(Math.cos(heading) * reach, 3.3 + random() * 1.3, Math.sin(heading) * reach);
      gem.spin.set(random() * 8 - 4, random() * 8 - 4, random() * 8 - 4);

      if (settled) this.settleGem(gem);
    });
  }

  private settleGem(gem: Gem) {
    // Where it would have got to, without running the flight: the same fan,
    // laid out on the ground at the reach it was thrown with.
    const heading = Math.atan2(gem.velocity.z, gem.velocity.x);
    const reach = Math.hypot(gem.velocity.x, gem.velocity.z) * 0.42 + BODY_W * 0.4;
    gem.group.position.set(Math.cos(heading) * reach, GEM_REST_Y, Math.sin(heading) * reach);
    gem.velocity.set(0, 0, 0);
    gem.group.quaternion.copy(gem.restPose);
    gem.resting = true;
  }

  // ---- per-frame -----------------------------------------------------------

  update(deltaSeconds: number) {
    if (!this.phase) return;
    this.time += deltaSeconds;

    if (this.phase === "spinning") {
      const t = Math.min(1, this.time / ChestStage.SPIN_SECONDS);
      const eased = 1 - Math.pow(1 - t, 3);
      this.chest.rotation.y = eased * Math.PI * 2 * ChestStage.SPIN_TURNS;
      this.chest.scale.setScalar(0.86 + 0.14 * eased);
      return;
    }

    this.updateLid();
    this.updateBurst();
    this.updateGems(deltaSeconds);
  }

  private updateLid() {
    // Overshoots a touch on the way open, then holds.
    const t = Math.min(1, this.time / ChestStage.LID_SECONDS);
    const eased = t >= 1 ? 1 : 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 0.6);
    this.lid.rotation.x = ChestStage.LID_OPEN * Math.min(1.04, eased);
    // The chest itself does not move once it has settled: the light breathing
    // and the stones coming to rest are the only motion left on this screen,
    // and a chest bobbing under them reads as floating rather than as sitting
    // there open.
  }

  /**
   * The light's only animation: it grows and fades UP as the lid swings, then
   * holds still. `open` reaches 1 a little before the lid finishes and clamps
   * there, so nothing here moves for the rest of the screen — no turning, no
   * pulsing. A beam that keeps breathing pulls the eye off the number the
   * screen is actually there to show.
   */
  private updateBurst() {
    const open = Math.min(1, this.time / (ChestStage.LID_SECONDS * 0.8));
    this.rays.scale.setScalar(0.3 + 0.7 * open);
    this.rays.material.opacity = open * 0.75;
    this.core.scale.setScalar(0.45 + 0.55 * open);
    this.core.material.opacity = open * 0.5;
  }

  private updateGems(deltaSeconds: number) {
    for (const gem of this.gems) {
      if (!gem.group.visible) continue;

      if (!gem.resting) {
        gem.velocity.y += GRAVITY * deltaSeconds;
        gem.group.position.addScaledVector(gem.velocity, deltaSeconds);
        // Tumbling as a quaternion, not by adding to Euler angles: a stone
        // turning about all three axes at once gimbal-locks its way into a
        // wobble if the angles are integrated separately.
        const rate = gem.spin.length();
        if (rate > 1e-4) {
          TUMBLE_AXIS.copy(gem.spin).divideScalar(rate);
          TUMBLE.setFromAxisAngle(TUMBLE_AXIS, rate * deltaSeconds);
          gem.group.quaternion.premultiply(TUMBLE);
        }

        // Bounces off a contact height a bit above where it finally lies: a
        // stone mid-tumble is standing on a corner, and only once it has flopped
        // onto a face is it as low as `GEM_REST_Y`.
        if (gem.group.position.y <= GEM_LAND_Y && gem.velocity.y < 0) {
          if (Math.abs(gem.velocity.y) < GEM_SETTLE_SPEED) {
            // Comes to rest on the spot, in one step — no lingering
            // ease/slerp into its final height and pose afterward. That
            // extra settle used to keep nudging a stone that already read as
            // landed, which looked like it was quietly re-snapping into a
            // different "fixed" pose a beat after it had stopped (2026-09h
            // ask: "tôi muốn nó yên ở vị trí luôn chứ không tự nhiên snap").
            // The X/Z it lands at is wherever the bounce actually left it —
            // never recomputed — so this really is its rest position, not a
            // placeholder waiting for a later correction.
            gem.group.position.y = GEM_REST_Y;
            gem.group.quaternion.copy(gem.restPose);
            gem.velocity.set(0, 0, 0);
            gem.resting = true;
          } else {
            gem.group.position.y = GEM_LAND_Y;
            gem.velocity.y = -gem.velocity.y * GEM_BOUNCE;
            gem.velocity.x *= 0.7;
            gem.velocity.z *= 0.7;
            gem.spin.multiplyScalar(0.55);
          }
        }
      }

      // The shadow tracks the stone's ground position and shrinks with its
      // height, which is what sells the arc as happening above a floor.
      const height = Math.max(0, gem.group.position.y - GEM_REST_Y);
      const closeness = 1 / (1 + height * 0.9);
      gem.shadow.position.set(gem.group.position.x, 0.004, gem.group.position.z);
      gem.shadow.scale.setScalar(0.6 + 0.4 * closeness);
      (gem.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * closeness;
    }
  }

  /** Frees every geometry and material the stage owns — nothing here is shared
   * with anything else in the scene, the same contract `disposeCostumeParts`
   * (`costumes.ts`) works to. */
  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse((node) => {
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
