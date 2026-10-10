import { describe, expect, it } from "vitest";
import { placePlants, type Placeable } from "./layout";

const seed = (i: number, extra: Partial<Placeable> = {}): Placeable => ({
  id: `seed-${i}`,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  ...extra,
});

describe("placePlants", () => {
  it("is deterministic", () => {
    const seeds = Array.from({ length: 12 }, (_, i) => seed(i));
    expect([...placePlants(seeds)]).toEqual([
      ...placePlants([...seeds].reverse()),
    ]);
  });

  it("never moves an existing plant when a newer thought is planted", () => {
    const seeds = Array.from({ length: 20 }, (_, i) => seed(i));
    const before = placePlants(seeds);
    const after = placePlants([...seeds, seed(20), seed(21)]);
    for (const s of seeds) expect(after.get(s.id)).toEqual(before.get(s.id));
  });

  it("keeps slots inside the bed", () => {
    const placed = placePlants(Array.from({ length: 60 }, (_, i) => seed(i)));
    for (const slot of placed.values()) {
      expect(Math.abs(slot.u)).toBeLessThanOrEqual(0.5);
      expect(slot.depth).toBeGreaterThanOrEqual(0);
      expect(slot.depth).toBeLessThanOrEqual(1);
    }
  });

  it("honours a stored position", () => {
    const placed = placePlants([seed(0, { position_x: 0.2, position_y: 0.7 })]);
    expect(placed.get("seed-0")).toEqual({ u: 0.2, depth: 0.7 });
  });

  it("spreads early plants apart", () => {
    const placed = [
      ...placePlants(Array.from({ length: 6 }, (_, i) => seed(i))).values(),
    ];
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(
          Math.hypot(
            placed[i].u - placed[j].u,
            (placed[i].depth - placed[j].depth) * 0.55,
          ),
        ).toBeGreaterThan(0.1);
  });
});
