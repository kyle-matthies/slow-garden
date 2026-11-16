/**
 * The main journeys, run twice with the same steps and the same expectations:
 *
 * - `server`: what `garden/page.tsx` renders today. The workspace gets
 *   server-loaded data, the default provider selects the server-action store
 *   (the real actions and route handlers, over a mocked server client), and a
 *   refresh re-runs the loader as `revalidatePath` / `router.refresh()` do.
 * - `browser`: the browser-mode entry (`BrowserGarden` / `BrowserImport`)
 *   over the real browser store, loading and reloading through the store.
 *
 * Both run over the same in-memory stand-in for Supabase, which checks nothing
 * a database checks. This proves the two modes show the person the same
 * things for the same steps; it is not a database test.
 */
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, createWorld, type World } from "@/lib/garden/store/testing/fake-supabase";
import type { Db } from "@/lib/garden/store/queries";
import type { GardenLoad } from "@/lib/garden/store/types";

// These journeys wait on real multi-step loads (the loader, then the Returns
// record, each several awaited reads). Testing Library's default one-second
// wait is an assumption about machine speed, not about the app: a slow CI
// runner exceeded it while the page was still correctly loading. The waits
// below are still on what the person sees; only the bound is wider.
configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 40000 });

const nav = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  replace: undefined as unknown as (path: string) => void,
  refreshed: 0,
  onRefresh: undefined as undefined | (() => void),
  notify() {
    for (const listener of [...nav.listeners]) listener();
  },
}));
const current = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    nav.listeners.add(listener);
    return () => nav.listeners.delete(listener);
  };
  const router = {
    push(url: string) {
      window.history.pushState(null, "", url);
    },
    replace(url: string) {
      nav.replace(url);
    },
    refresh() {
      nav.refreshed++;
      nav.onRefresh?.();
    },
  };
  return {
    useRouter: () => router,
    usePathname: () => useSyncExternalStore(subscribe, () => window.location.pathname),
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
    redirect: (path: string) => {
      throw new Error(`redirect:${path}`);
    },
  };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => current.db,
  isSupabaseConfigured: () => true,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => current.db,
  isSupabaseConfigured: () => true,
}));
// A server action that revalidates is followed by a fresh server render.
vi.mock("next/cache", () => ({ revalidatePath: () => queueMicrotask(() => nav.onRefresh?.()) }));
// The scene is a canvas; these journeys are about the pages around it.
vi.mock("./scene/garden-scene", () => ({ GardenScene: () => <div data-testid="scene" /> }));
vi.mock("./scene/garden-ring", () => ({ GardenRing: () => <div data-testid="ring" /> }));
vi.mock("./scene/thought-plant", () => ({ ThoughtPlant: () => null, TopicPlants: () => null }));

import { GET as exportRoute } from "./export/route";
import { GET as historyRoute } from "./history/route";
import { GardenStoreProvider } from "@/lib/garden/store/provider";
import { createBrowserStore } from "@/lib/garden/store/browser-store";
import { loadGardenForSession } from "@/lib/garden/store/server-loader";
import { useSearchParams } from "next/navigation";
import { BrowserGarden, BrowserImport } from "./browser-entry";
import { GardenWorkspace } from "./workspace";
import { ImportForm } from "./import/import-form";

const T = "tenant-1";
const G1 = "11111111-1111-4111-8111-111111111111";
const P1 = "33333333-3333-4333-8333-333333333331";
const S1 = "44444444-4444-4444-8444-444444444441";
const E1 = "55555555-5555-4555-8555-555555555551";
const R1 = "66666666-6666-4666-8666-666666666661";
const PASS = "77777777-7777-4777-8777-777777777771";
const B1 = "88888888-8888-4888-8888-888888888881";
const DAY = "2026-11-01T09:00:00.000Z";

type Mode = "server" | "browser";
type Flags = { deletion?: boolean };

