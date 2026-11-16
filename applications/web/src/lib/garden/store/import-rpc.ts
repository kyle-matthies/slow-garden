/**
 * Import through `public.import_thought`, shared by the server action and the
 * browser data layer so both send exactly the same call.
 *
 * The RPC is one transaction and holds the limits itself (500 entries per
 * call, 1,048,576 bytes, blank and length rules, archived topics) and is the
 * only way an entry's date can be set once the owner can no longer write
 * `entries.created_at`. It never changes an entry that already exists. Identifiers are derived here exactly as
 * `runImport` derives them, so a retry is a replay and notes imported before
 * the RPC existed are skipped, not duplicated.
 *
 * Pure of `next/*` and `server-only`.
 */
import {
  validateImportInput,
  type ImportInput,
  type ImportOutcome,
} from "@/app/garden/import/import-core";
import { deterministicId, sha256Hex } from "../import";
import type { Db } from "./queries";
import * as rules from "./rules";

export type ImportPlan = {
  p_plot_id: string;
  p_seed_id: string;
  p_title: string;
  p_entries: {
    entry_id: string;
    revision_id: string;
    body: string;
    date: string | null;
  }[];
};

/** The arguments for `import_thought`: the same identifiers `runImport` computes. */
export async function planImport(
  tenantId: string,
  input: ImportInput,
): Promise<ImportPlan> {
  const title = input.title.trim();
  const fingerprint = await sha256Hex(
    title + "\n" + input.entries.map((e) => e.body).join("\n"),
  );
  const seedId = await deterministicId(
    "import-seed",
    tenantId,
    input.plotId,
    fingerprint,
  );
  const occurrences = new Map<string, number>();
  const entries: ImportPlan["p_entries"] = [];
  for (const entry of input.entries) {
    const hash = await sha256Hex(entry.body);
    const identity = `${entry.date ?? ""}\n${hash}`;
    const ordinal = occurrences.get(identity) ?? 0;
    occurrences.set(identity, ordinal + 1);
    const parts = [seedId, hash, entry.date ?? "", String(ordinal)];
    entries.push({
      entry_id: await deterministicId("import-entry", ...parts),
      revision_id: await deterministicId("import-revision", ...parts),
      body: entry.body,
      date: entry.date,
    });
  }
  return {
    p_plot_id: input.plotId,
    p_seed_id: seedId,
    p_title: title,
    p_entries: entries,
  };
}

/**
 * Validate, then import in one database transaction.
 *
 * `legacy` is the call-by-call import used before the RPC existed. An error
 * saying the function is missing is not enough to use it: a stale API schema
 * cache says the same about a function that exists, and against the migrated
 * database the call-by-call path would save entries and then be refused their
 * dates. So it runs only on a positive signal that this is the older database:
 * the owner may still write `entries.created_at` (asked with an update that
 * matches no row; privileges are checked by Postgres itself, not the cache).
 *
 * Messages say what is known: an import the database refused saved nothing
 * (one transaction); a call that never answered, or a call-by-call import that
 * failed midway, may have saved something.
 */
export async function importThoughtWith(
  db: Db,
  tenantId: string,
  input: ImportInput,
  legacy: () => Promise<ImportOutcome>,
): Promise<ImportOutcome> {
  const invalid = validateImportInput(input);
  if (invalid) return { ok: false, message: invalid };
  if (rules.importBytes(input) > rules.IMPORT_MAX_BYTES)
    return { ok: false, message: rules.IMPORT_CHECK_INPUT };
  const plan = await planImport(tenantId, input);
  let answer: { data: unknown; error: unknown };
  try {
    answer = await db.rpc("import_thought", plan);
  } catch {
    return { ok: false, message: rules.IMPORT_UNCERTAIN };
  }
  const { data, error } = answer;
  if (error) {
    const code = (error as { code?: string }).code;
    if (rules.rpcMissing(error)) {
      const probe = await db
        .from("entries")
        .update({ created_at: new Date(0).toISOString() })
        .eq("id", rules.NO_ROW);
      if (probe.error) return { ok: false, message: rules.IMPORT_UNAVAILABLE };
      try {
        return await legacy();
      } catch {
        return { ok: false, message: rules.IMPORT_INTERRUPTED };
      }
    }
    if (code === rules.ARCHIVED_PLACE)
      return {
        ok: false,
        message: /^this thought is archived\b/.test(
          String((error as { message?: unknown }).message ?? ""),
        )
          ? rules.archivedMessage(error)
          : rules.IMPORT_TOPIC_UNAVAILABLE,
      };
    if (code === "22023") return { ok: false, message: rules.IMPORT_CHECK_INPUT };
    // Only a refusal the database itself reported proves nothing was written.
    // An error without a code is a failed connection or response, which can
    // arrive after the transaction committed.
    if (typeof code !== "string" || code === "")
      return { ok: false, message: rules.IMPORT_UNCERTAIN };
    return { ok: false, message: rules.IMPORT_NOT_SAVED };
  }
  const receipt = rules.importReceipt(data);
  if (!receipt) return { ok: false, message: rules.IMPORT_UNCERTAIN };
  return { ok: true, ...receipt };
}
