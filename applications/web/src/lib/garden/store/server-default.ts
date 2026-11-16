/**
 * Wires the `server` store to the real server actions. Loaded lazily by
 * select.ts so a static (browser-only) build never bundles a server action.
 */
import * as gardenActions from "@/app/garden/actions";
import { importThought } from "@/app/garden/import/actions";
import { locateRevisions } from "@/app/garden/returns-lookup";
import { createClient } from "@/lib/supabase/client";
import { loadGardenForSession, readSession } from "./server-loader";
import { createServerActionStore } from "./server-action-store";
import type { GardenStore } from "./types";

export function createDefaultServerStore(): GardenStore {
  return createServerActionStore({
    actions: {
      readSession,
      loadGardenForSession,
      readReturns: gardenActions.readReturns,
      locateRevisions,
      createArea: gardenActions.createArea,
      saveEntry: gardenActions.saveEntry,
      setArchived: gardenActions.setArchived,
      setPlotPermissions: gardenActions.setPlotPermissions,
      setTendingPreferences: gardenActions.setTendingPreferences,
      inviteReflection: gardenActions.inviteReflection,
      cancelReflection: gardenActions.cancelReflection,
      respondToBloom: gardenActions.respondToBloom,
      respondToMark: gardenActions.respondToMark,
      importThought,
      previewDeletion: gardenActions.previewDeletion,
      deleteItem: gardenActions.deleteItem,
      deleteAccount: gardenActions.deleteAccount,
      signOut: gardenActions.signOut,
    },
    fetch: (url, init) => fetch(url, init),
    authClient: createClient,
  });
}
