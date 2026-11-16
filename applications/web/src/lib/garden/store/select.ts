/**
 * Which GardenStore the app uses: `NEXT_PUBLIC_GARDEN_STORE=server|browser`,
 * default `server`. Anything else is treated as `server`, so a typo can never
 * silently move a deployment onto the browser path.
 */
import type { GardenFlags } from "./queries";
import {
  STORE_OPERATIONS,
  type GardenStore,
  type StoreKind,
} from "./types";

export function storeKind(
  value: string | undefined = process.env.NEXT_PUBLIC_GARDEN_STORE,
): StoreKind {
  return value === "browser" ? "browser" : "server";
}

/**
 * A store whose implementation loads on first use. Every operation is already
 * asynchronous, so callers cannot tell; the unused implementation is never
 * fetched, and a static build can drop the server one entirely.
 */
export function lazyStore(kind: StoreKind, load: () => Promise<GardenStore>): GardenStore {
  let loading: Promise<GardenStore> | undefined;
  const ready = () =>
    (loading ??= load().catch((error) => {
      loading = undefined;
      throw error;
    }));
  const store = { kind } as Record<string, unknown>;
  for (const name of STORE_OPERATIONS)
    store[name] = async (...args: unknown[]) => {
      const target = (await ready()) as unknown as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      return target[name](...args);
    };
  return store as unknown as GardenStore;
}

export type StoreSelection = {
  kind?: StoreKind;
  /** Deployment switches for the browser store; see BrowserStoreOptions.flags. */
  flags?: () => GardenFlags;
};

export function createGardenStore(selection: StoreSelection = {}): GardenStore {
  const kind = selection.kind ?? storeKind();
  // Keep the two dynamic imports in separate branches of a build-time constant
  // so the bundler can discard the one a build does not use.
  if (process.env.NEXT_PUBLIC_GARDEN_STORE === "browser") {
    // A browser build carries no server code, so an explicit request for the
    // server store is refused rather than silently answered by the other one.
    if (selection.kind === "server")
      throw new Error("The server store is not available in a browser-store build.");
    return lazyStore("browser", async () =>
      (await import("./browser-default")).createDefaultBrowserStore(selection.flags),
    );
  }
  if (kind === "browser")
    return lazyStore("browser", async () =>
      (await import("./browser-default")).createDefaultBrowserStore(selection.flags),
    );
  return lazyStore("server", async () =>
    (await import("./server-default")).createDefaultServerStore(),
  );
}
