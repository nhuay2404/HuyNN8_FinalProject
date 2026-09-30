// Three.js side of the conveyor (rules live in sand-conveyor.ts): the belt
// under the picture, the sand piles riding it, and the colour boxes below.
//
// Owns no game state. `sync` is handed the latest `ConveyorState` plus the
// events the last `stepConveyor` produced, and animates towards it: piles
// slide to where the rules put them, a pour throws a short stream of grains
// down into its box, a full box pops and shrinks away, and the box that takes
// its slot rises in behind it.
//
// Local space: the root sits at the centre of the belt's top surface; +x runs
// along the belt the way it moves, boxes hang below it at -y.

import * as THREE from "three";
import {
  CONVEYOR_SPEED,
  slotX,
  type ConveyorBox,
  type ConveyorEvent,
  type ConveyorState,
} from "./sand-conveyor";
import type { SandColor } from "./sand-types";

const BELT_DEPTH = 0.5;
const ROLLER_RADIUS = 0.17;
const SLAT_GAP = 0.15;
const GRAIN_SIZE = 0.085;
/** Where the boxes' own centres hang, below the belt top — low enough that
 * the "n/5 +" badge (`badgeAnchorWorld`) fits between belt and boxes. */
export const CONVEYOR_BOX_Y = -1.12;
const BOX_HEIGHT = 0.5;
const BOX_DEPTH = 0.46;
/** How far below the belt top the whole rig reaches — the fit uses this. */
export const CONVEYOR_BAND_HEIGHT = -CONVEYOR_BOX_Y + BOX_HEIGHT / 2 + 0.05;
const POUR_SECONDS = 0.38;
const POUR_GRAINS = 6;
const DROP_SECONDS = 0.28;
const VANISH_SECONDS = 0.45;
const ENTER_SECONDS = 0.35;
/** How long a shot's loosened grains take to fly from the picture down onto
 * the belt — the engine flies them, and a fresh pile waits this long. */
export const SAND_TRAVEL_SECONDS = 0.45;
/** Brightness multipliers a pile's grains pick from at random. */
const PILE_SHADES = [0.82, 0.92, 1, 1.08];
type PileVisual = { group: THREE.Group; grains: THREE.Mesh[]; drop: number; amount: number };
type BoxVisual = {
  box: ConveyorBox;
  slot: number;
  group: THREE.Group;
  fill: THREE.Mesh;
  label: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; shown: number };
  shownFill: number;
  /** 0 → 1 while rising in; null once settled. */
  enter: number | null;
  /** 0 → 1 while popping away; null while alive. */
  vanish: number | null;
};
type PourGrain = { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; boxId: number; amount: number };

export class ConveyorView {
  readonly root = new THREE.Group();
  private readonly length: number;
  private readonly colorHex: (color: SandColor) => number;
  private readonly disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private readonly grainGeometry: THREE.BoxGeometry;
  private readonly materials = new Map<SandColor, THREE.MeshLambertMaterial>();
  private readonly shades = new Map<string, THREE.MeshLambertMaterial>();
  private readonly slats: THREE.Mesh[] = [];
  private readonly piles = new Map<number, PileVisual>();
  private readonly boxes = new Map<number, BoxVisual>();
  private pours: PourGrain[] = [];  /** Grains already on their way into a box but not landed — the box's shown
   * fill waits on them so it rises when the sand arrives, not before. */
  private readonly inFlight = new Map<number, number>();

  constructor(length: number, colorHex: (color: SandColor) => number) {
    this.length = length;
    this.colorHex = colorHex;
    this.grainGeometry = this.track(new THREE.BoxGeometry(GRAIN_SIZE, GRAIN_SIZE, GRAIN_SIZE));
    this.buildBelt();
  }

  private track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private material(color: SandColor) {
    let material = this.materials.get(color);
    if (!material) {
      material = this.track(new THREE.MeshLambertMaterial({ color: this.colorHex(color) }));
      this.materials.set(color, material);
    }
    return material;
  }

