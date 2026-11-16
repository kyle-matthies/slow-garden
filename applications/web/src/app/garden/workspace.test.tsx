import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWith, storeOf } from "@/lib/garden/store/testing/render";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { FIXTURE } from "@/app/dev/axe-fixtures/fixture";
import type { Tending, TendingBloom } from "@/lib/garden/scene/tending";
import type { GardenData } from "@/lib/garden/types";
import { GardenWorkspace } from "./workspace";
import { GardenStoreProvider } from "@/lib/garden/store/provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("./actions", () => ({
  respondToMark: vi.fn(), setArchived: vi.fn(), setPlotPermissions: vi.fn(), signOut: vi.fn(),
  createArea: vi.fn(), saveEntry: vi.fn(), readReturns: vi.fn(), inviteReflection: vi.fn(),
  respondToBloom: vi.fn(), cancelReflection: vi.fn(), locateRevisions: vi.fn(), setTendOvernight: vi.fn(),
}));
// The scene is another team's canvas; the workspace's own chrome is under test.
// No test here reaches the store; one that did would fail loudly.
const render = renderWith(storeOf({}));
vi.mock("./scene/garden-scene", () => ({ GardenScene: () => <div data-testid="scene" /> }));
vi.mock("./scene/garden-ring", () => ({ GardenRing: () => <div data-testid="ring" /> }));
vi.mock("./scene/thought-plant", () => ({ ThoughtPlant: () => null, TopicPlants: () => null }));

