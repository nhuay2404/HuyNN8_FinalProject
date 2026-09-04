import * as THREE from "three";

/**
 * The reward chest, as a real 3D rig — the thing the reward screen spins,
 * settles and opens (`setChestShowcase` in `SandCannonEngine.ts`). Modelled
 * after `public/icons/ChestIcon.png`, the flat icon the home screen's own
 * reward-track button already wears: same proportions (a wide box under a
 * domed lid), same palette (two browns for the wood, a warm gold for the
 * straps and corner plates, a cornflower-blue lock shield with a near-black
 * keyhole), so the icon on the button and the model that opens read as the
 * same object.
 *
 * Its own file rather than more of `SandCannonEngine.ts` for the same reason
 * `costumes.ts` is: this is a prop the engine happens to be able to show, not
 * part of how the game plays. Nothing here touches gameplay geometry.
 *
 * Everything is `MeshBasicMaterial` — the engine's scene has no lights at all,
 * and every rig in this codebase is flat, unlit colour. The depth comes from
 * giving each face of a box its own shade instead, the way the icon draws its
 * own front and side faces: a lighter front, a darker pair of sides, a darker
 * top again. That reads as a solid object the moment it turns, without needing
 * a lighting model the rest of the scene does not have.
 */

// The icon's own palette, sampled from the artwork.
const WOOD_FRONT = 0xa5703f;
const WOOD_SIDE = 0x855a30;
const WOOD_DARK = 0x6d4423;
const LID_FRONT = 0x6f4a2c;
const LID_SIDE = 0x5b3c23;
const GOLD = 0xf3c34a;
const GOLD_DARK = 0xd9a52f;
const STUD = 0xffe08a;
const LOCK_BLUE = 0x4a7fe0;
const LOCK_BLUE_DARK = 0x3766c4;
const KEYHOLE = 0x1d2c4a;

// One chest, in world units. Wider than it is deep, the way the icon's is.
const BODY_W = 2.1;
const BODY_H = 1.02;
const BODY_D = 1.3;
/** The lid is a half-cylinder lying along the chest's depth, so the arc the
 * icon draws across the top is what the camera sees head-on at rest. */
const LID_R = BODY_W / 2;
/** Where the lid hinges: the back top edge of the body. */
const HINGE_Z = -BODY_D / 2;
/** The three gold straps, by their x offset — the icon's own spacing. */
const STRAP_X = [-BODY_W * 0.33, 0, BODY_W * 0.33];
const STRAP_W = 0.2;

export type ChestRig = {
  root: THREE.Group;
  /** Rotate this about X to open the lid — its origin is already the hinge. */
  lid: THREE.Group;
  /** The light inside, hidden until the lid lifts. */
  glow: THREE.Mesh;
};

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

