/**
 * Parity: the same scenarios run against the `server` store (the real server
 * actions, loader and route handlers) and the `browser` store, each over its
 * own copy of the same recording fake database. Results must be identical and
 * so must every database and auth call, in order.
 *
 * One difference is deliberate and is normalised below: to learn who is signed
 * in, the server asks the auth server (`getUser`), so a session ended on
 * another device is refused on its next request, while the browser can only
 * verify its own token (`getClaims`). See src/lib/supabase/session.ts.
 *
 * The fake checks nothing a real database checks. This proves the two paths
 * ask for the same things; it does not prove RLS or any RPC. The rules these
 * scenarios stand in for (blank text, archived topics, the deletion switch,
 * import limits, capabilities) are exercised for real only by the pgTAP suite
 * in supabase/tests/browser_path_rules.sql.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, createWorld, type Call, type World } from "./testing/fake-supabase";
import type { Db } from "./queries";
import { STORE_OPERATIONS, type GardenStore } from "./types";

const current = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => current.db,
  isSupabaseConfigured: () => true,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => current.db,
  isSupabaseConfigured: () => true,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET as exportRoute } from "@/app/garden/export/route";
import { GET as historyRoute } from "@/app/garden/history/route";
import { createDefaultServerStore } from "./server-default";
import { createDefaultBrowserStore } from "./browser-default";

const T = "tenant-1";
const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333331";
const P2 = "33333333-3333-4333-8333-333333333332";
const S1 = "44444444-4444-4444-8444-444444444441";
const E1 = "55555555-5555-4555-8555-555555555551";
const R0 = "66666666-6666-4666-8666-666666666660";
const R1 = "66666666-6666-4666-8666-666666666661";
const PASS = "77777777-7777-4777-8777-777777777771";
const B1 = "88888888-8888-4888-8888-888888888881";
const M1 = "99999999-9999-4999-8999-999999999991";
const NEW = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

type Flags = { ai: boolean; deletion: boolean };

function seededWorld(): World {
  const day = "2026-11-01T09:00:00.000Z";
  const world = createWorld({
    tables: {
      accounts: [{ id: T, tend_overnight: false, timezone: "UTC" }],
      gardens: [
        { id: G1, tenant_id: T, name: "Home Garden", status: "active", archived_at: null },
        { id: G2, tenant_id: T, name: "Old", status: "archived", archived_at: day },
      ],
      plots: [
        { id: P1, tenant_id: T, garden_id: G1, name: "Work", ai_enabled: true, cross_pollinate: false, archived_at: null, permission_version: 1 },
        { id: P2, tenant_id: T, garden_id: G1, name: "Shelved", ai_enabled: false, cross_pollinate: false, archived_at: day, permission_version: 1 },
      ],
      seeds: [
        { id: S1, tenant_id: T, garden_id: G1, plot_id: P1, title: "First thought", status: "active", archived_at: null, created_at: day },
      ],
      entries: [{ id: E1, tenant_id: T, garden_id: G1, seed_id: S1, archived_at: null, created_at: day }],
      current_entries: [
        { entry_id: E1, revision_id: R1, seed_id: S1, garden_id: G1, tenant_id: T, body: "synthetic second draft", revision_number: 2, created_at: day, revised_at: "2026-11-02T09:00:00.000Z", archived_at: null },
      ],
      seed_revisions: [
        { id: R0, tenant_id: T, garden_id: G1, seed_id: S1, entry_id: E1, revision_number: 1, body: "synthetic first draft", created_at: day },
        { id: R1, tenant_id: T, garden_id: G1, seed_id: S1, entry_id: E1, revision_number: 2, body: "synthetic second draft", created_at: "2026-11-02T09:00:00.000Z" },
      ],
      garden_passes: [
        { id: PASS, tenant_id: T, garden_id: G1, plot_ids: [P1], status: "complete", created_at: "2026-11-03T02:00:00.000Z", finished_at: "2026-11-03T02:05:00.000Z" },
      ],
      blooms: [
        { id: B1, pass_id: PASS, tenant_id: T, garden_id: G1, ordinal: 0, kind: "change", interpretation: "synthetic interpretation", evidence: [{ revision_id: R0, excerpt: "first draft" }], created_at: "2026-11-03T02:05:00.000Z" },
      ],
      bloom_responses: [],
      tending_marks: [
        { id: M1, pass_id: PASS, tenant_id: T, garden_id: G1, seed_id: S1, kind: "theme", label: "drafts", evidence: [{ revision_id: R1, excerpt: "second draft" }], created_at: "2026-11-03T02:05:00.000Z" },
      ],
      tending_mark_responses: [],
      garden_themes: [],
    },
  });
  world.rpc = {
    save_entry(args, w) {
      if (args.p_body === "stale") return { data: null, error: { code: "40001" } };
      if (args.p_body === "refused") return { data: null, error: { code: "42501" } };
      w.tables.seed_revisions.push({ id: args.p_revision_id, entry_id: args.p_entry_id, seed_id: args.p_seed_id, body: args.p_body });
      return { data: args.p_revision_id, error: null };
    },
    export_garden_sources: (_args, w) => ({
      data: {
        schema: "slow-garden-source-v2",
        exported_at: "2026-11-16T00:00:00.000Z",
        gardens: w.tables.gardens,
        plots: w.tables.plots,
        seeds: w.tables.seeds,
        entries: w.tables.entries,
        revisions: w.tables.seed_revisions,
      },
      error: null,
    }),
    deletion_preview: (args) =>
      args.p_id === NEW(404)
        ? { data: null, error: null }
        : { data: { kind: args.p_kind, entries: 1, versions: 2, returns: 1 }, error: null },
    delete_entry: () => ({ data: { deleted: true }, error: null }),
    delete_seed: () => ({ data: { deleted: true }, error: null }),
    delete_plot: (args) =>
      args.p_confirm_name === "Work"
        ? { data: { deleted: true }, error: null }
        : { data: null, error: { code: "22023" } },
    delete_garden: () => ({ data: null, error: { code: "40P01" } }),
    delete_account: (args) =>
      args.p_confirm === "ada@example.test"
        ? { data: { deleted: true }, error: null }
        : args.p_confirm === "stale session"
          ? { data: null, error: { code: "SGA01" } }
          : { data: null, error: { code: "22023" } },
  };
  return world;
}

async function routeFetch(input: string): Promise<Response> {
  const url = new URL(input, "http://localhost");
  const request = new Request(url);
  if (url.pathname === "/garden/export") return exportRoute(request);
  if (url.pathname === "/garden/history") return historyRoute(request);
  return new Response("Not found", { status: 404 });
}

type Outcome = { value: unknown } | { rejected: string };
type Steps = (store: GardenStore) => Array<() => Promise<unknown>>;
type Run = { outcomes: Outcome[]; calls: Call[]; world: World };

async function runOn(
  kind: "server" | "browser",
  flags: Flags,
  arrange: (world: World) => void,
  steps: Steps,
): Promise<Run> {
  const world = seededWorld();
  arrange(world);
  const { db, calls } = createFakeDb(world);
  current.db = db;
  vi.stubEnv("GARDEN_AI_ENABLED", flags.ai ? "true" : "false");
  vi.stubEnv("GARDEN_DELETION_ENABLED", flags.deletion ? "true" : "false");
  const store =
    kind === "server"
      ? createDefaultServerStore()
      : createDefaultBrowserStore(() => ({
          aiAvailable: flags.ai,
          deletionAvailable: flags.deletion,
        }));
  expect(store.kind).toBe(kind);
  const outcomes: Outcome[] = [];
  for (const step of steps(store)) {
    try {
      outcomes.push({ value: await step() });
    } catch (error) {
      outcomes.push({ rejected: error instanceof Error ? error.message : String(error) });
    }
  }
  return { outcomes, calls, world };
}

/** The two ways of asking who is signed in, made comparable. */
const sessionChecksAlike = (calls: Call[]): Call[] =>
  calls.map((call) =>
    call.target === "auth:getUser" || call.target === "auth:getClaims"
      ? { target: "auth:session-check", steps: [] }
      : call,
  );

