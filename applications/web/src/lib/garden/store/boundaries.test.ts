/**
 * Lint-style guard: nothing reachable from a `store/browser*` module may be
 * server-only. A static (Capacitor) build has no server, and a browser bundle
 * must never contain a path to cookies, the cache API or a server action.
 */
// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STORE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(STORE, "../../..");
const FORBIDDEN = ["next/headers", "next/cache", "server-only", "next/server"];
const IMPORT =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  throw new Error(`Cannot resolve ${specifier} from ${relative(SRC, from)}`);
}

export function imports(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
}
function isServerModule(source: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use server["']/.test(source);
}

/** Every violation reachable from `entry`, with the import chain that reaches it. */
function violations(entry: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const here = [...chain, relative(SRC, file)];
    if (isServerModule(source)) found.push(`${here.join(" -> ")} is a "use server" module`);
    for (const specifier of imports(source)) {
      if (FORBIDDEN.includes(specifier)) found.push(`${here.join(" -> ")} imports ${specifier}`);
      if (/(^|\/)supabase\/(server|proxy)$/.test(specifier))
        found.push(`${here.join(" -> ")} imports the server Supabase client`);
      const next = resolveModule(file, specifier);
      if (next) walk(next, here);
    }
  };
  walk(entry, []);
  return found;
}

const browserModules = readdirSync(STORE)
  .filter((name) => /^browser.*\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => join(STORE, name));

describe("browser store boundaries", () => {
  it("finds the browser modules", () => {
    expect(browserModules.map((f) => relative(STORE, f)).sort()).toEqual(["browser-default.ts", "browser-store.ts"]);
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
