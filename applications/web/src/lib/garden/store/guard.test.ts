import { describe, expect, it, vi } from "vitest";
import type { GardenData } from "../types";
import { NOT_ON_SCREEN, OTHER_ACCOUNT, createGuardView, guardStore } from "./guard";
import { STORE_OPERATIONS, type GardenStore } from "./types";

const view = (gardenId: string, tenantId = "t"): GardenData =>
  ({
    tenantId,
    gardens: [{ id: gardenId, name: gardenId, status: "active" }, { id: "other-garden", name: "o", status: "active" }],
    gardenId,
    plots: [{ id: `${gardenId}-topic` }],
    seeds: [{ id: `${gardenId}-thought` }],
    entries: [{ entry_id: `${gardenId}-entry` }],
    aiAvailable: true,
    tending: { marks: [{ id: `${gardenId}-mark` }], blooms: [{ id: `${gardenId}-bloom` }], themes: [] },
    tendingHistory: { available: true, passes: [{ id: `${gardenId}-pass` }] },
  }) as unknown as GardenData;

function setup(shown: GardenData | null, sessionTenant: string | null = "t") {
  const inner: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of STORE_OPERATIONS) inner[name] = vi.fn(async () => ({ ok: true }));
  inner.getSession = vi.fn(async () => (sessionTenant ? { signedIn: true, tenantId: sessionTenant, email: null } : { signedIn: false }));
  inner.createArea = vi.fn(async (_k, _n, _p, id) => ({ ok: true, id }));
  inner.importThought = vi.fn(async () => ({ ok: true, id: "imported-thought", created: 1, skipped: 0 }));
  inner.loadReturns = vi.fn(async () => ({ passes: [{ id: "listed-pass" }], blooms: [{ id: "listed-bloom" }], responses: [] }));
  const holder = createGuardView();
  const otherAccount = vi.fn();
  holder.show(shown, otherAccount);
  const store = guardStore({ kind: "browser", ...inner } as unknown as GardenStore, holder);
  return { store, inner, holder, otherAccount };
}
const entryInput = (seedId: string, entryId = "new-entry") => ({ seedId, entryId, revisionId: "r", body: "b", expectedRevisionId: null });
const refused = { ok: false, message: NOT_ON_SCREEN };

/** Every write, aimed at garden `g`. */
const writes = (store: GardenStore, g: string): [string, () => Promise<unknown>][] => [
  ["createArea topic", () => store.createArea("plot", "n", g, "id-1")],
  ["createArea thought", () => store.createArea("seed", "n", `${g}-topic`, "id-2")],
  ["saveEntry", () => store.saveEntry(entryInput(`${g}-thought`))],
  ["setArchived garden", () => store.setArchived("garden", g, true)],
  ["setArchived topic", () => store.setArchived("plot", `${g}-topic`, true)],
  ["setArchived thought", () => store.setArchived("seed", `${g}-thought`, true)],
  ["setArchived entry", () => store.setArchived("entry", `${g}-entry`, true)],
  ["setTopicTending", () => store.setTopicTending(`${g}-topic`, true, false)],
  ["requestPass", () => store.requestPass(g, [`${g}-topic`], "pass-id")],
  ["cancelPass", () => store.cancelPass(`${g}-pass`)],
  ["respondToBloom", () => store.respondToBloom("r", `${g}-bloom`, "keep", "")],
  ["respondToMark", () => store.respondToMark("r", `${g}-mark`, "keep")],
  ["importThought", () => store.importThought({ plotId: `${g}-topic`, title: "t", entries: [] })],
  ["previewDeletion", () => store.previewDeletion("seed", `${g}-thought`)],
  ["deleteItem entry", () => store.deleteItem("entry", `${g}-entry`)],
  ["deleteItem topic", () => store.deleteItem("plot", `${g}-topic`, "n")],
];
const accountWrites = (store: GardenStore): [string, () => Promise<unknown>][] => [
  ["createArea garden", () => store.createArea("garden", "n", "", "id-0")],
  ["setTendingPreferences", () => store.setTendingPreferences(true, "UTC")],
  ["deleteAccount", () => store.deleteAccount("x")],
  ["previewDeletion account", () => store.previewDeletion("account", "")],
];
const called = (inner: Record<string, ReturnType<typeof vi.fn>>) =>
  STORE_OPERATIONS.filter((n) => n !== "getSession" && inner[n].mock.calls.length > 0);

