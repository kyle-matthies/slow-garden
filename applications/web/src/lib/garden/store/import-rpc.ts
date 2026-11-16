/**
 * Import through `public.import_thought`, shared by the server action and the
 * browser data layer so both send exactly the same call.
 *
 * The RPC is one transaction and holds the limits itself (500 entries,
 * 1,048,576 bytes, blank and length rules, archived topics) and is the only
 * way an entry's date can be set once the owner can no longer write
 * `entries.created_at`. Identifiers are derived here exactly as
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
 * Validate, then import in one database transaction. `legacy` is the
 * call-by-call import used before the RPC existed; it runs only when the
 * database answers that `import_thought` is not installed. Throws on any other
 * database failure, for the caller to report as it always has.
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
  const { data, error } = await db.rpc(
    "import_thought",
    await planImport(tenantId, input),
  );
  if (error) {
    if (rules.rpcMissing(error)) return legacy();
    if ((error as { code?: string }).code === rules.TOPIC_UNAVAILABLE)
      return { ok: false, message: rules.IMPORT_TOPIC_UNAVAILABLE };
    throw error;
  }
  const receipt = rules.importReceipt(data);
  if (!receipt) throw new Error("Unexpected import result");
  return { ok: true, ...receipt };
}
