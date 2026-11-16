/**
 * Where the browser keeps the session. The hosted app (server or browser
 * store) keeps the cookie client, which its server can read. A static export
 * has no server, so it keeps the session in this browser's own storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({
  cookie: [] as unknown[][],
  storage: [] as unknown[][],
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => {
    made.cookie.push(args);
    return { kind: "cookie" };
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    made.storage.push(args);
    return { kind: "storage", n: made.storage.length };
  },
}));

beforeEach(() => {
  vi.resetModules();
  made.cookie.length = made.storage.length = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic");
});
afterEach(() => vi.unstubAllEnvs());

describe("browser Supabase client", () => {
  it("is the cookie client unless the build target is the static export", async () => {
    for (const target of [undefined, "", "server", "Static", "export"]) {
      if (target === undefined) vi.stubEnv("NEXT_PUBLIC_GARDEN_TARGET", "");
      else vi.stubEnv("NEXT_PUBLIC_GARDEN_TARGET", target);
      const { createClient, sessionStorageKind } = await import("./client");
      expect(sessionStorageKind(), String(target)).toBe("cookies");
      expect(createClient()).toEqual({ kind: "cookie" });
    }
    expect(made.storage).toEqual([]);
    // Exactly the call the hosted app has always made.
    expect(made.cookie[0]).toEqual(["http://127.0.0.1:1", "sb_publishable_synthetic"]);
  });

  it("in a static export keeps the session in browser storage, never in a URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_GARDEN_TARGET", "static");
    const { createClient, sessionStorageKind } = await import("./client");
    expect(sessionStorageKind()).toBe("browser-storage");
    const client = createClient();
    expect(client).toMatchObject({ kind: "storage" });
    expect(made.cookie).toEqual([]);
    expect(made.storage[0]).toEqual([
      "http://127.0.0.1:1",
      "sb_publishable_synthetic",
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
    ]);
  });

  it("in a static export hands out one client, so one session and one refresh timer", async () => {
    vi.stubEnv("NEXT_PUBLIC_GARDEN_TARGET", "static");
    const { createClient } = await import("./client");
    expect(createClient()).toBe(createClient());
    expect(made.storage).toHaveLength(1);
  });
});
