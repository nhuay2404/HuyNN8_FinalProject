// The conveyor under the picture: pure rules, no Three.js.
//
// Every shot that clears sand drops ONE pile onto a straight belt. The belt
// runs left to right and wraps (a pile leaving the right roller comes back on
// at the left), so a pile nobody wants just keeps circling. Below the belt sit
// a few colour boxes; a box sucks in a pile of its own colour the moment that
// pile passes over it, up to the box's capacity. A full box disappears and the
// next box in the queue takes its slot.
//
// Box capacities are carved out of the picture itself: every colour's total
// grain count is split into boxes of roughly `BOX_TARGET_FRACTION` of the
// whole picture, so the boxes add up to exactly the sand there is — the level
// is only won once every box is full, and it can never run short or over.
//
// Losing: the belt holds `capacity` piles. A shot that would put one more on
// it fails the level, and so does a full belt that nothing on it can ever
// leave (no pile matches any box on show).

import type { SandColor } from "./sand-types";

/** How many boxes are on show under the belt at once. */
export const CONVEYOR_SLOT_COUNT = 4;
/** Piles the belt holds before it jams — the "0/5" badge. */
export const CONVEYOR_BASE_CAPACITY = 5;
/** Gold per extra belt slot bought with the badge's "+" button. */
export const CONVEYOR_EXPAND_COST = 50;
/** Roughly how much of the whole picture one box holds. */
export const BOX_TARGET_FRACTION = 1 / 12;
/** Belt speed, in belt-lengths per second. */
export const CONVEYOR_SPEED = 0.2;

export type ConveyorBox = {
  id: number;
  color: SandColor;
  capacity: number;
  filled: number;
};

export type ConveyorPile = {
  id: number;
  color: SandColor;
  /** Grains still in the pile. */
  amount: number;
  /** Position along the belt, 0 (left roller) to 1 (right roller). */
  x: number;
};

export type ConveyorState = {
  capacity: number;
  piles: ConveyorPile[];
  /** One entry per slot under the belt; null once the queue has run dry. */
  slots: (ConveyorBox | null)[];
  /** Boxes still waiting for a free slot, in the order they will appear. */
  queue: ConveyorBox[];
  nextId: number;
};

export type ConveyorEvent =
  | { kind: "FILL"; slot: number; boxId: number; pileId: number; amount: number }
  | { kind: "BOX_FULL"; slot: number; box: ConveyorBox }
  | { kind: "BOX_ENTER"; slot: number; box: ConveyorBox };

/** Centre of slot `index`, as a 0-1 position along the belt. */
export function slotX(index: number, slotCount = CONVEYOR_SLOT_COUNT): number {
  return (index + 0.5) / slotCount;
}

/**
 * Split every colour's grain count into boxes and interleave them.
 *
 * Interleaving is a smooth weighted round-robin — each pick goes to whichever
 * colour is furthest behind its fair share — so a colour that fills a third
 * of the picture shows up in about a third of the queue, spread out rather
 * than bunched. Deterministic (no RNG): the same picture always gets the same
 * boxes in the same order. `order` breaks ties.
 */
export function planConveyorBoxes(
  counts: Partial<Record<SandColor, number>>,
  order: readonly SandColor[] = Object.keys(counts) as SandColor[],
): ConveyorBox[] {
  const colors = order.filter((color) => (counts[color] ?? 0) > 0);
  const total = colors.reduce((sum, color) => sum + (counts[color] ?? 0), 0);
  if (!total) return [];
  const target = Math.max(1, Math.round(total * BOX_TARGET_FRACTION));

  const sizes = new Map<SandColor, number[]>();
  for (const color of colors) {
    const count = counts[color] ?? 0;
    const boxes = Math.max(1, Math.round(count / target));
    const base = Math.floor(count / boxes);
    const extra = count - base * boxes;
    sizes.set(color, Array.from({ length: boxes }, (_, index) => base + (index < extra ? 1 : 0)));
  }

  const taken = new Map<SandColor, number>(colors.map((color) => [color, 0]));
  const plan: ConveyorBox[] = [];
  let id = 1;
  while (plan.length < [...sizes.values()].reduce((sum, list) => sum + list.length, 0)) {
    let best: SandColor | null = null;
    let bestScore = Infinity;
    for (const color of colors) {
      const list = sizes.get(color)!;
      const done = taken.get(color)!;
      if (done >= list.length) continue;
      const score = (done + 0.5) / list.length;
      if (score < bestScore) {
        best = color;
        bestScore = score;
      }
    }
    if (!best) break;
    const index = taken.get(best)!;
    plan.push({ id: id++, color: best, capacity: sizes.get(best)![index], filled: 0 });
    taken.set(best, index + 1);
  }
  return plan;
}

