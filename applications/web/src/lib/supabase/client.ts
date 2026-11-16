import { createBrowserClient } from "@supabase/ssr";
import { createClient as createStorageClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** The publishable key and URL are public build-time values; no secret lives here. */
export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * Where this build keeps the session. The hosted app keeps it in cookies, so
 * its server can read it. A static export (`GARDEN_STATIC_EXPORT=1`, which
 * sets `NEXT_PUBLIC_GARDEN_TARGET=static`) has no server and may run on an
 * origin where cookies do not work (a native shell's local scheme), so it
 * keeps the session in this browser's own storage.
 */
export function sessionStorageKind(): "cookies" | "browser-storage" {
  return process.env.NEXT_PUBLIC_GARDEN_TARGET === "static" ? "browser-storage" : "cookies";
}

let stored: SupabaseClient<Database> | undefined;

export function createClient() {
  if (sessionStorageKind() === "browser-storage")
    // One client per page: one session, one refresh timer. The session is
    // never read from the address (sign-in is a typed code, not a link).
    return (stored ??= createStorageClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
    ));
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
