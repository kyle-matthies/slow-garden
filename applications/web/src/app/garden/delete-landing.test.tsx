import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ isSupabaseConfigured: () => false, createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/app/landing/garden-example", () => ({ GardenExample: () => null }));
import Home from "@/app/page";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it("says deletion is not available while the switch is off", async () => {
  vi.stubEnv("GARDEN_DELETION_ENABLED", "false");
  render(await Home());
  expect(screen.getByRole("heading", { name: "Archive now, deletion before wider release" })).toBeVisible();
  expect(screen.getByText(/In-app deletion is not available yet/)).toBeVisible();
  expect(screen.getByText(/archive anything to put it out of view, and\s+export all of it/)).toBeVisible();
  expect(screen.queryByText(/permanently erases/)).toBeNull();
});

it("describes what deletion erases only when the switch is on", async () => {
  vi.stubEnv("GARDEN_DELETION_ENABLED", "true");
  render(await Home());
  expect(screen.getByRole("heading", { name: "Archive hides. Delete erases." })).toBeVisible();
  expect(screen.getByText(/permanently erases an entry, a thought, a topic, a garden or\s+your whole account/)).toBeVisible();
  expect(screen.getByText(/routine\s+backups are not reachable from the app/)).toBeVisible();
  expect(screen.queryByText(/not available yet/)).toBeNull();
});
