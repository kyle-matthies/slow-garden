"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/garden/types";

async function authenticated() {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub)
    throw new Error("Please sign in again. Your draft is still here.");
  return { db, tenantId: data.claims.sub };
}
function message(error: unknown): ActionResult {
  const e = error as { code?: string; message?: string };
  return {
    ok: false,
    message:
      e.code === "40001"
        ? "This entry changed elsewhere. Reload to review it; your draft is still here."
        : "Could not save. Your writing is still here; please retry.",
  };
}
export async function createArea(
  kind: "garden" | "plot" | "seed",
  name: string,
  parentId: string,
  id: string,
): Promise<ActionResult> {
  if (!name.trim() || name.length > (kind === "seed" ? 160 : 120))
    return { ok: false, message: "Please choose a short name." };
  try {
    const { db, tenantId } = await authenticated();
    // Ignore an exact replay; never upsert fields over a later edit.
    const table =
      kind === "garden" ? "gardens" : kind === "plot" ? "plots" : "seeds";
    const { data: prior, error: readError } = await db
      .from(table)
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!prior) {
      if (kind === "garden") {
        const { error } = await db
          .from("gardens")
          .insert({ id, tenant_id: tenantId, name: name.trim() });
        if (error) throw error;
      } else if (kind === "plot") {
        const { error } = await db.from("plots").insert({
          id,
          tenant_id: tenantId,
          garden_id: parentId,
          name: name.trim(),
        });
        if (error) throw error;
      } else {
        const { data: plot, error: pe } = await db
          .from("plots")
          .select("garden_id,archived_at")
          .eq("id", parentId)
          .single();
        if (pe || plot.archived_at) throw pe ?? new Error("Archived");
        const { error } = await db.from("seeds").insert({
          id,
          tenant_id: tenantId,
          garden_id: plot.garden_id,
          plot_id: parentId,
          title: name.trim(),
        });
        if (error) throw error;
      }
    }
    revalidatePath("/garden");
    return { ok: true, id };
  } catch (error) {
    return message(error);
  }
}
export async function saveEntry(input: {
  seedId: string;
  entryId: string;
  revisionId: string;
  body: string;
  expectedRevisionId: string | null;
}): Promise<ActionResult> {
  if (!input.body.trim() || input.body.length > 20000)
    return { ok: false, message: "Write between 1 and 20,000 characters." };
  try {
    const { db } = await authenticated();
    const { data, error } = await db.rpc("save_entry", {
      p_seed_id: input.seedId,
      p_entry_id: input.entryId,
      p_revision_id: input.revisionId,
      p_body: input.body,
      p_expected_revision_id: input.expectedRevisionId ?? undefined,
    });
    if (error) throw error;
    revalidatePath("/garden");
    return { ok: true, id: data };
  } catch (error) {
    return message(error);
  }
}
export async function setArchived(
  kind: "garden" | "plot" | "seed" | "entry",
  id: string,
  archived: boolean,
): Promise<ActionResult> {
  try {
    const { db } = await authenticated();
    const table =
      kind === "garden"
        ? "gardens"
        : kind === "plot"
          ? "plots"
          : kind === "seed"
            ? "seeds"
            : "entries";
    const archived_at = archived ? new Date().toISOString() : null;
    const query =
      table === "gardens" || table === "seeds"
        ? db
            .from(table)
            .update({ status: archived ? "archived" : "active", archived_at })
        : db.from(table).update({ archived_at });
    const { data, error } = await query.eq("id", id).select("id").single();
    if (error || !data) throw error;
    revalidatePath("/garden");
    return { ok: true };
  } catch (error) {
    return message(error);
  }
}
export async function setPlotPermissions(
  id: string,
  ai: boolean,
  cross: boolean,
): Promise<ActionResult> {
  try {
    const { db } = await authenticated();
    const { error } = await db
      .from("plots")
      .update({ ai_enabled: ai, cross_pollinate: cross })
      .eq("id", id)
      .select("id")
      .single();
    if (error) throw error;
    revalidatePath("/garden");
    return { ok: true };
  } catch (error) {
    return message(error);
  }
}
export async function signOut(scope: "local" | "global" = "local") {
  if (scope !== "local" && scope !== "global")
    throw new Error("Invalid sign-out scope");
  const db = await createClient();
  const { error } = await db.auth.signOut({ scope });
  if (error) throw new Error("Sign-out failed. Please retry.");
  return { ok: true };
}

export async function inviteReflection(
  gardenId: string,
  plotIds: string[],
  id: string,
): Promise<ActionResult> {
  if (process.env.GARDEN_AI_ENABLED !== "true")
    return {
      ok: false,
      message:
        "AI reflections are not enabled yet. Your writing remains available.",
    };
  try {
    const { db, tenantId } = await authenticated();
    const { data: existing, error: readError } = await db
      .from("garden_passes")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (existing) return { ok: true, id };
    const { error } = await db.from("garden_passes").insert({
      id,
      tenant_id: tenantId,
      garden_id: gardenId,
      plot_ids: plotIds,
    });
    if (error)
      return {
        ok: false,
        message:
          error.code === "55000"
            ? "A reflection is already pending, the AI budget is reached, or the quality gate is not active. Try again later."
            : "Check the selected topics and their AI permissions before retrying.",
      };
    revalidatePath("/garden");
    return { ok: true, id };
  } catch {
    return {
      ok: false,
      message: "Could not invite a reflection. Please retry.",
    };
  }
}
export async function cancelReflection(id: string): Promise<ActionResult> {
  try {
    const { db } = await authenticated();
    const { error } = await db
      .from("garden_passes")
      .update({ status: "cancelled" })
      .eq("id", id)
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Could not cancel. Refresh to see its current state.",
    };
  }
}
export async function respondToBloom(
  id: string,
  bloomId: string,
  response: "keep" | "correct" | "prune",
  correction: string,
): Promise<ActionResult> {
  if (response === "correct" && !correction.trim())
    return { ok: false, message: "Add your correction in your own words." };
  try {
    const { db, tenantId } = await authenticated();
    const { data: existing } = await db
      .from("bloom_responses")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      const { error } = await db.from("bloom_responses").insert({
        id,
        tenant_id: tenantId,
        bloom_id: bloomId,
        response,
        correction: response === "correct" ? correction : null,
      });
      if (error) throw error;
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Could not save your response. Please retry.",
    };
  }
}
export async function readReturns(gardenId: string) {
  const { db } = await authenticated();
  const [
    { data: passes, error: pe },
    { data: blooms, error: be },
    { data: responses, error: re },
  ] = await Promise.all([
    db
      .from("garden_passes")
      .select("*")
      .eq("garden_id", gardenId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("blooms")
      .select("*")
      .eq("garden_id", gardenId)
      .order("created_at", { ascending: false })
      .limit(150),
    db
      .from("bloom_responses")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (pe || be || re) throw Error("Returns unavailable");
  return {
    passes: passes ?? [],
    blooms: blooms ?? [],
    responses: responses ?? [],
  };
}
