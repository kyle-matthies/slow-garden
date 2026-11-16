/**
 * Input rules, error mapping and row shaping shared by the server actions and
 * the browser data layer (ADR-009 stage 1).
 *
 * Pure: no `next/*`, no `server-only`, no cookies, no database client. The
 * database (RLS, constraints, triggers and RPCs) remains the authority; these
 * rules only refuse early and phrase refusals the same way on both paths.
 */
import type { ActionResult } from "../types";

export type AreaKind = "garden" | "plot" | "seed";
export type ArchivableKind = AreaKind | "entry";
export type SignOutScope = "local" | "global";

const UUID_STRICT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The looser identifier shape the history route and revision lookup accept. */
const UUID_LOOSE = /^[0-9a-f-]{36}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_STRICT.test(value);
}
export function isLooseUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_LOOSE.test(value);
}

/* ---------- blank text and length ---------- */

/**
 * Exactly the characters `String.prototype.trim()` removes (ECMAScript
 * WhiteSpace and LineTerminator). The database holds the same list in
 * `private.trim_text` (migration 20261116041903); rules.test.ts compares the
 * two, and compares this list with `trim()` for every code point. Zero-width
 * space (U+200B), the joiners, U+2060, U+180E and U+0085 are not in it: a
 * name made only of those is not blank on the server path or in the database.
 */
export const BLANK_CHARACTERS =
  "\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680" +
  "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A" +
  "\u2028\u2029\u202F\u205F\u3000\uFEFF";

/** What the validation rules mean by blank: nothing left after `trim()`. */
export function isBlank(value: string): boolean {
  return value.trim() === "";
}

/**
 * Length limits, in UTF-16 code units (`String.length`). The database counts
 * the same way (`private.utf16_length`), so an emoji costs two on both sides.
 */
export const TEXT_LIMITS = {
  gardenName: 120,
  topicName: 120,
  thoughtTitle: 160,
  entryBody: 20000,
  timezone: 64,
} as const;

/* ---------- capabilities ---------- */

/** What `public.garden_capabilities()` answers for the signed-in account. */
export type Capabilities = { tending: boolean; deletion: boolean };
/** Deployment switches supplied by whoever builds the store (the server's environment flags). */
export type AvailabilityFlags = {
  aiAvailable: boolean;
  deletionAvailable: boolean;
};
export const NOTHING_AVAILABLE: AvailabilityFlags = {
  aiAvailable: false,
  deletionAvailable: false,
};

/** Only literal `true` enables anything; a malformed answer enables nothing. */
export function gardenCapabilities(value: unknown): Capabilities {
  const row =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { tending: row.tending === true, deletion: row.deletion === true };
}

/**
 * How the two switches combine: both must allow.
 *
 * - `capabilities` present (the database has `garden_capabilities()`): a
 *   feature is available when the database allows it AND the supplied flag
 *   does. With no flags supplied (a build with no server to read an
 *   environment), the database decides alone.
 * - `capabilities` null (a database that predates the RPC): only explicitly
 *   supplied flags count, exactly as before the RPC existed; with none,
 *   nothing is available.
 */
export function availability(
  flags: AvailabilityFlags | undefined,
  capabilities: Capabilities | null,
): AvailabilityFlags {
  if (!capabilities) return flags ?? NOTHING_AVAILABLE;
  return {
    aiAvailable: (flags?.aiAvailable ?? true) && capabilities.tending,
    deletionAvailable: (flags?.deletionAvailable ?? true) && capabilities.deletion,
  };
}

/** PostgREST and Postgres codes for "no such function": the migration is not applied. */
export function rpcMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "PGRST202" || code === "42883";
}

/* ---------- areas and archiving ---------- */

export function areaTable(kind: AreaKind): "gardens" | "plots" | "seeds" {
  return kind === "garden" ? "gardens" : kind === "plot" ? "plots" : "seeds";
}
export function archivableTable(
  kind: ArchivableKind,
): "gardens" | "plots" | "seeds" | "entries" {
  return kind === "entry" ? "entries" : areaTable(kind);
}
/**
 * Gardens and thoughts carry a status beside the timestamp (a database check
 * ties the two together); topics and entries carry the timestamp alone.
 */
