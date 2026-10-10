import type { Entry, Plot, Seed } from "@/lib/garden/types";
import { bedAngles } from "./camera";
import { genomeFor, type Genome } from "./genome";
import { growthFor, type Growth } from "./growth";
import { placePlants, type PlantSlot } from "./layout";
import {
  bloomsForSeed,
  marksForSeed,
  type Tending,
  type TendingBloom,
  type TendingMark,
} from "./tending";

export const MAX_PLANTS_PER_BED = 24;

export type ScenePlantModel = {
  seed: Seed;
  slot: PlantSlot;
  growth: Growth;
  genome: Genome;
  marks: TendingMark[];
  blooms: TendingBloom[];
  /** Latest entry, revision or creation time; chooses which plants render. */
  lastActivity: string;
};

export type SceneBedModel = {
  plot: Plot;
  angle: number;
  plants: ScenePlantModel[];
  /** Active thoughts not rendered because the bed is full. */
  resting: number;
  total: number;
};

/**
 * Build the beds for one garden. Placement includes archived thoughts so a
 * restored plant returns to its own slot. Only active thoughts render, and a
 * full bed shows its most recently tended plants. The rest stay reachable
 * through the list view and search.
 */
export function buildBeds(
  plots: readonly Plot[],
  seeds: readonly Seed[],
  entries: readonly Entry[],
  tending: Tending,
): SceneBedModel[] {
  const angles = bedAngles(plots.length);
  const entriesBySeed = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = entriesBySeed.get(e.seed_id);
    if (list) list.push(e);
    else entriesBySeed.set(e.seed_id, [e]);
  }
  return plots.map((plot, i) => {
    const plotSeeds = seeds.filter((s) => s.plot_id === plot.id);
    const slots = placePlants(plotSeeds);
    const active = plotSeeds
      .filter((s) => s.status === "active")
      .map((seed) => {
        const growth = growthFor(entriesBySeed.get(seed.id) ?? []);
        return {
          seed,
          slot: slots.get(seed.id)!,
          growth,
          genome: genomeFor(seed.id),
          marks: marksForSeed(tending, seed.id),
          blooms: bloomsForSeed(tending, seed.id),
          lastActivity:
            growth.lastWrittenAt && growth.lastWrittenAt > seed.created_at
              ? growth.lastWrittenAt
              : seed.created_at,
        };
      });
    const shown = [...active]
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
      .slice(0, MAX_PLANTS_PER_BED)
      .sort((a, b) => a.slot.depth - b.slot.depth);
    return {
      plot,
      angle: angles[i],
      plants: shown,
      resting: active.length - shown.length,
      total: active.length,
    };
  });
}
