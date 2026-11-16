import { afterEach, describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({ server: 0, browser: 0, flags: undefined as unknown }));
vi.mock("./server-default", () => ({
  createDefaultServerStore: () => {
    made.server++;
    return { kind: "server", getSession: async () => ({ signedIn: false }) };
  },
}));
vi.mock("./browser-default", () => ({
  createDefaultBrowserStore: (flags: unknown) => {
    made.browser++;
    made.flags = flags;
    return {
      kind: "browser",
      getSession: async () => ({ signedIn: true, tenantId: "t", email: null }),
      signOut: async () => {
        throw new Error("Sign-out failed. Please retry.");
      },
    };
  },
}));
import { createGardenStore, lazyStore, storeKind } from "./select";
import { STORE_OPERATIONS, type GardenStore } from "./types";

afterEach(() => {
  vi.unstubAllEnvs();
  made.server = made.browser = 0;
  made.flags = undefined;
});

describe("NEXT_PUBLIC_GARDEN_STORE", () => {
  it("defaults to the server store, and so does anything unrecognised", () => {
    for (const value of [undefined, "", "server", "Browser", "browser ", "client", "true"])
      expect(storeKind(value), String(value)).toBe("server");
    expect(storeKind("browser")).toBe("browser");
  });

  it("selects the server store when unset and loads only that implementation", async () => {
    vi.stubEnv("NEXT_PUBLIC_GARDEN_STORE", "");
    const store = createGardenStore();
    expect(store.kind).toBe("server");
    expect(made).toMatchObject({ server: 0, browser: 0 });
    expect(await store.getSession()).toEqual({ signedIn: false });
    await store.getSession();
    expect(made).toMatchObject({ server: 1, browser: 0 });
  });

  it("selects the browser store when asked and hands it the deployment flags", async () => {
    vi.stubEnv("NEXT_PUBLIC_GARDEN_STORE", "browser");
    const flags = () => ({ aiAvailable: true, deletionAvailable: false });
    const store = createGardenStore({ flags });
    expect(store.kind).toBe("browser");
    expect(await store.getSession()).toMatchObject({ signedIn: true });
    expect(made).toMatchObject({ server: 0, browser: 1 });
    expect(made.flags).toBe(flags);
  });

  it("an explicit kind overrides the environment", async () => {
    vi.stubEnv("NEXT_PUBLIC_GARDEN_STORE", "server");
    expect(createGardenStore({ kind: "browser" }).kind).toBe("browser");
  });
});

describe("lazyStore", () => {
  it("exposes every operation and passes rejections through", async () => {
    vi.stubEnv("NEXT_PUBLIC_GARDEN_STORE", "browser");
    const store = createGardenStore();
    for (const name of STORE_OPERATIONS) expect(typeof store[name]).toBe("function");
    await expect(store.signOut()).rejects.toThrow("Sign-out failed. Please retry.");
  });

  it("retries the load after a failed import instead of caching the failure", async () => {
    let attempts = 0;
    const store = lazyStore("browser", async () => {
      if (++attempts === 1) throw new Error("chunk failed");
      return { getSession: async () => ({ signedIn: false }) } as unknown as GardenStore;
    });
    await expect(store.getSession()).rejects.toThrow("chunk failed");
    expect(await store.getSession()).toEqual({ signedIn: false });
    expect(attempts).toBe(2);
  });
});
