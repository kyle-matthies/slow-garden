"use client";
/**
 * React access to the GardenStore (ADR-009 stage 1). Nothing in the app uses
 * this yet; workspace.tsx still imports server actions directly.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GardenData } from "../types";
import type { GardenFlags } from "./queries";
import { createGardenStore } from "./select";
import type { GardenStore } from "./types";

const StoreContext = createContext<GardenStore | null>(null);

export function GardenStoreProvider({
  store,
  aiAvailable = false,
  deletionAvailable = false,
  children,
}: {
  /** Supply a store directly (tests, fixtures); otherwise the environment decides. */
  store?: GardenStore;
  /**
   * Deployment switches for the browser store. On the hosted app the server
   * page passes what it read from its environment; a static build has no
   * server to ask and leaves both off until the database can answer.
   */
  aiAvailable?: boolean;
  deletionAvailable?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    if (store) return store;
    const flags: GardenFlags = { aiAvailable, deletionAvailable };
    return createGardenStore({ flags: () => flags });
  }, [store, aiAvailable, deletionAvailable]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useGardenStore(): GardenStore {
  const store = useContext(StoreContext);
  if (!store)
    throw new Error("useGardenStore must be used inside GardenStoreProvider");
  return store;
}

export type GardenState =
  | { status: "loading"; data?: GardenData }
  | { status: "ready"; data: GardenData }
  | { status: "signed-out"; data?: undefined }
  | { status: "error"; data?: GardenData };

/**
 * The garden as client state, replacing the server prop plus `router.refresh()`.
 * `initial` is the server-rendered data on the hosted app (first paint is
 * unchanged); without it the hook loads on mount. `reload()` re-reads through
 * the store and keeps showing the last data while it does.
 */
export function useGardenData(
  requestedGardenId?: string,
  initial?: GardenData,
): GardenState & { reload: () => Promise<void> } {
  const store = useGardenStore();
  const [state, setState] = useState<GardenState>(
    initial ? { status: "ready", data: initial } : { status: "loading" },
  );
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    setState((s) => ({ status: "loading", data: s.data }));
    try {
      const result = await store.loadGarden(requestedGardenId);
      if (ticket !== latest.current) return;
      setState(
        result.signedIn
          ? { status: "ready", data: result.data }
          : { status: "signed-out" },
      );
    } catch {
      if (ticket !== latest.current) return;
      setState((s) => ({ status: "error", data: s.data }));
    }
  }, [store, requestedGardenId]);
  const loadedFor = useRef(initial ? requestedGardenId : null);
  useEffect(() => {
    if (loadedFor.current === requestedGardenId) return;
    loadedFor.current = requestedGardenId;
    void reload();
  }, [reload, requestedGardenId]);
  return { ...state, reload };
}