describe("guardStore", () => {
  it("lets every write through when it names what is on screen", async () => {
    const { store, inner } = setup(view("a"));
    for (const [name, run] of [...writes(store, "a"), ...accountWrites(store)])
      expect(await run(), name).toMatchObject({ ok: true });
    expect(inner.saveEntry).toHaveBeenCalledOnce();
    expect(inner.deleteItem).toHaveBeenCalledTimes(2);
  });

  it("refuses every write aimed at a garden that is not the one on screen, and sends nothing", async () => {
    const { store, inner } = setup(view("b"));
    for (const [name, run] of writes(store, "a")) expect(await run(), name).toEqual(refused);
    expect(called(inner)).toEqual([]);
  });

  it("refuses every write while no garden is on screen (loading, or the error screen)", async () => {
    const { store, inner } = setup(null);
    for (const [name, run] of [...writes(store, "a"), ...accountWrites(store)])
      expect(await run(), name).toEqual(refused);
    expect(called(inner)).toEqual([]);
    expect(inner.getSession).not.toHaveBeenCalled();
  });

  it("refuses every write when the session is now another account, and asks for a re-read", async () => {
    const { store, inner, otherAccount } = setup(view("a"), "someone-else");
    for (const [name, run] of [...writes(store, "a"), ...accountWrites(store)])
      expect(await run(), name).toEqual({ ok: false, message: OTHER_ACCOUNT });
    expect(called(inner)).toEqual([]);
    expect(otherAccount).toHaveBeenCalled();
  });

  it("leaves a signed-out write to the store's own sign-in answer", async () => {
    const { store, inner } = setup(view("a"), null);
    inner.saveEntry.mockResolvedValue({ ok: false, message: "Please sign in again. Your draft is still here." });
    expect(await store.saveEntry(entryInput("a-thought"))).toEqual({ ok: false, message: "Please sign in again. Your draft is still here." });
  });

  it("follows the screen: what was allowed is refused once another garden is shown", async () => {
    const { store, holder, inner } = setup(view("a"));
    expect(await store.saveEntry(entryInput("a-thought"))).toMatchObject({ ok: true });
    holder.show(view("b"), () => {});
    expect(await store.saveEntry(entryInput("a-thought"))).toEqual(refused);
    expect(await store.saveEntry(entryInput("b-thought"))).toMatchObject({ ok: true });
    expect(inner.saveEntry).toHaveBeenCalledTimes(2);
  });

  it("refuses when the screen changes while the session is being checked", async () => {
    const { store, holder, inner } = setup(view("a"));
    inner.getSession.mockImplementation(async () => {
      holder.show(null, () => {});
      return { signedIn: true, tenantId: "t", email: null };
    });
    expect(await store.saveEntry(entryInput("a-thought"))).toEqual(refused);
    expect(inner.saveEntry).not.toHaveBeenCalled();
  });

  it("allows first run: a garden, its topic, a thought and an entry created before any re-read", async () => {
    const { store } = setup({ ...view(""), gardens: [], plots: [], seeds: [], entries: [] });
    expect(await store.createArea("garden", "My garden", "", "g-new")).toMatchObject({ ok: true });
    expect(await store.createArea("plot", "Notes", "g-new", "p-new")).toMatchObject({ ok: true });
    expect(await store.createArea("seed", "Title", "p-new", "s-new")).toMatchObject({ ok: true });
    expect(await store.saveEntry(entryInput("s-new", "e-new"))).toMatchObject({ ok: true });
    expect(await store.setArchived("entry", "e-new", true)).toMatchObject({ ok: true });
    // An id this store never created is still refused.
    expect(await store.createArea("plot", "Notes", "g-elsewhere", "p-2")).toEqual(refused);
  });

  it("forgets what it created when the account on screen changes", async () => {
    const { store, holder, inner } = setup(view("a"));
    await store.createArea("garden", "n", "", "g-new");
    holder.show(view("b", "other"), () => {});
    inner.getSession.mockResolvedValue({ signedIn: true, tenantId: "other", email: null });
    expect(await store.createArea("plot", "n", "g-new", "p-new")).toEqual(refused);
  });

  it("reads Returns for the garden on screen only, and accepts responses to what that record listed", async () => {
    const { store, inner } = setup(view("a"));
    await expect(store.loadReturns("b")).rejects.toThrow(NOT_ON_SCREEN);
    expect(inner.loadReturns).not.toHaveBeenCalled();
    expect(await store.respondToBloom("r", "listed-bloom", "keep", "")).toEqual(refused);
    await store.loadReturns("a");
    expect(await store.respondToBloom("r", "listed-bloom", "keep", "")).toMatchObject({ ok: true });
    expect(await store.cancelPass("listed-pass")).toMatchObject({ ok: true });
  });

  it("passes reads, sign-in and sign-out straight through", async () => {
    const { store, inner } = setup(null);
    await store.loadGarden("a");
    await store.loadEntryHistory("e");
    await store.locateRevisions(["r"]);
    await store.exportGarden({ format: "md" });
    await store.requestEmailCode("a@example.test");
    await store.verifyEmailCode("a@example.test", "123456");
    await store.signOut("global");
    expect(called(inner).sort()).toEqual(["exportGarden", "loadEntryHistory", "loadGarden", "locateRevisions", "requestEmailCode", "signOut", "verifyEmailCode"]);
    expect(store.kind).toBe("browser");
  });
});
