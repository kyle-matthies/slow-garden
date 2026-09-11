import type { GardenData } from "./types";

/**
 * A thought can take a new entry only while it, its topic, and its garden are
 * all active. Individually archived entries inside an active thought do not
 * block continuation.
 */
export function isThoughtWritable(
  data: Pick<GardenData, "gardens" | "plots" | "seeds">,
  seedId: string,
): boolean {
  const seed = data.seeds.find((s) => s.id === seedId);
  if (!seed || seed.status !== "active") return false;
  const plot = data.plots.find((p) => p.id === seed.plot_id);
  if (!plot || plot.archived_at) return false;
  const garden = data.gardens.find((g) => g.id === seed.garden_id);
  return !!garden && garden.status === "active";
}
