import { describe, expect, it } from "vitest";
import { GROWTH_STAGES, describeGrowth, growthFor, type GrowthEntry } from "./growth";

const entry = (day: number, revisions = 1, revisedDay = day): GrowthEntry => ({
  created_at: new Date(Date.UTC(2026, 0, 1 + day, 9)).toISOString(),
  revised_at: new Date(Date.UTC(2026, 0, 1 + revisedDay, 10)).toISOString(),
  revision_number: revisions,
});

describe("growthFor", () => {
  it("starts as a seed with no entries", () => {
    expect(growthFor([])).toMatchObject({ stage: "seed", entries: 0, days: 0, lastWrittenAt: null });
  });

  it("follows the documented thresholds", () => {
    expect(growthFor([entry(0)]).stage).toBe("sprout");
    expect(growthFor([entry(0), entry(0)]).stage).toBe("leafing");
    expect(growthFor([entry(0, 2)]).stage).toBe("leafing");
    expect(growthFor([entry(0), entry(1), entry(1)]).stage).toBe("budding");
    expect(growthFor([entry(0), entry(0), entry(0)]).stage).toBe("leafing");
    expect(growthFor([entry(0), entry(1), entry(2), entry(2), entry(2)]).stage).toBe("flowering");
    expect(growthFor([entry(0, 4), entry(0, 4)]).stage).toBe("flowering");
  });

  it("never shrinks as writing accumulates", () => {
    const entries: GrowthEntry[] = [];
    let previous = 0;
    for (let i = 0; i < 30; i++) {
      entries.push(entry(Math.floor(i / 2), 1 + (i % 3 === 0 ? 1 : 0)));
      const stage = GROWTH_STAGES.indexOf(growthFor(entries).stage);
      expect(stage).toBeGreaterThanOrEqual(previous);
      previous = stage;
    }
    expect(previous).toBe(GROWTH_STAGES.indexOf("flowering"));
  });

  it("counts revision days and the latest writing", () => {
    const g = growthFor([entry(0, 2, 3)]);
    expect(g.days).toBe(2);
    expect(g.contributions).toBe(2);
    expect(g.lastWrittenAt).toBe(entry(0, 2, 3).revised_at);
  });

  it("describes growth in plain words, never as a score", () => {
    expect(describeGrowth(growthFor([]))).toBe("no entries yet");
    expect(describeGrowth(growthFor([entry(0)]))).toBe("1 entry");
    expect(describeGrowth(growthFor([entry(0), entry(4)]))).toBe("2 entries over 2 days");
  });
});
