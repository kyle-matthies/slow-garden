import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { confirmedSession } from "@/lib/supabase/session";
import { StoreBoundary } from "@/app/garden/store-boundary";
import { LoginScreen } from "./login-screen";

export const metadata: Metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (isSupabaseConfigured()) {
    const db = await createClient();
    // The same confirmed check the garden makes, so a session ended elsewhere
    // lands here and is not sent back and forth. No session cookie, no call.
    if (await confirmedSession(db)) redirect("/garden");
  }
  return (
    <StoreBoundary>
      <LoginScreen configured={isSupabaseConfigured()} />
    </StoreBoundary>
  );
}
