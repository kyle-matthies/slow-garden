import { describe, expect, it } from "vitest";
import { createBrowserStore } from "./browser-store";
import { createFakeDb, createWorld } from "./testing/fake-supabase";

const ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

describe("browser store defaults", () => {
  it("keeps AI passes and deletion off unless the deployment says otherwise", async () => {
    const { db, calls } = createFakeDb(createWorld({ tables: { gardens: [], accounts: [] } }));
    const store = createBrowserStore({ client: () => db });
    expect(await store.requestPass(ID, [ID], ID)).toEqual({
      ok: false,
      message: "AI reflections are not enabled yet. Your writing remains available.",
    });
    for (const result of [
      await store.previewDeletion("entry", ID),
      await store.deleteItem("entry", ID),
      await store.deleteAccount("ada@example.test"),
    ])
      expect(result).toEqual({ ok: false, message: "Deletion is not available yet. Nothing was erased." });
    expect(calls).toEqual([]);
    const load = await store.loadGarden();
    expect(load).toMatchObject({ signedIn: true, data: { aiAvailable: false, deletionAvailable: false } });
  });

  it("reads the flags at call time, not at construction", async () => {
    const { db } = createFakeDb(createWorld({ tables: { garden_passes: [] } }));
    let aiAvailable = false;
    const store = createBrowserStore({ client: () => db, flags: () => ({ aiAvailable, deletionAvailable: false }) });
    expect((await store.requestPass(ID, [ID], ID)).ok).toBe(false);
    aiAvailable = true;
    expect(await store.requestPass(ID, [ID], ID)).toEqual({ ok: true, id: ID });
  });

  it("treats a missing configuration as signed out without building a client", async () => {
    const store = createBrowserStore({
      client: () => {
        throw new Error("no client");
      },
      configured: () => false,
    });
    expect(await store.getSession()).toEqual({ signedIn: false });
    expect(await store.loadGarden()).toEqual({ signedIn: false });
  });

  it("uses the injected clock for archive timestamps", async () => {
    const world = createWorld({ tables: { plots: [{ id: ID, archived_at: null }] } });
    const { db } = createFakeDb(world);
    const store = createBrowserStore({ client: () => db, now: () => new Date("2026-01-02T03:04:05.000Z") });
    expect(await store.setArchived("plot", ID, true)).toEqual({ ok: true });
    expect(world.tables.plots[0].archived_at).toBe("2026-01-02T03:04:05.000Z");
  });

  it("writes the caller's own tenant id from the verified session, never from input", async () => {
    const world = createWorld({ claims: { sub: "tenant-9" }, tables: { gardens: [] } });
    const { db } = createFakeDb(world);
    const store = createBrowserStore({ client: () => db });
    await store.createArea("garden", "Mine", "someone-else", ID);
    expect(world.tables.gardens).toEqual([{ id: ID, tenant_id: "tenant-9", name: "Mine" }]);
  });
});