export function createConveyorState(
  counts: Partial<Record<SandColor, number>>,
  order?: readonly SandColor[],
  capacity = CONVEYOR_BASE_CAPACITY,
  slotCount = CONVEYOR_SLOT_COUNT,
): ConveyorState {
  const queue = planConveyorBoxes(counts, order);
  const slots = Array.from({ length: slotCount }, () => queue.shift() ?? null);
  const nextId = Math.max(0, ...slots.map((box) => box?.id ?? 0), ...queue.map((box) => box.id)) + 1;
  return { capacity, piles: [], slots, queue, nextId };
}

/**
 * Drop one pile per colour onto the belt at `x`. `overflow` is true when the
 * belt ends up holding more piles than it has room for — the caller fails
 * the level on that.
 */
export function addPiles(
  state: ConveyorState,
  amounts: Partial<Record<SandColor, number>>,
  x: number,
): { state: ConveyorState; overflow: boolean; added: ConveyorPile[] } {
  let nextId = state.nextId;
  const added: ConveyorPile[] = [];
  for (const [color, amount] of Object.entries(amounts) as [SandColor, number][]) {
    if (amount > 0) added.push({ id: nextId++, color, amount, x: clamp01(x) });
  }
  const piles = [...state.piles, ...added];
  return { state: { ...state, piles, nextId }, overflow: piles.length > state.capacity, added };
}

/**
 * Advance the belt by `seconds`. A pile crossing a slot's centre pours into
 * that slot's box if the colours match and the box has room; a pile emptied
 * that way leaves the belt, and a box filled that way leaves its slot for the
 * next one in the queue.
 */
export function stepConveyor(
  state: ConveyorState,
  seconds: number,
  speed = CONVEYOR_SPEED,
): { state: ConveyorState; events: ConveyorEvent[] } {
  if (!state.piles.length || seconds <= 0) return { state, events: [] };
  const events: ConveyorEvent[] = [];
  const slots = [...state.slots];
  const queue = [...state.queue];
  const travel = speed * seconds;
  const piles: ConveyorPile[] = [];

  for (const original of state.piles) {
    const pile = { ...original };
    const from = pile.x;
    const to = from + travel;
    // Every slot centre this pile crossed this tick, in the order it met them.
    // A pile can wrap past the right roller mid-step.
    const crossed: { at: number; index: number }[] = [];
    for (let lap = 0; lap <= Math.floor(to); lap++) {
      for (let index = 0; index < slots.length; index++) {
        const at = slotX(index, slots.length) + lap;
        if (at > from && at <= to) crossed.push({ at, index });
      }
    }
    crossed.sort((a, b) => a.at - b.at);
    for (const { index } of crossed) {
      if (pile.amount <= 0) break;
      const box = slots[index];
      if (!box || box.color !== pile.color) continue;
      const pour = Math.min(pile.amount, box.capacity - box.filled);
      if (pour <= 0) continue;
      const filledBox = { ...box, filled: box.filled + pour };
      pile.amount -= pour;
      events.push({ kind: "FILL", slot: index, boxId: box.id, pileId: pile.id, amount: pour });
      if (filledBox.filled >= filledBox.capacity) {
        events.push({ kind: "BOX_FULL", slot: index, box: filledBox });
        const next = queue.shift() ?? null;
        slots[index] = next;
        if (next) events.push({ kind: "BOX_ENTER", slot: index, box: next });
      } else {
        slots[index] = filledBox;
      }
    }
    pile.x = to - Math.floor(to);
    if (pile.amount > 0) piles.push(pile);
  }
  return { state: { ...state, piles, slots, queue }, events };
}

/** Nothing left on the belt. */
export function isConveyorDrained(state: ConveyorState): boolean {
  return state.piles.length === 0;
}

/** Every box has been filled and cleared away. */
export function isConveyorComplete(state: ConveyorState): boolean {
  return state.queue.length === 0 && state.slots.every((box) => box === null) && state.piles.length === 0;
}

/** Could any pile on the belt still pour into a box on show? */
export function conveyorCanProgress(state: ConveyorState): boolean {
  return state.piles.some((pile) =>
    state.slots.some((box) => box && box.color === pile.color && box.filled < box.capacity));
}

/** A full belt that nothing on it can ever leave — the level is lost. */
export function isConveyorJammed(state: ConveyorState): boolean {
  return state.piles.length >= state.capacity && !conveyorCanProgress(state);
}

/** No room for another pile right now — firing waits. */
export function isConveyorFull(state: ConveyorState): boolean {
  return state.piles.length >= state.capacity;
}

export function expandConveyor(state: ConveyorState, extra = 1): ConveyorState {
  return { ...state, capacity: state.capacity + extra };
}

function clamp01(value: number) {
  return Math.min(0.999, Math.max(0, value));
}