/** Stand-in for the schema's defaults, views and RPC bodies. Checks nothing. */
function world(seeded: boolean, flags: Flags = {}): World {
  const w = createWorld({
    tables: {
      accounts: [{ id: T, tend_overnight: false, timezone: "UTC" }],
      gardens: [], plots: [], seeds: [], entries: [], current_entries: [], seed_revisions: [],
      garden_passes: [], blooms: [], bloom_responses: [], tending_marks: [],
      tending_mark_responses: [], garden_themes: [],
    },
    defaults: {
      gardens: { status: "active", archived_at: null, created_at: DAY },
      plots: { ai_enabled: false, cross_pollinate: false, archived_at: null, created_at: DAY },
      seeds: { status: "active", archived_at: null, created_at: DAY },
      bloom_responses: { created_at: "2026-11-16T12:00:00.000Z" },
    },
    // `current_entries` is a view over entries and their newest revision.
    onWrite(table, now) {
      if (table !== "entries") return;
      for (const view of now.tables.current_entries) {
        const entry = now.tables.entries.find((e) => e.id === view.entry_id);
        if (entry) view.archived_at = entry.archived_at ?? null;
      }
    },
  });
  if (seeded) {
    w.tables.gardens.push({ id: G1, tenant_id: T, name: "Home Garden", status: "active", archived_at: null, created_at: DAY });
    w.tables.plots.push({ id: P1, tenant_id: T, garden_id: G1, name: "Work", ai_enabled: false, cross_pollinate: false, archived_at: null, created_at: DAY });
    w.tables.seeds.push({ id: S1, tenant_id: T, garden_id: G1, plot_id: P1, title: "First thought", status: "active", archived_at: null, created_at: DAY });
    w.tables.entries.push({ id: E1, tenant_id: T, garden_id: G1, seed_id: S1, archived_at: null, created_at: DAY });
    w.tables.seed_revisions.push({ id: R1, tenant_id: T, garden_id: G1, seed_id: S1, entry_id: E1, revision_number: 1, body: "synthetic first page", created_at: DAY });
    w.tables.current_entries.push({ entry_id: E1, revision_id: R1, seed_id: S1, garden_id: G1, tenant_id: T, body: "synthetic first page", revision_number: 1, created_at: DAY, revised_at: DAY, archived_at: null });
    w.tables.garden_passes.push({ id: PASS, tenant_id: T, garden_id: G1, plot_ids: [P1], status: "complete", created_at: "2026-11-03T02:00:00.000Z", finished_at: "2026-11-03T02:05:00.000Z" });
    w.tables.blooms.push({ id: B1, pass_id: PASS, tenant_id: T, garden_id: G1, ordinal: 0, kind: "change", interpretation: "synthetic interprétation — ✳", evidence: [{ revision_id: R1, excerpt: "first page" }], created_at: "2026-11-03T02:05:00.000Z" });
  }
  const saveRevision = (seedId: string, entryId: string, revisionId: string, body: string, at: string) => {
    const seed = w.tables.seeds.find((s) => s.id === seedId)!;
    const prior = w.tables.seed_revisions.filter((r) => r.entry_id === entryId);
    if (!prior.length)
      w.tables.entries.push({ id: entryId, tenant_id: T, garden_id: seed.garden_id, seed_id: seedId, archived_at: null, created_at: at });
    const created = prior.length ? (w.tables.entries.find((e) => e.id === entryId)!.created_at as string) : at;
    w.tables.seed_revisions.push({ id: revisionId, tenant_id: T, garden_id: seed.garden_id, seed_id: seedId, entry_id: entryId, revision_number: prior.length + 1, body, created_at: at });
    w.tables.current_entries = w.tables.current_entries.filter((e) => e.entry_id !== entryId);
    w.tables.current_entries.push({ entry_id: entryId, revision_id: revisionId, seed_id: seedId, garden_id: seed.garden_id, tenant_id: T, body, revision_number: prior.length + 1, created_at: created, revised_at: at, archived_at: null });
  };
  let tick = 0;
  w.rpc = {
    garden_capabilities: () => ({ data: { tending: false, deletion: !!flags.deletion }, error: null }),
    save_entry(args) {
      const at = new Date(Date.parse("2026-11-10T09:00:00.000Z") + ++tick * 60_000).toISOString();
      saveRevision(args.p_seed_id as string, args.p_entry_id as string, args.p_revision_id as string, args.p_body as string, at);
      return { data: args.p_revision_id, error: null };
    },
    import_thought(args) {
      const plot = w.tables.plots.find((p) => p.id === args.p_plot_id)!;
      w.tables.seeds.push({ id: args.p_seed_id, tenant_id: T, garden_id: plot.garden_id, plot_id: plot.id, title: args.p_title, status: "active", archived_at: null, created_at: DAY });
      const entries = args.p_entries as { entry_id: string; revision_id: string; body: string }[];
      for (const e of entries) saveRevision(args.p_seed_id as string, e.entry_id, e.revision_id, e.body, DAY);
      return { data: { id: args.p_seed_id, created: entries.length, skipped: 0 }, error: null };
    },
    export_garden_sources: () => ({
      data: {
        schema: "slow-garden-source-v2",
        exported_at: "2026-11-16T00:00:00.000Z",
        gardens: w.tables.gardens, plots: w.tables.plots, seeds: w.tables.seeds,
        entries: w.tables.entries, revisions: w.tables.seed_revisions,
      },
      error: null,
    }),
    deletion_preview: () => ({ data: { entries: 1, versions: 1 }, error: null }),
    delete_entry(args) {
      for (const table of ["entries", "current_entries", "seed_revisions"] as const)
        w.tables[table] = w.tables[table].filter((r) => (r.entry_id ?? r.id) !== args.p_entry_id);
      return { data: { deleted: true }, error: null };
    },
  };
  return w;
}

