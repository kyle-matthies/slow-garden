import { hashString, seededRandom } from "./hash";

/**
 * Stable plant placement within a bed. A plant's slot depends only on its own
 * ID and the plants created before it, so planting a new thought never moves
 * an existing one. There is no automatic rearrangement.
 */
export type PlantSlot = {
  /** -0.5..0.5 across the bed's width. */
  u: number;
  /** 0 (back of the bed) .. 1 (front). */
  depth: number;
};

export type Placeable = {
  id: string;
  created_at: string;
  position_x?: number | null;
  position_y?: number | null;
};

const MIN_GAP = 0.11;
const ATTEMPTS = 14;

function distance(a: PlantSlot, b: PlantSlot) {
  // Depth is compressed, so neighbours across rows may sit closer.
  return Math.hypot(a.u - b.u, (a.depth - b.depth) * 0.55);
}

export function byCreation<T extends Placeable>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}

/**
 * Place every item (include archived ones so restored plants keep their slot).
 * A stored position wins when present: position_x is read as u in -0.5..0.5
 * and position_y as depth in 0..1.
 */
export function placePlants(
  items: readonly Placeable[],
): Map<string, PlantSlot> {
  const placed = new Map<string, PlantSlot>();
  for (const item of byCreation(items)) {
    if (
      typeof item.position_x === "number" &&
      typeof item.position_y === "number" &&
      Math.abs(item.position_x) <= 0.5 &&
      item.position_y >= 0 &&
      item.position_y <= 1
    ) {
      placed.set(item.id, { u: item.position_x, depth: item.position_y });
      continue;
    }
    const random = seededRandom(hashString(`slot:${item.id}`));
    let best: PlantSlot | null = null;
    let bestGap = -1;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const candidate = { u: random() - 0.5, depth: 0.08 + random() * 0.84 };
      let gap = Infinity;
      for (const other of placed.values())
        gap = Math.min(gap, distance(candidate, other));
      if (gap >= MIN_GAP) {
        best = candidate;
        break;
      }
      if (gap > bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
    placed.set(item.id, best!);
  }
  return placed;
}
