/**
 * Test helpers: render a component with a GardenStore supplied through the
 * provider, the way the app supplies one. Tests only.
 */
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { GardenStoreProvider } from "../provider";
import { STORE_OPERATIONS, type GardenStore, type StoreKind } from "../types";

/** A store with only the operations a test supplies; any other call fails loudly. */
export function storeOf(
  operations: Partial<Omit<GardenStore, "kind">>,
  kind: StoreKind = "server",
): GardenStore {
  const store = { kind } as Record<string, unknown>;
  for (const name of STORE_OPERATIONS)
    store[name] =
      operations[name] ??
      (() => {
        throw new Error(`The test store was not given ${name}`);
      });
  return store as unknown as GardenStore;
}

/** `render` from Testing Library, inside a provider for `store` (rerenders too). */
export function renderWith(store: GardenStore) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <GardenStoreProvider store={store}>{children}</GardenStoreProvider>;
  }
  return (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
    render(ui, { ...options, wrapper: Wrapper });
}
