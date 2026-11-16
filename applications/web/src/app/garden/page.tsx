import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Loading from "@/app/loading";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { loadGarden } from "@/lib/garden/data";
import { storeKind } from "@/lib/garden/store/select";
import { BrowserGarden } from "./browser-entry";
import { StoreBoundary } from "./store-boundary";
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
  // Browser mode: no cookie is read and nothing private is rendered here; the
  // client entry checks the session and loads through the store.
  if (storeKind() === "browser")
    return (
      <StoreBoundary>
        <Suspense fallback={<Loading />}>
          <BrowserGarden />
        </Suspense>
      </StoreBoundary>
    );
  if (!isSupabaseConfigured()) redirect("/login");
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  const params = await searchParams;
  return (
    <StoreBoundary>
      <GardenWorkspace data={await loadGarden(data.claims.sub, params.garden)} />
    </StoreBoundary>
  );
}
