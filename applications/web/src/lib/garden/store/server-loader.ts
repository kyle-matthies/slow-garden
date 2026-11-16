"use server";
/**
 * Server half of the `server` store: the session check and loader that
 * `app/garden/page.tsx` performs today, callable from a client hook so a
 * reload does not need `router.refresh()`. Reads only the caller's own data,
 * under RLS, with the cookie session, confirmed with the auth server each time. Removed together with the server actions.
 */
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { confirmedSession } from "@/lib/supabase/session";
import { loadGarden } from "@/lib/garden/data";
import type { GardenLoad, StoreSession } from "./types";

export async function readSession(): Promise<StoreSession> {
  if (!isSupabaseConfigured()) return { signedIn: false };
  const db = await createClient();
  const session = await confirmedSession(db);
  return session ? { signedIn: true, ...session } : { signedIn: false };
}

export async function loadGardenForSession(
  requestedGardenId?: string,
): Promise<GardenLoad> {
  const session = await readSession();
  if (!session.signedIn) return { signedIn: false };
  return {
    signedIn: true,
    data: await loadGarden(
      session.tenantId,
      typeof requestedGardenId === "string" ? requestedGardenId : undefined,
    ),
  };
}
