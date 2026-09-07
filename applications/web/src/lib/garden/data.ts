import { createClient } from "@/lib/supabase/server";
import type { GardenData } from "./types";

// Read every page explicitly: PostgREST's server row cap is not an export limit.
export async function allRows<T>(
  query: (
    start: number,
    end: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await query(start, start + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}
export async function loadGarden(
  tenantId: string,
  requested?: string,
): Promise<GardenData> {
  const db = await createClient();
  const gardens = await allRows((a, b) =>
    db
      .from("gardens")
      .select("id,name,status")
      .order("created_at")
      .order("id")
      .range(a, b),
  );
  const gardenId =
    gardens.find((g) => g.id === requested)?.id ??
    gardens.find((g) => g.status === "active")?.id ??
    gardens[0]?.id ??
    "";
  const [plots, seeds, entries] = gardenId
    ? await Promise.all([
        allRows((a, b) =>
          db
            .from("plots")
            .select("*")
            .eq("garden_id", gardenId)
            .order("created_at")
            .order("id")
            .range(a, b),
        ),
        allRows((a, b) =>
          db
            .from("seeds")
            .select("*")
            .eq("garden_id", gardenId)
            .order("created_at")
            .order("id")
            .range(a, b),
        ),
        allRows((a, b) =>
          db
            .from("current_entries")
            .select("*")
            .eq("garden_id", gardenId)
            .order("created_at")
            .order("entry_id")
            .range(a, b),
        ),
      ])
    : [[], [], []];
  return {
    tenantId,
    gardens,
    gardenId,
    plots,
    seeds,
    entries: entries as GardenData["entries"],
    aiAvailable: process.env.GARDEN_AI_ENABLED === "true",
  };
}
