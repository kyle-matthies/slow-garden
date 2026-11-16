/**
 * Static export (ADR-009 stage 3). `GARDEN_STATIC_EXPORT=1` builds the app
 * with `output: 'export'` from the `*.static.tsx` route files only; the
 * hosted build never sees those files and is otherwise unchanged. This file
 * pins both halves so the delivery record
 * (documents/operations/STATIC_EXPORT_2026-11-16.md) cannot drift from the code:
 *
 * 1. Nothing reachable from the browser-mode entry, or from any static route
 *    file, may be server-only: no cookies, cache API, server action or server
 *    Supabase client.
 * 2. The static route files are listed, and none of them forces a dynamic
 *    render, reads cookies or search parameters on the server, or redirects.
 * 3. What the switch does to `next.config.ts`, and what it leaves alone.
 * 4. What cannot be exported stays on the server path only, listed with the
 *    reason. Adding or removing one fails here until the list is updated.
 *
 * A source check: the build itself is run by hand (see the delivery record).
 */
// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** A route file of the static export: Next sees it only with `pageExtensions: ["static.tsx"]`. */
const isStaticRoute = (path: string) => /\.static\.tsx?$/.test(path);
const STATIC_ROUTES = sourceFiles().map(rel).filter(isStaticRoute).sort();

