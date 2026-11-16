import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeleteControl, erasedLines } from "./delete-control";
import { DeleteZone } from "./delete-zone";
import { resetDeletionFlagForTests } from "./delete-flag";

const actions = vi.hoisted(() => ({
  deletionEnabled: vi.fn(),
  previewDeletion: vi.fn(),
  deleteItem: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock("./actions", () => actions);
const drafts = vi.hoisted(() => ({ discardDeletedDrafts: vi.fn() }));
vi.mock("./delete-drafts", () => drafts);
const otp = vi.hoisted(() => ({ signInWithOtp: vi.fn(), verifyOtp: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: otp }) }));
beforeEach(() => { resetDeletionFlagForTests(); actions.deletionEnabled.mockResolvedValue(true); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
/** Controls render only once the server has confirmed deletion is switched on. */
const openDialog = async (name: string) => fireEvent.click(await screen.findByRole("button", { name }));

const counts = { gardens: 0, topics: 0, thoughts: 0, entries: 1, versions: 3, returns: 1, responses: 1, marks: 2 };
const preview = (extra = {}, confirmPhrase: string | null = null) =>
  actions.previewDeletion.mockResolvedValue({ ok: true, counts: { ...counts, ...extra }, confirmPhrase });
const confirmButton = (noun: string) => screen.getByRole("button", { name: `Delete ${noun} permanently` });

it("states in plain words exactly what each scope erases", () => {
  expect(erasedLines("entry", counts)).toEqual([
    "This entry, with 3 saved versions",
    "1 bloom from tending that read this writing",
    "1 response you gave to that bloom (kept, corrected or pruned)",
    "2 tending marks from the same tending",
  ]);
  expect(erasedLines("seed", { ...counts, entries: 4, versions: 4, returns: 0, responses: 0, marks: 0 })).toEqual([
    "This thought and its title",
    "4 entries, with 4 saved versions",
  ]);
  expect(erasedLines("account", { gardens: 2, topics: 3, thoughts: 5, entries: 8, versions: 13, returns: 2, responses: 3, marks: 0 })).toEqual([
    "2 gardens", "3 topics", "5 thoughts", "8 entries, with 13 saved versions",
    "2 blooms from tending that read this writing",
    "3 responses you gave to those blooms (kept, corrected or pruned)",
    "Your account and sign-in, on every device",
  ]);
});

it("deletes an entry after a plain confirm, with counts shown and Cancel focused first", async () => {
  preview();
  actions.deleteItem.mockResolvedValue({ ok: true });
  const onDeleted = vi.fn();
  render(<DeleteControl kind="entry" id="e1" name="this entry" onDeleted={onDeleted} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  await openDialog("Delete entry…");
  const dialog = screen.getByRole("dialog", { name: "Delete this entry permanently?" });
  expect(dialog).toHaveAccessibleDescription("Archive hides. Delete erases, permanently.");
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(confirmButton("entry")).toBeDisabled();
  await screen.findByText("This entry, with 3 saved versions");
  expect(actions.previewDeletion).toHaveBeenCalledWith("entry", "e1");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText(/Export first/)).toBeNull();
  fireEvent.click(confirmButton("entry"));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  expect(actions.deleteItem).toHaveBeenCalledWith("entry", "e1", "");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("cancels without deleting and returns focus to the button that opened it", async () => {
  preview();
  render(<DeleteControl kind="seed" id="s1" name="Leaving room" onDeleted={vi.fn()} />);
  const trigger = await screen.findByRole("button", { name: "Delete thought…" });
  fireEvent.click(trigger);
  await screen.findByText("This thought and its title");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
  expect(actions.deleteItem).not.toHaveBeenCalled();
});

it("renders nothing at all while deletion is switched off", async () => {
  actions.deletionEnabled.mockResolvedValue(false);
  const { container } = render(
    <>
      <DeleteControl kind="entry" id="e1" name="this entry" onDeleted={vi.fn()} />
      <DeleteZone tenantId="t1" garden={{ id: "g1", name: "Home" }} seedIds={[]} go={vi.fn()} />
    </>,
  );
  await waitFor(() => expect(actions.deletionEnabled).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText(/Delete/)).toBeNull();
});

it("renders nothing when the switch cannot be read, and asks only once per page", async () => {
  actions.deletionEnabled.mockRejectedValue(new Error("offline"));
  const { container } = render(
    <>
      <DeleteControl kind="entry" id="e1" name="this entry" onDeleted={vi.fn()} />
      <DeleteControl kind="entry" id="e2" name="this entry" onDeleted={vi.fn()} />
    </>,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(container).toBeEmptyDOMElement();
  expect(actions.deletionEnabled).toHaveBeenCalledOnce();
});

it("account deletion that needs a fresh sign-in offers the email code and returns to the same dialog", async () => {
  preview({ gardens: 1 }, "ada@example.test");
  actions.deleteAccount.mockResolvedValueOnce({ ok: false, reauth: true, message: "ignored" }).mockResolvedValueOnce({ ok: true });
  otp.signInWithOtp.mockResolvedValue({ error: null });
  otp.verifyOtp.mockResolvedValueOnce({ error: new Error("bad") }).mockResolvedValueOnce({ error: null });
  const go = vi.fn();
  render(<DeleteZone tenantId="t1" seedIds={[]} go={go} />);
  await openDialog("Delete account…");
  const field = await screen.findByRole("textbox", { name: "Type ada@example.test to confirm" });
  fireEvent.change(field, { target: { value: "ada@example.test" } });
  fireEvent.click(confirmButton("account"));
  await screen.findByText("Please sign in again first.");
  expect(screen.getByText(/Nothing was\s+erased, and nothing you typed here is lost/)).toBeVisible();
  expect(confirmButton("account")).toBeDisabled();
  expect(go).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  const code = await screen.findByRole("textbox", { name: "Six-digit code sent to ada@example.test" });
  expect(otp.signInWithOtp).toHaveBeenCalledWith({ email: "ada@example.test", options: { shouldCreateUser: false } });
  fireEvent.change(code, { target: { value: "12 34 56" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm code" }));
  await screen.findByText("That code did not work. Check it, or send a new one.");
  fireEvent.keyDown(code, { key: "Enter" });
  await screen.findByText("You are signed in again. You can delete your account now.");
  expect(otp.verifyOtp).toHaveBeenLastCalledWith({ email: "ada@example.test", token: "123456", type: "email" });
  expect(actions.deleteAccount).toHaveBeenCalledOnce();
  expect(screen.queryByText("Please sign in again first.")).toBeNull();
  expect(field).toHaveValue("ada@example.test");
  expect(field).toHaveFocus();
  fireEvent.click(confirmButton("account"));
  await waitFor(() => expect(go).toHaveBeenCalledWith("/account/deleted"));
  expect(actions.deleteAccount).toHaveBeenCalledTimes(2);
});

it("Escape cancels", async () => {
  preview();
  render(<DeleteControl kind="entry" id="e1" name="this entry" onDeleted={vi.fn()} />);
  await openDialog("Delete entry…");
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(actions.deleteItem).not.toHaveBeenCalled();
});

it("a topic needs its exact name typed before the button works", async () => {
  preview({ topics: 1, thoughts: 2, entries: 5, versions: 6 });
  actions.deleteItem.mockResolvedValue({ ok: true });
  const onDeleted = vi.fn();
  render(<DeleteControl kind="plot" id="p1" name="Mornings" onDeleted={onDeleted} />);
  await openDialog("Delete topic…");
  screen.getByRole("dialog", { name: "Delete “Mornings” permanently?" });
  const field = screen.getByRole("textbox", { name: "Type Mornings to confirm" });
  expect(field).toHaveFocus();
  await screen.findByText("2 thoughts");
  fireEvent.change(field, { target: { value: "mornings" } });
  expect(confirmButton("topic")).toBeDisabled();
  fireEvent.submit(field.closest("form")!);
  expect(actions.deleteItem).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: "Mornings" } });
  expect(confirmButton("topic")).toBeEnabled();
  fireEvent.click(confirmButton("topic"));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  expect(actions.deleteItem).toHaveBeenCalledWith("plot", "p1", "Mornings");
});

it("a garden offers export first, for that garden", async () => {
  preview({ gardens: 1, topics: 1, thoughts: 1 });
  render(<DeleteControl kind="garden" id="g1" name="Home" exportGardenId="g1" onDeleted={vi.fn()} />);
  await openDialog("Delete garden…");
  expect(screen.getByRole("link", { name: "Export first · Markdown" })).toHaveAttribute("href", "/garden/export?format=md&garden=g1");
  expect(screen.getByRole("link", { name: "Export first · JSON" })).toHaveAttribute("href", "/garden/export?garden=g1");
  await screen.findByText("1 topic");
});

it("never enables deletion when the counts could not be read", async () => {
  actions.previewDeletion.mockResolvedValue({ ok: false, message: "Deletion is not available yet. Nothing was erased." });
  render(<DeleteControl kind="entry" id="e1" name="this entry" onDeleted={vi.fn()} />);
  await openDialog("Delete entry…");
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Deletion is not available yet. Nothing was erased."));
  expect(confirmButton("entry")).toBeDisabled();
});

it("a refused deletion keeps the dialog open and says nothing was erased", async () => {
  preview();
  actions.deleteItem.mockResolvedValue({ ok: false, message: "Could not delete. Nothing was erased; please retry." });
  const onDeleted = vi.fn();
  render(<DeleteControl kind="entry" id="e1" name="this entry" onDeleted={onDeleted} />);
  await openDialog("Delete entry…");
  await screen.findByText("This entry, with 3 saved versions");
  fireEvent.click(confirmButton("entry"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Nothing was erased"));
  expect(onDeleted).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(confirmButton("entry")).toBeEnabled();
});

it("settings: account deletion types the email, clears every local draft, and leaves for the confirmation page", async () => {
  preview({ gardens: 2, topics: 3, thoughts: 4, entries: 5, versions: 6 }, "ada@example.test");
  actions.deleteAccount.mockResolvedValue({ ok: true });
  const go = vi.fn();
  render(<DeleteZone tenantId="t1" garden={{ id: "g1", name: "Home" }} seedIds={["s1"]} go={go} />);
  expect(await screen.findByText(/Archive hides\. Delete erases, permanently\./)).toBeVisible();
  expect(screen.getByRole("button", { name: "Delete garden…" })).toBeVisible();
  await openDialog("Delete account…");
  const field = await screen.findByRole("textbox", { name: "Type ada@example.test to confirm" });
  expect(screen.getByText("Your account and sign-in, on every device")).toBeVisible();
  expect(screen.getByRole("link", { name: "Export first · JSON" })).toHaveAttribute("href", "/garden/export");
  expect(confirmButton("account")).toBeDisabled();
  fireEvent.change(field, { target: { value: " Ada@Example.test " } });
  fireEvent.click(confirmButton("account"));
  await waitFor(() => expect(go).toHaveBeenCalledWith("/account/deleted"));
  expect(actions.deleteAccount).toHaveBeenCalledWith(" Ada@Example.test ");
  expect(drafts.discardDeletedDrafts).toHaveBeenCalledWith("t1", { everything: true });
});

it("settings: garden deletion discards that garden's drafts and reloads the workspace", async () => {
  preview({ gardens: 1 });
  actions.deleteItem.mockResolvedValue({ ok: true });
  const go = vi.fn();
  render(<DeleteZone tenantId="t1" garden={{ id: "g1", name: "Home" }} seedIds={["s1", "s2"]} go={go} />);
  await openDialog("Delete garden…");
  const field = screen.getByRole("textbox", { name: "Type Home to confirm" });
  await waitFor(() => expect(actions.previewDeletion).toHaveBeenCalledWith("garden", "g1"));
  fireEvent.change(field, { target: { value: "Home" } });
  await waitFor(() => expect(confirmButton("garden")).toBeEnabled());
  fireEvent.click(confirmButton("garden"));
  await waitFor(() => expect(go).toHaveBeenCalledWith("/garden"));
  expect(drafts.discardDeletedDrafts).toHaveBeenCalledWith("t1", { seedIds: ["s1", "s2"] });
});
