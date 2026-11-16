import { afterEach, beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { getClaims: vi.fn(), signOut: vi.fn() },
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { deleteAccount, deleteItem, previewDeletion } from "./actions";

const ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
beforeEach(() => {
  vi.stubEnv("GARDEN_DELETION_ENABLED", "true");
  db.auth.getClaims.mockResolvedValue({ data: { claims: { sub: "t1", email: "ada@example.test" } }, error: null });
  db.auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it("previews with the database's counts and never mutates", async () => {
  db.rpc.mockResolvedValue({ data: { kind: "entry", entries: 1, versions: 2, returns: 1, responses: 2, marks: 0, gardens: 0, topics: 0, thoughts: 0 }, error: null });
  expect(await previewDeletion("entry", ID)).toEqual({
    ok: true,
    counts: { gardens: 0, topics: 0, thoughts: 0, entries: 1, versions: 2, returns: 1, responses: 2, marks: 0 },
    confirmPhrase: null,
  });
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("deletion_preview", { p_kind: "entry", p_id: ID });
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("an account preview returns the email to type, or the fallback phrase", async () => {
  db.rpc.mockResolvedValue({ data: { gardens: 2 }, error: null });
  expect(await previewDeletion("account", "")).toMatchObject({ ok: true, confirmPhrase: "ada@example.test" });
  expect(db.rpc).toHaveBeenCalledWith("deletion_preview", { p_kind: "account" });
  db.auth.getClaims.mockResolvedValue({ data: { claims: { sub: "t1" } }, error: null });
  expect(await previewDeletion("account", "")).toMatchObject({ ok: true, confirmPhrase: "delete my account" });
});

it("a missing or foreign item previews as already gone", async () => {
  db.rpc.mockResolvedValue({ data: null, error: null });
  expect(await previewDeletion("seed", ID)).toEqual({ ok: false, message: "This is no longer here. It may already have been deleted." });
});

it("rejects malformed ids and unknown scopes before reaching the database", async () => {
  expect((await previewDeletion("entry", "not-an-id")).ok).toBe(false);
  expect((await deleteItem("entry", "1 or 1=1")).ok).toBe(false);
  expect((await deleteItem("account" as never, ID)).ok).toBe(false);
  expect((await previewDeletion("everything" as never, ID)).ok).toBe(false);
  expect(db.rpc).not.toHaveBeenCalled();
});

it("says so plainly when the deletion migration has not been applied", async () => {
  db.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  expect(await previewDeletion("entry", ID)).toEqual({ ok: false, message: "Deletion is not available yet. Nothing was erased." });
  expect(await deleteItem("entry", ID)).toEqual({ ok: false, message: "Deletion is not available yet. Nothing was erased." });
});

it.each([
  ["entry", "delete_entry", { p_entry_id: ID }],
  ["seed", "delete_seed", { p_seed_id: ID }],
  ["plot", "delete_plot", { p_plot_id: ID, p_confirm_name: "Name" }],
  ["garden", "delete_garden", { p_garden_id: ID, p_confirm_name: "Name" }],
] as const)("deletes a %s through its own RPC", async (kind, rpc, args) => {
  db.rpc.mockResolvedValue({ data: { deleted: true }, error: null });
  expect(await deleteItem(kind, ID, "Name")).toEqual({ ok: true });
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith(rpc, args);
  expect(revalidatePath).toHaveBeenCalledWith("/garden");
});

it("a replayed deletion of something already gone still succeeds", async () => {
  db.rpc.mockResolvedValue({ data: { deleted: false }, error: null });
  expect(await deleteItem("entry", ID)).toEqual({ ok: true });
});

it("a name mismatch refused by the database erases nothing and says so", async () => {
  db.rpc.mockResolvedValue({ data: null, error: { code: "22023" } });
  expect(await deleteItem("garden", ID, "Wrong")).toEqual({ ok: false, message: "The name you typed does not match. Nothing was erased." });
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("a signed-out caller deletes nothing", async () => {
  db.auth.getClaims.mockResolvedValue({ data: null, error: new Error("no session") });
  expect((await deleteItem("entry", ID)).ok).toBe(false);
  expect((await deleteAccount("ada@example.test")).ok).toBe(false);
  expect((await previewDeletion("entry", ID)).ok).toBe(false);
  expect(db.rpc).not.toHaveBeenCalled();
});

it("account deletion erases, then clears this browser's session even if the server refuses the sign-out", async () => {
  db.rpc.mockResolvedValue({ data: { deleted: true }, error: null });
  db.auth.signOut.mockRejectedValue(new Error("user not found"));
  expect(await deleteAccount("ada@example.test")).toEqual({ ok: true });
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("delete_account", { p_confirm: "ada@example.test" });
  expect(db.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
});

it("a refused account deletion keeps the session and erases nothing", async () => {
  db.rpc.mockResolvedValue({ data: null, error: { code: "22023" } });
  expect(await deleteAccount("wrong")).toEqual({ ok: false, message: "What you typed does not match. Nothing was erased." });
  db.rpc.mockResolvedValue({ data: null, error: { code: "55000" } });
  expect(await deleteAccount("ada@example.test")).toEqual({ ok: false, message: "Could not delete. Nothing was erased; please retry." });
  expect(db.auth.signOut).not.toHaveBeenCalled();
});

it.each([undefined, "false", "TRUE", "1"])("is off unless GARDEN_DELETION_ENABLED is exactly true (%s)", async (value) => {
  vi.unstubAllEnvs();
  if (value !== undefined) vi.stubEnv("GARDEN_DELETION_ENABLED", value);
  else vi.stubEnv("GARDEN_DELETION_ENABLED", "");
  const off = { ok: false, message: "Deletion is not available yet. Nothing was erased." };
  expect(await previewDeletion("entry", ID)).toEqual(off);
  expect(await deleteItem("garden", ID, "Name")).toEqual(off);
  expect(await deleteAccount("ada@example.test")).toEqual(off);
  expect(db.rpc).not.toHaveBeenCalled();
  expect(db.auth.signOut).not.toHaveBeenCalled();
});

it("a stale or revoked session is asked to sign in again, and stays signed in", async () => {
  db.rpc.mockResolvedValue({ data: null, error: { code: "SGA01" } });
  expect(await deleteAccount("ada@example.test")).toEqual({
    ok: false,
    reauth: true,
    message: "For your safety, deleting an account needs a sign-in from the last ten minutes. Nothing was erased.",
  });
  expect(db.auth.signOut).not.toHaveBeenCalled();
});

it("a deadlock or lock timeout asks for a retry and says nothing was erased", async () => {
  db.rpc.mockResolvedValue({ data: null, error: { code: "40P01" } });
  expect(await deleteItem("garden", ID, "Name")).toEqual({ ok: false, message: "The garden was busy for a moment. Nothing was erased; please try again." });
});
