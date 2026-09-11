import {
  deterministicId,
  isCalendarDate,
  sha256Hex,
  // @ts-expect-error node --test strips types and needs the explicit extension
} from "../../../lib/garden/import.ts";

export type ImportInput = {
  plotId: string;
  title: string;
  entries: { body: string; date: string | null }[];
};
export type ImportDb = {
  readPlot(
    id: string,
  ): Promise<{ garden_id: string; archived_at: string | null } | null>;
  seedExists(id: string): Promise<boolean>;
  insertSeed(row: {
    id: string;
    tenant_id: string;
    garden_id: string;
    plot_id: string;
    title: string;
  }): Promise<void>;
  revisionExists(id: string): Promise<boolean>;
  saveEntry(args: {
    seedId: string;
    entryId: string;
    revisionId: string;
    body: string;
  }): Promise<void>;
  setEntryDate(entryId: string, createdAt: string): Promise<void>;
};
export type ImportOutcome =
  | { ok: true; id: string; created: number; skipped: number }
  | { ok: false; message: string };

const UUID = /^[0-9a-f-]{36}$/i;

export function validateImportInput(input: ImportInput): string | null {
  const title = input.title.trim();
  return !UUID.test(input.plotId) ||
    !title ||
    title.length > 160 ||
    !input.entries.length ||
    input.entries.length > 500 ||
    input.entries.some(
      (e) =>
        !e.body.trim() ||
        e.body.length > 20000 ||
        (e.date !== null && !isCalendarDate(e.date)),
    )
    ? "Check the topic and entries, then retry."
    : null;
}

export async function runImport(
  db: ImportDb,
  tenantId: string,
  input: ImportInput,
): Promise<ImportOutcome> {
  const invalid = validateImportInput(input);
  if (invalid) return { ok: false, message: invalid };
  const title = input.title.trim();
  const plot = await db.readPlot(input.plotId);
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
  if (!(await db.seedExists(seedId)))
    await db.insertSeed({
      id: seedId,
      tenant_id: tenantId,
      garden_id: plot.garden_id,
      plot_id: input.plotId,
      title,
    });
  let created = 0,
    skipped = 0;
  const occurrences = new Map<string, number>();
  for (const entry of input.entries) {
    const hash = await sha256Hex(entry.body);
    const identity = `${entry.date ?? ""}\n${hash}`;
    const ordinal = occurrences.get(identity) ?? 0;
    occurrences.set(identity, ordinal + 1);
    const parts = [seedId, hash, entry.date ?? "", String(ordinal)];
    const entryId = await deterministicId("import-entry", ...parts);
    const revisionId = await deterministicId("import-revision", ...parts);
    const existing = await db.revisionExists(revisionId);
    await db.saveEntry({
      seedId,
      entryId,
      revisionId,
      body: entry.body,
    });
    if (entry.date)
      await db.setEntryDate(entryId, `${entry.date}T12:00:00.000Z`);
    if (existing) skipped++;
    else created++;
  }
  return { ok: true, id: seedId, created, skipped };
}