/** Run on both stores, require identical outcomes, calls and final tables. */
async function both(
  steps: Steps,
  options: { flags?: Partial<Flags>; arrange?: (world: World) => void } = {},
): Promise<Run> {
  const flags = { ai: false, deletion: false, ...options.flags };
  const arrange = options.arrange ?? (() => {});
  const server = await runOn("server", flags, arrange, steps);
  const browser = await runOn("browser", flags, arrange, steps);
  expect(browser.outcomes).toEqual(server.outcomes);
  expect(sessionChecksAlike(browser.calls)).toEqual(sessionChecksAlike(server.calls));
  // The server never trusts the token alone, and the browser never needs the server's check.
  expect(server.calls.map((c) => c.target)).not.toContain("auth:getClaims");
  expect(browser.calls.map((c) => c.target)).not.toContain("auth:getUser");
  expect(browser.world.tables).toEqual(server.world.tables);
  return browser;
}

const values = (run: Run) =>
  run.outcomes.map((o) => ("value" in o ? o.value : { rejected: o.rejected }));
const targets = (run: Run) => run.calls.map((c) => c.target);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
  vi.stubGlobal("fetch", routeFetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("session", () => {
  it("the server confirms the session with the auth server before every read and write", async () => {
    const world = seededWorld();
    const { db, calls } = createFakeDb(world);
    current.db = db;
    const store = createDefaultServerStore();
    await store.getSession();
    await store.loadGarden();
    await store.saveEntry({ seedId: S1, entryId: E1, revisionId: NEW(1), body: "synthetic", expectedRevisionId: R1 });
    await routeFetch("/garden/export");
    await routeFetch(`/garden/history?entry=${E1}`);
    const auth = calls.map((c) => c.target).filter((t) => t.startsWith("auth:"));
    expect(auth).toEqual(Array(5).fill("auth:getUser"));
  });

  it("a session the auth server no longer knows is signed out on the server, whatever the token says", async () => {
    const world = seededWorld();
    // The token would still verify; the auth server answers that the session is gone.
    world.fail["auth.getUser"] = { code: "session_not_found" };
    const { db, calls } = createFakeDb(world);
    current.db = db;
    const store = createDefaultServerStore();
    expect(await store.getSession()).toEqual({ signedIn: false });
    expect(await store.loadGarden()).toEqual({ signedIn: false });
    expect((await routeFetch("/garden/export")).status).toBe(401);
    expect((await routeFetch(`/garden/history?entry=${E1}`)).status).toBe(401);
    expect(calls.every((c) => c.target === "auth:getUser")).toBe(true);
  });

  it("reports the signed-in person and requests and verifies an email code", async () => {
    const run = await both((s) => [
      () => s.getSession(),
      () => s.requestEmailCode("ada@example.test"),
      () => s.requestEmailCode("ada@example.test", { createAccount: false }),
      () => s.verifyEmailCode("ada@example.test", " 123456 "),
    ]);
    expect(values(run)).toEqual([
      { signedIn: true, tenantId: T, email: "ada@example.test" },
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
    expect(run.calls[1].steps).toEqual([
      ["signInWithOtp", { email: "ada@example.test", options: { shouldCreateUser: true } }],
    ]);
    expect(run.calls[2].steps[0][1]).toMatchObject({ options: { shouldCreateUser: false } });
    expect(run.calls[3].steps).toEqual([
      ["verifyOtp", { email: "ada@example.test", token: "123456", type: "email" }],
    ]);
  });

  it("passes the auth service's own message through on failure", async () => {
    const run = await both(
      (s) => [() => s.requestEmailCode("ada@example.test"), () => s.verifyEmailCode("ada@example.test", "000000")],
      {
        arrange: (w) => {
          w.fail["auth.signInWithOtp"] = { code: "over_email_send_rate_limit", message: "Wait a minute." };
          w.fail["auth.verifyOtp"] = { code: "otp_expired", message: "Token has expired or is invalid" };
        },
      },
    );
    expect(values(run)).toEqual([
      { ok: false, message: "Wait a minute." },
      { ok: false, message: "Token has expired or is invalid" },
    ]);
  });

  it("signs out, rejects when sign-out fails, and refuses an unknown scope", async () => {
    const ok = await both((s) => [() => s.signOut(), () => s.getSession(), () => s.signOut("global")]);
    expect(values(ok)).toEqual([{ ok: true }, { signedIn: false }, { ok: true }]);
    expect(ok.calls[0].steps).toEqual([["signOut", { scope: "local" }]]);
    const failed = await both(
      (s) => [() => s.signOut(), () => s.signOut("everywhere" as never)],
      { arrange: (w) => (w.fail["auth.signOut"] = { code: "500" }) },
    );
    expect(values(failed)).toEqual([
      { rejected: "Sign-out failed. Please retry." },
      { rejected: "Invalid sign-out scope" },
    ]);
  });
});

describe("signed out", () => {
  it("every operation refuses the same way and touches no table or RPC", async () => {
    const run = await both(
      (s) => [
        () => s.getSession(),
        () => s.loadGarden(),
        () => s.loadReturns(G1),
        () => s.locateRevisions([R0]),
        () => s.loadEntryHistory(E1),
        () => s.createArea("garden", "New", "", NEW(1)),
        () => s.saveEntry({ seedId: S1, entryId: NEW(2), revisionId: NEW(3), body: "words", expectedRevisionId: null }),
        () => s.setArchived("seed", S1, true),
        () => s.setTopicTending(P1, true, true),
        () => s.setTendingPreferences(true, "Europe/London"),
        () => s.requestPass(G1, [P1], NEW(4)),
        () => s.cancelPass(PASS),
        () => s.respondToBloom(NEW(5), B1, "keep", ""),
        () => s.respondToMark(NEW(6), M1, "keep"),
        () => s.importThought({ plotId: P1, title: "Imported", entries: [{ body: "one", date: null }] }),
        () => s.exportGarden({ format: "json" }),
        () => s.previewDeletion("entry", E1),
        () => s.deleteItem("entry", E1),
        () => s.deleteAccount("ada@example.test"),
      ],
      { flags: { ai: true, deletion: true }, arrange: (w) => (w.claims = null) },
    );
    expect(values(run)).toEqual([
      { signedIn: false },
      { signedIn: false },
      { rejected: "Please sign in again. Your draft is still here." },
      {},
      { ok: false, reason: "signed-out" },
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
      { ok: false, message: "Could not save that preference. Please retry." },
      { ok: false, message: "Could not invite a reflection. Please retry." },
      { ok: false, message: "Could not cancel. Refresh to see its current state." },
      { ok: false, message: "Could not save your response. Please retry." },
      { ok: false, message: "Could not save your response. Please retry." },
      { ok: false, message: "Could not import. Your files are unchanged; please retry." },
      { ok: false, reason: "signed-out", message: "Unauthorized" },
      { ok: false, message: "Please sign in again. Nothing was erased." },
      { ok: false, message: "Could not delete. Nothing was erased; please retry." },
      { ok: false, message: "Could not delete the account. Nothing was erased; please retry." },
    ]);
    expect(new Set(targets(run))).toEqual(new Set(["auth:getClaims"]));
  });
});

describe("loading", () => {
  it("loads the default garden with tending, history and account", async () => {
    const run = await both((s) => [() => s.loadGarden()], { flags: { ai: true } });
    const load = values(run)[0] as { signedIn: true; data: Record<string, unknown> };
    expect(load.signedIn).toBe(true);
    expect(load.data).toMatchObject({
      tenantId: T,
      gardenId: G1,
      aiAvailable: true,
      deletionAvailable: false,
      account: { tendOvernight: false, timezone: "UTC" },
      tendingHistory: { available: true },
    });
    expect((load.data.plots as unknown[]).length).toBe(2);
    expect((load.data.tending as { blooms: unknown[] }).blooms).toHaveLength(1);
    expect(targets(run)).toContain("from:current_entries");
  });

  it("honours a requested garden and ignores an unknown one", async () => {
    const run = await both((s) => [() => s.loadGarden(G2), () => s.loadGarden("not-a-garden")]);
    const [archived, fallback] = values(run) as { data: { gardenId: string; plots: unknown[] } }[];
    expect(archived.data.gardenId).toBe(G2);
    expect(archived.data.plots).toEqual([]);
    expect(fallback.data.gardenId).toBe(G1);
  });

  it("loads an account with no garden yet", async () => {
    const run = await both((s) => [() => s.loadGarden()], {
      arrange: (w) => {
        w.tables.gardens = [];
      },
    });
    expect(values(run)[0]).toMatchObject({ signedIn: true, data: { gardenId: "", plots: [], entries: [] } });
  });

  it("still loads the garden before the tending migration exists", async () => {
    const run = await both((s) => [() => s.loadGarden()], {
      arrange: (w) => {
        delete w.tables.tending_marks;
        delete w.tables.tending_mark_responses;
        delete w.tables.garden_themes;
      },
    });
    expect(values(run)[0]).toMatchObject({ data: { gardenId: G1, tending: { marks: [], blooms: [] } } });
  });

  it("rejects when the garden itself cannot be read", async () => {
    const run = await both((s) => [() => s.loadGarden()], {
      arrange: (w) => (w.fail["gardens.select"] = { code: "57014" }),
    });
    expect(run.outcomes[0]).toHaveProperty("rejected");
  });

  it("reads returns, locates superseded revisions and reads entry history", async () => {
    const run = await both((s) => [
      () => s.loadReturns(G1),
      () => s.locateRevisions([R0, R0, "junk", "'; drop table seeds; --"]),
      () => s.locateRevisions(["junk"]),
      () => s.loadEntryHistory(E1),
      () => s.loadEntryHistory("not-an-entry"),
    ]);
    const [returns, located, none, history, invalid] = values(run) as [
      { passes: unknown[]; blooms: unknown[]; responses: unknown[] },
      Record<string, unknown>,
      unknown,
      { ok: true; revisions: { id: string }[] },
      unknown,
    ];
    expect(returns.passes).toHaveLength(1);
    expect(returns.blooms).toHaveLength(1);
    expect(located).toEqual({
      [R0]: { entry_id: E1, seed_id: S1, revision_number: 1, created_at: "2026-11-01T09:00:00.000Z" },
    });
    expect(none).toEqual({});
    expect(history.revisions.map((r) => r.id)).toEqual([R0, R1]);
    const read = run.calls.find((c) => c.steps.some(([m, column]) => m === "eq" && column === "entry_id"))!;
    expect(read.steps[0]).toEqual(["select", "id,body,created_at,revision_number"]);
    expect(invalid).toEqual({ ok: false, reason: "invalid-entry" });
    const lookup = run.calls.find((c) => c.steps.some(([m]) => m === "in"))!;
    expect(lookup.steps.find(([m]) => m === "in")).toEqual(["in", "id", [R0]]);
  });

  it("reports unavailable returns and history without partial data", async () => {
    const run = await both((s) => [() => s.loadReturns(G1), () => s.loadEntryHistory(E1)], {
      arrange: (w) => {
        w.fail["blooms.select"] = { code: "57014" };
        w.fail["seed_revisions.select"] = { code: "57014" };
      },
    });
    expect(values(run)).toEqual([{ rejected: "Returns unavailable" }, { ok: false, reason: "unavailable" }]);
  });
});

describe("gardens, topics, thoughts and entries", () => {
  it("creates each kind once, trims the name, and treats a replay as done", async () => {
    const run = await both((s) => [
      () => s.createArea("garden", "  Allotment  ", "", NEW(1)),
      () => s.createArea("plot", "Reading", G1, NEW(2)),
      () => s.createArea("seed", "A new thought", P1, NEW(3)),
      () => s.createArea("seed", "A different title", P1, NEW(3)),
    ]);
    expect(values(run)).toEqual([
      { ok: true, id: NEW(1) },
      { ok: true, id: NEW(2) },
      { ok: true, id: NEW(3) },
      { ok: true, id: NEW(3) },
    ]);
    expect(run.world.tables.gardens.at(-1)).toEqual({ id: NEW(1), tenant_id: T, name: "Allotment" });
    expect(run.world.tables.plots.at(-1)).toEqual({ id: NEW(2), tenant_id: T, garden_id: G1, name: "Reading" });
    expect(run.world.tables.seeds.at(-1)).toEqual({ id: NEW(3), tenant_id: T, garden_id: G1, plot_id: P1, title: "A new thought" });
    expect(run.calls.filter((c) => c.steps.some(([m]) => m === "insert"))).toHaveLength(3);
  });

  it("refuses bad names before any call, and a thought in an archived or missing topic", async () => {
    const run = await both((s) => [
      () => s.createArea("garden", "   ", "", NEW(1)),
      () => s.createArea("plot", "x".repeat(121), G1, NEW(2)),
      () => s.createArea("seed", "x".repeat(161), P1, NEW(3)),
      () => s.createArea("seed", "Into the shelf", P2, NEW(4)),
      () => s.createArea("seed", "Nowhere", NEW(9), NEW(5)),
    ]);
    expect(values(run)).toEqual([
      { ok: false, message: "Please choose a short name." },
      { ok: false, message: "Please choose a short name." },
      { ok: false, message: "Please choose a short name." },
      { ok: false, message: "This topic is archived. Restore it to keep writing here; your draft is still here." },
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
    ]);
    expect(run.world.tables.seeds).toHaveLength(1);
    expect(run.calls.some((c) => c.steps.some(([m]) => m === "insert"))).toBe(false);
  });

  it("saves and revises an entry through save_entry and reports a stale edit", async () => {
    const run = await both((s) => [
      () => s.saveEntry({ seedId: S1, entryId: NEW(1), revisionId: NEW(2), body: "a new entry", expectedRevisionId: null }),
      () => s.saveEntry({ seedId: S1, entryId: E1, revisionId: NEW(3), body: "third draft", expectedRevisionId: R1 }),
      () => s.saveEntry({ seedId: S1, entryId: E1, revisionId: NEW(4), body: "stale", expectedRevisionId: R0 }),
      () => s.saveEntry({ seedId: S1, entryId: E1, revisionId: NEW(5), body: "refused", expectedRevisionId: R1 }),
      () => s.saveEntry({ seedId: S1, entryId: E1, revisionId: NEW(6), body: " \n ", expectedRevisionId: R1 }),
      () => s.saveEntry({ seedId: S1, entryId: E1, revisionId: NEW(7), body: "x".repeat(20001), expectedRevisionId: R1 }),
    ]);
    expect(values(run)).toEqual([
      { ok: true, id: NEW(2) },
      { ok: true, id: NEW(3) },
      { ok: false, message: "This entry changed elsewhere. Reload to review it; your draft is still here." },
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
      { ok: false, message: "Write between 1 and 20,000 characters." },
      { ok: false, message: "Write between 1 and 20,000 characters." },
    ]);
    const saves = run.calls.filter((c) => c.target === "rpc:save_entry");
    expect(saves).toHaveLength(4);
    expect(saves[0].steps[0][1]).toEqual({ p_seed_id: S1, p_entry_id: NEW(1), p_revision_id: NEW(2), p_body: "a new entry" });
    expect(saves[1].steps[0][1]).toMatchObject({ p_expected_revision_id: R1 });
  });

  it("archives and restores every kind with the right columns", async () => {
    const run = await both((s) => [
      () => s.setArchived("garden", G1, true),
      () => s.setArchived("garden", G2, false),
      () => s.setArchived("plot", P1, true),
      () => s.setArchived("plot", P2, false),
      () => s.setArchived("seed", S1, true),
      () => s.setArchived("seed", S1, false),
      () => s.setArchived("entry", E1, true),
      () => s.setArchived("entry", E1, false),
      () => s.setArchived("seed", NEW(404), true),
    ]);
    expect(values(run)).toEqual([
      ...Array(8).fill({ ok: true }),
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
    ]);
    const updates = run.calls.filter((c) => c.steps[0][0] === "update").map((c) => [c.target, c.steps[0][1]]);
    expect(updates).toEqual([
      ["from:gardens", { status: "archived", archived_at: "2026-11-16T12:00:00.000Z" }],
      ["from:gardens", { status: "active", archived_at: null }],
      ["from:plots", { archived_at: "2026-11-16T12:00:00.000Z" }],
      ["from:plots", { archived_at: null }],
      ["from:seeds", { status: "archived", archived_at: "2026-11-16T12:00:00.000Z" }],
      ["from:seeds", { status: "active", archived_at: null }],
      ["from:entries", { archived_at: "2026-11-16T12:00:00.000Z" }],
      ["from:entries", { archived_at: null }],
      ["from:seeds", { status: "archived", archived_at: "2026-11-16T12:00:00.000Z" }],
    ]);
  });
});

describe("tending settings and account preferences", () => {
  it("changes a topic's tending and the overnight preference", async () => {
    const run = await both((s) => [
      () => s.setTopicTending(P1, false, true),
      () => s.setTopicTending(NEW(404), true, true),
      () => s.setTendingPreferences(true, "Europe/London"),
      () => s.setTendingPreferences(true, "Not a zone!"),
    ]);
    expect(values(run)).toEqual([
      { ok: true },
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
      { ok: true },
      { ok: false, message: "Choose a time zone from the list." },
    ]);
    expect(run.world.tables.plots[0]).toMatchObject({ ai_enabled: false, cross_pollinate: true });
    expect(run.world.tables.accounts[0]).toEqual({ id: T, tend_overnight: true, timezone: "Europe/London" });
    const account = run.calls.find((c) => c.target === "from:accounts")!;
    expect(account.steps).toEqual([
      ["update", { tend_overnight: true, timezone: "Europe/London" }],
      ["eq", "id", T],
    ]);
  });

  it("reports a refused preference (the database validates the zone)", async () => {
    const run = await both((s) => [() => s.setTendingPreferences(false, "Mars/Olympus")], {
      arrange: (w) => (w.fail["accounts.update"] = { code: "22023" }),
    });
    expect(values(run)).toEqual([{ ok: false, message: "Could not save that preference. Please retry." }]);
  });
});

describe("returns", () => {
  it("refuses a pass without any call while AI is switched off", async () => {
    const run = await both((s) => [() => s.requestPass(G1, [P1], NEW(1))]);
    expect(values(run)).toEqual([
      { ok: false, message: "AI reflections are not enabled yet. Your writing remains available." },
    ]);
    expect(run.calls).toEqual([]);
  });

  it("requests a pass with only the four permitted columns, and replays safely", async () => {
    const run = await both(
      (s) => [() => s.requestPass(G1, [P1], NEW(1)), () => s.requestPass(G1, [P1], NEW(1)), () => s.cancelPass(NEW(1))],
      { flags: { ai: true } },
    );
    expect(values(run)).toEqual([{ ok: true, id: NEW(1) }, { ok: true, id: NEW(1) }, { ok: true }]);
    const inserts = run.calls.filter((c) => c.steps[0][0] === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].steps[0][1]).toEqual({ id: NEW(1), tenant_id: T, garden_id: G1, plot_ids: [P1] });
    expect(run.calls.at(-1)!.steps[0]).toEqual(["update", { status: "cancelled" }]);
  });

  it("phrases the database's refusals the same way", async () => {
    const gate = await both((s) => [() => s.requestPass(G1, [P1], NEW(1))], {
      flags: { ai: true },
      arrange: (w) => (w.fail["garden_passes.insert"] = { code: "55000" }),
    });
    expect((values(gate)[0] as { message: string }).message).toMatch(/already pending/);
    const scope = await both((s) => [() => s.requestPass(G1, [P2], NEW(1)), () => s.cancelPass(NEW(404))], {
      flags: { ai: true },
      arrange: (w) => (w.fail["garden_passes.insert"] = { code: "42501" }),
    });
    expect(values(scope)).toEqual([
      { ok: false, message: "Check the selected topics and their tending settings before retrying." },
      { ok: false, message: "Could not cancel. Refresh to see its current state." },
    ]);
    const unreadable = await both((s) => [() => s.requestPass(G1, [P1], NEW(1))], {
      flags: { ai: true },
      arrange: (w) => (w.fail["garden_passes.select"] = { code: "57014" }),
    });
    expect(values(unreadable)).toEqual([{ ok: false, message: "Could not invite a reflection. Please retry." }]);
  });

  it("records bloom responses append-only and stores a correction only with `correct`", async () => {
    const run = await both((s) => [
      () => s.respondToBloom(NEW(1), B1, "keep", "ignored text"),
      () => s.respondToBloom(NEW(2), B1, "correct", "In my own words."),
      () => s.respondToBloom(NEW(2), B1, "prune", ""),
      () => s.respondToBloom(NEW(3), B1, "correct", "   "),
    ]);
    expect(values(run)).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
      { ok: false, message: "Add your correction in your own words." },
    ]);
    expect(run.world.tables.bloom_responses).toEqual([
      { id: NEW(1), tenant_id: T, bloom_id: B1, response: "keep", correction: null },
      { id: NEW(2), tenant_id: T, bloom_id: B1, response: "correct", correction: "In my own words." },
    ]);
  });

  it("records mark responses and refuses anything but keep or prune", async () => {
    const run = await both((s) => [
      () => s.respondToMark(NEW(1), M1, "prune"),
      () => s.respondToMark(NEW(1), M1, "keep"),
      () => s.respondToMark(NEW(2), M1, "correct" as never),
    ]);
    expect(values(run)).toEqual([{ ok: true }, { ok: true }, { ok: false, message: "Choose keep or prune." }]);
    expect(run.world.tables.tending_mark_responses).toEqual([
      { id: NEW(1), tenant_id: T, mark_id: M1, response: "prune" },
    ]);
  });

  it("reports a response the database refuses", async () => {
    const run = await both((s) => [() => s.respondToBloom(NEW(1), B1, "keep", ""), () => s.respondToMark(NEW(2), M1, "keep")], {
      arrange: (w) => {
        w.fail["bloom_responses.insert"] = { code: "42501" };
        w.fail["tending_mark_responses.insert"] = { code: "42501" };
      },
    });
    expect(values(run)).toEqual(Array(2).fill({ ok: false, message: "Could not save your response. Please retry." }));
  });
});

