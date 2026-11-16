/**
 * Reads shared by the server loader and the browser data layer (ADR-009 stage 1).
 *
 * Every function takes the Supabase client it should use, so the same code runs
 * with the cookie-backed server client and with the browser client. Nothing
 * here imports `next/*`, `server-only` or cookies. All access is the signed-in
 * person's own, under RLS, with the publishable key.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { GardenData } from "../types";
import { loadTending } from "../tending-data";
import { loadTendingHistory } from "../tending-history";
import {
  buildExportDocument,
  exportFilename,
  filterSnapshotByGarden,
  formatExportMarkdown,
  type ExportSnapshot,
} from "../export";
import {
  availability,
  exportMimeType,
  gardenCapabilities,
  isAbsentRelation,
  rpcMissing,
  type AvailabilityFlags,
  type Capabilities,
  type ExportFormat,
} from "./rules";

export type Db = SupabaseClient<Database>;

/** Deployment switches the client cannot decide for itself. */
export type GardenFlags = AvailabilityFlags;

/**
 * What the database says this account may use. `null` means the database
 * predates `garden_capabilities()`; any other failure reads as nothing
 * available, never as available.
 */
export async function readCapabilities(db: Db): Promise<Capabilities | null> {
  try {
    const { data, error } = await db.rpc("garden_capabilities");
    if (error) return rpcMissing(error) ? null : gardenCapabilities(null);
    return gardenCapabilities(data);
  } catch {
    return gardenCapabilities(null);
  }
}

// Read every page explicitly: PostgREST's server row cap is not an export limit.
export async function allRows<T>(
  query: (
    start: number,
    end: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await query(start, start + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

/** Optional only when the relation does not exist yet; never hide a partial read. */
export async function optionalRows<T>(
  query: Parameters<typeof allRows<T>>[0],
): Promise<T[]> {
  try {
    return await allRows(query);
  } catch (error) {
    if (isAbsentRelation(error)) return [];
    throw error;
  }
}

export async function loadGardenWith(
  db: Db,
  tenantId: string,
  requested: string | undefined,
  /** Supplied deployment flags; with none, the database decides (see `availability`). */
  flags: GardenFlags | undefined,
): Promise<GardenData> {
  const gardens = await allRows((a, b) =>
    db
      .from("gardens")
      .select("id,name,status")
      .order("created_at")
      .order("id")
      .range(a, b),
  );
  const gardenId =
    gardens.find((g) => g.id === requested)?.id ??
    gardens.find((g) => g.status === "active")?.id ??
    gardens[0]?.id ??
    "";
  const [plots, seeds, entries] = gardenId
    ? await Promise.all([
        allRows((a, b) =>
          db
            .from("plots")
            .select("*")
            .eq("garden_id", gardenId)
            .order("created_at")
            .order("id")
            .range(a, b),
        ),
        allRows((a, b) =>
          db
            .from("seeds")
            .select("*")
            .eq("garden_id", gardenId)
            .order("created_at")
            .order("id")
            .range(a, b),
        ),
        allRows((a, b) =>
          db
            .from("current_entries")
            .select("*")
            .eq("garden_id", gardenId)
            .order("created_at")
            .order("entry_id")
            .range(a, b),
        ),
      ])
    : [[], [], []];
  const [tending, account, tendingHistory, capabilities] = await Promise.all([
    gardenId
      ? loadTending(db, gardenId, entries as GardenData["entries"])
      : undefined,
    db
      .from("accounts")
      .select("tend_overnight,timezone")
      .eq("id", tenantId)
      .maybeSingle()
      .then(
        ({ data, error }) =>
          !error && data
            ? { tendOvernight: data.tend_overnight, timezone: data.timezone }
            : undefined,
        () => undefined,
      ),
    gardenId ? loadTendingHistory(db, gardenId) : undefined,
    readCapabilities(db),
  ]);
  // Both must allow: the supplied flags and the database's own switches.
  const available = availability(flags, capabilities);
  return {
    tenantId,
    gardens,
    gardenId,
    plots,
    seeds,
    entries: entries as GardenData["entries"],
    aiAvailable: available.aiAvailable,
    deletionAvailable: available.deletionAvailable,
    tending,
    tendingHistory,
    account,
  };
}

export type EntryRevision = {
  id: string;
  body: string;
  created_at: string;
  revision_number: number;
};

/** Every saved version of one entry, newest first. */
export function readEntryHistory(db: Db, entryId: string): Promise<EntryRevision[]> {
  return allRows((a, b) =>
    db
      .from("seed_revisions")
      .select("id,body,created_at,revision_number")
      .eq("entry_id", entryId)
      .order("revision_number", { ascending: false })
      .range(a, b),
  );
}

type SourceExport = Omit<
  ExportSnapshot,
  "passes" | "blooms" | "responses" | "marks" | "markResponses"
>;

/**
 * The whole account's sources (one consistent RPC snapshot) and everything
 * derived from them. Throws rather than return a partial export.
 */
export async function readExportSnapshot(db: Db): Promise<ExportSnapshot> {
  const { data: snapshot, error } = await db.rpc("export_garden_sources");
  if (error || !snapshot) throw error ?? new Error("Export unavailable");
  const source = snapshot as unknown as SourceExport;
  const [passes, blooms, responses, marks, markResponses] = await Promise.all([
    allRows<Tables<"garden_passes">>((a, b) =>
      db.from("garden_passes").select("*").order("created_at").order("id").range(a, b),
    ),
    allRows<Tables<"blooms">>((a, b) =>
      db.from("blooms").select("*").order("created_at").order("id").range(a, b),
    ),
    allRows<Tables<"bloom_responses">>((a, b) =>
      db.from("bloom_responses").select("*").order("created_at").order("id").range(a, b),
    ),
    optionalRows<Tables<"tending_marks">>((a, b) =>
      db.from("tending_marks").select("*").order("created_at").order("id").range(a, b),
    ),
    optionalRows<Tables<"tending_mark_responses">>((a, b) =>
      db
        .from("tending_mark_responses")
        .select("*")
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
  ]);
  return { ...source, passes, blooms, responses, marks, markResponses };
}

export type ExportFile = { filename: string; mimeType: string; text: string };

/** Shape a snapshot into the file the export route serves, or say why not. */
export function shapeExport(
  snapshot: ExportSnapshot,
  format: ExportFormat,
  gardenId: string | undefined,
): ExportFile | "garden-not-found" {
  let full = snapshot;
  if (gardenId) {
    if (!full.gardens.some((g) => g.id === gardenId)) return "garden-not-found";
    full = filterSnapshotByGarden(full, gardenId);
  }
  const markdown = format === "md";
  return {
    filename: exportFilename(
      markdown ? "md" : "json",
      gardenId ? full.gardens[0]?.name : undefined,
    ),
    mimeType: exportMimeType(format),
    text: markdown
      ? formatExportMarkdown(full)
      : JSON.stringify(buildExportDocument(full), null, 2),
  };
}
