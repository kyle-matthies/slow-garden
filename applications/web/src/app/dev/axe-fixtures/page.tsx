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
  searchParams: Promise<{ state?: string; thoughts?: string; gardens?: string }>;
}) {
  if (process.env.GARDEN_AXE_FIXTURES !== "1") notFound();
  const { state, thoughts, gardens } = await searchParams;
  if (state === "error") return <ErrorFixture />;
  if (state === "loading") return <Loading />;
  if (state === "scale") {
    // A synthetic, tended garden for performance receipts (ADR-007 budget).
    const count = Math.min(Math.max(Number(thoughts) || 100, 1), 1000);
    const data = syntheticGarden(6, count);
    // Extra empty gardens so the ring can be checked with 20+ of them.
    const ring = Math.min(Math.max(Number(gardens) || 1, 1), 60);
    const names = ["Work", "Home", "Reading", "The studio", "Health", "Letters", "Travel", "Learning", "Friends", "Money", "Craft", "Someday"];
    const extra = Array.from({ length: ring - 1 }, (_, i) => ({
      ...data.gardens[0],
      id: `00000000-0000-4000-8000-0000000a${String(i).padStart(4, "0")}`,
      name: `${names[i % names.length]}${i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ""}`,
    }));
    return (
      <Suspense>
        <GardenWorkspace
          data={{
            ...data,
            gardens: [...data.gardens, ...extra],
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
