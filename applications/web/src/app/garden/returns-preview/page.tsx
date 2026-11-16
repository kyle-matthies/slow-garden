import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReturnsPreview } from "./preview";
import { StoreBoundary } from "../store-boundary";

const isProduction = process.env.NODE_ENV === "production";

export const metadata: Metadata = isProduction
  ? { robots: { index: false, follow: false } }
  : {
      title: "Returns fixture preview",
      robots: { index: false, follow: false },
    };

/**
 * Development-only. In production this renders the app's not-found UI with no
 * fixture content; because the root loading boundary streams, Next returns a
 * soft 404 (200 + noindex). No provider, database, or sign-in is involved.
 */
export default function ReturnsPreviewPage() {
  if (isProduction) notFound();
  return (
    <Suspense fallback={<p>Opening the fixture Returns…</p>}>
      <StoreBoundary>
        <ReturnsPreview />
      </StoreBoundary>
    </Suspense>
  );
}
