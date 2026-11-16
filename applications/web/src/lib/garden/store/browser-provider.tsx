"use client";
/**
 * The browser store for the React tree, with no path to the server wiring:
 * this is the provider the browser-mode entry and a static build use. The
 * store is created once per mount; nothing is fetched until first use.
 */
import { useMemo, type ReactNode } from "react";
import { createDefaultBrowserStore } from "./browser-default";
import { StoreContext } from "./context";
import type { GardenFlags } from "./queries";

export function BrowserStoreProvider({
  aiAvailable,
  deletionAvailable,
  children,
}: {
  /** As for GardenStoreProvider: supplied by a server when there is one. */
  aiAvailable?: boolean;
  deletionAvailable?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    if (aiAvailable === undefined && deletionAvailable === undefined)
      return createDefaultBrowserStore();
    const flags: GardenFlags = {
      aiAvailable: aiAvailable ?? false,
      deletionAvailable: deletionAvailable ?? false,
    };
    return createDefaultBrowserStore(() => flags);
  }, [aiAvailable, deletionAvailable]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
