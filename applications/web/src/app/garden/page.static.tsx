import type { Metadata } from "next";
import { Suspense } from "react";
import Loading from "@/app/loading";
import { BrowserStoreProvider } from "@/lib/garden/store/browser-provider";
import { BrowserGarden } from "./browser-entry";

export const metadata: Metadata = {
  title: "Your garden",
  robots: { index: false, follow: false },
};

/**
 * `/garden` in the static export. The file holds no private data: the session
 * is checked and the garden is loaded in the browser, through the store. No
 * deployment switch is passed, so the database decides alone
 * (`garden_capabilities()`).
 */
export default function StaticGardenPage() {
  return (
    <BrowserStoreProvider>
      <Suspense fallback={<Loading />}>
        <BrowserGarden />
      </Suspense>
    </BrowserStoreProvider>
  );
}