const seed = FIXTURE.seeds[0];
function bloom(id: string): TendingBloom {
  return {
    id, passId: "pass", kind: "connection", interpretation: `Synthetic ${id}`, createdAt: "2026-10-08T02:20:00Z", isNew: true,
    evidence: [{ revisionId: `${id}-r1`, seedId: seed.id, excerpt: "Synthetic", writtenAt: "2026-03-01T00:00:00Z" }],
  };
}
const tending: Tending = { marks: [], themes: [], blooms: [bloom("a"), bloom("b")] };
const tended: GardenData = { ...FIXTURE, tending };
const SEEN_KEY = `slow-garden:seen-blooms:${FIXTURE.tenantId}`;
function open(search: string, data: GardenData = tended) {
  window.history.replaceState(null, "", `/garden${search}`);
  return render(<GardenWorkspace data={data} />);
}
const returnsLink = () => within(screen.getByRole("navigation", { name: "Garden tools" })).getByRole("button", { name: /^Returns/ });

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it("announces new blooms once in Pages, and dismissing clears the Returns dot for good", () => {
  open("?view=list");
  expect(screen.getByRole("heading", { name: "Overnight, the garden noticed…" })).toBeInTheDocument();
  expect(returnsLink()).toHaveTextContent("2 new blooms");
  // The reveal is the only announcement: no second pill in the banner.
  expect(screen.queryByText(/new blooms? in Returns/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss and mark as seen" }));
  expect(screen.queryByRole("heading", { name: "Overnight, the garden noticed…" })).not.toBeInTheDocument();
  expect(returnsLink()).not.toHaveTextContent("new bloom");
  expect(JSON.parse(localStorage.getItem(SEEN_KEY)!).sort()).toEqual(["a", "b"]);
  cleanup();
  open("?view=list");
  expect(screen.queryByRole("heading", { name: "Overnight, the garden noticed…" })).not.toBeInTheDocument();
  expect(returnsLink()).not.toHaveTextContent("new bloom");
});

it("mounts the reveal over the Meadow at garden level only", () => {
  open("");
  expect(screen.getByTestId("scene")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Overnight, the garden noticed…" })).toBeInTheDocument();
  cleanup();
  open(`?topic=${FIXTURE.plots[0].id}`);
  expect(screen.queryByRole("heading", { name: "Overnight, the garden noticed…" })).not.toBeInTheDocument();
  cleanup();
  open(`?view=list&topic=${FIXTURE.plots[0].id}`);
  expect(screen.queryByRole("heading", { name: "Overnight, the garden noticed…" })).not.toBeInTheDocument();
});

it("opening Returns receipts the blooms, so the reveal does not repeat afterwards", () => {
  open("?view=returns");
  expect(screen.getByRole("heading", { name: "What the garden returned" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Overnight, the garden noticed…" })).not.toBeInTheDocument();
  expect(screen.getAllByText("New")).toHaveLength(2);
  expect(returnsLink()).not.toHaveTextContent("new bloom");
  cleanup();
  open("?view=list");
  expect(screen.queryByRole("heading", { name: "Overnight, the garden noticed…" })).not.toBeInTheDocument();
});

it("renders only the wordmark and the More menu during first run", () => {
  open("", { ...FIXTURE, gardens: [], gardenId: "", plots: [], seeds: [], entries: [] });
  expect(screen.getByLabelText("Name your garden")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Slow Garden/ })).toBeInTheDocument();
  for (const name of ["Meadow", "Pages", /^Returns/, /^All gardens/])
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Where you are" })).not.toBeInTheDocument();
  expect(document.querySelector(".level-trail, .view-toggle, .returns-link, .gardens-button")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Import notes" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
});

it("announces nothing in server HTML, where this browser's receipts are unknown", () => {
  window.history.replaceState(null, "", "/garden?view=list");
  const html = renderToString(<GardenStoreProvider store={storeOf({})}><GardenWorkspace data={tended} /></GardenStoreProvider>);
  expect(html).toContain("Fixture garden");
  expect(html).not.toContain("morning-return");
  expect(html).not.toContain("returns-dot");
});

it("arriving with Pages remembered keeps a topic or thought that no longer exists in the address, so the notice stays", () => {
  localStorage.setItem("slow-garden:garden-view", "list");
  open("?topic=gone&thought=gone#entry-e1");
  const address = new URL(window.location.href);
  expect(address.searchParams.get("view")).toBe("list");
  expect(address.searchParams.get("topic")).toBe("gone");
  expect(address.searchParams.get("thought")).toBe("gone");
  expect(address.searchParams.get("garden")).toBe(FIXTURE.gardenId);
  expect(address.hash).toBe("#entry-e1");
  cleanup();
  // Re-rendered from the rewritten address, as the router does: still said.
  render(<GardenWorkspace data={tended} />);
  expect(screen.getByText(/That location is no longer available/)).toBeInTheDocument();
  cleanup();
  // A found location is rewritten as before.
  open(`?topic=${FIXTURE.plots[0].id}`);
  expect(window.location.search).toBe(`?topic=${FIXTURE.plots[0].id}&garden=${FIXTURE.gardenId}&view=list`);
});

it("Returns, after a pass that finished with nothing to say and with tending inactive: tended before, never 'no AI has read'", () => {
  // The loader dates "last tended" from blooms and marks; a pass that returned
  // neither is known only from the pass record.
  const quiet: GardenData = {
    ...FIXTURE,
    aiAvailable: false,
    tending: { marks: [], themes: [], blooms: [] },
    tendingHistory: {
      available: true,
      passes: [
        { id: "p2", status: "failed", createdAt: "2026-11-04T02:00:00Z", finishedAt: "2026-11-04T02:01:00Z" },
        { id: "p1", status: "complete", createdAt: "2026-11-03T02:00:00Z", finishedAt: "2026-11-03T02:05:00Z" },
      ],
    },
  };
  open("?view=returns", quiet);
  const text = document.querySelector(".returns-page")!.textContent ?? "";
  expect(text).toContain("Last tended");
  expect(text).toContain("Tending is not active now.");
  expect(text).toContain("No bloom is showing. Earlier tending passes are in the full record below.");
  expect(text).not.toContain("no AI has read");
  expect(document.querySelector(".returns-tended time")?.getAttribute("datetime")).toBe("2026-11-03T02:05:00Z");
  cleanup();
  // No finished pass on record: the never-tended wording stays, and is true.
  open("?view=returns", { ...quiet, tendingHistory: { available: true, passes: [quiet.tendingHistory!.passes[0]] } });
  expect(document.querySelector(".returns-page")!.textContent).toContain("so no AI has read your writing");
});
