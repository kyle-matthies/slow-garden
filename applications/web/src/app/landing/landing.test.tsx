import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ configured: false, signedIn: false }));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => state.configured,
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: state.signedIn ? { sub: "synthetic-account" } : {} }, error: null }) } }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

import Home from "../page";

beforeEach(() => { state.configured = false; state.signedIn = false; });
afterEach(cleanup);

it("routes every acquisition CTA through the existing sign-in flow and discloses the AI test state", async () => {
  render(await Home());
  const links = screen.getAllByRole("link", { name: "Start your garden" });
  expect(links).toHaveLength(2);
  for (const link of links) expect(link).toHaveAttribute("href", "/login");
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(screen.getByText(/Automatic overnight delivery is not generally active/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Your writing belongs in your garden." })).toBeInTheDocument();
});

it("keeps signed-in people on the shortest route back to their own garden", async () => {
  state.configured = true;
  state.signedIn = true;
  await expect(Home()).rejects.toThrow("redirect:/garden");
});