describe("import", () => {
  const input = {
    plotId: P1,
    title: "Imported notes",
    entries: [
      { body: "first imported entry", date: "2026-01-05" },
      { body: "second imported entry", date: null },
    ],
  };

  it("imports once and skips the same notes on a second run", async () => {
    const run = await both((s) => [() => s.importThought(input), () => s.importThought(input)]);
    const [first, second] = values(run) as { ok: true; id: string; created: number; skipped: number }[];
    expect(first).toMatchObject({ ok: true, created: 2, skipped: 0 });
    expect(second).toMatchObject({ ok: true, id: first.id, created: 0, skipped: 2 });
    expect(run.world.tables.seeds.at(-1)).toEqual({ id: first.id, tenant_id: T, garden_id: G1, plot_id: P1, title: "Imported notes" });
    const dated = run.calls.filter((c) => c.target === "from:entries");
    // First the probe that matches no row (may this owner still write entry dates?), then the real date.
    expect(dated[0].steps).toEqual([["update", { created_at: "1970-01-01T00:00:00.000Z" }], ["eq", "id", "00000000-0000-0000-0000-000000000000"]]);
    expect(dated[1].steps[0]).toEqual(["update", { created_at: "2026-01-05T12:00:00.000Z" }]);
    expect(run.calls.filter((c) => c.target === "rpc:save_entry")[0].steps[0][1]).not.toHaveProperty("p_expected_revision_id");
  });

  it("refuses invalid input and archived topics, and reports a database failure", async () => {
    const run = await both((s) => [
      () => s.importThought({ ...input, title: "  " }),
      () => s.importThought({ ...input, entries: [] }),
      () => s.importThought({ ...input, entries: [{ body: "x".repeat(20001), date: null }] }),
      () => s.importThought({ ...input, entries: [{ body: "dated", date: "2026-02-30" }] }),
      () => s.importThought({ ...input, plotId: "not-a-topic" }),
      () => s.importThought({ ...input, plotId: P2 }),
    ]);
    expect(values(run)).toEqual([
      ...Array(5).fill({ ok: false, message: "Check the topic and entries, then retry." }),
      { ok: false, message: "Choose an active topic." },
    ]);
    // Only the archived topic gets as far as the database: import_thought is
    // asked first and, absent in this world, the call-by-call path reads the topic.
    expect(run.calls.filter((c) => c.target.startsWith("rpc:")).map((c) => c.target)).toEqual(["rpc:import_thought"]);
    const failed = await both((s) => [() => s.importThought(input)], {
      arrange: (w) => (w.fail["rpc.save_entry"] = { code: "57014" }),
    });
    // The call-by-call import is not one transaction: say that something may have been saved.
    expect(values(failed)).toEqual([
      { ok: false, message: "The import stopped partway. Some entries may have been saved; run the same import again to finish. Nothing will be saved twice." },
    ]);
    expect(failed.world.tables.seeds).toHaveLength(2);
  });

  it("does not use the call-by-call import when a missing function is only a stale schema cache", async () => {
    // import_thought answers "not found" (PGRST202) but the owner can no longer write entry dates:
    // this is the migrated database behind a stale API cache, where the old path would save
    // entries and then be refused their dates.
    const run = await both((s) => [() => s.importThought(input)], {
      arrange: (w) => (w.fail["entries.update"] = { code: "42501" }),
    });
    expect(values(run)).toEqual([
      { ok: false, message: "Import is not available right now. Nothing was imported; please try again in a minute." },
    ]);
    expect(targets(run)).toEqual(["auth:getClaims", "rpc:import_thought", "from:entries"]);
    expect(run.world.tables.seeds).toHaveLength(1);
    expect(run.world.tables.seed_revisions).toHaveLength(2);
  });
});