/** What makes a page impossible to export, read from its source. */
function serverFacts(source: string): string {
  return [
    /export const dynamic = "force-dynamic"/.test(source) && "force-dynamic",
    /supabase\/server/.test(source) && "cookies",
    /searchParams/.test(source) && "searchParams",
    /redirect\(/.test(source) && "redirect",
  ]
    .filter(Boolean)
    .join(", ");
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

describe("the static route files (GARDEN_STATIC_EXPORT=1)", () => {
  it("are exactly these", () => {
    expect(STATIC_ROUTES).toEqual([
      "app/account/deleted/page.static.tsx",
      "app/error.static.tsx",
      "app/garden/import/page.static.tsx",
      "app/garden/page.static.tsx",
      "app/layout.static.tsx",
      "app/loading.static.tsx",
      "app/login/page.static.tsx",
      "app/page.static.tsx",
    ]);
  });

  it.each(STATIC_ROUTES)("%s reaches nothing server-only", (path) => {
    expect(violations(join(SRC, path))).toEqual([]);
  });

  it.each(STATIC_ROUTES)("%s forces nothing dynamic, reads no cookie or search parameter, redirects nowhere", (path) => {
    const source = read(path);
    expect(serverFacts(source)).toBe("");
    expect(source).not.toMatch(/next\/headers|cookies\(|headers\(|revalidate|generateStaticParams/);
    // Only public build-time values, and the two deployment switches the
    // landing page states at build time.
    const env = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    for (const key of env)
      expect(key, `${path} reads ${key}`).toMatch(/^(NEXT_PUBLIC_[A-Z0-9_]+|GARDEN_AI_ENABLED|GARDEN_DELETION_ENABLED)$/);
  });

  it("no route handler, proxy or instrumentation file is part of the static build", () => {
    const names = STATIC_ROUTES.map((path) => path.split("/").pop());
    for (const name of names) expect(name).toMatch(/^(page|layout|loading|error)\.static\.tsx$/);
    expect(sourceFiles().map(rel).filter((path) => /(^|\/)(route|proxy|middleware|instrumentation)\.static\./.test(path))).toEqual([]);
  });

  it("the garden, import and sign-in pages mount the browser store and the browser entry, with no deployment flag", () => {
    for (const [path, entry] of [
      ["app/garden/page.static.tsx", "<BrowserGarden />"],
      ["app/garden/import/page.static.tsx", "<BrowserImport />"],
      ["app/login/page.static.tsx", "<LoginScreen configured={isSupabaseConfigured()} />"],
    ]) {
      const source = read(path);
      expect(source, path).toContain("<BrowserStoreProvider>");
      expect(source, path).toContain(entry);
      // No flag is passed, so the database decides alone (garden_capabilities()).
      expect(source, path).not.toMatch(/aiAvailable|deletionAvailable|StoreBoundary|GardenStoreProvider|store\/select/);
    }
    // The login page asks only whether Supabase is configured (public values).
    expect(imports(read("app/login/page.static.tsx"))).toContain("@/lib/supabase/client");
  });

  it("the landing page is the hosted one, with the signed-in check done in the browser", () => {
    const source = read("app/page.static.tsx");
    expect(source).toContain("<LandingPage");
    expect(source).toContain("<SignedInRedirect />");
    expect(read("app/page.tsx")).toContain("<LandingPage");
  });

  it("the layout carries the policy the hosted app sends as a header", () => {
    const source = read("app/layout.static.tsx");
    expect(source).toMatch(/httpEquiv="Content-Security-Policy" content=\{process\.env\.NEXT_PUBLIC_GARDEN_CSP\}/);
    expect(source).toMatch(/name="referrer" content="no-referrer"/);
    expect(source).toMatch(/export \{ metadata, viewport \} from "\.\/layout"/);
  });

  it("the session lives in browser storage in this build only", () => {
    const client = read("lib/supabase/client.ts");
    expect(client).toMatch(/NEXT_PUBLIC_GARDEN_TARGET === "static"/);
    expect(client).toMatch(/detectSessionInUrl: false/);
  });
});

describe("next.config.ts: the build switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  const SUPABASE = {
    NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
  };
  async function config(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const name of [
      "GARDEN_STATIC_EXPORT",
      "NEXT_PUBLIC_GARDEN_STORE",
      "NEXT_PUBLIC_GARDEN_TARGET",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ])
      vi.stubEnv(name, env[name] ?? "");
    return (await import("../../../../next.config")).default;
  }
  const POLICY =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self'; " +
    "connect-src 'self' https://synthetic.supabase.test wss://synthetic.supabase.test; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'; " +
    "worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests";

  it.each([undefined, "", "0"])("unset (%j): the hosted build, with nothing of the export in it", async (value) => {
    const hosted = await config({ ...SUPABASE, GARDEN_STATIC_EXPORT: value });
    expect(Object.keys(hosted).sort()).toEqual(["headers", "logging", "poweredByHeader", "turbopack"]);
    expect(hosted).toMatchObject({ logging: false, poweredByHeader: false });
    const rules = await hosted.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/(.*)");
    expect(Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))).toEqual({
      "Content-Security-Policy": POLICY,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-DNS-Prefetch-Control": "off",
    });
  });

  it("the hosted build does not need Supabase values, and may select either store", async () => {
    for (const store of ["", "server", "browser"])
      expect(Object.keys(await config({ NEXT_PUBLIC_GARDEN_STORE: store })).sort()).toEqual([
        "headers",
        "logging",
        "poweredByHeader",
        "turbopack",
      ]);
  });

  it("GARDEN_STATIC_EXPORT=1: an export of the static route files, on the browser store", async () => {
    const exported = await config({ ...SUPABASE, GARDEN_STATIC_EXPORT: "1" });
    expect(Object.keys(exported).sort()).toEqual([
      "env",
      "logging",
      "output",
      "pageExtensions",
      "poweredByHeader",
      "trailingSlash",
      "turbopack",
    ]);
    expect(exported).toMatchObject({
      output: "export",
      trailingSlash: true,
      pageExtensions: ["static.tsx"],
      logging: false,
      poweredByHeader: false,
    });
    // Headers, rewrites and redirects do not exist without a server.
    expect(exported.headers).toBeUndefined();
    expect(exported.rewrites).toBeUndefined();
    expect(exported.redirects).toBeUndefined();
    expect(exported.env).toEqual({
      NEXT_PUBLIC_GARDEN_STORE: "browser",
      NEXT_PUBLIC_GARDEN_TARGET: "static",
      // The header's policy without the one directive a <meta> tag cannot carry.
      NEXT_PUBLIC_GARDEN_CSP: POLICY.replace(" frame-ancestors 'none';", ""),
    });
    expect(exported.env!.NEXT_PUBLIC_GARDEN_CSP).not.toMatch(/frame-ancestors/);
  });

  it("pageExtensions keeps the two builds apart", () => {
    // Hosted (Next's default extensions): `page.static.tsx` is not `page.<ext>`.
    const hosted = /^(page|route|layout|loading|error|proxy)\.(tsx|ts|jsx|js)$/;
    // Static: only `<name>.static.tsx`.
    const exported = /^(page|route|layout|loading|error|proxy)\.(static\.tsx)$/;
    const names = sourceFiles().map((file) => file.split("/").pop()!);
    for (const name of names.filter(isStaticRoute)) {
      expect(name).not.toMatch(hosted);
      expect(name).toMatch(exported);
    }
    for (const name of ["page.tsx", "route.ts", "proxy.ts", "layout.tsx"]) expect(name).not.toMatch(exported);
  });

  it("refuses a value it does not know, the server store, and a build with no Supabase values", async () => {
    for (const value of ["true", "yes", "export", "1 "])
      await expect(config({ ...SUPABASE, GARDEN_STATIC_EXPORT: value }), value).rejects.toThrow(
        /GARDEN_STATIC_EXPORT must be "1" or unset/,
      );
    await expect(
      config({ ...SUPABASE, GARDEN_STATIC_EXPORT: "1", NEXT_PUBLIC_GARDEN_STORE: "server" }),
    ).rejects.toThrow(/NEXT_PUBLIC_GARDEN_STORE must be unset or "browser"/);
    await expect(config({ GARDEN_STATIC_EXPORT: "1" })).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect((await config({ ...SUPABASE, GARDEN_STATIC_EXPORT: "1", NEXT_PUBLIC_GARDEN_STORE: "browser" })).output).toBe("export");
  });
});