/** What the server pages render, with a refresh that re-runs the loader. */
function ServerPage({ page }: { page: "garden" | "import" }) {
  const requested = useSearchParams().get("garden") ?? undefined;
  const [load, setLoad] = useState<GardenLoad | null>(null);
  useEffect(() => {
    let on = true;
    const run = () => void loadGardenForSession(requested).then((next) => on && setLoad(next));
    nav.onRefresh = run;
    run();
    return () => {
      on = false;
    };
  }, [requested]);
  if (!load) return null;
  if (!load.signedIn) return <p>redirected to /login</p>;
  const data = load.data;
  return (
    <GardenStoreProvider>
      {page === "garden" ? (
        <GardenWorkspace data={data} />
      ) : (
        <ImportForm key={data.gardenId} gardens={data.gardens} gardenId={data.gardenId} plots={data.plots.filter((p) => !p.archived_at)} />
      )}
    </GardenStoreProvider>
  );
}

function start(mode: Mode, w: World, path: string, flags: Flags = {}, page: "garden" | "import" = "garden") {
  const { db, calls } = createFakeDb(w);
  current.db = db;
  vi.stubEnv("GARDEN_DELETION_ENABLED", flags.deletion ? "true" : "false");
  window.history.replaceState(null, "", path);
  if (mode === "server") render(<ServerPage page={page} />);
  else {
    const store = createBrowserStore({
      client: () => db as Db,
      flags: () => ({ aiAvailable: false, deletionAvailable: !!flags.deletion }),
    });
    render(
      <GardenStoreProvider store={store}>
        {page === "garden" ? <BrowserGarden /> : <BrowserImport />}
      </GardenStoreProvider>,
    );
  }
  return { db, calls };
}

const downloads: { name: string; blob: Blob }[] = [];
const pushState = window.history.pushState.bind(window.history);
const replaceState = window.history.replaceState.bind(window.history);

