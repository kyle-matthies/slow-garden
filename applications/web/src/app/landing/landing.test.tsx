import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ configured: false, signedIn: false }));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => state.configured,
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: state.signedIn ? { sub: "synthetic-account" } : {} }, error: null }) } }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

import Home from "../page";

beforeEach(() => { state.configured = false; state.signedIn = false; delete process.env.GARDEN_AI_ENABLED; });
afterEach(cleanup);

it("states the overnight method in the hero and routes every acquisition CTA through the existing sign-in flow", async () => {
  render(await Home());
  expect(screen.getByRole("heading", { level: 1, name: "Write by day. Wake to a bloom." })).toBeInTheDocument();
  expect(screen.getByText(/Overnight, an AI pass tends what you\s+wrote and returns at most three blooms/)).toBeInTheDocument();
  const links = screen.getAllByRole("link", { name: "Start your garden" });
  expect(links).toHaveLength(2);
  for (const link of links) expect(link).toHaveAttribute("href", "/login");
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(screen.getByRole("heading", { name: "What the AI will never do." })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Your writing belongs in your garden." })).toBeInTheDocument();
});

it("says plainly that overnight tending is in private preview while the server gate is closed", async () => {
  render(await Home());
  expect(screen.getAllByText(/Overnight tending is in private preview; writing, history and\s+export work today\./)).toHaveLength(2);
});

it("drops the preview line once tending is enabled on the server", async () => {
  process.env.GARDEN_AI_ENABLED = "true";
  render(await Home());
  expect(screen.queryByText(/private preview/)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Write by day. Wake to a bloom." })).toBeInTheDocument();
});

it("keeps signed-in people on the shortest route back to their own garden", async () => {
  state.configured = true;
  state.signedIn = true;
  await expect(Home()).rejects.toThrow("redirect:/garden");
});
