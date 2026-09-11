import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import Loading from "@/app/loading";
import { GardenWorkspace } from "@/app/garden/workspace";
import { ErrorFixture } from "./error-fixture";
import { FIXTURE } from "./fixture";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AxeFixturesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.GARDEN_AXE_FIXTURES !== "1") notFound();
  const { state } = await searchParams;
  if (state === "error") return <ErrorFixture />;
  if (state === "loading") return <Loading />;
  return (
    <Suspense>
      <GardenWorkspace data={FIXTURE} />
    </Suspense>
  );
}
