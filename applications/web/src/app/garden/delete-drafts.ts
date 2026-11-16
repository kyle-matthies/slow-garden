import {
  broadcastDraftsCleared,
  clearLegacySessionDrafts,
  markDraftsCleared,
  openDraftStore,
  type DraftRecord,
} from "@/lib/garden/drafts";

/** Which unsaved browser drafts belong to writing that was just erased. */
export type DeletedWriting =
  | { entryId: string }
  | { seedIds: readonly string[] }
  | { everything: true };

export function draftBelongsTo(
  record: Pick<DraftRecord, "seedId" | "entryId" | "scope">,
  deleted: DeletedWriting,
): boolean {
  if ("everything" in deleted) return true;
  if ("entryId" in deleted)
    return record.scope === "revise" && record.entryId === deleted.entryId;
  return deleted.seedIds.includes(record.seedId);
}

/**
 * Deletion on the server must not leave the same words waiting in this
 * browser. Best effort: storage can be unavailable, and that never blocks
 * or reverses the deletion itself.
 */
export async function discardDeletedDrafts(
  tenantId: string,
  deleted: DeletedWriting,
): Promise<void> {
  try {
    const store = await openDraftStore();
    if ("everything" in deleted) {
      let local: Storage | null = null;
      try {
        local = localStorage;
      } catch {
        local = null;
      }
      markDraftsCleared(local, tenantId);
      broadcastDraftsCleared(tenantId);
      await store?.clear(tenantId);
      clearLegacySessionDrafts(sessionStorage, tenantId);
      return;
    }
    if (!store) return;
    for (const record of await store.list(tenantId))
      if (draftBelongsTo(record, deleted)) await store.remove(record.key);
  } catch {
    // The words are gone from the account; a stray local draft is the person's to discard.
  }
}
