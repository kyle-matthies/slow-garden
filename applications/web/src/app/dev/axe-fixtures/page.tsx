import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import Loading from "@/app/loading";
import { GardenWorkspace } from "@/app/garden/workspace";
import { ErrorFixture } from "./error-fixture";
import {
  syntheticGarden,
  syntheticTending,
} from "@/app/garden/meadow-preview/fixtures";
import { FIXTURE } from "./fixture";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AxeFixturesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; thoughts?: string }>;
}) {
  if (process.env.GARDEN_AXE_FIXTURES !== "1") notFound();
  const { state, thoughts } = await searchParams;
  if (state === "error") return <ErrorFixture />;
  if (state === "loading") return <Loading />;
  if (state === "scale") {
    // A synthetic, tended garden for performance receipts (ADR-007 budget).
    const count = Math.min(Math.max(Number(thoughts) || 100, 1), 1000);
    const data = syntheticGarden(6, count);
    return (
      <Suspense>
        <GardenWorkspace
          data={{
            ...data,
            tending: syntheticTending(data, "full"),
            account: { tendOvernight: false, timezone: "UTC" },
          }}
        />
      </Suspense>
    );
  }
  return (
    <Suspense>
      <GardenWorkspace data={FIXTURE} />
    </Suspense>
  );
}
