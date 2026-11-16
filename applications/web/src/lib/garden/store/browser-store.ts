/**
 * GardenStore over Supabase, from the browser (ADR-009 stage 1).
 *
 * Uses the publishable key and the signed-in person's own session only. Every
 * write is an RLS-checked table write or one of the existing RPCs; there is no
 * service-role key and no privileged path here. Each method mirrors its server
 * action call for call, so the parity suite can compare the two.
 *
 * Must never import `next/headers`, `next/cache`, `server-only` or a server
 * action: boundaries.test.ts enforces that for every `browser*` module.
 */
import {
  saveErrorMessage,
  validateAreaName,
  validateBloomResponse,
  validateEntryBody,
  validateTimezone,
} from "../validation";
import type { ActionResult } from "../types";
import { runImport, type ImportDb } from "@/app/garden/import/import-core";
import * as rules from "./rules";
import {
  loadGardenWith,
  readEntryHistory,
  readExportSnapshot,
  shapeExport,
  type Db,
  type GardenFlags,
} from "./queries";
import { requestEmailCode, verifyEmailCode } from "./auth";
import type { GardenStore, RevisionLocation } from "./types";

export type BrowserStoreOptions = {
  /** The browser Supabase client (publishable key, the person's session). */
  client: () => Db;
  /**
   * Deployment switches (`GARDEN_AI_ENABLED`, `GARDEN_DELETION_ENABLED`) are
   * server-only today and the browser cannot read them. Until the database can
   * answer, whoever builds the store must supply them; the default is off, so
   * the browser path never permits what the server path would refuse.
   */
  flags?: () => GardenFlags;
  /** False when the Supabase URL or publishable key is missing. */
  configured?: () => boolean;
  now?: () => Date;
};

const OFF: GardenFlags = { aiAvailable: false, deletionAvailable: false };

