/**
 * Wires the `browser` store to the app's browser Supabase client. Loaded
 * lazily by select.ts. No server module may be imported from here.
 */
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { createBrowserStore } from "./browser-store";
import type { GardenFlags } from "./queries";
import type { GardenStore } from "./types";

export function createDefaultBrowserStore(flags?: () => GardenFlags): GardenStore {
  return createBrowserStore({
    client: createClient,
    configured: isSupabaseConfigured,
    flags,
  });
}
