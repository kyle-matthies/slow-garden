import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { loadGarden } from "@/lib/garden/data";
import { GardenWorkspace } from "./workspace";
export const metadata: Metadata = {
  title: "Your garden",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function GardenPage({
  searchParams,
}: {
  searchParams: Promise<{ garden?: string }>;
}) {
  if (!isSupabaseConfigured()) redirect("/login");
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  const params = await searchParams;
  return (
    <GardenWorkspace data={await loadGarden(data.claims.sub, params.garden)} />
  );
}
