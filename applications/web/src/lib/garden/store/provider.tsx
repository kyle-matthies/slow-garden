"use client";
/**
 * The environment-selected GardenStore for the React tree (ADR-009). The
 * hooks live in `context.tsx`; components import them from there.
 */
import { useMemo, type ReactNode } from "react";
import { StoreContext } from "./context";
import type { GardenFlags } from "./queries";
import { createGardenStore } from "./select";
import type { GardenStore } from "./types";

export function GardenStoreProvider({
  store,
  aiAvailable,
  deletionAvailable,
  children,
}: {
  /** Supply a store directly (tests, fixtures); otherwise the environment decides. */
  store?: GardenStore;
  /**
   * Deployment switches for the browser store. On the hosted app the server
   * page passes what it read from its environment, and the database's own
   * switches must allow as well. A static build has no server to ask: leave
   * both unset and the database decides alone (`garden_capabilities()`).
   * Setting only one leaves the other off.
   */
  aiAvailable?: boolean;
  deletionAvailable?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    if (store) return store;
    if (aiAvailable === undefined && deletionAvailable === undefined)
      return createGardenStore();
    const flags: GardenFlags = {
      aiAvailable: aiAvailable ?? false,
      deletionAvailable: deletionAvailable ?? false,
    };
    return createGardenStore({ flags: () => flags });
  }, [store, aiAvailable, deletionAvailable]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export {
  useGardenData,
  useGardenReload,
  useGardenStore,
  type GardenState,
} from "./context";
