/**
 * A static walk of the source import graph, for the boundary and
 * static-readiness checks. It reads files; it builds and runs nothing.
 * Type-only imports count as edges: the check is deliberately stricter than a
 * bundler, so a server module can never be one refactor away from a browser
 * bundle. Tests only.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const FORBIDDEN = ["next/headers", "next/cache", "server-only", "next/server"];
const IMPORT =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export function resolveModule(from: string, specifier: string): string | null {
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
export function isServerModule(source: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use server["']/.test(source);
}
const isCode = (file: string) => /\.[cm]?[jt]sx?$/.test(file);

/** Every source module reachable from `entry` (itself included). */
export function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!isCode(file)) return;
    for (const specifier of imports(readFileSync(file, "utf8"))) {
      const next = resolveModule(file, specifier);
      if (next) walk(next);
    }
  };
  walk(entry);
  return [...seen];
}

/** Every violation reachable from `entry`, with the import chain that reaches it. */
export function violations(entry: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!isCode(file)) return;
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