describe("import through import_thought (migration 20261116041903)", () => {
  const input = {
    plotId: P1,
    title: "  Imported notes ",
    entries: [
      { body: "first imported entry", date: "2026-01-05" },
      { body: "second imported entry", date: null },
      { body: "first imported entry", date: "2026-01-05" },
    ],
  };
  type Plan = { p_plot_id: string; p_seed_id: string; p_title: string; p_entries: { entry_id: string; revision_id: string; body: string; date: string | null }[] };
  const installed = (w: World) => {
    w.rpc.import_thought = (args) => ({
      data: { id: args.p_seed_id, created: (args.p_entries as unknown[]).length, skipped: 0 },
      error: null,
    });
  };

  it("sends one call with the whole batch and no separate date update", async () => {
    const run = await both((s) => [() => s.importThought(input)], { arrange: installed });
    const plan = run.calls.find((c) => c.target === "rpc:import_thought")!.steps[0][1] as Plan;
    expect(values(run)).toEqual([{ ok: true, id: plan.p_seed_id, created: 3, skipped: 0 }]);
    expect(targets(run)).toEqual(["auth:getClaims", "rpc:import_thought"]);
    expect(plan.p_plot_id).toBe(P1);
    expect(plan.p_title).toBe("Imported notes");
    expect(plan.p_entries.map((e) => [e.body, e.date])).toEqual(input.entries.map((e) => [e.body, e.date]));
    expect(new Set(plan.p_entries.map((e) => e.entry_id)).size).toBe(3);
  });

  it("derives the same identifiers as the call-by-call import, so a replay across the migration is skipped", async () => {
    const legacy = await both((s) => [() => s.importThought(input)]);
    const rpc = await both((s) => [() => s.importThought(input)], { arrange: installed });
    const plan = rpc.calls.find((c) => c.target === "rpc:import_thought")!.steps[0][1] as Plan;
    const saves = legacy.calls.filter((c) => c.target === "rpc:save_entry").map((c) => c.steps[0][1] as Record<string, string>);
    expect((values(legacy)[0] as { id: string }).id).toBe(plan.p_seed_id);
    expect(plan.p_entries.map((e) => [e.entry_id, e.revision_id, e.body])).toEqual(
      saves.map((s) => [s.p_entry_id, s.p_revision_id, s.p_body]),
    );
    expect(saves.every((s) => s.p_seed_id === plan.p_seed_id)).toBe(true);
  });

  it("phrases the database's refusals: topic, anything else, and an unreadable receipt", async () => {
    const topic = await both((s) => [() => s.importThought(input)], {
      arrange: (w) => (w.fail["rpc.import_thought"] = { code: "SGA02" }),
    });
    expect(values(topic)).toEqual([{ ok: false, message: "Choose an active topic." }]);
    const thought = await both((s) => [() => s.importThought(input)], {
      arrange: (w) => (w.fail["rpc.import_thought"] = { code: "SGA02", message: "this thought is archived; restore it to write here" }),
    });
    expect(values(thought)).toEqual([
      { ok: false, message: "This thought is archived. Restore it to keep writing here; your draft is still here." },
    ]);
    const input22023 = await both((s) => [() => s.importThought(input)], {
      arrange: (w) => (w.fail["rpc.import_thought"] = { code: "22023" }),
    });
    expect(values(input22023)).toEqual([{ ok: false, message: "Check the topic and entries, then retry." }]);
    // One transaction: a refusal from the database saved nothing, and says so.
    for (const code of ["40001", "42501", "23514", "40P01"]) {
      const refused = await both((s) => [() => s.importThought(input)], {
        arrange: (w) => (w.fail["rpc.import_thought"] = { code }),
      });
      expect(values(refused), code).toEqual([{ ok: false, message: "Could not import. Nothing was saved; please retry." }]);
      expect(targets(refused), code).toEqual(["auth:getClaims", "rpc:import_thought"]);
    }
    // No readable answer: do not claim either way.
    const uncertain = {
      ok: false,
      message: "Could not confirm the import. It may have been saved; run the same import again to check. Nothing will be saved twice.",
    };
    const odd = await both((s) => [() => s.importThought(input)], {
      arrange: (w) => (w.rpc.import_thought = () => ({ data: { id: 7 }, error: null })),
    });
    expect(values(odd)).toEqual([uncertain]);
    const dropped = await both((s) => [() => s.importThought(input)], {
      arrange: (w) =>
        (w.rpc.import_thought = () => {
          throw new Error("network");
        }),
    });
    expect(values(dropped)).toEqual([uncertain]);
  });

  it("refuses more than 1,048,576 bytes of text before any import call", async () => {
    const big = { ...input, entries: Array.from({ length: 60 }, (_, i) => ({ body: `${i} ` + "x".repeat(18000), date: null })) };
    const run = await both((s) => [() => s.importThought(big)], { arrange: installed });
    expect(values(run)).toEqual([{ ok: false, message: "Check the topic and entries, then retry." }]);
    expect(targets(run)).toEqual(["auth:getClaims"]);
  });
});

