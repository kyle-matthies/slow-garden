import { describe, expect, it } from "vitest";
import { createBrowserStore } from "./browser-store";
import { createFakeDb, createWorld } from "./testing/fake-supabase";

const ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

describe("browser store defaults", () => {
  const off = { ok: false, message: "Deletion is not available yet. Nothing was erased." };
  const noAi = { ok: false, message: "AI reflections are not enabled yet. Your writing remains available." };

  it("with no flags and a database that predates the capabilities RPC, keeps AI passes and deletion off", async () => {
    const world = createWorld({ tables: { gardens: [], accounts: [], garden_passes: [] } });
    world.rpc.delete_entry = () => ({ data: { deleted: true }, error: null });
    const { db, calls } = createFakeDb(world);
    const store = createBrowserStore({ client: () => db });
    expect(await store.requestPass(ID, [ID], ID)).toEqual(noAi);
    for (const result of [
      await store.previewDeletion("entry", ID),
      await store.deleteItem("entry", ID),
      await store.deleteAccount("ada@example.test"),
    ])
      expect(result).toEqual(off);
    // It asked the database what is available and reached nothing else: an
    // unguarded deletion RPC from before the switch is never called.
    expect(calls.map((c) => c.target)).toEqual(Array(4).fill("rpc:garden_capabilities"));
    const load = await store.loadGarden();
    expect(load).toMatchObject({ signedIn: true, data: { aiAvailable: false, deletionAvailable: false } });
  });

  it("with no flags, lets the database decide", async () => {
    const world = createWorld({ tables: { gardens: [], accounts: [], garden_passes: [] } });
    let answer: unknown = { tending: true, deletion: false };
    world.rpc.garden_capabilities = () => ({ data: answer, error: null });
    world.rpc.delete_entry = () => ({ data: { deleted: true }, error: null });
    const { db, calls } = createFakeDb(world);
    const store = createBrowserStore({ client: () => db });
    expect(await store.loadGarden()).toMatchObject({ data: { aiAvailable: true, deletionAvailable: false } });
    expect(await store.requestPass(ID, [ID], ID)).toEqual({ ok: true, id: ID });
    expect(await store.deleteItem("entry", ID)).toEqual(off);
    expect(calls.some((c) => c.target === "rpc:delete_entry")).toBe(false);
    answer = { tending: false, deletion: true };
    expect(await store.loadGarden()).toMatchObject({ data: { aiAvailable: false, deletionAvailable: true } });
    expect(await store.requestPass(ID, [ID], "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1")).toEqual(noAi);
    expect(await store.deleteItem("entry", ID)).toEqual({ ok: true });
    world.fail["rpc.garden_capabilities"] = { code: "42501" };
    expect(await store.deleteItem("entry", ID)).toEqual(off);
    expect(await store.loadGarden()).toMatchObject({ data: { aiAvailable: false, deletionAvailable: false } });
  });

  it("supplied flags that are off refuse without any call, whatever the database says", async () => {
    const world = createWorld({ tables: { gardens: [], accounts: [] } });
    world.rpc.garden_capabilities = () => ({ data: { tending: true, deletion: true }, error: null });
    const { db, calls } = createFakeDb(world);
    const store = createBrowserStore({ client: () => db, flags: () => ({ aiAvailable: false, deletionAvailable: false }) });
    expect(await store.requestPass(ID, [ID], ID)).toEqual(noAi);
    expect(await store.deleteItem("entry", ID)).toEqual(off);
    expect(await store.deleteAccount("ada@example.test")).toEqual(off);
    expect(calls).toEqual([]);
    expect(await store.loadGarden()).toMatchObject({ data: { aiAvailable: false, deletionAvailable: false } });
  });

  it("supplied flags that are on still need the database to allow", async () => {
    const world = createWorld({ tables: { gardens: [], accounts: [] } });
    world.rpc.garden_capabilities = () => ({ data: { tending: false, deletion: false }, error: null });
    world.fail["rpc.delete_entry"] = { code: "SGA03" };
    const { db } = createFakeDb(world);
    const store = createBrowserStore({ client: () => db, flags: () => ({ aiAvailable: true, deletionAvailable: true }) });
    expect(await store.loadGarden()).toMatchObject({ data: { aiAvailable: false, deletionAvailable: false } });
    expect(await store.deleteItem("entry", ID)).toEqual(off);
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
