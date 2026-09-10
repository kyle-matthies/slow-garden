"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/garden/types";
import { deterministicId, sha256Hex } from "@/lib/garden/import";

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function authenticated() {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub)
    throw new Error("Please sign in again. Your files are still here.");
  return { db, tenantId: data.claims.sub };
}

export async function importThought(input: {
  plotId: string;
  title: string;
  entries: { body: string; date: string | null }[];
}): Promise<ActionResult & { created?: number; skipped?: number }> {
  const title = input.title.trim();
  if (
    !UUID.test(input.plotId) ||
    !title ||
    title.length > 160 ||
    !input.entries.length ||
    input.entries.length > 500 ||
    input.entries.some(
      (e) =>
        !e.body.trim() ||
        e.body.length > 20000 ||
        (e.date !== null && !DATE.test(e.date)),
    )
  )
    return { ok: false, message: "Check the topic and entries, then retry." };
  try {
    const { db, tenantId } = await authenticated();
    const { data: plot, error: plotError } = await db
      .from("plots")
      .select("garden_id,archived_at")
      .eq("id", input.plotId)
      .maybeSingle();
    if (plotError) throw plotError;
    if (!plot || plot.archived_at)
      return { ok: false, message: "Choose an active topic." };
    const fingerprint = await sha256Hex(
      title + "\n" + input.entries.map((e) => e.body).join("\n"),
    );
    const seedId = await deterministicId(
      "import-seed",
      tenantId,
      input.plotId,
      fingerprint,
    );
    const { data: prior, error: readError } = await db
      .from("seeds")
      .select("id")
      .eq("id", seedId)
      .maybeSingle();
    if (readError) throw readError;
    if (!prior) {
      const { error } = await db.from("seeds").insert({
        id: seedId,
        tenant_id: tenantId,
        garden_id: plot.garden_id,
        plot_id: input.plotId,
        title,
      });
      if (error) throw error;
    }
    let created = 0,
      skipped = 0;
    for (const entry of input.entries) {
      const hash = await sha256Hex(entry.body);
      const entryId = await deterministicId("import-entry", seedId, hash);
      const revisionId = await deterministicId("import-revision", seedId, hash);
      const { data: existing, error: checkError } = await db
        .from("seed_revisions")
        .select("id")
        .eq("id", revisionId)
        .maybeSingle();
      if (checkError) throw checkError;
      const { error } = await db.rpc("save_entry", {
        p_seed_id: seedId,
        p_entry_id: entryId,
        p_revision_id: revisionId,
        p_body: entry.body,
      });
      if (error) throw error;
      if (existing) {
        skipped++;
      } else {
        created++;
        if (entry.date)
          await db
            .from("entries")
            .update({ created_at: `${entry.date}T12:00:00.000Z` })
            .eq("id", entryId);
      }
    }
    revalidatePath("/garden");
    return { ok: true, id: seedId, created, skipped };
  } catch {
    return {
      ok: false,
      message: "Could not import. Your files are unchanged; please retry.",
    };
  }
}