describe("database switches and refusals (migration 20261116041903)", () => {
  const caps = (tending: boolean, deletion: boolean) => (w: World) => {
    w.rpc.garden_capabilities = () => ({ data: { tending, deletion }, error: null });
  };
  const availabilityOf = (run: Run) => {
    const load = values(run)[0] as { data: { aiAvailable: boolean; deletionAvailable: boolean } };
    return [load.data.aiAvailable, load.data.deletionAvailable];
  };

  it("needs both the deployment flag and the database to allow", async () => {
    const on = { ai: true, deletion: true };
    expect(availabilityOf(await both((s) => [() => s.loadGarden()], { flags: on, arrange: caps(true, true) }))).toEqual([true, true]);
    expect(availabilityOf(await both((s) => [() => s.loadGarden()], { flags: on, arrange: caps(true, false) }))).toEqual([true, false]);
    expect(availabilityOf(await both((s) => [() => s.loadGarden()], { flags: on, arrange: caps(false, true) }))).toEqual([false, true]);
    expect(availabilityOf(await both((s) => [() => s.loadGarden()], { flags: { ai: false, deletion: false }, arrange: caps(true, true) }))).toEqual([false, false]);
    expect(availabilityOf(await both((s) => [() => s.loadGarden()], { flags: { ai: true, deletion: false }, arrange: caps(true, true) }))).toEqual([true, false]);
  });

  it("asks the database once per load, and reads a failed or malformed answer as nothing available", async () => {
    const on = { ai: true, deletion: true };
    const asked = await both((s) => [() => s.loadGarden()], { flags: on, arrange: caps(true, true) });
    expect(targets(asked).filter((t) => t === "rpc:garden_capabilities")).toHaveLength(1);
    const failed = await both((s) => [() => s.loadGarden()], {
      flags: on,
      arrange: (w) => (w.fail["rpc.garden_capabilities"] = { code: "42501" }),
    });
    expect(availabilityOf(failed)).toEqual([false, false]);
    const odd = await both((s) => [() => s.loadGarden()], {
      flags: on,
      arrange: (w) => (w.rpc.garden_capabilities = () => ({ data: { tending: "yes", deletion: 1 }, error: null })),
    });
    expect(availabilityOf(odd)).toEqual([false, false]);
  });

  it("keeps today's behaviour against a database that predates the capabilities RPC", async () => {
    const run = await both((s) => [() => s.loadGarden()], { flags: { ai: true, deletion: true } });
    expect(availabilityOf(run)).toEqual([true, true]);
    expect(targets(run)).toContain("rpc:garden_capabilities");
  });

  it("says deletion is unavailable when the database's switch is off, whatever the flag says", async () => {
    const run = await both(
      (s) => [
        () => s.previewDeletion("entry", E1),
        () => s.deleteItem("entry", E1),
        () => s.deleteItem("plot", P1, "Work"),
        () => s.deleteAccount("ada@example.test"),
      ],
      {
        flags: { deletion: true },
        arrange: (w) => {
          for (const name of ["deletion_preview", "delete_entry", "delete_plot", "delete_account"])
            w.fail[`rpc.${name}`] = { code: "SGA03" };
        },
      },
    );
    expect(values(run)).toEqual(Array(4).fill({ ok: false, message: "Deletion is not available yet. Nothing was erased." }));
    expect(run.world.claims).not.toBeNull();
  });

  it("says what is archived when the database refuses a thought or a save for that reason", async () => {
    const run = await both(
      (s) => [
        () => s.createArea("seed", "Late thought", P1, NEW(31)),
        () => s.saveEntry({ seedId: S1, entryId: NEW(36), revisionId: NEW(37), body: "written in another tab", expectedRevisionId: null }),
      ],
      {
        arrange: (w) => {
          w.fail["seeds.insert"] = { code: "SGA02", message: "this garden is archived; restore it to write here" };
          w.fail["rpc.save_entry"] = { code: "SGA02", message: "this thought is archived; restore it to write here" };
        },
      },
    );
    expect(values(run)).toEqual([
      { ok: false, message: "This garden is archived. Restore it to keep writing here; your draft is still here." },
      { ok: false, message: "This thought is archived. Restore it to keep writing here; your draft is still here." },
    ]);
  });

  it("reports a blank name, a blank body or a correction the database refuses like any failed save", async () => {
    const run = await both(
      (s) => [
        () => s.createArea("garden", "Refused by constraint", "", NEW(32)),
        () => s.saveEntry({ seedId: S1, entryId: NEW(33), revisionId: NEW(34), body: "refused by constraint", expectedRevisionId: null }),
        () => s.respondToBloom(NEW(35), B1, "correct", "refused by constraint"),
      ],
      {
        arrange: (w) => {
          w.fail["gardens.insert"] = { code: "23514" };
          w.fail["rpc.save_entry"] = { code: "23514" };
          w.fail["bloom_responses.insert"] = { code: "23514" };
        },
      },
    );
    expect(values(run)).toEqual([
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
      { ok: false, message: "Could not save. Your writing is still here; please retry." },
      { ok: false, message: "Could not save your response. Please retry." },
    ]);
  });
});

