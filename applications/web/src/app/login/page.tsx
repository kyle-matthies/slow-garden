import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { StoreBoundary } from "@/app/garden/store-boundary";
import { LoginScreen } from "./login-screen";

export const metadata: Metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (isSupabaseConfigured()) {
    const db = await createClient();
    const { data, error } = await db.auth.getClaims();
    if (!error && data?.claims?.sub) redirect("/garden");
  }
  return (
    <StoreBoundary>
      <LoginScreen configured={isSupabaseConfigured()} />
    </StoreBoundary>
  );
}
