"use client";
/**
 * React access to the GardenStore (ADR-009 stage 2): the context, the hooks
 * and the garden-as-client-state hook. This module imports no store
 * implementation, so the browser-mode entry can use it without reaching the
 * server wiring (see static-readiness.test.ts). `provider.tsx` adds the
 * environment-selected default; `browser-provider.tsx` the browser-only one.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { GardenData } from "../types";
import type { GardenStore } from "./types";

export const StoreContext = createContext<GardenStore | null>(null);

export function useGardenStore(): GardenStore {
  const store = useContext(StoreContext);
  if (!store)
    throw new Error("useGardenStore must be used inside GardenStoreProvider");
  return store;
}

/**
 * How the tree re-reads the garden after a change, when the client owns the
 * data (browser mode). `null` on the hosted server path: there the server
 * action's `revalidatePath` and `router.refresh()` do it, exactly as before.
 */
export const GardenReloadContext = createContext<(() => Promise<void>) | null>(
  null,
);
export function useGardenReload(): (() => Promise<void>) | null {
  return useContext(GardenReloadContext);
}

export type GardenState =
  | { status: "loading"; data?: GardenData }
  | { status: "ready"; data: GardenData }
  | { status: "signed-out"; data?: undefined }
  | { status: "error"; data?: GardenData };

/**
 * The garden as client state, replacing the server prop plus `router.refresh()`.
 * `initial` is server-rendered data when there is some; without it the hook
 * loads on mount. `reload()` re-reads through the store and keeps showing the
 * last data while it does.
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