export function archivePatch(
  kind: ArchivableKind,
  archived: boolean,
  now: Date,
):
  | { status: "archived" | "active"; archived_at: string | null }
  | { archived_at: string | null } {
  const archived_at = archived ? now.toISOString() : null;
  return kind === "garden" || kind === "seed"
    ? { status: archived ? "archived" : "active", archived_at }
    : { archived_at };
}

/* ---------- session ---------- */

export const SIGN_IN_AGAIN = "Please sign in again. Your draft is still here.";
export const SIGN_IN_AGAIN_IMPORT =
  "Please sign in again. Your files are still here.";
export const SIGN_OUT_FAILED = "Sign-out failed. Please retry.";

export function assertSignOutScope(
  scope: unknown,
): asserts scope is SignOutScope {
  if (scope !== "local" && scope !== "global")
    throw new Error("Invalid sign-out scope");
}

/* ---------- returns: passes, blooms and marks ---------- */

export const AI_UNAVAILABLE =
  "AI reflections are not enabled yet. Your writing remains available.";
export const PASS_REQUEST_FAILED =
  "Could not invite a reflection. Please retry.";
export const PASS_CANCEL_FAILED =
  "Could not cancel. Refresh to see its current state.";
export const RESPONSE_FAILED = "Could not save your response. Please retry.";
export const PREFERENCE_FAILED =
  "Could not save that preference. Please retry.";
export const RETURNS_UNAVAILABLE = "Returns unavailable";

/** The database refused the pass (`prepare_pass`); say why without internals. */
export function passRequestRefusal(error: unknown): ActionResult {
  const code = (error as { code?: string } | null)?.code;
  return {
    ok: false,
    message:
      code === "55000"
        ? "A reflection is already pending, the AI budget is reached, or the quality gate is not active. Try again later."
        : "Check the selected topics and their tending settings before retrying.",
  };
}

export function validateMarkResponse(response: unknown): string | null {
  return response === "keep" || response === "prune"
    ? null
    : "Choose keep or prune.";
}

/** A correction is stored only with a `correct` response. */
export function bloomCorrection(
  response: "keep" | "correct" | "prune",
  correction: string,
): string | null {
  return response === "correct" ? correction : null;
}

/** At most 200 distinct, well-formed revision ids per lookup. */
export function revisionLookupIds(revisionIds: readonly string[]): string[] {
  return Array.from(new Set(revisionIds)).filter(isLooseUuid).slice(0, 200);
}

/* ---------- import ---------- */

export const IMPORT_FAILED =
  "Could not import. Your files are unchanged; please retry.";
export const IMPORT_CHECK_INPUT = "Check the topic and entries, then retry.";
export const IMPORT_TOPIC_UNAVAILABLE = "Choose an active topic.";
/** SQLSTATE raised when a thought or import targets a missing or archived topic or garden. */
export const TOPIC_UNAVAILABLE = "SGA02";
/** One import: at most this many entries (also enforced by `import_thought`). */
export const IMPORT_MAX_ENTRIES = 500;
/**
 * One import: title plus bodies, in UTF-8 bytes. A server action request is
 * capped at 1 MB by Next; `import_thought` holds the same figure for callers
 * that have no such ceiling.
 */
export const IMPORT_MAX_BYTES = 1_048_576;

export function importBytes(input: {
  title: string;
  entries: readonly { body: string }[];
}): number {
  const encoder = new TextEncoder();
  let total = encoder.encode(input.title).length;
  for (const entry of input.entries) total += encoder.encode(entry.body).length;
  return total;
}

/** What `import_thought` returns, or null when it is not that shape. */
export function importReceipt(
  value: unknown,
): { id: string; created: number; skipped: number } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" &&
    typeof row.created === "number" &&
    typeof row.skipped === "number"
    ? { id: row.id, created: row.created, skipped: row.skipped }
    : null;
}

/* ---------- permanent deletion ---------- */

export type DeletionKind = "entry" | "seed" | "plot" | "garden" | "account";
export type DeletionCounts = {
  gardens: number;
  topics: number;
  thoughts: number;
  entries: number;
  versions: number;
  returns: number;
  responses: number;
  marks: number;
};
export type DeletionPreview =
  | { ok: true; counts: DeletionCounts; confirmPhrase: string | null }
  | { ok: false; message: string };
export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; message: string; reauth?: true };

export const DELETION_KINDS: readonly DeletionKind[] = [
  "entry",
  "seed",
  "plot",
  "garden",
  "account",
];
export const DELETION_UNAVAILABLE =
  "Deletion is not available yet. Nothing was erased.";
