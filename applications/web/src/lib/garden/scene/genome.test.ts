import { describe, expect, it } from "vitest";
import { genomeFor } from "./genome";
import { SPECIES } from "./species";

describe("genomeFor", () => {
  it("is stable for an ID", () => {
    expect(genomeFor("a-thought")).toEqual(genomeFor("a-thought"));
  });

  it("uses every species across many thoughts", () => {
    const seen = new Set(Array.from({ length: 400 }, (_, i) => genomeFor(`t-${i}`).species.id));
    expect(seen.size).toBe(SPECIES.length);
  });

  it("keeps traits within the species' natural ranges", () => {
    for (let i = 0; i < 200; i++) {
      const g = genomeFor(`t-${i}`);
      expect(g.petals).toBeGreaterThanOrEqual(g.species.petals[0]);
      expect(g.petals).toBeLessThanOrEqual(g.species.petals[1]);
      expect(g.height).toBeGreaterThanOrEqual(g.species.height[0]);
      expect(g.height).toBeLessThanOrEqual(g.species.height[1]);
      expect(g.colour[1]).toBeGreaterThanOrEqual(0);
      expect(g.colour[2]).toBeLessThanOrEqual(100);
    }
  });
});
