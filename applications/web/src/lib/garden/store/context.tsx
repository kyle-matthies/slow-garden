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

/** Whether a garden re-read failed while the last good data is still shown. */
export const GardenRefreshFailedContext = createContext(false);
export function useGardenRefreshFailed(): boolean {
  return useContext(GardenRefreshFailedContext);
}

export type GardenState =
  | { status: "loading"; data?: GardenData }
  | { status: "ready"; data: GardenData }
  | { status: "signed-out"; data?: undefined }
  | { status: "error"; data?: GardenData };

/** Loaded data, with the request it answered. */
type Held = { data: GardenData; requested: string | undefined };
type Phase = { status: GardenState["status"]; held?: Held };

/**
 * Data belongs to a request when it is the answer to that request, or when it
 * is the garden the request names (the same garden reached by another address).
 * An answer may name a different garden than was asked for: the loader falls
 * back when the requested garden no longer exists, and the page says so.
 */
function belongs(held: Held | undefined, requested: string | undefined): held is Held {
  return !!held && (held.requested === requested || held.data.gardenId === requested);
}

/**
 * The garden as client state, replacing the server prop plus `router.refresh()`.
 * `initial` is server-rendered data when there is some; without it the hook
 * loads on mount.
 *
 * `data` is only ever data for the garden now requested. While another garden
 * is loading, or after its load failed, `data` is absent and the earlier
 * garden is offered as `previous` (for a way back), never as the garden.
 * A failed re-read of the same garden keeps `data` with status `error`.
 *
 * `reload()` always reads the garden currently requested, whichever render
 * the caller took it from, and an answer is dropped unless it is the answer to
 * the latest request, so a slow earlier answer cannot replace a later one.
 * If a re-read fails and the session is no longer the account the data
 * belongs to, the data is dropped rather than shown under another account.
 */
export function useGardenData(
  requestedGardenId?: string,
  initial?: GardenData,
): GardenState & { previous?: GardenData; reload: () => Promise<void> } {
  const store = useGardenStore();
  const [state, setState] = useState<Phase>(
    initial
      ? { status: "ready", held: { data: initial, requested: requestedGardenId } }
      : { status: "loading" },
  );
  const latest = useRef(0);
  const requested = useRef(requestedGardenId);
  useEffect(() => {
    requested.current = requestedGardenId;
  });
  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    const asked = requested.current;
    setState((s) => ({ status: "loading", held: s.held }));
    try {
      const result = await store.loadGarden(asked);
      if (ticket !== latest.current) return;
      setState(
        result.signedIn
          ? { status: "ready", held: { data: result.data, requested: asked } }
          : { status: "signed-out" },
      );
    } catch {
      if (ticket !== latest.current) return;
      // Kept data is only safe to show to the account it was read for.
      let session: Awaited<ReturnType<GardenStore["getSession"]>> | null = null;
      try {
        session = await store.getSession();
      } catch {
        session = null;
      }
      if (ticket !== latest.current) return;
      setState((s) => {
        if (session && !session.signedIn) return { status: "signed-out" };
        if (session?.signedIn && s.held && s.held.data.tenantId !== session.tenantId)
          return { status: "error" };
        return { status: "error", held: s.held };
      });
    }
  }, [store]);
  const loadedFor = useRef(initial ? requestedGardenId : null);
  useEffect(() => {
    if (loadedFor.current === requestedGardenId) return;
    loadedFor.current = requestedGardenId;
    requested.current = requestedGardenId;
    void reload();
  }, [reload, requestedGardenId]);
  const current = belongs(state.held, requestedGardenId);
  const data = current ? state.held!.data : undefined;
  const previous = current ? undefined : state.held?.data;
  // Data for another garden is never "ready" for this one.
  const status = state.status === "ready" && !current ? "loading" : state.status;
  return { status, data, previous, reload } as GardenState & {
    previous?: GardenData;
    reload: () => Promise<void>;
  };
}
