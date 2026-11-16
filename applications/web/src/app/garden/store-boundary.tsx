import type { ReactNode } from "react";
import { BrowserStoreProvider } from "@/lib/garden/store/browser-provider";
import { GardenStoreProvider } from "@/lib/garden/store/provider";
import { storeKind } from "@/lib/garden/store/select";

/**
 * Server component: gives a page's client tree its GardenStore.
 *
 * `server` (default): the server-action adapter, unchanged behaviour.
 * `browser`: the browser store. This deployment still has a server, so its
 * two switches are passed down and combine with the database's own
 * (`garden_capabilities()`): both must allow, as on the server path. Only the
 * two booleans cross to the client; no secret does.
 */
export function StoreBoundary({ children }: { children: ReactNode }) {
  if (storeKind() === "browser")
    return (
      <BrowserStoreProvider
        aiAvailable={process.env.GARDEN_AI_ENABLED === "true"}
        deletionAvailable={process.env.GARDEN_DELETION_ENABLED === "true"}
      >
        {children}
      </BrowserStoreProvider>
    );
  return <GardenStoreProvider>{children}</GardenStoreProvider>;
}
