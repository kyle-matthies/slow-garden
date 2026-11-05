import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type TendingPassStatus = "queued" | "processing" | "complete" | "failed" | "cancelled" | "withdrawn";
export type TendingHistory = {
  available: boolean;
  passes: { id: string; status: TendingPassStatus; createdAt: string; finishedAt: string | null }[];
};
const statuses = new Set(["queued", "processing", "complete", "failed", "cancelled", "withdrawn"]);

/** Read operational history through the signed-in client's RLS, never snapshots or prose. */
export async function loadTendingHistory(db: SupabaseClient<Database>, gardenId: string): Promise<TendingHistory> {
  try {
    const { data, error } = await db.from("garden_passes")
      .select("id,status,created_at,finished_at").eq("garden_id", gardenId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(5);
    if (error || !data) return { available: false, passes: [] };
    if (data.some((row) => !statuses.has(row.status) || !Number.isFinite(Date.parse(row.created_at)) ||
      (row.finished_at !== null && !Number.isFinite(Date.parse(row.finished_at))))) {
      return { available: false, passes: [] };
    }
    return { available: true, passes: data.map((row) => ({
      id: row.id, status: row.status as TendingPassStatus, createdAt: row.created_at, finishedAt: row.finished_at,
    })) };
  } catch {
    return { available: false, passes: [] };
  }
}
