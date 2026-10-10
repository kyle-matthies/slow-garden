import { describe, expect, it } from "vitest";
import type { Entry, Plot, Seed } from "@/lib/garden/types";
import { MAX_PLANTS_PER_BED, buildBeds } from "./model";
import { EMPTY_TENDING } from "./tending";

const plot = (id: string): Plot => ({
  id,
  garden_id: "g",
  name: id,
  ai_enabled: false,
  cross_pollinate: false,
  archived_at: null,
  permission_version: 1,
});
const seed = (i: number, plotId = "p1", status = "active"): Seed => ({
  id: `s${i}`,
  garden_id: "g",
  plot_id: plotId,
  title: `Thought ${i}`,
  status,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
});
const entry = (seedId: string, day: number): Entry => ({
  entry_id: `${seedId}-${day}`,
  revision_id: `r-${seedId}-${day}`,
  seed_id: seedId,
  body: "text",
  revision_number: 1,
  created_at: new Date(Date.UTC(2026, 2, day)).toISOString(),
  revised_at: new Date(Date.UTC(2026, 2, day)).toISOString(),
  archived_at: null,
});

describe("buildBeds", () => {
  it("renders at most a bed's worth of the most recently tended plants", () => {
    const seeds = Array.from({ length: 30 }, (_, i) => seed(i));
    const entries = [entry("s0", 20), entry("s1", 21)];
    const [bed] = buildBeds([plot("p1")], seeds, entries, EMPTY_TENDING);
    expect(bed.plants).toHaveLength(MAX_PLANTS_PER_BED);
    expect(bed.resting).toBe(30 - MAX_PLANTS_PER_BED);
    expect(bed.plants.map((p) => p.seed.id)).toContain("s0");
  });

  it("keeps an archived thought's slot for when it is restored", () => {
    const seeds = [seed(0), seed(1, "p1", "archived"), seed(2)];
    const [withArchived] = buildBeds([plot("p1")], seeds, [], EMPTY_TENDING);
    const restored = buildBeds(
      [plot("p1")],
      seeds.map((s) => ({ ...s, status: "active" })),
      [],
      EMPTY_TENDING,
    )[0];
    expect(withArchived.plants.map((p) => p.seed.id)).toEqual(
      expect.not.arrayContaining(["s1"]),
    );
    const slot = (bed: typeof withArchived, id: string) =>
      bed.plants.find((p) => p.seed.id === id)?.slot;
    expect(slot(restored, "s2")).toEqual(slot(withArchived, "s2"));
  });

  it("places beds around the ring", () => {
    const beds = buildBeds(
      [plot("a"), plot("b"), plot("c")],
      [],
      [],
      EMPTY_TENDING,
    );
    expect(beds.map((b) => b.angle)).toEqual([0, 120, 240]);
  });
});
