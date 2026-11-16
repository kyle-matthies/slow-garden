/**
 * GardenStore: every data operation the web app performs, behind one interface
 * (ADR-009 stage 1). Two implementations exist:
 *
 * - `server` — a thin adapter over today's server actions, loader and route
 *   handlers. Behaviour is unchanged.
 * - `browser` — talks to Supabase from the browser with the publishable key and
 *   the person's own session. RLS and the existing RPCs are the only authority.
 *
 * Result shapes are the ones the server actions already return, so a component
 * can move from an imported action to a store method without other changes.
 */
import type { Tables } from "@/types/database";
import type { ActionResult, GardenData } from "../types";
import type { ImportInput } from "@/app/garden/import/import-core";
import type {
  ArchivableKind,
  AreaKind,
  DeleteAccountResult,
  DeletionKind,
  DeletionPreview,
  ExportFormat,
  SignOutScope,
} from "./rules";
import type { EntryRevision, ExportFile } from "./queries";

export type StoreKind = "server" | "browser";

export type StoreSession =
  | { signedIn: true; tenantId: string; email: string | null }
  | { signedIn: false };

/** A sign-in step either worked or carries the auth service's own message. */
export type AuthStepResult = { ok: true } | { ok: false; message: string };

/** The loader never redirects; the caller decides what a signed-out visit means. */
export type GardenLoad =
  | { signedIn: true; data: GardenData }
  | { signedIn: false };

export type ReturnsData = {
  passes: Tables<"garden_passes">[];
  blooms: Tables<"blooms">[];
  responses: Tables<"bloom_responses">[];
};

export type RevisionLocation = {
  entry_id: string;
  seed_id: string;
  revision_number: number;
  created_at: string;
};

export type SaveEntryInput = {
  seedId: string;
  entryId: string;
  revisionId: string;
  body: string;
  expectedRevisionId: string | null;
};

export type ImportResult = ActionResult & { created?: number; skipped?: number };

export type EntryHistoryResult =
  | { ok: true; revisions: EntryRevision[] }
  | { ok: false; reason: "signed-out" | "invalid-entry" | "unavailable" };

export type ExportRequest = { format: ExportFormat; gardenId?: string };
export type ExportResult =
  | ({ ok: true } & ExportFile)
  | {
      ok: false;
      reason: "signed-out" | "invalid-garden" | "garden-not-found" | "unavailable";
      message: string;
    };

export interface GardenStore {
  readonly kind: StoreKind;

  /* Session */
  getSession(): Promise<StoreSession>;
  /** Email a six-digit code. `createAccount: false` is the re-authentication step. */
  requestEmailCode(
    email: string,
    options?: { createAccount?: boolean },
  ): Promise<AuthStepResult>;
  verifyEmailCode(email: string, code: string): Promise<AuthStepResult>;
  /** Rejects when sign-out fails, as the server action does. */
  signOut(scope?: SignOutScope): Promise<{ ok: true }>;

  /* Reads */
  /** Gardens, the chosen garden's topics, thoughts and entries, tending, history, account. */
  loadGarden(requestedGardenId?: string): Promise<GardenLoad>;
  /** Rejects when signed out or unavailable, as the server action does. */
  loadReturns(gardenId: string): Promise<ReturnsData>;
  locateRevisions(revisionIds: string[]): Promise<Record<string, RevisionLocation>>;
  loadEntryHistory(entryId: string): Promise<EntryHistoryResult>;

  /* Gardens, topics, thoughts, entries */
  createArea(kind: AreaKind, name: string, parentId: string, id: string): Promise<ActionResult>;
  saveEntry(input: SaveEntryInput): Promise<ActionResult>;
  /** Archive (`true`) or restore (`false`) a garden, topic, thought or entry. */
  setArchived(kind: ArchivableKind, id: string, archived: boolean): Promise<ActionResult>;

  /* Tending settings and account preferences */
  setTopicTending(topicId: string, ai: boolean, crossPollinate: boolean): Promise<ActionResult>;
  setTendingPreferences(tendOvernight: boolean, timezone: string): Promise<ActionResult>;

  /* Returns */
  requestPass(gardenId: string, topicIds: string[], id: string): Promise<ActionResult>;
  cancelPass(id: string): Promise<ActionResult>;
  respondToBloom(
    id: string,
    bloomId: string,
    response: "keep" | "correct" | "prune",
    correction: string,
  ): Promise<ActionResult>;
  respondToMark(id: string, markId: string, response: "keep" | "prune"): Promise<ActionResult>;

  /* Import and export */
  importThought(input: ImportInput): Promise<ImportResult>;
  exportGarden(request: ExportRequest): Promise<ExportResult>;

  /* Permanent deletion */
  previewDeletion(kind: DeletionKind, id: string): Promise<DeletionPreview>;
  deleteItem(
    kind: Exclude<DeletionKind, "account">,
    id: string,
    confirmName?: string,
  ): Promise<ActionResult>;
  deleteAccount(confirm: string): Promise<DeleteAccountResult>;
}

/** Every operation name, for coverage checks and the action-to-method table. */
export const STORE_OPERATIONS = [
  "getSession",
  "requestEmailCode",
  "verifyEmailCode",
  "signOut",
  "loadGarden",
  "loadReturns",
  "locateRevisions",
  "loadEntryHistory",
  "createArea",
  "saveEntry",
  "setArchived",
  "setTopicTending",
  "setTendingPreferences",
  "requestPass",
  "cancelPass",
  "respondToBloom",
  "respondToMark",
  "importThought",
  "exportGarden",
  "previewDeletion",
  "deleteItem",
  "deleteAccount",
] as const satisfies readonly (keyof Omit<GardenStore, "kind">)[];

export type { EntryRevision, ExportFile, ExportFormat };
export type {
  ArchivableKind,
  AreaKind,
  DeleteAccountResult,
  DeletionKind,
  DeletionPreview,
  SignOutScope,
};
