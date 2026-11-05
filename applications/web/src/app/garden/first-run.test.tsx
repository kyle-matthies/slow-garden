import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FirstRun } from "./first-run";
import { createArea, saveEntry } from "./actions";
import { broadcastDraftsCleared, createStorageBackend, LIVE_TABS_KEY, markDraftsCleared, resetTabIdentityForTests, TAB_ID_KEY } from "@/lib/garden/drafts";
import { emptyOnboardingDraft, loadOnboardingDraft, onboardingRecord } from "@/lib/garden/onboarding-draft";
import * as drafts from "@/lib/garden/drafts";

vi.mock("./actions", () => ({ createArea: vi.fn(), saveEntry: vi.fn() }));
const garden = "10000000-0000-4000-8000-000000000001";
const topic = "10000000-0000-4000-8000-000000000002";
const thought = "10000000-0000-4000-8000-000000000003";
const entry = "10000000-0000-4000-8000-000000000004";
const revision = "10000000-0000-4000-8000-000000000005";

afterEach(() => {
  cleanup(); resetTabIdentityForTests(); vi.restoreAllMocks(); vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear();
});

it("keeps the request id across a failed garden save and a reload", async () => {
  vi.mocked(createArea).mockRejectedValueOnce(new Error("network"));
  const view = render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  const input = screen.getByLabelText("Name your garden");
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Notebook" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Could not save. Please retry.");
  const request = vi.mocked(createArea).mock.calls[0][3];
  view.unmount();
  vi.mocked(createArea).mockResolvedValueOnce({ ok: true, id: garden });
  render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Name your garden")).toHaveValue("Notebook"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("Name a first topic");
  expect(vi.mocked(createArea).mock.calls[1]).toEqual(["garden", "Notebook", "", request]);
});

it("recovers an unfinished first entry, replays its saved ids, and clears setup after success", async () => {
  const store = createStorageBackend(sessionStorage);
  await store.put(onboardingRecord("alice", "previous-tab", {
    ...emptyOnboardingDraft(), step: 4, gardenId: garden, topicId: topic, thoughtId: thought,
    gardenName: "Notebook", topicName: "Ideas", thoughtTitle: "A question", body: "My unsaved words",
    entryId: entry, revisionId: revision,
  }));
  vi.mocked(saveEntry).mockResolvedValueOnce({ ok: false, message: "Try again" }).mockResolvedValueOnce({ ok: true });
  const done = vi.fn();
  const view = render(<FirstRun tenantId="alice" onDone={done} />);
  await waitFor(() => expect(screen.getByLabelText("Write a first entry")).toHaveValue("My unsaved words"));
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await screen.findByText("Try again");
  view.unmount();
  render(<FirstRun tenantId="alice" onDone={done} />);
  await waitFor(() => expect(screen.getByLabelText("Write a first entry")).toHaveValue("My unsaved words"));
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith({ gardenId: garden, topicId: topic, thoughtId: thought, entryId: entry }));
  expect(vi.mocked(saveEntry).mock.calls[0][0]).toEqual(vi.mocked(saveEntry).mock.calls[1][0]);
  expect(await loadOnboardingDraft("alice", store)).toBeNull();
});

it("invalidates pending browser writes on sign-out", async () => {
  render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  const input = screen.getByLabelText("Name your garden");
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Unfinished" } });
  act(() => { markDraftsCleared(localStorage, "alice"); broadcastDraftsCleared("alice"); });
  await waitFor(() => expect(input).toBeDisabled());
  expect(await loadOnboardingDraft("alice", createStorageBackend(sessionStorage))).toBeNull();
  expect(createArea).not.toHaveBeenCalled();
});

it("removes an in-flight write if sign-out happened while storage was writing", async () => {
  const store = createStorageBackend(sessionStorage);
  const originalPut = store.put.bind(store);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const put = vi.spyOn(store, "put").mockImplementationOnce(async (record) => {
    await blocked;
    await originalPut(record);
  });
  vi.spyOn(drafts, "openDraftStore").mockResolvedValue(store);
  render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  const input = screen.getByLabelText("Name your garden");
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Do not resurrect" } });
  await waitFor(() => expect(put).toHaveBeenCalled());
  act(() => { markDraftsCleared(localStorage, "alice"); broadcastDraftsCleared("alice"); release(); });
  await waitFor(async () => expect(await store.list("alice")).toHaveLength(0));
});

it("does not overwrite an existing checkpoint if recovery storage cannot be read", async () => {
  const store = createStorageBackend(sessionStorage);
  const record = onboardingRecord("alice", "old-tab", { ...emptyOnboardingDraft(), gardenName: "Keep me" });
  await store.put(record);
  vi.spyOn(store, "list").mockRejectedValue(new Error("temporarily unreadable"));
  const put = vi.spyOn(store, "put");
  vi.spyOn(drafts, "openDraftStore").mockResolvedValue(store);
  render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  await screen.findByText("Draft backup could not be opened. Keep this page open until you save your entry.");
  fireEvent.change(screen.getByLabelText("Name your garden"), { target: { value: "New attempt" } });
  await act(async () => { await Promise.resolve(); });
  expect(put).not.toHaveBeenCalled();
  expect((await store.get(record.key))?.body).toBe(record.body);
});

it("does not show one account's recovered writing after the tenant changes", async () => {
  const store = createStorageBackend(sessionStorage);
  await store.put(onboardingRecord("alice", "old-tab", { ...emptyOnboardingDraft(), gardenName: "Alice's private name" }));
  const view = render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Name your garden")).toHaveValue("Alice's private name"));
  view.rerender(<FirstRun tenantId="bob" onDone={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Name your garden")).toBeEnabled());
  expect(screen.getByLabelText("Name your garden")).toHaveValue("");
});

it("leaves A's live draft intact while B starts and completes its own setup", async () => {
  const store = createStorageBackend(sessionStorage);
  const a = onboardingRecord("alice", "tab-a", {
    ...emptyOnboardingDraft(), step: 4, gardenId: garden, topicId: topic,
    thoughtId: thought, body: "A's unchanged original writing",
  });
  await store.put(a);
  localStorage.setItem(LIVE_TABS_KEY, JSON.stringify({ "tab-a": Date.now() }));
  sessionStorage.setItem(TAB_ID_KEY, "tab-b");
  vi.mocked(createArea).mockResolvedValueOnce({ ok: true, id: garden }).mockResolvedValueOnce({ ok: true, id: topic }).mockResolvedValueOnce({ ok: true, id: thought });
  vi.mocked(saveEntry).mockResolvedValueOnce({ ok: true });
  const done = vi.fn();
  const b = render(<FirstRun tenantId="alice" onDone={done} />);
  const input = screen.getByLabelText("Name your garden");
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveValue("");
  fireEvent.change(input, { target: { value: "B garden" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText("Name a first topic"), { target: { value: "B topic" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText("Name a first thought"), { target: { value: "B thought" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText("Write a first entry"), { target: { value: "B's own writing" } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect((await store.get(a.key))?.body).toBe(a.body);
  b.unmount(); resetTabIdentityForTests();
  // A reload releases its prior heartbeat, retaining A's session tab identity.
  localStorage.setItem(LIVE_TABS_KEY, "{}");
  sessionStorage.setItem(TAB_ID_KEY, "tab-a");
  render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Write a first entry")).toHaveValue("A's unchanged original writing"));
});
