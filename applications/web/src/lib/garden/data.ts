import { createClient } from "@/lib/supabase/server";
import type { GardenData } from "./types";
import { loadGardenWith } from "./store/queries";

// The paging reader and the garden loader now live in store/queries (no server
// imports) so the browser data layer issues exactly the same reads (ADR-009).
export { allRows } from "./store/queries";

export async function loadGarden(
  tenantId: string,
  requested?: string,
): Promise<GardenData> {
  return loadGardenWith(await createClient(), tenantId, requested, {
    aiAvailable: process.env.GARDEN_AI_ENABLED === "true",
    deletionAvailable: process.env.GARDEN_DELETION_ENABLED === "true",
  });
}
