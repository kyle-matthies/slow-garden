import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MeadowPreview } from "./preview";

const isProduction = process.env.NODE_ENV === "production";

export const metadata: Metadata = {
  title: isProduction ? undefined : "Meadow preview",
  robots: { index: false, follow: false },
};

/**
 * Development-only synthetic garden for scene, motion and tending checks. In
 * production it renders not-found with no fixture content, like the Cabinet
 * preview. No database, provider or sign-in is involved.
 */
export default function MeadowPreviewPage() {
  if (isProduction) notFound();
  return (
    <Suspense fallback={<p>Planting the preview garden…</p>}>
      <MeadowPreview />
    </Suspense>
  );
}