describe("export", () => {
  it("exports everything as JSON and Markdown, and one garden by id", async () => {
    const run = await both((s) => [
      () => s.exportGarden({ format: "json" }),
      () => s.exportGarden({ format: "md" }),
      () => s.exportGarden({ format: "json", gardenId: G1 }),
      () => s.exportGarden({ format: "md", gardenId: G2 }),
    ]);
    const [json, md, one, old] = values(run) as { ok: true; filename: string; mimeType: string; text: string }[];
    expect(json).toMatchObject({ ok: true, filename: "slow-garden-export.json", mimeType: "application/json" });
    const document = JSON.parse(json.text);
    expect(document.schema).toBe("slow-garden-export-v2");
    expect(document.source.gardens).toHaveLength(2);
    expect(document.derived.blooms.rows).toHaveLength(1);
    expect(md).toMatchObject({ filename: "slow-garden-export.md", mimeType: "text/markdown; charset=utf-8" });
    expect(md.text).toContain("synthetic second draft");
    expect(one.filename).toBe("slow-garden-export-home-garden.json");
    expect(JSON.parse(one.text).source.gardens).toHaveLength(1);
    expect(old.filename).toBe("slow-garden-export-old.md");
    expect(targets(run).filter((t) => t === "rpc:export_garden_sources")).toHaveLength(4);
  });

  it("refuses a malformed or unknown garden", async () => {
    const run = await both((s) => [
      () => s.exportGarden({ format: "json", gardenId: "not-a-garden" }),
      () => s.exportGarden({ format: "json", gardenId: NEW(404) }),
    ]);
    expect(values(run)).toEqual([
      { ok: false, reason: "invalid-garden", message: "Invalid garden id" },
      { ok: false, reason: "garden-not-found", message: "Garden not found" },
    ]);
  });

  it("tolerates absent tending tables but never returns a partial export", async () => {
    const early = await both((s) => [() => s.exportGarden({ format: "json" })], {
      arrange: (w) => {
        delete w.tables.tending_marks;
        delete w.tables.tending_mark_responses;
      },
    });
    expect(JSON.parse((values(early)[0] as { text: string }).text).derived.marks.rows).toEqual([]);
    for (const key of ["blooms.select", "tending_marks.select", "rpc.export_garden_sources"]) {
      const failed = await both((s) => [() => s.exportGarden({ format: "md" })], {
        arrange: (w) => (w.fail[key] = { code: "57014" }),
      });
      expect(values(failed)).toEqual([
        { ok: false, reason: "unavailable", message: "Export failed; no partial export was produced." },
      ]);
    }
  });
});

