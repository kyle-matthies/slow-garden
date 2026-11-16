"use client";
import { DeleteControl } from "./delete-control";
import { discardDeletedDrafts } from "./delete-drafts";
import { useDeletionEnabled } from "./delete-flag";

/** Where a browser goes once its account no longer exists. */
export const ACCOUNT_DELETED_PATH = "/account/deleted";

/**
 * Settings: delete this garden, or the whole account. Sits after export so a
 * copy is always one step away, and says plainly how it differs from archive.
 */
export function DeleteZone({
  tenantId,
  garden,
  seedIds,
  go = (path: string) => window.location.assign(path),
}: {
  tenantId: string;
  garden?: { id: string; name: string };
  /** Thoughts in the current garden, so their unsaved drafts can be discarded. */
  seedIds: readonly string[];
  go?: (path: string) => void;
}) {
  // Off, or not yet known: the section is not rendered at all.
  if (!useDeletionEnabled()) return null;
  return (
    <section className="delete-zone" aria-labelledby="delete-zone-title">
      <h3 id="delete-zone-title">Delete</h3>
      <p>
        Archive hides. Delete erases, permanently. Deleting removes your
        writing, every saved version, and any blooms or marks that tending
        drew from it. Export first if you want a copy.
      </p>
      <div className="delete-row">
        {garden && (
          <DeleteControl
            kind="garden"
            id={garden.id}
            name={garden.name}
            exportGardenId={garden.id}
            onDeleted={async () => {
              await discardDeletedDrafts(tenantId, { seedIds });
              go("/garden");
            }}
          />
        )}
        <DeleteControl
          kind="account"
          id=""
          name="your account"
          onDeleted={async () => {
            await discardDeletedDrafts(tenantId, { everything: true });
            go(ACCOUNT_DELETED_PATH);
          }}
        />
      </div>
    </section>
  );
}