  private buildBelt() {
    const housing = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(this.length + 0.12, 0.24, BELT_DEPTH + 0.12)),
      this.track(new THREE.MeshLambertMaterial({ color: 0xc9ccd8 })),
    );
    housing.position.y = -0.15;
    const bed = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(this.length, 0.03, BELT_DEPTH)),
      this.track(new THREE.MeshLambertMaterial({ color: 0x4d5170 })),
    );
    bed.position.y = -0.02;
    this.root.add(housing, bed);

    const rollerGeometry = this.track(new THREE.CylinderGeometry(ROLLER_RADIUS, ROLLER_RADIUS, BELT_DEPTH + 0.16, 20));
    const hubGeometry = this.track(new THREE.CylinderGeometry(ROLLER_RADIUS * 0.45, ROLLER_RADIUS * 0.45, BELT_DEPTH + 0.18, 12));
    const rollerMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0xe4e6ee }));
    const hubMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0x9aa0b4 }));
    for (const side of [-1, 1]) {
      for (const [geometry, material] of [[rollerGeometry, rollerMaterial], [hubGeometry, hubMaterial]] as const) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(side * (this.length / 2 + 0.04), -ROLLER_RADIUS + 0.06, 0);
        this.root.add(mesh);
      }
    }

    const slatGeometry = this.track(new THREE.BoxGeometry(0.05, 0.02, BELT_DEPTH - 0.04));
    const slatMaterial = this.track(new THREE.MeshLambertMaterial({ color: 0x777ba0 }));
    const count = Math.round(this.length / SLAT_GAP);
    for (let i = 0; i < count; i++) {
      const slat = new THREE.Mesh(slatGeometry, slatMaterial);
      slat.userData.u = i / count;
      slat.position.y = 0.005;
      this.slats.push(slat);
      this.root.add(slat);
    }
  }

  /** Belt position (0-1) to local x. */
  private beltX(u: number) {
    return -this.length / 2 + u * this.length;
  }

  private slotPosition(slot: number, slotCount: number) {
    return new THREE.Vector3(this.beltX(slotX(slot, slotCount)), CONVEYOR_BOX_Y, 0.08);
  }

  /** Where a pile at belt position `u` sits, in world space — for the engine
   * to drop freshly shot sand onto. */
  worldPointOnBelt(u: number) {
    return this.root.localToWorld(new THREE.Vector3(this.beltX(u), 0, 0));
  }

  /** Bottom-centre of the belt housing, in world space — the "n/5" badge hangs here. */
  badgeAnchorWorld() {
    return this.root.localToWorld(new THREE.Vector3(0, -0.2, BELT_DEPTH / 2));
  }

  private buildBoxVisual(box: ConveyorBox, slot: number, slotCount: number, entering: boolean): BoxVisual {
    const width = (this.length / slotCount) * 0.8;
    const group = new THREE.Group();
    group.position.copy(this.slotPosition(slot, slotCount));
    const hex = this.colorHex(box.color);
    const shellGeometry = this.track(new THREE.BoxGeometry(width, BOX_HEIGHT, BOX_DEPTH));
    const shell = new THREE.Mesh(
      shellGeometry,
      this.track(new THREE.MeshLambertMaterial({ color: hex, transparent: true, opacity: 0.3, depthWrite: false })),
    );
    const edges = new THREE.LineSegments(
      this.track(new THREE.EdgesGeometry(shellGeometry)),
      this.track(new THREE.LineBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(0.7) })),
    );
    const fillGeometry = this.track(new THREE.BoxGeometry(width - 0.06, BOX_HEIGHT - 0.06, BOX_DEPTH - 0.06));
    fillGeometry.translate(0, (BOX_HEIGHT - 0.06) / 2, 0);
    const fill = new THREE.Mesh(fillGeometry, this.material(box.color));
    fill.position.y = -(BOX_HEIGHT - 0.06) / 2;
    fill.scale.y = 0.001;

    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const texture = this.track(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(width * 0.62, width * 0.31)),
      this.track(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })),
    );
    label.position.set(0, 0, BOX_DEPTH / 2 + 0.01);
    group.add(shell, fill, edges, label);
    group.renderOrder = 1;

    const visual: BoxVisual = {
      box,
      slot,
      group,
      fill,
      label: { canvas, texture, shown: -1 },
      shownFill: 0,
      // Waits out the box it replaces popping away before rising in.
      enter: entering ? -3 : null,
      vanish: null,
    };
    this.drawLabel(visual, 0);
    if (entering) group.scale.setScalar(0.001);
    this.root.add(group);
    return visual;
  }

  private drawLabel(visual: BoxVisual, fraction: number) {
    const pct = Math.round(fraction * 100);
    if (pct === visual.label.shown) return;
    visual.label.shown = pct;
    const context = visual.label.canvas.getContext("2d")!;
    context.clearRect(0, 0, 128, 64);
    context.fillStyle = "rgba(255,255,255,0.92)";
    context.beginPath();
    context.roundRect(4, 6, 120, 52, 18);
    context.fill();
    context.fillStyle = "#3a3450";
    context.font = "800 34px Nunito, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`${pct}%`, 64, 34);
    visual.label.texture.needsUpdate = true;
  }

  /** A lighter or darker take on a sand colour, so a pile's grains don't all
   * read as one flat block. Cached per (colour, shade). */
  private shadedMaterial(color: SandColor, shade: number) {
    const key = `${color}:${shade}`;
    let material = this.shades.get(key);
    if (!material) {
      const tint = new THREE.Color(this.colorHex(color)).multiplyScalar(PILE_SHADES[shade]);
      material = this.track(new THREE.MeshLambertMaterial({ color: tint }));
      this.shades.set(key, material);
    }
    return material;
  }

  private buildPileVisual(amount: number, color: SandColor): PileVisual {
    const group = new THREE.Group();
    const base = Math.sqrt(amount) * 0.9;
    const count = THREE.MathUtils.clamp(Math.round(base * (0.8 + Math.random() * 0.4)), 3, 16);
    // Every pile its own shape: lopsided in width and depth, a peak that
    // wanders off-centre, and a height that varies from pile to pile.
    const spreadX = 0.1 + Math.random() * 0.07;
    const spreadZ = 0.12 + Math.random() * 0.1;
    const peakX = (Math.random() - 0.5) * 0.06;
    const height = GRAIN_SIZE * (1.6 + Math.random() * 1.2);
    const grains: THREE.Mesh[] = [];
    for (let i = 0; i < count; i++) {
      const shade = Math.floor(Math.random() * PILE_SHADES.length);
      const grain = new THREE.Mesh(this.grainGeometry, this.shadedMaterial(color, shade));
      // Uniform over the footprint, then stacked higher the nearer the peak.
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random());
      const x = Math.cos(angle) * dist * spreadX;
      const z = Math.sin(angle) * dist * spreadZ;
      const nearPeak = 1 - Math.min(1, Math.hypot((x - peakX) / spreadX, z / spreadZ));
      const size = 0.7 + Math.random() * 0.6;
      grain.scale.setScalar(size);
      grain.position.set(x + peakX * nearPeak, (GRAIN_SIZE * size) / 2 + nearPeak * height * Math.random(), z);
      grain.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6);
      grains.push(grain);
      group.add(grain);
    }
    group.visible = false;
    this.root.add(group);
    // Starts below 0 so the pile waits for the engine's flying grains
    // (`SAND_TRAVEL_SECONDS`) to reach the belt before it drops in.
    return { group, grains, drop: -SAND_TRAVEL_SECONDS / DROP_SECONDS, amount };
  }

  /** Lay out the boxes for a fresh level, with no animation. */
  reset(state: ConveyorState) {
    for (const visual of this.boxes.values()) this.root.remove(visual.group);
    for (const pile of this.piles.values()) this.root.remove(pile.group);
    for (const pour of this.pours) this.root.remove(pour.mesh);
    this.boxes.clear();
    this.piles.clear();
    this.pours = [];
    this.inFlight.clear();
    state.slots.forEach((box, slot) => {
      if (box) this.boxes.set(box.id, this.buildBoxVisual(box, slot, state.slots.length, false));
    });
  }

  sync(state: ConveyorState, events: readonly ConveyorEvent[], seconds: number) {
    const slotCount = state.slots.length;
    for (const slat of this.slats) {
      slat.userData.u = (slat.userData.u + (CONVEYOR_SPEED * seconds)) % 1;
      slat.position.x = this.beltX(slat.userData.u);
    }

    for (const event of events) {
      if (event.kind === "FILL") {
        const visual = this.boxes.get(event.boxId);
        const pile = this.piles.get(event.pileId);
        if (!visual) continue;
        visual.box = { ...visual.box, filled: visual.box.filled + event.amount };
        this.inFlight.set(event.boxId, (this.inFlight.get(event.boxId) ?? 0) + event.amount);
        const from = pile ? pile.group.position.clone() : this.slotPosition(event.slot, slotCount).setY(0);
        const to = this.slotPosition(event.slot, slotCount).setY(CONVEYOR_BOX_Y + BOX_HEIGHT * 0.3);
        const material = this.material(visual.box.color);
        for (let i = 0; i < POUR_GRAINS; i++) {
          const mesh = new THREE.Mesh(this.grainGeometry, material);
          mesh.position.copy(from);
          this.root.add(mesh);
          this.pours.push({
            mesh,
            from: from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.05, (Math.random() - 0.5) * 0.2)),
            to: to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0, 0)),
            t: -i * 0.05,
            boxId: event.boxId,
            amount: i === POUR_GRAINS - 1 ? event.amount : 0,
          });
        }
      } else if (event.kind === "BOX_FULL") {
        const visual = this.boxes.get(event.box.id);
        if (visual) {
          visual.box = event.box;
          // Pops once the last of its sand has landed — see the pour loop below.
          visual.vanish = visual.vanish ?? -1;
        }
      } else if (event.kind === "BOX_ENTER") {
        this.boxes.set(event.box.id, this.buildBoxVisual(event.box, event.slot, slotCount, true));
      }
    }

    // Piles: follow the rules' positions, new ones drop in from above.
    const live = new Set(state.piles.map((pile) => pile.id));
    for (const [id, visual] of this.piles) {
      if (!live.has(id)) {
        this.root.remove(visual.group);
        this.piles.delete(id);
      }
    }
    for (const pile of state.piles) {
      let visual = this.piles.get(pile.id);
      if (!visual) {
        visual = this.buildPileVisual(pile.amount, pile.color);
        this.piles.set(pile.id, visual);
      }
      visual.drop = Math.min(1, visual.drop + seconds / DROP_SECONDS);
      visual.group.visible = visual.drop > 0;
      const edge = Math.min(pile.x, 1 - pile.x) * this.length;
      // Shrinks into the roller at the right end, grows back out of the left.
      const endScale = THREE.MathUtils.clamp(edge / 0.22, 0.05, 1);
      const shrink = THREE.MathUtils.clamp(Math.sqrt(pile.amount / Math.max(1, visual.amount)), 0.45, 1);
      visual.group.scale.setScalar(endScale * shrink);
      // Short drop: the grains already fell most of the way on their own.
      const fall = 1 - Math.max(0, visual.drop);
      visual.group.position.set(this.beltX(pile.x), fall * fall * 0.3, 0);
    }

    // Pours in flight.
    this.pours = this.pours.filter((pour) => {
      pour.t += seconds / POUR_SECONDS;
      const t = THREE.MathUtils.clamp(pour.t, 0, 1);
      pour.mesh.visible = pour.t > 0;
      pour.mesh.position.lerpVectors(pour.from, pour.to, t);
      pour.mesh.position.y += Math.sin(t * Math.PI) * 0.18;
      if (pour.t < 1) return true;
      this.root.remove(pour.mesh);
      if (pour.amount) this.inFlight.set(pour.boxId, (this.inFlight.get(pour.boxId) ?? 0) - pour.amount);
      return false;
    });

    // Boxes: fill level eases to what has landed, full ones pop, new ones rise.
    for (const [id, visual] of this.boxes) {
      const landed = visual.box.filled - Math.max(0, this.inFlight.get(id) ?? 0);
      const target = THREE.MathUtils.clamp(landed / visual.box.capacity, 0, 1);
      visual.shownFill += (target - visual.shownFill) * Math.min(1, seconds * 10);
      visual.fill.scale.y = Math.max(0.001, visual.shownFill);
      this.drawLabel(visual, target);

      if (visual.enter !== null) {
        visual.enter = Math.min(1, visual.enter + seconds / ENTER_SECONDS);
        const k = Math.max(0, visual.enter);
        const overshoot = 1 + Math.sin(k * Math.PI) * 0.12;
        visual.group.scale.setScalar(Math.max(0.001, k * overshoot));
        visual.group.position.y = CONVEYOR_BOX_Y - (1 - k) * 0.5;
        if (k >= 1) visual.enter = null;
      }
      if (visual.vanish !== null) {
        if (visual.vanish < 0) {
          if (target >= 1 && visual.shownFill > 0.97) visual.vanish = 0;
          continue;
        }
        visual.vanish = Math.min(1, visual.vanish + seconds / VANISH_SECONDS);
        const k = visual.vanish;
        visual.group.scale.setScalar(k < 0.3 ? 1 + k * 0.5 : Math.max(0.001, 1.15 * (1 - (k - 0.3) / 0.7)));
        visual.group.position.y = CONVEYOR_BOX_Y + k * 0.25;
        if (k >= 1) {
          this.root.remove(visual.group);
          this.boxes.delete(id);
        }
      }
    }
  }

  dispose() {
    for (const item of this.disposables) item.dispose();
  }
}