describe("permanent deletion", () => {
  it("refuses everything without any call while deletion is switched off", async () => {
    const run = await both((s) => [
      () => s.previewDeletion("entry", E1),
      () => s.deleteItem("seed", S1),
      () => s.deleteAccount("ada@example.test"),
    ]);
    expect(values(run)).toEqual(Array(3).fill({ ok: false, message: "Deletion is not available yet. Nothing was erased." }));
    expect(run.calls).toEqual([]);
  });

  it("refuses malformed targets before reaching the database", async () => {
    const run = await both(
      (s) => [
        () => s.previewDeletion("entry", "not-an-id"),
        () => s.previewDeletion("everything" as never, E1),
        () => s.deleteItem("entry", "1 or 1=1"),
        () => s.deleteItem("account" as never, E1),
      ],
      { flags: { deletion: true } },
    );
    expect(values(run)).toEqual(Array(4).fill({ ok: false, message: "That item cannot be deleted from here." }));
    expect(run.calls).toEqual([]);
  });

  it("previews with the database's counts and the phrase to type for an account", async () => {
    const run = await both(
      (s) => [
        () => s.previewDeletion("entry", E1),
        () => s.previewDeletion("account", ""),
        () => s.previewDeletion("seed", NEW(404)),
      ],
      { flags: { deletion: true } },
    );
    expect(values(run)).toEqual([
      { ok: true, counts: { gardens: 0, topics: 0, thoughts: 0, entries: 1, versions: 2, returns: 1, responses: 0, marks: 0 }, confirmPhrase: null },
      { ok: true, counts: expect.any(Object), confirmPhrase: "ada@example.test" },
      { ok: false, message: "This is no longer here. It may already have been deleted." },
    ]);
    const previews = run.calls.filter((c) => c.target === "rpc:deletion_preview").map((c) => c.steps[0][1]);
    expect(previews).toEqual([{ p_kind: "entry", p_id: E1 }, { p_kind: "account" }, { p_kind: "seed", p_id: NEW(404) }]);
  });

  it("falls back to a fixed phrase when the session carries no email", async () => {
    const run = await both((s) => [() => s.previewDeletion("account", "")], {
      flags: { deletion: true },
      arrange: (w) => (w.claims = { sub: T }),
    });
    expect(values(run)[0]).toMatchObject({ confirmPhrase: "delete my account" });
  });

  it("deletes through the RPCs and phrases each refusal", async () => {
    const run = await both(
      (s) => [
        () => s.deleteItem("entry", E1),
        () => s.deleteItem("seed", S1),
        () => s.deleteItem("plot", P1, "Work"),
        () => s.deleteItem("plot", P1, "Wrong"),
        () => s.deleteItem("garden", G1, "Home Garden"),
      ],
      { flags: { deletion: true } },
    );
    expect(values(run)).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
      { ok: false, message: "The name you typed does not match. Nothing was erased." },
      { ok: false, message: "The garden was busy for a moment. Nothing was erased; please try again." },
    ]);
    expect(run.calls.filter((c) => c.target.startsWith("rpc:")).map((c) => [c.target, c.steps[0][1]])).toEqual([
      ["rpc:delete_entry", { p_entry_id: E1 }],
      ["rpc:delete_seed", { p_seed_id: S1 }],
      ["rpc:delete_plot", { p_plot_id: P1, p_confirm_name: "Work" }],
      ["rpc:delete_plot", { p_plot_id: P1, p_confirm_name: "Wrong" }],
      ["rpc:delete_garden", { p_garden_id: G1, p_confirm_name: "Home Garden" }],
    ]);
  });

  it("says deletion is unavailable when the RPCs are not installed", async () => {
    const run = await both((s) => [() => s.previewDeletion("entry", E1), () => s.deleteItem("entry", E1), () => s.deleteAccount("x")], {
      flags: { deletion: true },
      arrange: (w) => (w.rpc = {}),
    });
    expect(values(run)).toEqual(Array(3).fill({ ok: false, message: "Deletion is not available yet. Nothing was erased." }));
  });

  it("deletes the account, then ends the local session; refusals erase nothing", async () => {
    const refused = await both(
      (s) => [() => s.deleteAccount("stale session"), () => s.deleteAccount("someone@else.test"), () => s.getSession()],
      { flags: { deletion: true } },
    );
    expect(values(refused)).toEqual([
      { ok: false, reauth: true, message: "For your safety, deleting an account needs a sign-in from the last ten minutes. Nothing was erased." },
      { ok: false, message: "What you typed does not match. Nothing was erased." },
      { signedIn: true, tenantId: T, email: "ada@example.test" },
    ]);
    expect(targets(refused)).not.toContain("auth:signOut");
    const done = await both((s) => [() => s.deleteAccount("ada@example.test"), () => s.getSession()], {
      flags: { deletion: true },
    });
    expect(values(done)).toEqual([{ ok: true }, { signedIn: false }]);
    expect(targets(done).slice(0, 3)).toEqual(["auth:getClaims", "rpc:delete_account", "auth:signOut"]);
    expect(done.calls[2].steps).toEqual([["signOut", { scope: "local" }]]);
  });
});

describe("coverage", () => {
  it("both stores implement every operation in the interface", async () => {
    current.db = createFakeDb(createWorld()).db as Db;
    for (const store of [createDefaultServerStore(), createDefaultBrowserStore()])
      for (const name of STORE_OPERATIONS) expect(typeof store[name], `${store.kind}.${name}`).toBe("function");
    expect(STORE_OPERATIONS).toHaveLength(22);
  });
});
