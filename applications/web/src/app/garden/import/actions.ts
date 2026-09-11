"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/garden/types";
import {
  runImport,
  type ImportDb,
  type ImportInput,
} from "./import-core";

async function authenticated() {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub)
    throw new Error("Please sign in again. Your files are still here.");
  return { db, tenantId: data.claims.sub };
}

export async function importThought(
  input: ImportInput,
): Promise<ActionResult & { created?: number; skipped?: number }> {
  try {
    const { db, tenantId } = await authenticated();
    const adapter: ImportDb = {
      async readPlot(id) {
        const { data, error } = await db
          .from("plots")
          .select("garden_id,archived_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      async seedExists(id) {
        const { data, error } = await db
          .from("seeds")
          .select("id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return !!data;
      },
      async insertSeed(row) {
        const { error } = await db.from("seeds").insert(row);
        if (error) throw error;
      },
      async revisionExists(id) {
        const { data, error } = await db
          .from("seed_revisions")
          .select("id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return !!data;
      },
      async saveEntry(args) {
        const { error } = await db.rpc("save_entry", {
          p_seed_id: args.seedId,
          p_entry_id: args.entryId,
          p_revision_id: args.revisionId,
          p_body: args.body,
        });
        if (error) throw error;
      },
      async setEntryDate(entryId, createdAt) {
        const { error } = await db
          .from("entries")
          .update({ created_at: createdAt })
          .eq("id", entryId);
        if (error) throw error;
      },
    };
    const result = await runImport(adapter, tenantId, input);
    if (result.ok) revalidatePath("/garden");
    return result;
  } catch {
    return {
      ok: false,
      message: "Could not import. Your files are unchanged; please retry.",
    };
  }
}
