"use server";
/**
 * Server half of the `server` store: the session check and loader that
 * `app/garden/page.tsx` performs today, callable from a client hook so a
 * reload does not need `router.refresh()`. Reads only the caller's own data,
 * under RLS, with the cookie session. Removed together with the server actions.
 */
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { loadGarden } from "@/lib/garden/data";
import type { GardenLoad, StoreSession } from "./types";

export async function readSession(): Promise<StoreSession> {
  if (!isSupabaseConfigured()) return { signedIn: false };
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) return { signedIn: false };
  return {
    signedIn: true,
    tenantId: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
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
