import { describe, expect, it } from "vitest";
import { genomeFor } from "./genome";
import { GROWTH_STAGES } from "./growth";
import { plantShape } from "./plant-geometry";
import { SPECIES } from "./species";

const idFor = (speciesId: string) => {
  for (let i = 0; i < 5000; i++)
    if (genomeFor(`x${i}`).species.id === speciesId) return `x${i}`;
  throw new Error(speciesId);
};

describe("plantShape", () => {
  for (const species of SPECIES)
    it(`draws ${species.id} at every stage with finite geometry`, () => {
      const genome = genomeFor(idFor(species.id));
      let previous = 0;
      for (const stage of GROWTH_STAGES) {
        const shape = plantShape(genome, stage, 0.5);
        const text = [
          shape.stem,
          ...shape.branches,
          ...shape.leaves.map((l) => l.d),
        ].join(" ");
        expect(text).not.toMatch(/NaN|Infinity/);
        expect(shape.height).toBeGreaterThan(previous);
        previous = shape.height;
        const flowers = shape.heads.filter((h) => h.kind === "flower").length;
        if (stage === "flowering") expect(flowers).toBeGreaterThanOrEqual(1);
        else expect(flowers).toBe(0);
        if (stage === "budding")
          expect(shape.heads.some((h) => h.kind === "bud")).toBe(true);
      }
    });
});