export function buildChest(): ChestRig {
  const root = new THREE.Group();

  // ---- body ----------------------------------------------------------------
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D),
    boxShades(WOOD_FRONT, WOOD_SIDE, WOOD_DARK),
  );
  body.position.y = BODY_H / 2;
  root.add(body);

  // The plank seams the icon rules across the body — thin dark slabs standing
  // a hair proud of the face rather than a texture, since the whole scene is
  // untextured flat colour.
  for (const y of [BODY_H * 0.34, BODY_H * 0.66]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(BODY_W * 1.002, 0.035, BODY_D * 1.002), flat(WOOD_DARK));
    seam.position.y = y;
    root.add(seam);
  }

  // ---- lid -----------------------------------------------------------------
  // A group whose origin sits ON the hinge line, so opening it is one rotation
  // about X and nothing has to be re-offset per frame.
  const lid = new THREE.Group();
  lid.position.set(0, BODY_H, HINGE_Z);
  root.add(lid);

  // Half a cylinder lying along z. `rotation.x` of a quarter turn takes the
  // geometry's own +y axis onto +z, and the theta window (a half turn starting
  // at a quarter) is what leaves the TOP half rather than one of the sides —
  // worked out against three's own theta convention, which starts at the local
  // +z axis and sweeps toward +x.
  const dome = new THREE.Mesh(
    new THREE.CylinderGeometry(LID_R, LID_R, BODY_D, 30, 1, true, Math.PI / 2, Math.PI),
    flatShell(LID_FRONT),
  );
  dome.rotation.x = Math.PI / 2;
  dome.position.z = BODY_D / 2;
  lid.add(dome);

  // `openEnded` above leaves both ends of that tube bare, so each gets a half
  // disc — which is also the arc face the camera actually sees at rest.
  const frontCap = new THREE.Mesh(new THREE.CircleGeometry(LID_R, 30, 0, Math.PI), flatShell(LID_SIDE));
  frontCap.position.z = BODY_D;
  lid.add(frontCap);
  const backCap = new THREE.Mesh(new THREE.CircleGeometry(LID_R, 30, 0, Math.PI), flatShell(LID_SIDE));
  backCap.rotation.y = Math.PI;
  lid.add(backCap);

  // ---- gold straps ---------------------------------------------------------
  // Three straps running over the lid and straight down the body's front, the
  // way the icon lays them out. The lid half is a slab laid tangent to the
  // dome at that x — `atan2` is the tilt that puts its own up axis along the
  // dome's normal there, so the strap sits ON the curve rather than through it.
  for (const x of STRAP_X) {
    const surfaceY = Math.sqrt(LID_R * LID_R - x * x);
    const overLid = new THREE.Mesh(new THREE.BoxGeometry(STRAP_W, 0.07, BODY_D * 1.004), flat(GOLD));
    overLid.position.set(x, surfaceY - 0.02, BODY_D / 2);
    overLid.rotation.z = -Math.atan2(x, surfaceY);
    lid.add(overLid);

    const downBody = new THREE.Mesh(
      new THREE.BoxGeometry(STRAP_W, BODY_H, BODY_D * 1.008),
      boxShades(GOLD, GOLD_DARK, GOLD),
    );
    downBody.position.set(x, BODY_H / 2, 0);
    root.add(downBody);
  }

  // The band along the seam where lid meets body — the icon's thickest gold
  // line, and the thing that reads as the chest's rim.
  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(BODY_W * 1.02, 0.16, BODY_D * 1.02),
    boxShades(GOLD, GOLD_DARK, GOLD),
  );
  rim.position.y = BODY_H - 0.04;
  root.add(rim);

  // Corner plates with their own studs, at all four vertical edges. The icon
  // only draws the two it can see; this one turns, so it gets all four.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.3), boxShades(GOLD, GOLD_DARK, GOLD));
      plate.position.set((sx * BODY_W) / 2, BODY_H * 0.17, (sz * BODY_D) / 2);
      root.add(plate);

      const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 12), flat(STUD));
      stud.rotation.z = Math.PI / 2;
      stud.position.copy(plate.position);
      root.add(stud);
    }
  }

  // ---- lock ----------------------------------------------------------------
  // The blue shield on the front seam, keyhole and all. Part of the BODY, not
  // the lid: it stays put while the lid swings away from it, which is what
  // makes the chest read as unlocked rather than as one solid piece hinging.
  const shield = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.46, 0.12),
    boxShades(LOCK_BLUE, LOCK_BLUE_DARK, LOCK_BLUE),
  );
  shield.position.set(0, BODY_H * 0.74, BODY_D / 2 + 0.04);
  root.add(shield);

  const keyhole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 14), flat(KEYHOLE));
  keyhole.rotation.x = Math.PI / 2;
  keyhole.position.set(0, BODY_H * 0.79, BODY_D / 2 + 0.1);
  root.add(keyhole);

  const keyslot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.06), flat(KEYHOLE));
  keyslot.position.set(0, BODY_H * 0.7, BODY_D / 2 + 0.1);
  root.add(keyslot);

  // ---- the light inside ----------------------------------------------------
  // A flat disc standing in the mouth of the chest, hidden until the lid lifts
  // (the engine shows it) — the "there is something in here" beat, done as
  // unlit geometry because the scene has no lights to make a real one with.
  const glow = new THREE.Mesh(new THREE.CircleGeometry(BODY_W * 0.44, 30), flat(0xcdeaff, 0.95));
  glow.material.side = THREE.DoubleSide;
  glow.position.set(0, BODY_H + 0.01, 0);
  glow.rotation.x = -Math.PI / 2;
  glow.visible = false;
  root.add(glow);

  return { root, lid, glow };
}

/** Frees every geometry and material the rig owns — nothing here is shared
 * with anything else in the scene, the same contract `disposeCostumeParts`
 * (`costumes.ts`) works to. */
export function disposeChest(rig: ChestRig) {
  rig.root.parent?.remove(rig.root);
  rig.root.traverse((node) => {
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