beforeEach(() => {
  nav.replace = vi.fn();
  nav.refreshed = 0;
  nav.onRefresh = undefined;
  downloads.length = 0;
  // Next keeps useSearchParams in step with history; so does this stand-in.
  window.history.pushState = (...args) => {
    pushState(...args);
    nav.notify();
  };
  window.history.replaceState = (...args) => {
    replaceState(...args);
    nav.notify();
  };
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input, "http://localhost");
    const request = new Request(url);
    if (url.pathname === "/garden/history") return historyRoute(request);
    if (url.pathname === "/garden/export") return exportRoute(request);
    return new Response("Not found", { status: 404 });
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  // jsdom has no layout; the workspace scrolls a saved entry into view.
  Element.prototype.scrollIntoView = () => {};
  // Pages is this person's remembered view, so lenses return to it.
  localStorage.setItem("slow-garden:garden-view", "list");
  let blob: Blob | null = null;
  URL.createObjectURL = (b: Blob) => ((blob = b), "blob:synthetic");
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (this.download && blob) downloads.push({ name: this.download, blob });
  });
});
afterEach(() => {
  cleanup();
  window.history.pushState = pushState;
  window.history.replaceState = replaceState;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const thoughtPath = `/garden?garden=${G1}&topic=${P1}&thought=${S1}&view=list`;
const notice = (text: string | RegExp) =>
  waitFor(() => expect(screen.getAllByRole("status").some((n) => (typeof text === "string" ? n.textContent === text : text.test(n.textContent ?? "")))).toBe(true));
/** A topic's bed card or a thought's specimen card on a Pages level. */
const card = (kind: "bed-card" | "specimen-card", name: string) =>
  waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(`button.${kind}`)].find((b) => b.textContent?.includes(name));
    if (!found) throw new Error(`No ${kind} named ${name}`);
    return found;
  });
const openMenu = (item: string) => {
  fireEvent.click(screen.getByRole("button", { name: /More/ }));
  fireEvent.click(within(screen.getByRole("navigation", { name: "Garden tools" })).getByRole("button", { name: item }));
};

