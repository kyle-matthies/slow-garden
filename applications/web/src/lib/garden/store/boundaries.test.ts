/**
 * Lint-style guard: nothing reachable from a `store/browser*` module may be
 * server-only. A static (Capacitor) build has no server, and a browser bundle
 * must never contain a path to cookies, the cache API or a server action.
 */
// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { imports, isServerModule, violations } from "./testing/import-graph";

const STORE = dirname(fileURLToPath(import.meta.url));
const browserModules = readdirSync(STORE)
  .filter((name) => /^browser.*\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => join(STORE, name));

describe("browser store boundaries", () => {
  it("finds the browser modules", () => {
    expect(browserModules.map((f) => relative(STORE, f)).sort()).toEqual(["browser-default.ts", "browser-provider.tsx", "browser-store.ts"]);
  });

  it.each(browserModules.map((f) => [relative(STORE, f), f]))(
    "%s reaches no server-only module or server action",
    (_name, file) => {
      expect(violations(file)).toEqual([]);
    },
  );

  it.each(["rules.ts", "queries.ts", "auth.ts", "types.ts", "server-action-store.ts"])(
    "shared module %s is free of server imports too",
    (name) => {
      expect(violations(join(STORE, name))).toEqual([]);
    },
  );

  it("no service-role key or secret is named anywhere in the store", () => {
    const names = readdirSync(STORE, { recursive: true }) as string[];
    for (const name of names) {
      const file = join(STORE, name);
      if (!statSync(file).isFile() || /\.test\.tsx?$/.test(name)) continue;
      const source = readFileSync(file, "utf8");
      expect(source, name).not.toMatch(/SERVICE_ROLE|service_role|SECRET_KEY|createServerClient/);
      const env = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
      for (const key of env) expect(key, `${name} reads ${key}`).toMatch(/^NEXT_PUBLIC_/);
    }
  });

  it("the guard itself detects each kind of violation", () => {
    expect(imports(`import { cookies } from "next/headers";`)).toEqual(["next/headers"]);
    expect(imports(`import "server-only";\nimport type { A } from './a';`)).toEqual(["server-only", "./a"]);
    expect(imports(`export { x } from "next/cache";`)).toEqual(["next/cache"]);
    expect(imports(`const m = await import("@/app/garden/actions");`)).toEqual(["@/app/garden/actions"]);
    expect(imports(`import {\n  a,\n  b,\n} from "../x";`)).toEqual(["../x"]);
    expect(isServerModule(`"use server";\nexport async function a() {}`)).toBe(true);
    expect(isServerModule(`/** doc */\n'use server'\n`)).toBe(true);
    expect(isServerModule(`const s = "use server";`)).toBe(false);
    // The server wiring is caught for both reasons, so the walker is live.
    const server = violations(join(STORE, "server-default.ts"));
    expect(server.some((v) => v.includes('"use server" module'))).toBe(true);
    expect(server.some((v) => v.includes("next/cache"))).toBe(true);
    expect(server.some((v) => v.includes("server Supabase client"))).toBe(true);
  });
});