describe("server path only: what cannot be exported, and why it stays", () => {
  const files = sourceFiles();
  const app = files.filter((f) => rel(f).startsWith("app/"));
  const sources = new Map(files.map((f) => [rel(f), readFileSync(f, "utf8")]));
  const list = (test: (path: string, source: string) => boolean) =>
    [...sources].filter(([path, source]) => test(path, source)).map(([path]) => path).sort();
  const fromStatic = new Set(STATIC_ROUTES.flatMap((path) => reachable(join(SRC, path)).map(rel)));

  it("route handlers: they read the Request (export, history) or exist for the host (health)", () => {
    // Replaced in the static build by store.exportGarden and
    // store.loadEntryHistory. Kept because the server store still calls them.
    const handlers = list((path) => /(^|\/)route\.ts$/.test(path));
    expect(handlers).toEqual([
      "app/api/health/route.ts",
      "app/garden/export/route.ts",
      "app/garden/history/route.ts",
    ]);
    expect(read("app/garden/export/route.ts")).toMatch(/request\.url/);
    expect(read("app/garden/history/route.ts")).toMatch(/request\.url/);
    for (const path of handlers) expect(fromStatic, path).not.toContain(path);
  });

  it("the proxy: session refresh and no-store for server-rendered private pages", () => {
    // The static pages hold no private data and the browser client refreshes
    // its own session, so the static build has nothing for it to do.
    expect(list((path) => path === "proxy.ts" || path === "middleware.ts")).toEqual(["proxy.ts"]);
    expect(fromStatic).not.toContain("proxy.ts");
    expect(fromStatic).not.toContain("lib/supabase/proxy.ts");
  });

  it("server actions: the server store's writes, each with a browser-store equivalent", () => {
    const actions = list((_path, source) => isServerModule(source));
    expect(actions).toEqual([
      "app/garden/actions.ts",
      "app/garden/import/actions.ts",
      "app/garden/returns-lookup.ts",
      "lib/garden/store/server-loader.ts",
    ]);
    for (const path of actions) expect(fromStatic, path).not.toContain(path);
  });

  it("server pages: forced dynamic, cookie session (D-029), server search parameters, redirects", () => {
    const pages = app.map(rel).filter((path) => /(^|\/)page\.tsx$/.test(path)).sort();
    expect(pages.map((path) => [path, serverFacts(sources.get(path)!)])).toEqual([
      // Exported as it is, through page.static.tsx.
      ["app/account/deleted/page.tsx", ""],
      // Not exported: needs a request (the fixture state is a server search parameter).
      ["app/dev/axe-fixtures/page.tsx", "force-dynamic, searchParams"],
      // Static equivalents: garden/import/page.static.tsx, garden/page.static.tsx.
      ["app/garden/import/page.tsx", "force-dynamic, cookies, searchParams, redirect"],
      // Not exported: development only (not-found in production).
      ["app/garden/meadow-preview/page.tsx", ""],
      ["app/garden/page.tsx", "force-dynamic, cookies, searchParams, redirect"],
      // Not exported: development only (not-found in production).
      ["app/garden/returns-preview/page.tsx", ""],
      // Static equivalents: login/page.static.tsx, page.static.tsx.
      ["app/login/page.tsx", "force-dynamic, cookies, redirect"],
      ["app/page.tsx", "force-dynamic, cookies, redirect"],
    ]);
    // Every page a person uses has a static equivalent beside it.
    for (const path of ["app/account/deleted", "app/garden/import", "app/garden", "app/login", "app"])
      expect(STATIC_ROUTES).toContain(`${path}/page.static.tsx`);
    // The server pages themselves are in no static graph, except the one that is exported as it is.
    for (const path of pages.filter((p) => p !== "app/account/deleted/page.tsx"))
      expect(fromStatic, path).not.toContain(path);
  });

  it("cookies() and headers(): one caller, the server Supabase client", () => {
    expect(list((_path, source) => /from "next\/headers"/.test(source))).toEqual(["lib/supabase/server.ts"]);
    expect(fromStatic).not.toContain("lib/supabase/server.ts");
    expect(fromStatic).not.toContain("lib/supabase/session.ts");
  });

  it("dynamic route segments: none", () => {
    const segments = app.map(rel).filter((path) => /\[[^/]+\]/.test(path));
    expect(segments).toEqual([]);
  });

  it("the store selection module still names the server wiring, and no static route imports it", () => {
    // select.ts loads `server-default` behind a build-time constant. The
    // static routes do not import select.ts at all, so the export does not
    // depend on the bundler discarding that branch.
    expect(imports(read("lib/garden/store/select.ts"))).toContain("./server-default");
    for (const path of ["lib/garden/store/select.ts", "lib/garden/store/provider.tsx", "app/garden/store-boundary.tsx"])
      expect(fromStatic, path).not.toContain(path);
  });
});
