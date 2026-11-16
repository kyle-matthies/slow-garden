/**
 * GardenStore over today's server actions, loader and route handlers
 * (ADR-009 stage 1). A thin adapter: it adds no rule and changes no behaviour.
 * The actions are passed in, so this module itself imports nothing server-side.
 */
import type { ActionResult } from "../types";
import type { ImportInput } from "@/app/garden/import/import-core";
import type {
  ArchivableKind,
  AreaKind,
  DeleteAccountResult,
  DeletionKind,
  DeletionPreview,
  SignOutScope,
} from "./rules";
import type { Db, EntryRevision } from "./queries";
import { exportMimeType } from "./rules";
import { requestEmailCode, verifyEmailCode } from "./auth";
import type {
  ExportRequest,
  GardenLoad,
  GardenStore,
  ImportResult,
  ReturnsData,
  RevisionLocation,
  SaveEntryInput,
  StoreSession,
} from "./types";

/** The server functions the app calls today, by their current names. */
export type ServerActions = {
  readSession(): Promise<StoreSession>;
  loadGardenForSession(requestedGardenId?: string): Promise<GardenLoad>;
  readReturns(gardenId: string): Promise<ReturnsData>;
  locateRevisions(revisionIds: string[]): Promise<Record<string, RevisionLocation>>;
  createArea(kind: AreaKind, name: string, parentId: string, id: string): Promise<ActionResult>;
  saveEntry(input: SaveEntryInput): Promise<ActionResult>;
  setArchived(kind: ArchivableKind, id: string, archived: boolean): Promise<ActionResult>;
  setPlotPermissions(id: string, ai: boolean, cross: boolean): Promise<ActionResult>;
  setTendingPreferences(tendOvernight: boolean, timezone: string): Promise<ActionResult>;
  inviteReflection(gardenId: string, plotIds: string[], id: string): Promise<ActionResult>;
  cancelReflection(id: string): Promise<ActionResult>;
  respondToBloom(
    id: string,
    bloomId: string,
    response: "keep" | "correct" | "prune",
    correction: string,
  ): Promise<ActionResult>;
  respondToMark(id: string, markId: string, response: "keep" | "prune"): Promise<ActionResult>;
  importThought(input: ImportInput): Promise<ImportResult>;
  previewDeletion(kind: DeletionKind, id: string): Promise<DeletionPreview>;
  deleteItem(
    kind: Exclude<DeletionKind, "account">,
    id: string,
    confirmName?: string,
  ): Promise<ActionResult>;
  deleteAccount(confirm: string): Promise<DeleteAccountResult>;
  signOut(scope?: SignOutScope): Promise<{ ok: boolean }>;
};

export type ServerActionStoreOptions = {
  actions: ServerActions;
  /** Same-origin fetch for `/garden/export` and `/garden/history`. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Sign-in codes are requested from the browser client today. */
  authClient: () => Db;
};

export function exportPath({ format, gardenId }: ExportRequest): string {
  const params = new URLSearchParams();
  if (format === "md") params.set("format", "md");
  if (gardenId) params.set("garden", gardenId);
  const query = params.toString();
  return `/garden/export${query ? `?${query}` : ""}`;
}

function attachmentName(response: Response, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(
    response.headers.get("Content-Disposition") ?? "",
  );
  return match?.[1] ?? fallback;
}

export function createServerActionStore(
  options: ServerActionStoreOptions,
): GardenStore {
  const { actions } = options;
  return {
    kind: "server",

    getSession: () => actions.readSession(),
    requestEmailCode: (email, o) => requestEmailCode(options.authClient(), email, o),
    verifyEmailCode: (email, code) => verifyEmailCode(options.authClient(), email, code),
    async signOut(scope = "local") {
      await actions.signOut(scope);
      return { ok: true };
    },

    loadGarden: (requested) => actions.loadGardenForSession(requested),
    loadReturns: (gardenId) => actions.readReturns(gardenId),
    locateRevisions: (ids) => actions.locateRevisions(ids),
    async loadEntryHistory(entryId) {
      let response: Response;
      try {
        response = await options.fetch(
          `/garden/history?entry=${encodeURIComponent(entryId)}`,
          { cache: "no-store" },
        );
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      if (response.status === 401) return { ok: false, reason: "signed-out" };
      if (response.status === 400) return { ok: false, reason: "invalid-entry" };
      if (!response.ok) return { ok: false, reason: "unavailable" };
      return { ok: true, revisions: (await response.json()) as EntryRevision[] };
    },

    createArea: (kind, name, parentId, id) => actions.createArea(kind, name, parentId, id),
    saveEntry: (input) => actions.saveEntry(input),
    setArchived: (kind, id, archived) => actions.setArchived(kind, id, archived),

    setTopicTending: (id, ai, cross) => actions.setPlotPermissions(id, ai, cross),
    setTendingPreferences: (overnight, timezone) =>
      actions.setTendingPreferences(overnight, timezone),

    requestPass: (gardenId, topicIds, id) => actions.inviteReflection(gardenId, topicIds, id),
    cancelPass: (id) => actions.cancelReflection(id),
    respondToBloom: (id, bloomId, response, correction) =>
      actions.respondToBloom(id, bloomId, response, correction),
    respondToMark: (id, markId, response) => actions.respondToMark(id, markId, response),

    importThought: (input) => actions.importThought(input),
    async exportGarden(request) {
      const format = request.format === "md" ? "md" : "json";
      let response: Response;
      try {
        response = await options.fetch(exportPath({ ...request, format }), {
          cache: "no-store",
        });
      } catch {
        return {
          ok: false,
          reason: "unavailable",
          message: "Export failed; no partial export was produced.",
        };
      }
      const text = await response.text();
      if (!response.ok)
        return {
          ok: false,
          reason:
            response.status === 401
              ? "signed-out"
              : response.status === 400
                ? "invalid-garden"
                : response.status === 404
                  ? "garden-not-found"
                  : "unavailable",
          message: text,
        };
      return {
        ok: true,
        filename: attachmentName(response, `slow-garden-export.${format}`),
        mimeType: response.headers.get("Content-Type") ?? exportMimeType(format),
        text,
      };
    },

    previewDeletion: (kind, id) => actions.previewDeletion(kind, id),
    deleteItem: (kind, id, confirmName) => actions.deleteItem(kind, id, confirmName),
    deleteAccount: (confirm) => actions.deleteAccount(confirm),
  };
}
