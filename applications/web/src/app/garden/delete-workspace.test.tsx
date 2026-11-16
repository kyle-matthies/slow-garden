import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FIXTURE } from "@/app/dev/axe-fixtures/fixture";
import { GardenWorkspace } from "./workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("./actions", () => ({
  respondToMark: vi.fn(), setArchived: vi.fn(), setPlotPermissions: vi.fn(), signOut: vi.fn(),
  createArea: vi.fn(), saveEntry: vi.fn(), readReturns: vi.fn(), inviteReflection: vi.fn(),
  respondToBloom: vi.fn(), cancelReflection: vi.fn(), previewDeletion: vi.fn(), deleteItem: vi.fn(), deleteAccount: vi.fn(),
}));
vi.mock("./scene/garden-scene", () => ({ GardenScene: () => <div /> }));
vi.mock("./scene/garden-ring", () => ({ GardenRing: () => <div /> }));
vi.mock("./scene/thought-plant", () => ({ ThoughtPlant: () => null, TopicPlants: () => null }));

const seed = FIXTURE.seeds[0];
const openThought = (deletionAvailable?: boolean) => {
  window.history.replaceState(null, "", `/garden?topic=${seed.plot_id}&thought=${seed.id}`);
  return render(<GardenWorkspace data={{ ...FIXTURE, deletionAvailable }} />);
};
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it("the workspace shows no delete control while deletion is switched off or unset", () => {
  openThought(false);
  expect(screen.getByRole("button", { name: "Archive thought" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  cleanup();
  openThought(undefined);
  expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
});

it("the workspace shows delete beside archive when deletion is switched on", () => {
  openThought(true);
  expect(screen.getByRole("button", { name: "Archive thought" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Delete thought…" })).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Delete entry…" }).length).toBeGreaterThan(0);
});
