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

/** Deletion RPCs arrive with their own reviewed migration; before it, say so plainly. */
export function deletionMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "PGRST202" || code === "42883";
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
