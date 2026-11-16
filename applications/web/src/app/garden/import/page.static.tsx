import type { Metadata } from "next";
import { Suspense } from "react";
import Loading from "@/app/loading";
import { BrowserStoreProvider } from "@/lib/garden/store/browser-provider";
import { BrowserImport } from "../browser-entry";

export const metadata: Metadata = {
  title: "Import notes",
  robots: { index: false, follow: false },
};

/** `/garden/import` in the static export; see `../page.static.tsx`. */
export default function StaticImportPage() {
  return (
    <BrowserStoreProvider>
      <Suspense fallback={<Loading />}>
        <BrowserImport />
      </Suspense>
    </BrowserStoreProvider>
  );
}
