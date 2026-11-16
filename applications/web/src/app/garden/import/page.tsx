import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Loading from "@/app/loading";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { loadGarden } from "@/lib/garden/data";
import { storeKind } from "@/lib/garden/store/select";
import { BrowserImport } from "../browser-entry";
import { StoreBoundary } from "../store-boundary";
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
  if (storeKind() === "browser")
    return (
      <StoreBoundary>
        <Suspense fallback={<Loading />}>
          <BrowserImport />
        </Suspense>
      </StoreBoundary>
    );
  if (!isSupabaseConfigured()) redirect("/login");
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  const params = await searchParams;
  const garden = await loadGarden(data.claims.sub, params.garden);
  return (
    <StoreBoundary>
      <ImportForm
        key={garden.gardenId}
        gardens={garden.gardens}
        gardenId={garden.gardenId}
        plots={garden.plots.filter((p) => !p.archived_at)}
      />
    </StoreBoundary>
  );
}