describe.each<Mode>(["server", "browser"])("the main journeys in %s mode", (mode) => {
  it("first run with a seed pack lands on the first saved page, in a garden with the pack's topics", async () => {
    const w = world(false);
    start(mode, w, "/garden");
    const writing = await screen.findByLabelText("Write a first entry");
    await waitFor(() => expect(writing).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /A decision I’m circling/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "What I’m afraid of" }));
    fireEvent.change(writing, { target: { value: "Stay or go" } });
    fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
    // The thought page, with the page that was just written.
    expect(await screen.findByRole("heading", { level: 1, name: "Stay or go" })).toBeVisible();
    expect(await screen.findByText("Stay or go", { selector: "p.entry-body" })).toBeVisible();
    expect(screen.getByText("1 saved")).toBeVisible();
    expect(w.tables.gardens.map((g) => g.name)).toEqual(["My garden"]);
    expect(w.tables.plots.map((p) => p.name)).toEqual(["Notes", "The question itself", "What I’d tell a friend"]);
    expect(w.tables.seeds.map((s) => s.title)).toEqual(["Stay or go"]);
    expect(w.tables.current_entries.map((e) => e.body)).toEqual(["Stay or go"]);
    // The garden level lists the planted topics.
    fireEvent.click(screen.getByRole("button", { name: "Pages" }));
    fireEvent.click(await screen.findByRole("button", { name: /My garden/ }));
    for (const topic of ["Notes", "The question itself", "What I’d tell a friend"])
      expect(await card("bed-card", topic)).toBeVisible();
  });

  it("writes an entry, revises it, and shows both revisions in its history", async () => {
    const w = world(true);
    start(mode, w, thoughtPath);
    const page = await screen.findByLabelText("New entry", { selector: "textarea" });
    await waitFor(() => expect(page).toBeEnabled());
    fireEvent.change(page, { target: { value: "A second page" } });
    fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
    await notice("Entry saved to this thought.");
    const saved = (await screen.findByText("A second page", { selector: "p.entry-body" })).closest("article")!;
    expect(screen.getByText("2 saved")).toBeVisible();
    expect(within(saved).getByText("As first written")).toBeVisible();

    fireEvent.click(within(saved).getByRole("button", { name: "Revise" }));
    const revise = await within(saved).findByLabelText("Revise entry", { selector: "textarea" });
    await waitFor(() => expect(revise).toBeEnabled());
    fireEvent.change(revise, { target: { value: "A second page, reconsidered" } });
    fireEvent.click(within(saved).getByRole("button", { name: "Save revision" }));
    const revised = (await screen.findByText("A second page, reconsidered", { selector: "p.entry-body" })).closest("article")!;
    expect(await within(revised).findByText(/Revision 2 · revised/)).toBeVisible();

    fireEvent.click(within(revised).getByRole("button", { name: "Revision history" }));
    const history = await within(revised).findByRole("list", { name: "Revision history" });
    expect(within(history).getAllByRole("listitem").map((li) => li.querySelector(".entry-body")!.textContent).sort()).toEqual(["A second page", "A second page, reconsidered"]);
    expect(w.tables.seed_revisions.map((r) => r.body)).toEqual(["synthetic first page", "A second page", "A second page, reconsidered"]);
  });

  it("archives an entry out of the active view and restores it from Archive", async () => {
    const w = world(true);
    start(mode, w, thoughtPath);
    const entry = (await screen.findByText("synthetic first page", { selector: "p.entry-body" })).closest("article")!;
    fireEvent.click(within(entry).getByRole("button", { name: "Archive entry" }));
    await notice("entry archived. Find it in Archive; your writing was not deleted.");
    await waitFor(() => expect(screen.queryByText("synthetic first page", { selector: "p.entry-body" })).toBeNull());
    expect(screen.getByText("0 saved")).toBeVisible();
    expect(w.tables.entries[0].archived_at).toEqual(expect.any(String));

    openMenu("Archive");
    fireEvent.click(await card("bed-card", "Work"));
    fireEvent.click(await card("specimen-card", "First thought"));
    const archived = (await screen.findByText("synthetic first page", { selector: "p.entry-body" })).closest("article")!;
    fireEvent.click(within(archived).getByRole("button", { name: "Restore entry" }));
    await notice("entry restored. It is available in active views.");
    expect(w.tables.entries[0].archived_at).toBeNull();
    openMenu("Leave archive");
    fireEvent.click(await card("bed-card", "Work"));
    fireEvent.click(await card("specimen-card", "First thought"));
    expect(await screen.findByText("synthetic first page", { selector: "p.entry-body" })).toBeVisible();
  });

  it("keeps a bloom from the full record in Returns", async () => {
    const w = world(true);
    start(mode, w, `/garden?garden=${G1}&topic=${P1}&view=returns`);
    fireEvent.click(await screen.findByRole("button", { name: "Open the full record" }));
    const respond = await screen.findByRole("group", { name: /^Respond to / });
    fireEvent.click(within(respond).getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(w.tables.bloom_responses).toHaveLength(1));
    expect(w.tables.bloom_responses[0]).toMatchObject({ bloom_id: B1, response: "keep", correction: null, tenant_id: T });
    await waitFor(() => expect(screen.getAllByText(/Kept/).length).toBeGreaterThan(0));
  });

  it("saves a topic's tending choice and the overnight preference", async () => {
    const w = world(true);
    start(mode, w, `/garden?garden=${G1}&topic=${P1}&view=list`);
    fireEvent.click(await screen.findByText(/^Topic settings/));
    fireEvent.click(screen.getByRole("radio", { name: /^Tending on\s*This topic may be tended overnight/ }));
    await notice("Tending on saved for this topic.");
    await waitFor(() => expect(screen.getByText("Topic settings · Tending on")).toBeVisible());
    expect(w.tables.plots[0]).toMatchObject({ ai_enabled: true, cross_pollinate: false });

    openMenu("Settings & export");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Tend my garden overnight" }));
    await notice("Preference saved for UTC. This does not start or confirm an overnight run.");
    expect(w.tables.accounts[0]).toMatchObject({ tend_overnight: true, timezone: "UTC" });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Tend my garden overnight" })).toBeChecked());
  });

  it("imports a file as a thought and reports what was added", async () => {
    const w = world(true);
    start(mode, w, `/garden/import?garden=${G1}`, {}, "import");
    await screen.findByRole("heading", { name: "Bring in existing notes" });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [{ name: "walks.md", size: 40, lastModified: 10, text: async () => "## 2024-03-05\nA synthetic walk\n" }] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Import 1 / }));
    expect(await screen.findByText("Imported · 1 entries added, 0 already present")).toBeVisible();
    expect(w.tables.seeds.map((s) => s.title)).toEqual(["First thought", "walks"]);
    expect(w.tables.current_entries.map((e) => e.body)).toContain("A synthetic walk");
  });

  it("exports the same file in both modes", async () => {
    const w = world(true);
    const { db } = start(mode, w, thoughtPath);
    await screen.findByText("synthetic first page", { selector: "p.entry-body" });
    openMenu("Settings & export");
    const cases = [
      ["Export all sources · JSON", "/garden/export"],
      ["Export all sources · Markdown", "/garden/export?format=md"],
      ["Export this garden · JSON", `/garden/export?garden=${G1}`],
      ["Export this garden · Markdown", `/garden/export?format=md&garden=${G1}`],
    ] as const;
    for (const [name, href] of cases) {
      const link = await screen.findByRole("link", { name });
      // The same link in both modes; the server path leaves it to the browser.
      expect(link).toHaveAttribute("href", href);
      const before = downloads.length;
      const followed = fireEvent.click(link);
      current.db = db;
      const route = await exportRoute(new Request(new URL(href, "http://localhost")));
      const expected = await route.text();
      expect(route.status).toBe(200);
      if (mode === "server") {
        // Not intercepted: the browser follows the link to the route handler.
        expect(followed).toBe(true);
        expect(downloads).toHaveLength(before);
        continue;
      }
      expect(followed).toBe(false);
      await waitFor(() => expect(downloads).toHaveLength(before + 1));
      const file = downloads[before];
      // Byte for byte what the route handler sends, under the same name and type.
      const bytes = await new Promise<Uint8Array>((done) => {
        const reader = new FileReader();
        reader.onload = () => done(new Uint8Array(reader.result as ArrayBuffer));
        reader.readAsArrayBuffer(file.blob);
      });
      expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode(expected)));
      expect(route.headers.get("Content-Disposition")).toBe(`attachment; filename="${file.name}"`);
      expect(file.blob.type).toBe(route.headers.get("Content-Type")!.toLowerCase());
    }
  });

  it("deletes an entry permanently when deletion is switched on", async () => {
    const w = world(true, { deletion: true });
    start(mode, w, thoughtPath, { deletion: true });
    const entry = (await screen.findByText("synthetic first page", { selector: "p.entry-body" })).closest("article")!;
    fireEvent.click(within(entry).getByRole("button", { name: "Delete entry…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this entry permanently?" });
    expect(await within(dialog).findByText("This entry, with 1 saved version")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete entry permanently" }));
    await notice("Entry deleted permanently.");
    await waitFor(() => expect(screen.queryByText("synthetic first page", { selector: "p.entry-body" })).toBeNull());
    expect(screen.getByText("0 saved")).toBeVisible();
    expect(w.tables.entries).toHaveLength(0);
  });

  it("shows no delete control when deletion is switched off", async () => {
    start(mode, world(true), thoughtPath);
    await screen.findByText("synthetic first page", { selector: "p.entry-body" });
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("signs out, ends the session and leaves for the sign-in page", async () => {
    const w = world(true);
    const { calls } = start(mode, w, thoughtPath);
    await screen.findByText("synthetic first page", { selector: "p.entry-body" });
    openMenu("Sign out");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(w.claims).toBeNull();
    expect(calls.filter((c) => c.target === "auth:signOut").map((c) => c.steps[0])).toEqual([["signOut", { scope: "local" }]]);
    expect(nav.refreshed).toBeGreaterThan(0);
  });
});

describe("browser mode only: loading, signed out and error", () => {
  it("says it is loading, never shows the garden to a visitor without a session, and opens it after a code", async () => {
    const w = world(true);
    w.claims = null;
    const { db } = start("browser", w, thoughtPath);
    // Honest loading first; no garden content.
    expect(screen.getByText("Gathering what you left here…")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Sign in to your garden" })).toBeVisible();
    expect(screen.queryByText("synthetic first page")).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
    // A verified code starts the session, as the auth service would.
    const auth = (db as unknown as { auth: { verifyOtp: (p: unknown) => Promise<unknown> } }).auth;
    const verify = auth.verifyOtp;
    auth.verifyOtp = async (params) => {
      w.claims = { sub: T, email: "ada@example.test" };
      return verify(params);
    };
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "ada@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
    fireEvent.change(await screen.findByLabelText("Six-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Open my garden" }));
    // Back where the visitor was going, with no server redirect involved.
    expect(await screen.findByText("synthetic first page", { selector: "p.entry-body" })).toBeVisible();
    expect(window.location.search).toContain(`thought=${S1}`);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("says so when the garden cannot be read, and recovers on Try again", async () => {
    const w = world(true);
    w.fail["gardens.select"] = { code: "08006" };
    start("browser", w, thoughtPath);
    expect(await screen.findByRole("heading", { name: "Nothing was silently lost." })).toBeVisible();
    delete w.fail["gardens.select"];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("synthetic first page", { selector: "p.entry-body" })).toBeVisible();
  });

  it("shows the first-run page for an account with no garden yet", async () => {
    start("browser", world(false), "/garden");
    expect(await screen.findByLabelText("Write a first entry")).toBeVisible();
  });

  it("sign out everywhere asks the auth service for a global sign-out", async () => {
    const w = world(true);
    const { calls } = start("browser", w, thoughtPath);
    await screen.findByText("synthetic first page", { selector: "p.entry-body" });
    openMenu("Settings & export");
    fireEvent.click(await screen.findByRole("button", { name: "Sign out on all devices" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(calls.filter((c) => c.target === "auth:signOut").map((c) => c.steps[0])).toEqual([["signOut", { scope: "global" }]]);
  });
});

describe("browser mode: what is on screen is the garden the address names", () => {
  const G2 = "22222222-2222-4222-8222-222222222222";
  const twoGardens = () => {
    const w = world(true);
    w.tables.gardens.push({ id: G2, tenant_id: T, name: "Second Garden", status: "active", archived_at: null, created_at: "2026-11-02T09:00:00.000Z" });
    return w;
  };
  const go = (path: string) => act(() => window.history.pushState(null, "", path));

  it("a failed load of another garden shows the error screen, never the previous garden's workspace", async () => {
    const w = twoGardens();
    const { calls } = start("browser", w, thoughtPath);
    await screen.findByText("synthetic first page", { selector: "p.entry-body" });
    w.fail["gardens.select"] = { code: "08006" };
    go(`/garden?garden=${G2}&view=list`);
    expect(await screen.findByRole("heading", { name: "Nothing was silently lost." })).toBeVisible();
    // Nothing of the previous garden, and nothing to write into it with.
    expect(screen.queryByText("synthetic first page")).toBeNull();
    expect(screen.queryByText(/no longer available/)).toBeNull();
    expect(screen.queryByRole("button", { name: /New (topic|thought|garden)/ })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    // A retry, and a way back to where the person was.
    expect(screen.getByRole("link", { name: "Back to Home Garden" })).toHaveAttribute("href", `/garden?garden=${G1}`);
    const before = calls.length;
    delete w.fail["gardens.select"];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Second Garden" })).toBeVisible();
    expect(calls.slice(before).some((c) => c.target === "from:plots" && c.steps.some((step) => step[0] === "eq" && step[2] === G2))).toBe(true);
    expect(screen.queryByText("synthetic first page")).toBeNull();
  });

  it("going back from that error screen shows the previous garden again and re-reads it", async () => {
    const w = twoGardens();
    start("browser", w, thoughtPath);
    await screen.findByText("synthetic first page", { selector: "p.entry-body" });
    w.fail["gardens.select"] = { code: "08006" };
    go(`/garden?garden=${G2}&view=list`);
    await screen.findByRole("heading", { name: "Nothing was silently lost." });
    delete w.fail["gardens.select"];
    go(thoughtPath);
    expect(await screen.findByText("synthetic first page", { selector: "p.entry-body" })).toBeVisible();
    await waitFor(() => expect(screen.queryByText(/could not be refreshed/)).toBeNull());
  });

  it("a failed refresh of the same garden keeps the page, the unsaved draft and says it could not refresh", async () => {
    const w = world(true);
    start("browser", w, thoughtPath);
    const entry = (await screen.findByText("synthetic first page", { selector: "p.entry-body" })).closest("article")!;
    const page = screen.getByLabelText("New entry", { selector: "textarea" });
    await waitFor(() => expect(page).toBeEnabled());
    fireEvent.change(page, { target: { value: "words not saved yet" } });
    w.fail["gardens.select"] = { code: "08006" };
    fireEvent.click(within(entry).getByRole("button", { name: "Archive entry" }));
    // The change was saved and said so; the re-read failed and that is said too.
    await notice(/^entry archived\. Find it in Archive; your writing was not deleted\. The garden could not be refreshed/);
    expect(w.tables.entries[0].archived_at).toEqual(expect.any(String));
    expect(screen.queryByRole("heading", { name: "Nothing was silently lost." })).toBeNull();
    expect(screen.getByLabelText("New entry", { selector: "textarea" })).toHaveValue("words not saved yet");
    // The last good data stays: the entry is still listed until a refresh succeeds.
    expect(screen.getByText("synthetic first page", { selector: "p.entry-body" })).toBeVisible();
    delete w.fail["gardens.select"];
    fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
    await notice("Entry saved to this thought.");
    await waitFor(() => expect(screen.queryByText("synthetic first page", { selector: "p.entry-body" })).toBeNull());
    expect(screen.queryByText(/could not be refreshed/)).toBeNull();
  });

  it("refuses a write when another tab has signed in as a different account, and sends nothing", async () => {
    const w = world(true);
    const { calls } = start("browser", w, thoughtPath);
    const entry = (await screen.findByText("synthetic first page", { selector: "p.entry-body" })).closest("article")!;
    const page = screen.getByLabelText("New entry", { selector: "textarea" });
    await waitFor(() => expect(page).toBeEnabled());
    w.claims = { sub: "tenant-2", email: "grace@example.test" };
    const before = calls.length;
    fireEvent.change(page, { target: { value: "words for the first account" } });
    fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
    const refusal = "This page was opened by a different account, so nothing was saved. Reload the page to continue.";
    await notice(refusal);
    // The words are still in the page, unsaved.
    expect(screen.getByLabelText("New entry", { selector: "textarea" })).toHaveValue("words for the first account");
    fireEvent.click(within(entry).getByRole("button", { name: "Archive entry" }));
    await waitFor(() => expect(screen.getAllByText(refusal).length).toBe(2));
    expect(calls.slice(before).filter((c) => c.target.startsWith("rpc:save_entry") || c.steps.some((step) => step[0] === "insert" || step[0] === "update"))).toEqual([]);
    expect(w.tables.seed_revisions).toHaveLength(1);
    expect(w.tables.entries[0].archived_at).toBeNull();
  });

  it("a garden that no longer exists: the nearest garden is shown, said to be so, and new writing goes to the garden shown", async () => {
    const w = twoGardens();
    const gone = "99999999-9999-4999-8999-999999999999";
    start("browser", w, `/garden?garden=${gone}&view=list`);
    expect(await screen.findByRole("heading", { level: 1, name: "Home Garden" })).toBeVisible();
    expect(screen.getByText(/That location is no longer available/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /New topic/ }));
    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: "Fresh bed" } });
    fireEvent.submit(screen.getByLabelText(/Name/).closest("form")!);
    await waitFor(() => expect(w.tables.plots.map((p) => [p.name, p.garden_id])).toContainEqual(["Fresh bed", G1]));
    expect(w.tables.plots.some((p) => p.garden_id === gone)).toBe(false);
  });

  it("a garden archived elsewhere is shown as archived after the next read, with nowhere to write", async () => {
    const w = world(true);
    start("browser", w, thoughtPath);
    const entry = (await screen.findByText("synthetic first page", { selector: "p.entry-body" })).closest("article")!;
    await waitFor(() => expect(screen.getByLabelText("New entry", { selector: "textarea" })).toBeEnabled());
    Object.assign(w.tables.gardens[0], { status: "archived", archived_at: DAY });
    fireEvent.click(within(entry).getByRole("button", { name: "Revision history" }));
    await within(entry).findByRole("list", { name: "Revision history" });
    // Any re-read brings the change in; here, the one after a saved preference.
    openMenu("Settings & export");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Tend my garden overnight" }));
    expect(await screen.findByText(/This garden is archived\./)).toBeVisible();
    expect(screen.queryByLabelText("New entry", { selector: "textarea" })).toBeNull();
    expect(screen.getByRole("button", { name: "Revise" })).toBeDisabled();
  });
});
