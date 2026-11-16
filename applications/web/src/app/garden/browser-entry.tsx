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
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import Loading from "@/app/loading";
import ErrorPage from "@/app/error";
import { LoginScreen } from "@/app/login/login-screen";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  GardenRefreshFailedContext,
  GardenReloadContext,
  StoreContext,
  useGardenData,
  useGardenStore,
} from "@/lib/garden/store/context";
import { createGuardView, guardStore } from "@/lib/garden/store/guard";
import type { GardenData } from "@/lib/garden/types";
import { GardenWorkspace } from "./workspace";
import { ImportForm } from "./import/import-form";

/**
 * Loading, signed-out, error and ready. Private data is rendered only once a
 * session has been confirmed by the store; RLS, not this guard, is what
 * protects it.
 *
 * What is rendered is always the garden the address names (`useGardenData`
 * gives no data for any other). While another garden loads the loading state
 * shows; if that load fails the error screen shows, with a retry and a way
 * back, and never the previous garden's workspace. A failed re-read of the
 * garden already on screen keeps the page (and any unsaved writing in it) and
 * says the refresh failed. Writes go through `guardStore`, which refuses
 * anything not in the data on screen or not this account's.
 */
function GardenGate({ children }: { children: (data: GardenData) => ReactNode }) {
  const pathname = usePathname();
  const requested = useSearchParams().get("garden") || undefined;
  const { status, data, previous, reload } = useGardenData(requested);
  const base = useGardenStore();
  // What is on screen now (null while no garden is shown), told to the guard
  // after every render so a write is checked against what the person sees.
  const [guard] = useState(createGuardView);
  const showing = status === "signed-out" ? null : (data ?? null);
  useEffect(() => {
    // Another account's session is not followed automatically: the page
    // stays as it is, refuses to write, and says to reload.
    guard.show(showing, () => {});
  });
  const store = useMemo(() => guardStore(base, guard), [base, guard]);
  if (status === "signed-out")
    return (
      <LoginScreen
        configured={isSupabaseConfigured()}
        onSignedIn={() => void reload()}
      />
    );
  if (!data) {
    if (status !== "error") return <Loading />;
    const back = previous?.gardens.find((g) => g.id === previous.gardenId);
    return (
      <ErrorPage reset={() => void reload()}>
        {back && (
          <>
            {" "}
            <Link className="plain-button" href={`${pathname}?garden=${back.id}`}>
              Back to {back.name}
            </Link>
          </>
        )}
      </ErrorPage>
    );
  }
  return (
    <StoreContext.Provider value={store}>
      <GardenReloadContext.Provider value={reload}>
        <GardenRefreshFailedContext.Provider value={status === "error"}>
          {/* A different account or garden is a different page: no state carries over. */}
          <Fragment key={`${data.tenantId}:${data.gardenId}`}>{children(data)}</Fragment>
        </GardenRefreshFailedContext.Provider>
      </GardenReloadContext.Provider>
    </StoreContext.Provider>
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
