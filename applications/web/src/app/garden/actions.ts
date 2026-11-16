"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/garden/types";
import {
  saveErrorMessage,
  validateAreaName,
  validateBloomResponse,
  validateEntryBody,
  validateTimezone,
} from "@/lib/garden/validation";
import * as rules from "@/lib/garden/store/rules";

async function authenticated() {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub)
    throw new Error("Please sign in again. Your draft is still here.");
  return { db, tenantId: data.claims.sub };
}
function message(error: unknown): ActionResult {
  return { ok: false, message: saveErrorMessage(error) };
}
export async function createArea(
  kind: "garden" | "plot" | "seed",
  name: string,
  parentId: string,
  id: string,
): Promise<ActionResult> {
  const invalid = validateAreaName(kind, name);
  if (invalid) return { ok: false, message: invalid };
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
  const invalid = validateEntryBody(input.body);
  if (invalid) return { ok: false, message: invalid };
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
  rules.assertSignOutScope(scope);
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
    if (error) return rules.passRequestRefusal(error);
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
  const invalid = validateBloomResponse(response, correction);
  if (invalid) return { ok: false, message: invalid };
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

/** Keep or prune one tending mark. Append-only and replay-safe, like bloom responses. */
export async function respondToMark(
  id: string,
  markId: string,
  response: "keep" | "prune",
): Promise<ActionResult> {
  const invalid = rules.validateMarkResponse(response);
  if (invalid) return { ok: false, message: invalid };
  try {
    const { db, tenantId } = await authenticated();
    const { data: existing } = await db
      .from("tending_mark_responses")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      const { error } = await db.from("tending_mark_responses").insert({
        id,
        tenant_id: tenantId,
        mark_id: markId,
        response,
      });
      if (error) throw error;
    }
    revalidatePath("/garden");
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Could not save your response. Please retry.",
    };
  }
}

/** Overnight tending is a preference; it never starts processing by itself. */
export async function setTendingPreferences(
  tendOvernight: boolean,
  timezone: string,
): Promise<ActionResult> {
  const invalid = validateTimezone(timezone);
  if (invalid) return { ok: false, message: invalid };
  try {
    const { db, tenantId } = await authenticated();
    const { error } = await db
      .from("accounts")
      .update({ tend_overnight: tendOvernight, timezone })
      .eq("id", tenantId);
    if (error) throw error;
    revalidatePath("/garden");
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Could not save that preference. Please retry.",
    };
  }
}

/** What a permanent deletion will erase, counted by the database from the same sets it deletes. */
export type DeletionKind = rules.DeletionKind;
export type DeletionCounts = rules.DeletionCounts;
export type DeletionPreview = rules.DeletionPreview;
const DELETION_UNAVAILABLE = rules.DELETION_UNAVAILABLE;
/**
 * Ship-order switch. Off by default: the deletion migration must be applied
 * to the database before this is turned on. While off, no delete control is
 * rendered (GardenData.deletionAvailable) and every deletion action refuses.
 */
function deletionOn(): boolean {
  return process.env.GARDEN_DELETION_ENABLED === "true";
}
export type DeleteAccountResult = rules.DeleteAccountResult;
const { deletionCounts, deletionMissing, deletionFailure } = rules;
/** Read-only. Also returns the phrase to type for an account (its email address). */
export async function previewDeletion(
  kind: DeletionKind,
  id: string,
): Promise<DeletionPreview> {
  if (!rules.isPreviewTarget(kind, id))
    return { ok: false, message: "That item cannot be deleted from here." };
  if (!deletionOn()) return { ok: false, message: DELETION_UNAVAILABLE };
  try {
    const db = await createClient();
    const { data: auth, error: authError } = await db.auth.getClaims();
    if (authError || !auth?.claims?.sub)
      return { ok: false, message: "Please sign in again. Nothing was erased." };
    const { data, error } = await db.rpc(
      "deletion_preview",
      kind === "account" ? { p_kind: kind } : { p_kind: kind, p_id: id },
    );
    if (error)
      return {
        ok: false,
        message: deletionMissing(error)
          ? DELETION_UNAVAILABLE
          : "Could not count what this would erase. Nothing was erased.",
      };
    const counts = deletionCounts(data);
    if (!counts)
      return {
        ok: false,
        message: "This is no longer here. It may already have been deleted.",
      };
    const email =
      typeof auth.claims.email === "string" ? auth.claims.email.trim() : "";
    return {
      ok: true,
      counts,
      confirmPhrase:
        kind === "account" ? email || "delete my account" : null,
    };
  } catch {
    return {
      ok: false,
      message: "Could not count what this would erase. Nothing was erased.",
    };
  }
}
/**
 * Permanently erase an entry, thought, topic or garden with everything derived
 * from it. Each call is one database transaction: it erases everything or nothing.
 * Deleting something already gone succeeds, so a retry is safe.
 */
export async function deleteItem(
  kind: Exclude<DeletionKind, "account">,
  id: string,
  confirmName = "",
): Promise<ActionResult> {
  if (!rules.isDeleteItemTarget(kind, id))
    return { ok: false, message: "That item cannot be deleted from here." };
  if (!deletionOn()) return { ok: false, message: DELETION_UNAVAILABLE };
  try {
    const { db } = await authenticated();
    const { error } =
      kind === "entry"
        ? await db.rpc("delete_entry", { p_entry_id: id })
        : kind === "seed"
          ? await db.rpc("delete_seed", { p_seed_id: id })
          : kind === "plot"
            ? await db.rpc("delete_plot", {
                p_plot_id: id,
                p_confirm_name: confirmName,
              })
            : await db.rpc("delete_garden", {
                p_garden_id: id,
                p_confirm_name: confirmName,
              });
    if (error) return deletionFailure(error);
    revalidatePath("/garden");
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Could not delete. Nothing was erased; please retry.",
    };
  }
}
/**
 * Permanently erase the account: every garden, everything derived, the account
 * row and the sign-in identity, in one transaction. Then clear this browser's
 * session. The caller clears local drafts and leaves for the landing page.
 * The database refuses unless this session is a live sign-in from the last
 * ten minutes; that refusal comes back as `reauth`.
 */
export async function deleteAccount(
  confirm: string,
): Promise<DeleteAccountResult> {
  if (!deletionOn()) return { ok: false, message: DELETION_UNAVAILABLE };
  try {
    const { db } = await authenticated();
    const { error } = await db.rpc("delete_account", { p_confirm: confirm });
    if (error) {
      return rules.accountDeletionFailure(error);
    }
    // An account that is already gone (a replay) still ends this browser's session.
    try {
      // The identity no longer exists, so the server may refuse; cookies are cleared regardless.
      await db.auth.signOut({ scope: "local" });
    } catch {
      // Nothing left to sign out of.
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Could not delete the account. Nothing was erased; please retry.",
    };
  }
}
