/**
 * A recording stand-in for the Supabase client, for the store test suites.
 * It keeps a small in-memory set of tables, answers the query shapes the app
 * uses, and logs every call so two implementations can be compared call for
 * call. It checks nothing a real database checks (no RLS, constraints or
 * triggers): it proves what the code asks for, not what Postgres would allow.
 */
import type { Db } from "../queries";

type Row = Record<string, unknown>;
export type FakeError = { code: string; message?: string };
export type FakeResult = { data: unknown; error: FakeError | null };
export type Step = [method: string, ...args: unknown[]];
export type Call = { target: string; steps: Step[] };

export type World = {
  /** `null` is a signed-out visitor. */
  claims: { sub: string; email?: string } | null;
  tables: Record<string, Row[]>;
  /** RPC handlers by name. A missing handler answers like a missing function. */
  rpc: Record<string, (args: Row, world: World) => FakeResult>;
  /** Forced failures, keyed `table.verb` (verb: select, insert, update) or `auth.method`. */
  fail: Record<string, FakeError>;
  /** Column defaults applied to inserted rows, by table (what the schema would fill in). */
  defaults?: Record<string, Row>;
  /** Called after an insert or update, so a test can keep a stand-in view in step. */
  onWrite?: (table: string, world: World) => void;
};

export function createWorld(partial: Partial<World> = {}): World {
  return {
    claims: { sub: "tenant-1", email: "ada@example.test" },
    tables: {},
    rpc: {},
    fail: {},
    ...partial,
  };
}

function run(world: World, table: string, steps: Step[]): FakeResult {
  const verb = (steps.find(([m]) => m === "insert" || m === "update")?.[0] ?? "select") as string;
  const failure = world.fail[`${table}.${verb}`];
  if (failure) return { data: null, error: failure };
  if (!(table in world.tables))
    return { data: null, error: { code: "PGRST205", message: "relation not found" } };
  const rows = world.tables[table];

  if (verb === "insert") {
    const row = steps.find(([m]) => m === "insert")![1] as Row;
    if (row.id !== undefined && rows.some((r) => r.id === row.id))
      return { data: null, error: { code: "23505", message: "duplicate key" } };
    rows.push({ ...world.defaults?.[table], ...row });
    world.onWrite?.(table, world);
    return { data: null, error: null };
  }

  let matched = rows;
  for (const [method, column, value] of steps) {
    // Filters on an embedded relation ("blooms.garden_id") are not modelled.
    if (typeof column === "string" && column.includes(".")) continue;
    if (method === "eq") matched = matched.filter((r) => r[column as string] === value);
    if (method === "in")
      matched = matched.filter((r) => (value as unknown[]).includes(r[column as string]));
  }

  if (verb === "update") {
    const patch = steps.find(([m]) => m === "update")![1] as Row;
    for (const row of matched) Object.assign(row, patch);
    world.onWrite?.(table, world);
    if (!steps.some(([m]) => m === "select")) return { data: null, error: null };
  }

  let result = matched.map((r) => ({ ...r }));
  const range = steps.find(([m]) => m === "range");
  if (range) result = result.slice(range[1] as number, (range[2] as number) + 1);
  const limit = steps.find(([m]) => m === "limit");
  if (limit) result = result.slice(0, limit[1] as number);
  if (steps.some(([m]) => m === "single"))
    return result.length === 1
      ? { data: result[0], error: null }
      : { data: null, error: { code: "PGRST116", message: "not exactly one row" } };
  if (steps.some(([m]) => m === "maybeSingle")) return { data: result[0] ?? null, error: null };
  return { data: result, error: null };
}

const CHAIN = [
  "select",
  "insert",
  "update",
  "eq",
  "in",
  "order",
  "range",
  "limit",
  "single",
  "maybeSingle",
] as const;

export function createFakeDb(world: World): { db: Db; calls: Call[] } {
  const calls: Call[] = [];
  const record = (target: string, steps: Step[]) =>
    calls.push({ target, steps: JSON.parse(JSON.stringify(steps)) as Step[] });

  function builder(table: string) {
    const steps: Step[] = [];
    const query: Record<string, unknown> = {
      then(resolve: (value: FakeResult) => unknown, reject?: (reason: unknown) => unknown) {
        record(`from:${table}`, steps);
        return Promise.resolve(run(world, table, steps)).then(resolve, reject);
      },
    };
    for (const method of CHAIN)
      query[method] = (...args: unknown[]) => {
        steps.push([method, ...args]);
        return query;
      };
    return query;
  }

  function auth(method: string, args: unknown[], ok: () => FakeResult): Promise<FakeResult> {
    record(`auth:${method}`, [[method, ...args]]);
    const failure = world.fail[`auth.${method}`];
    return Promise.resolve(failure ? { data: null, error: failure } : ok());
  }

  const db = {
    from: (table: string) => builder(table),
    rpc(name: string, args: Row = {}) {
      record(`rpc:${name}`, [["rpc", args]]);
      const failure = world.fail[`rpc.${name}`];
      if (failure) return Promise.resolve({ data: null, error: failure });
      const handler = world.rpc[name];
      return Promise.resolve(
        handler
          ? handler(args, world)
          : { data: null, error: { code: "PGRST202", message: "function not found" } },
      );
    },
    auth: {
      getClaims: () =>
        auth("getClaims", [], () => ({
          data: world.claims ? { claims: world.claims } : null,
          error: null,
        })),
      // What the auth server says: the server path asks it on every request.
      getUser: () =>
        auth("getUser", [], () => ({
          data: {
            user: world.claims ? { id: world.claims.sub, email: world.claims.email } : null,
          },
          error: null,
        })),
      signOut: (options: unknown) =>
        auth("signOut", [options], () => {
          world.claims = null;
          return { data: null, error: null };
        }),
      signInWithOtp: (credentials: unknown) =>
        auth("signInWithOtp", [credentials], () => ({ data: {}, error: null })),
      verifyOtp: (params: unknown) =>
        auth("verifyOtp", [params], () => ({ data: {}, error: null })),
    },
  };
  return { db: db as unknown as Db, calls };
}
