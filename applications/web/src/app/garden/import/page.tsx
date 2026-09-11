import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { loadGarden } from "@/lib/garden/data";
import { ImportForm } from "./import-form";
export const metadata: Metadata = {
  title: "Import notes",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ garden?: string }>;
}) {
  if (!isSupabaseConfigured()) redirect("/login");
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  const params = await searchParams;
  const garden = await loadGarden(data.claims.sub, params.garden);
  return (
    <ImportForm
      key={garden.gardenId}
      gardens={garden.gardens}
      gardenId={garden.gardenId}
      plots={garden.plots.filter((p) => !p.archived_at)}
    />
  );
}