export function createBrowserStore(options: BrowserStoreOptions): GardenStore {
  const flags = () => options.flags?.() ?? OFF;
  const configured = () => options.configured?.() ?? true;
  const now = () => options.now?.() ?? new Date();

  async function claims(db: Db) {
    const { data, error } = await db.auth.getClaims();
    return error || !data?.claims?.sub ? null : data.claims;
  }
  async function authenticated(message = rules.SIGN_IN_AGAIN) {
    const db = options.client();
    const found = await claims(db);
    if (!found) throw new Error(message);
    return { db, tenantId: found.sub };
  }
  function failure(error: unknown): ActionResult {
    return { ok: false, message: saveErrorMessage(error) };
  }

  return {
    kind: "browser",

    async getSession() {
      if (!configured()) return { signedIn: false };
      const found = await claims(options.client());
      return found
        ? {
            signedIn: true,
            tenantId: found.sub,
            email: typeof found.email === "string" ? found.email : null,
          }
        : { signedIn: false };
    },
    requestEmailCode: (email, o) => requestEmailCode(options.client(), email, o),
    verifyEmailCode: (email, code) => verifyEmailCode(options.client(), email, code),
    async signOut(scope = "local") {
      rules.assertSignOutScope(scope);
      const { error } = await options.client().auth.signOut({ scope });
      if (error) throw new Error(rules.SIGN_OUT_FAILED);
      return { ok: true };
    },

    async loadGarden(requestedGardenId) {
      if (!configured()) return { signedIn: false };
      const db = options.client();
      const found = await claims(db);
      if (!found) return { signedIn: false };
      return {
        signedIn: true,
        data: await loadGardenWith(db, found.sub, requestedGardenId, flags()),
      };
    },
    async loadReturns(gardenId) {
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
      if (pe || be || re) throw Error(rules.RETURNS_UNAVAILABLE);
      return {
        passes: passes ?? [],
        blooms: blooms ?? [],
        responses: responses ?? [],
      };
    },
    async locateRevisions(revisionIds) {
      const ids = rules.revisionLookupIds(revisionIds);
      if (ids.length === 0) return {};
      const db = options.client();
      if (!(await claims(db))) return {};
      const { data: rows } = await db
        .from("seed_revisions")
        .select("id,entry_id,seed_id,revision_number,created_at")
        .in("id", ids);
      const located: Record<string, RevisionLocation> = {};
      for (const row of rows ?? [])
        located[row.id] = {
          entry_id: row.entry_id,
          seed_id: row.seed_id,
          revision_number: row.revision_number,
          created_at: row.created_at,
        };
      return located;
    },
    async loadEntryHistory(entryId) {
      const db = options.client();
      if (!(await claims(db))) return { ok: false, reason: "signed-out" };
      if (!rules.isLooseUuid(entryId))
        return { ok: false, reason: "invalid-entry" };
      try {
        return { ok: true, revisions: await readEntryHistory(db, entryId) };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async createArea(kind, name, parentId, id) {
      const invalid = validateAreaName(kind, name);
      if (invalid) return { ok: false, message: invalid };
      try {
        const { db, tenantId } = await authenticated();
        // Ignore an exact replay; never upsert fields over a later edit.
        const { data: prior, error: readError } = await db
          .from(rules.areaTable(kind))
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
        return { ok: true, id };
      } catch (error) {
        return failure(error);
      }
    },
    async saveEntry(input) {
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
        return { ok: true, id: data };
      } catch (error) {
        return failure(error);
      }
    },
    async setArchived(kind, id, archived) {
      try {
        const { db } = await authenticated();
        const table = rules.archivableTable(kind);
        const patch = rules.archivePatch(kind, archived, now());
        const query =
          table === "gardens" || table === "seeds"
            ? db.from(table).update(patch as { status: "archived" | "active"; archived_at: string | null })
            : db.from(table).update({ archived_at: patch.archived_at });
        const { data, error } = await query.eq("id", id).select("id").single();
        if (error || !data) throw error;
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },

    async setTopicTending(topicId, ai, crossPollinate) {
      try {
        const { db } = await authenticated();
        const { error } = await db
          .from("plots")
          .update({ ai_enabled: ai, cross_pollinate: crossPollinate })
          .eq("id", topicId)
          .select("id")
          .single();
        if (error) throw error;
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },
    async setTendingPreferences(tendOvernight, timezone) {
      const invalid = validateTimezone(timezone);
      if (invalid) return { ok: false, message: invalid };
      try {
        const { db, tenantId } = await authenticated();
        const { error } = await db
          .from("accounts")
          .update({ tend_overnight: tendOvernight, timezone })
          .eq("id", tenantId);
        if (error) throw error;
        return { ok: true };
      } catch {
        return { ok: false, message: rules.PREFERENCE_FAILED };
      }
    },

    async requestPass(gardenId, topicIds, id) {
      if (!flags().aiAvailable)
        return { ok: false, message: rules.AI_UNAVAILABLE };
      try {
        const { db, tenantId } = await authenticated();
        const { data: existing, error: readError } = await db
          .from("garden_passes")
          .select("id")
          .eq("id", id)
          .maybeSingle();
        if (readError) throw readError;
        if (existing) return { ok: true, id };
        // The database trigger (prepare_pass) is the gate: runtime switch,
        // budget, permissions and scope are all decided there.
        const { error } = await db.from("garden_passes").insert({
          id,
          tenant_id: tenantId,
          garden_id: gardenId,
          plot_ids: topicIds,
        });
        if (error) return rules.passRequestRefusal(error);
        return { ok: true, id };
      } catch {
        return { ok: false, message: rules.PASS_REQUEST_FAILED };
      }
    },
    async cancelPass(id) {
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
        return { ok: false, message: rules.PASS_CANCEL_FAILED };
      }
    },
    async respondToBloom(id, bloomId, response, correction) {
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
            correction: rules.bloomCorrection(response, correction),
          });
          if (error) throw error;
        }
        return { ok: true };
      } catch {
        return { ok: false, message: rules.RESPONSE_FAILED };
      }
    },
    async respondToMark(id, markId, response) {
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
        return { ok: true };
      } catch {
        return { ok: false, message: rules.RESPONSE_FAILED };
      }
    },

    async importThought(input) {
      try {
        const { db, tenantId } = await authenticated(rules.SIGN_IN_AGAIN_IMPORT);
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
        return await runImport(adapter, tenantId, input);
      } catch {
        return { ok: false, message: rules.IMPORT_FAILED };
      }
    },
    async exportGarden({ format, gardenId }) {
      const db = options.client();
      if (!(await claims(db)))
        return { ok: false, reason: "signed-out", message: "Unauthorized" };
      try {
        const snapshot = await readExportSnapshot(db);
        if (gardenId && !rules.isUuid(gardenId))
          return { ok: false, reason: "invalid-garden", message: "Invalid garden id" };
        const file = shapeExport(snapshot, format === "md" ? "md" : "json", gardenId);
        if (file === "garden-not-found")
          return { ok: false, reason: "garden-not-found", message: "Garden not found" };
        return { ok: true, ...file };
      } catch {
        return { ok: false, reason: "unavailable", message: rules.EXPORT_FAILED };
      }
    },

    async previewDeletion(kind, id) {
      if (!rules.isPreviewTarget(kind, id))
        return { ok: false, message: rules.DELETION_NOT_HERE };
      if (!flags().deletionAvailable)
        return { ok: false, message: rules.DELETION_UNAVAILABLE };
      try {
        const db = options.client();
        const found = await claims(db);
        if (!found) return { ok: false, message: rules.DELETION_SIGN_IN };
        // Counted by the database from the same sets it would delete.
        const { data, error } = await db.rpc(
          "deletion_preview",
          rules.deletionPreviewArgs(kind, id),
        );
        if (error) return rules.deletionPreviewFailure(error);
        const counts = rules.deletionCounts(data);
        if (!counts) return { ok: false, message: rules.DELETION_GONE };
        return {
          ok: true,
          counts,
          confirmPhrase:
            kind === "account" ? rules.accountConfirmPhrase(found.email) : null,
        };
      } catch {
        return { ok: false, message: rules.DELETION_COUNT_FAILED };
      }
    },
    async deleteItem(kind, id, confirmName = "") {
      if (!rules.isDeleteItemTarget(kind, id))
        return { ok: false, message: rules.DELETION_NOT_HERE };
      if (!flags().deletionAvailable)
        return { ok: false, message: rules.DELETION_UNAVAILABLE };
      try {
        const { db } = await authenticated();
        // Each RPC is one transaction and checks ownership and the typed name itself.
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
        if (error) return rules.deletionFailure(error);
        return { ok: true };
      } catch {
        return { ok: false, message: rules.DELETION_FAILED };
      }
    },
    async deleteAccount(confirm) {
      if (!flags().deletionAvailable)
        return { ok: false, message: rules.DELETION_UNAVAILABLE };
      try {
        const { db } = await authenticated();
        // The database checks the phrase and requires a sign-in from the last ten minutes.
        const { error } = await db.rpc("delete_account", { p_confirm: confirm });
        if (error) return rules.accountDeletionFailure(error);
        try {
          // The identity no longer exists; this clears the stored session.
          await db.auth.signOut({ scope: "local" });
        } catch {
          // Nothing left to sign out of.
        }
        return { ok: true };
      } catch {
        return { ok: false, message: rules.ACCOUNT_DELETION_FAILED };
      }
    },
  };
}
