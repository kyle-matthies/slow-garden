"use server";
import { createClient } from "@/lib/supabase/server";

export type RevisionLocation = {
  entry_id: string;
  seed_id: string;
  revision_number: number;
  created_at: string;
};

/**
 * Locates superseded source revisions so a clipping can still link to its entry.
 * Returns only identifiers and dates; revision bodies never leave the database here.
 */
export async function locateRevisions(
  revisionIds: string[],
): Promise<Record<string, RevisionLocation>> {
  const ids = Array.from(new Set(revisionIds)).filter((id) =>
    /^[0-9a-f-]{36}$/i.test(id),
  );
  if (ids.length === 0) return {};
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) return {};
  const { data: rows } = await db
    .from("seed_revisions")
    .select("id,entry_id,seed_id,revision_number,created_at")
    .in("id", ids.slice(0, 200));
  const located: Record<string, RevisionLocation> = {};
  for (const row of rows ?? [])
    located[row.id] = {
      entry_id: row.entry_id,
      seed_id: row.seed_id,
      revision_number: row.revision_number,
      created_at: row.created_at,
    };
  return located;
}
