/**
 * Static-build readiness (ADR-009 stage 2). A check, not a build switch:
 * `next.config.ts` is unchanged and no export is built here.
 *
 * 1. Nothing reachable from the browser-mode entry may be server-only. A
 *    static (Capacitor) build has no server, so its bundle must have no path
 *    to cookies, the cache API, a server action or the server Supabase client.
 * 2. What still blocks `output: 'export'` is listed from the source tree and
 *    pinned here, so the list in the delivery record cannot drift from the
 *    code: adding a blocker, or removing one, fails this test until the list
 *    is updated.
 */
// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC, imports, isServerModule, reachable, violations } from "./testing/import-graph";

const rel = (file: string) => relative(SRC, file).split("\\").join("/");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

/** What a browser-mode page mounts: the store provider, the garden and import entry, sign-in. */
const BROWSER_ENTRIES = [
  "lib/garden/store/browser-provider.tsx",
  "app/garden/browser-entry.tsx",
  "app/login/login-screen.tsx",
];

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

describe("browser-mode entry: nothing server-only is reachable", () => {
  it.each(BROWSER_ENTRIES)("%s", (entry) => {
    expect(violations(join(SRC, entry))).toEqual([]);
  });

  it("the entry really reaches the workspace, its children and the browser store", () => {
    const seen = new Set(BROWSER_ENTRIES.flatMap((entry) => reachable(join(SRC, entry)).map(rel)));
    for (const path of [
      "app/garden/workspace.tsx",
      "app/garden/entry-editor.tsx",
      "app/garden/first-run.tsx",
      "app/garden/new-area.tsx",
      "app/garden/returns.tsx",
      "app/garden/tending-settings.tsx",
      "app/garden/delete-control.tsx",
      "app/garden/delete-reauth.tsx",
      "app/garden/export-link.tsx",
      "app/garden/import/import-form.tsx",
      "app/login/login-form.tsx",
      "lib/garden/store/browser-store.ts",
      "lib/supabase/client.ts",
    ])
      expect(seen, path).toContain(path);
    // And none of the server wiring, by any route.
    for (const path of [
      "app/garden/actions.ts",
      "app/garden/import/actions.ts",
      "app/garden/returns-lookup.ts",
      "lib/garden/store/server-default.ts",
      "lib/garden/store/server-loader.ts",
      "lib/garden/store/select.ts",
      "lib/garden/store/provider.tsx",
      "lib/garden/data.ts",
      "lib/supabase/server.ts",
    ])
      expect(seen, path).not.toContain(path);
  });

  it("no component calls a server action, a route handler or Supabase directly", () => {
    // Everything under app/garden and app/login that runs in the browser goes
    // through the store. The server store, the pages and the handlers
    // themselves are the only callers left.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, "app"))) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/.test(source)) continue;
      for (const specifier of imports(source)) {
        if (/(^|\/)actions$|returns-lookup$|supabase\/(client|server)$|server-loader$/.test(specifier))
          offenders.push(`${rel(file)} imports ${specifier}`);
      }
      if (/fetch\(\s*[`"']\/garden\//.test(source)) offenders.push(`${rel(file)} fetches a route handler`);
    }
    // The browser entry asks only whether Supabase is configured (public values).
    expect(offenders).toEqual(["app/garden/browser-entry.tsx imports @/lib/supabase/client"]);
  });

  it("the walker catches the server page, so a clean result above means something", () => {
    const page = violations(join(SRC, "app/garden/page.tsx"));
    expect(page.some((v) => v.includes("server Supabase client"))).toBe(true);
    const provider = violations(join(SRC, "lib/garden/store/provider.tsx"));
    expect(provider.some((v) => v.includes('"use server" module'))).toBe(true);
  });
});

describe("what still blocks output: 'export'", () => {
  const files = sourceFiles();
  const app = files.filter((f) => rel(f).startsWith("app/"));
  const sources = new Map(files.map((f) => [rel(f), readFileSync(f, "utf8")]));
  const list = (test: (path: string, source: string) => boolean) =>
    [...sources].filter(([path, source]) => test(path, source)).map(([path]) => path).sort();

  it("route handlers", () => {
    // Handlers that read the Request cannot be exported; /api/health reads nothing.
    expect(list((path) => /(^|\/)route\.ts$/.test(path))).toEqual([
      "app/api/health/route.ts",
      "app/garden/export/route.ts",
      "app/garden/history/route.ts",
    ]);
    expect(read("app/garden/export/route.ts")).toMatch(/request\.url/);
    expect(read("app/garden/history/route.ts")).toMatch(/request\.url/);
  });

  it("the proxy", () => {
    expect(list((path) => path === "proxy.ts" || path === "middleware.ts")).toEqual(["proxy.ts"]);
  });

  it("server actions", () => {
    expect(list((_path, source) => isServerModule(source))).toEqual([
      "app/garden/actions.ts",
      "app/garden/import/actions.ts",
      "app/garden/returns-lookup.ts",
      "lib/garden/store/server-loader.ts",
    ]);
  });

  it("pages that are forced dynamic, read cookies, or read search parameters on the server", () => {
    const pages = app.map(rel).filter((path) => /(^|\/)page\.tsx$/.test(path)).sort();
    const facts = pages.map((path) => {
      const source = sources.get(path)!;
      return [
        path,
        [
          /export const dynamic = "force-dynamic"/.test(source) && "force-dynamic",
          /supabase\/server/.test(source) && "cookies",
          /searchParams/.test(source) && "searchParams",
          /redirect\(/.test(source) && "redirect",
        ]
          .filter(Boolean)
          .join(", "),
      ];
    });
    expect(facts).toEqual([
      ["app/account/deleted/page.tsx", ""],
      ["app/dev/axe-fixtures/page.tsx", "force-dynamic, searchParams"],
      ["app/garden/import/page.tsx", "force-dynamic, cookies, searchParams, redirect"],
      ["app/garden/meadow-preview/page.tsx", ""],
      ["app/garden/page.tsx", "force-dynamic, cookies, searchParams, redirect"],
      ["app/garden/returns-preview/page.tsx", ""],
      ["app/login/page.tsx", "force-dynamic, cookies, redirect"],
      ["app/page.tsx", "force-dynamic, cookies, redirect"],
    ]);
  });

  it("dynamic route segments: none", () => {
    const segments = app.map(rel).filter((path) => /\[[^/]+\]/.test(path));
    expect(segments).toEqual([]);
  });

  it("response headers set in next.config.ts (not applied by a static host)", () => {
    const config = readFileSync(join(SRC, "../next.config.ts"), "utf8");
    expect(config).toMatch(/async headers\(\)/);
    expect(config).not.toMatch(/output:\s*["']export["']/);
    expect(config).not.toMatch(/rewrites\(\)|redirects\(\)/);
  });

  it("the store selection module still names the server wiring", () => {
    // select.ts loads `server-default` behind a build-time constant. The
    // browser-mode entry above does not import select.ts at all, so a static
    // build does not depend on the bundler discarding that branch.
    expect(imports(read("lib/garden/store/select.ts"))).toContain("./server-default");
  });
});
