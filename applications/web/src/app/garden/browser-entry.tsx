"use client";
/**
 * Browser-mode entry (ADR-009 stage 2): the garden and the import page with
 * no server render of private data. The page loads through the store, the
 * session is checked here rather than by a server redirect, and a change is
 * followed by a re-read through the store rather than a server refresh.
 *
 * Nothing reachable from this module may be server-only; see
 * lib/garden/store/static-readiness.test.ts.
 */
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import Loading from "@/app/loading";
import ErrorPage from "@/app/error";
import { LoginScreen } from "@/app/login/login-screen";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { GardenReloadContext, useGardenData } from "@/lib/garden/store/context";
import type { GardenData } from "@/lib/garden/types";
import { GardenWorkspace } from "./workspace";
import { ImportForm } from "./import/import-form";

/**
 * Loading, signed-out, error and ready. Private data is rendered only once a
 * session has been confirmed by the store; RLS, not this guard, is what
 * protects it.
 */
function GardenGate({ children }: { children: (data: GardenData) => ReactNode }) {
  const requested = useSearchParams().get("garden") || undefined;
  const { status, data, reload } = useGardenData(requested);
  if (status === "signed-out")
    return (
      <LoginScreen
        configured={isSupabaseConfigured()}
        onSignedIn={() => void reload()}
      />
    );
  if (!data)
    return status === "error" ? (
      <ErrorPage reset={() => void reload()} />
    ) : (
      <Loading />
    );
  // Another garden was asked for and has not arrived: say so, rather than
  // show the previous garden under the new address.
  if (status === "loading" && requested && requested !== data.gardenId)
    return <Loading />;
  return (
    <GardenReloadContext.Provider value={reload}>
      {children(data)}
    </GardenReloadContext.Provider>
  );
}

export function BrowserGarden() {
  return <GardenGate>{(data) => <GardenWorkspace data={data} />}</GardenGate>;
}

export function BrowserImport() {
  return (
    <GardenGate>
      {(data) => (
        <ImportForm
          key={data.gardenId}
          gardens={data.gardens}
          gardenId={data.gardenId}
          plots={data.plots.filter((p) => !p.archived_at)}
        />
      )}
    </GardenGate>
  );
}