export const DELETION_NOT_HERE = "That item cannot be deleted from here.";
export const DELETION_COUNT_FAILED =
  "Could not count what this would erase. Nothing was erased.";
export const DELETION_SIGN_IN = "Please sign in again. Nothing was erased.";
export const DELETION_GONE =
  "This is no longer here. It may already have been deleted.";
export const DELETION_FAILED =
  "Could not delete. Nothing was erased; please retry.";
export const ACCOUNT_DELETION_FAILED =
  "Could not delete the account. Nothing was erased; please retry.";
/** SQLSTATE raised by delete_account when the session is not a live, recent sign-in. */
export const RECENT_SIGN_IN_REQUIRED = "SGA01";

/** A preview may name the account (no id); every other scope needs a UUID. */
export function isPreviewTarget(kind: unknown, id: unknown): boolean {
  return (
    DELETION_KINDS.includes(kind as DeletionKind) &&
    (kind === "account" || isUuid(id))
  );
}
/** Item deletion never accepts the account scope. */
export function isDeleteItemTarget(kind: unknown, id: unknown): boolean {
  return (
    DELETION_KINDS.includes(kind as DeletionKind) &&
    kind !== "account" &&
    isUuid(id)
  );
}

export function deletionCounts(value: unknown): DeletionCounts | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const read = (key: keyof DeletionCounts) =>
    typeof row[key] === "number" ? (row[key] as number) : 0;
  return {
    gardens: read("gardens"),
    topics: read("topics"),
    thoughts: read("thoughts"),
    entries: read("entries"),
    versions: read("versions"),
    returns: read("returns"),
    responses: read("responses"),
    marks: read("marks"),
  };
}

/** SQLSTATE raised by every deletion RPC while the database's deletion switch is off. */
export const DELETION_SWITCHED_OFF = "SGA03";

/**
 * Deletion is unavailable: its RPCs are not installed yet, or the database's
 * deployment switch is off. Either way, say so plainly.
 */
export function deletionMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return rpcMissing(error) || code === DELETION_SWITCHED_OFF;
}

export function deletionPreviewFailure(error: unknown): DeletionPreview {
  return {
    ok: false,
    message: deletionMissing(error)
      ? DELETION_UNAVAILABLE
      : DELETION_COUNT_FAILED,
  };
}

export function deletionFailure(error: unknown): ActionResult {
  const code = (error as { code?: string } | null)?.code;
  return {
    ok: false,
    message: deletionMissing(error)
      ? DELETION_UNAVAILABLE
      : code === "22023"
        ? "The name you typed does not match. Nothing was erased."
        : code === "40P01" || code === "55P03"
          ? "The garden was busy for a moment. Nothing was erased; please try again."
          : DELETION_FAILED,
  };
}

export function accountDeletionFailure(error: unknown): DeleteAccountResult {
  const code = (error as { code?: string } | null)?.code;
  if (code === RECENT_SIGN_IN_REQUIRED)
    return {
      ok: false,
      reauth: true,
      message:
        "For your safety, deleting an account needs a sign-in from the last ten minutes. Nothing was erased.",
    };
  if (code === "22023")
    return {
      ok: false,
      message: "What you typed does not match. Nothing was erased.",
    };
  return deletionFailure(error) as DeleteAccountResult;
}

/** The phrase to type before an account is erased: its email, or a fixed fallback. */
export function accountConfirmPhrase(email: unknown): string {
  return (typeof email === "string" ? email.trim() : "") || "delete my account";
}

/** Arguments for `deletion_preview`; the account scope carries no id. */
export function deletionPreviewArgs(
  kind: DeletionKind,
  id: string,
): { p_kind: DeletionKind; p_id?: string } {
  return kind === "account" ? { p_kind: kind } : { p_kind: kind, p_id: id };
}

/* ---------- export and history ---------- */

export type ExportFormat = "json" | "md";
export const EXPORT_FAILED = "Export failed; no partial export was produced.";

/**
 * Only an absent relation is optional (the web release may precede the tending
 * migration). Any other failure must fail the whole export.
 */
export function isAbsentRelation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "PGRST205" || code === "42P01";
}

export function exportMimeType(format: ExportFormat): string {
  return format === "md" ? "text/markdown; charset=utf-8" : "application/json";
}
