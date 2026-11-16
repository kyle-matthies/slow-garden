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
  expect(input).toHaveValue("My garden");
  fireEvent.change(input, { target: { value: "Notebook" } });
  fireEvent.change(screen.getByLabelText("Write a first entry"), { target: { value: "Words I typed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await screen.findByText("Could not save. Please retry.");
  const request = vi.mocked(createArea).mock.calls[0][3];
  view.unmount();
  vi.mocked(createArea).mockResolvedValueOnce({ ok: true, id: garden }).mockResolvedValueOnce({ ok: true, id: topic }).mockResolvedValueOnce({ ok: true, id: thought });
  vi.mocked(saveEntry).mockResolvedValueOnce({ ok: true });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  await waitFor(() => expect(screen.getByLabelText("Name your garden")).toHaveValue("Notebook"));
  expect(screen.getByLabelText("Write a first entry")).toHaveValue("Words I typed");
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(vi.mocked(createArea).mock.calls[1]).toEqual(["garden", "Notebook", "", request]);
});

it("reaches the first saved entry from one screen, defaulting the topic and titling the thought from the first line", async () => {
  vi.mocked(createArea).mockResolvedValueOnce({ ok: true, id: garden }).mockResolvedValueOnce({ ok: true, id: topic }).mockResolvedValueOnce({ ok: true, id: thought });
  vi.mocked(saveEntry).mockResolvedValueOnce({ ok: true });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  const writing = screen.getByLabelText("Write a first entry");
  await waitFor(() => expect(writing).toBeEnabled());
  fireEvent.change(writing, { target: { value: "Why do I keep circling this?\nMore below." } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  const calls = vi.mocked(createArea).mock.calls;
  expect(calls.map((c) => c.slice(0, 3))).toEqual([
    ["garden", "My garden", ""],
    ["plot", "Notes", garden],
    ["seed", "Why do I keep circling this?", topic],
  ]);
  const saved = vi.mocked(saveEntry).mock.calls[0][0];
  expect(saved).toMatchObject({ seedId: thought, body: "Why do I keep circling this?\nMore below.", expectedRevisionId: null });
  expect(done).toHaveBeenCalledWith({ gardenId: garden, topicId: topic, thoughtId: thought, entryId: saved.entryId });
});

it("resumes after a partial save without repeating what was already saved", async () => {
  vi.mocked(createArea).mockResolvedValueOnce({ ok: true, id: garden }).mockResolvedValueOnce({ ok: false, message: "Topic failed" });
  const view = render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  const writing = screen.getByLabelText("Write a first entry");
  await waitFor(() => expect(writing).toBeEnabled());
  fireEvent.change(writing, { target: { value: "Kept words" } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await screen.findByText("Topic failed");
  const topicRequest = vi.mocked(createArea).mock.calls[1][3];
  view.unmount();
  vi.mocked(createArea).mockResolvedValueOnce({ ok: true, id: topic }).mockResolvedValueOnce({ ok: true, id: thought });
  vi.mocked(saveEntry).mockResolvedValueOnce({ ok: true });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  await waitFor(() => expect(screen.getByLabelText("Write a first entry")).toHaveValue("Kept words"));
  expect(screen.getByLabelText("Name your garden")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(vi.mocked(createArea).mock.calls.map((c) => c[0])).toEqual(["garden", "plot", "plot", "seed"]);
  expect(vi.mocked(createArea).mock.calls[2]).toEqual(["plot", "Notes", garden, topicRequest]);
});

it("sets up only the garden and topic when the person chooses to write later", async () => {
  vi.mocked(createArea).mockResolvedValueOnce({ ok: true, id: garden }).mockResolvedValueOnce({ ok: true, id: topic });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  const later = screen.getByRole("button", { name: "Write later" });
  await waitFor(() => expect(later).toBeEnabled());
  fireEvent.click(later);
  await waitFor(() => expect(done).toHaveBeenCalledWith({ gardenId: garden, topicId: topic, thoughtId: "" }));
  expect(saveEntry).not.toHaveBeenCalled();
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
  expect(screen.getByLabelText("Name your garden")).toHaveValue("My garden");
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
  expect(input).toHaveValue("My garden");
  expect(screen.getByLabelText("Write a first entry")).toHaveValue("");
  fireEvent.change(input, { target: { value: "B garden" } });
  fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "B topic" } });
  fireEvent.change(screen.getByLabelText("Thought title"), { target: { value: "B thought" } });
  fireEvent.change(screen.getByLabelText("Write a first entry"), { target: { value: "B's own writing" } });
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

// Seed packs, plant your own, and the optional background (D-024).
const echo = () => vi.mocked(createArea).mockImplementation(async (_kind, _name, _parent, id) => ({ ok: true, id }));
const areas = () => vi.mocked(createArea).mock.calls.map((c) => [c[0], c[1]]);
const idOf = (name: string) => vi.mocked(createArea).mock.calls.find((c) => c[1] === name)![3];
async function ready() {
  const writing = screen.getByLabelText("Write a first entry");
  await waitFor(() => expect(writing).toBeEnabled());
  return writing;
}

it("keeps planting your own to a prefilled name, one page and one button, with nothing else asked", async () => {
  echo(); vi.mocked(saveEntry).mockResolvedValue({ ok: true });
  const done = vi.fn();
  const { container } = render(<FirstRun tenantId="alice" onDone={done} />);
  const writing = await ready();
  expect(screen.getByLabelText("Name your garden")).toHaveValue("My garden");
  // Nothing is opened, ticked or expanded until the person chooses to.
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(container.querySelectorAll("details[open]")).toHaveLength(0);
  expect(container.querySelectorAll("form :required")).toHaveLength(2);
  expect(container.querySelectorAll("form button[type=submit], form button:not([type])")).toHaveLength(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.change(writing, { target: { value: "Only my words" } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(areas()).toEqual([["garden", "My garden"], ["plot", "Notes"], ["seed", "Only my words"]]);
  expect(saveEntry).toHaveBeenCalledTimes(1);
});

it("explains the method in three lines and the four levels, without a tour", async () => {
  render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  await ready();
  const method = screen.getByRole("list", { name: "How Slow Garden works" });
  expect(Array.from(method.querySelectorAll("strong")).map((n) => n.textContent)).toEqual(["Write", "Leave it overnight", "Wake to a bloom"]);
  expect(screen.getByText("Where your words will live")).toBeInTheDocument();
});

it("plants the kept topics of an opened pack and leaves out the unticked one", async () => {
  echo(); vi.mocked(saveEntry).mockResolvedValue({ ok: true });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  const writing = await ready();
  fireEvent.click(screen.getByRole("button", { name: /A decision I’m circling/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "What I’m afraid of" }));
  fireEvent.change(writing, { target: { value: "Stay or go" } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(areas()).toEqual([
    ["garden", "My garden"], ["plot", "Notes"],
    ["plot", "The question itself"], ["plot", "What I’d tell a friend"],
    ["seed", "Stay or go"],
  ]);
  // Planting your own alongside a pack still writes in Notes.
  expect(vi.mocked(createArea).mock.calls[4][2]).toBe(idOf("Notes"));
  expect(done).toHaveBeenCalledWith(expect.objectContaining({ topicId: idOf("Notes") }));
});

it("combines packs, and closing a packet puts its topics back", async () => {
  echo();
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: /^Mornings/ }));
  fireEvent.click(screen.getByRole("button", { name: /^People/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Places/ }));
  expect(screen.getAllByRole("checkbox")).toHaveLength(9);
  fireEvent.click(screen.getByRole("button", { name: /^Places/ }));
  expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "Start my garden" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(areas()).toEqual([
    ["garden", "My garden"],
    ["plot", "Before the day starts"], ["plot", "Still here from yesterday"], ["plot", "Today’s one thing"],
    ["plot", "Conversations"], ["plot", "Things I meant to say"], ["plot", "People I’m learning from"],
  ]);
  expect(saveEntry).not.toHaveBeenCalled();
});

it("uses a chosen opening question as the thought's title and never as writing", async () => {
  echo(); vi.mocked(saveEntry).mockResolvedValue({ ok: true });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  const writing = await ready();
  fireEvent.click(screen.getByRole("button", { name: /A decision I’m circling/ }));
  const question = "If a friend brought you this, what would you say?";
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${question.replace("?", "\\?")}`) }));
  // The page is still empty: the question is a title above it.
  expect(writing).toHaveValue("");
  expect(screen.getByLabelText("Thought title")).toHaveValue(question);
  expect(screen.getByText("In What I’d tell a friend")).toBeInTheDocument();
  fireEvent.change(writing, { target: { value: "I would tell her to wait a week." } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  const bed = idOf("What I’d tell a friend");
  expect(areas()).toEqual([
    ["garden", "My garden"],
    ["plot", "The question itself"], ["plot", "What I’m afraid of"], ["plot", "What I’d tell a friend"],
    ["seed", question],
  ]);
  expect(vi.mocked(createArea).mock.calls[4][2]).toBe(bed);
  const saved = vi.mocked(saveEntry).mock.calls[0][0];
  expect(saved.body).toBe("I would tell her to wait a week.");
  expect(saved.body).not.toContain(question);
  expect(done).toHaveBeenCalledWith({ gardenId: idOf("My garden"), topicId: bed, thoughtId: idOf(question), entryId: saved.entryId });
});

it("takes the question off the page when it is removed or its topic is unticked", async () => {
  // Never finished, so it uses its own account: the checkpoint must not reach other tests.
  render(<FirstRun tenantId="carol" onDone={vi.fn()} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: /^Mornings/ }));
  fireEvent.click(screen.getByRole("button", { name: /^What from yesterday is still with you\?/ }));
  expect(screen.getByLabelText("Thought title")).toHaveValue("What from yesterday is still with you?");
  fireEvent.click(screen.getByRole("button", { name: "Remove this question and write in a blank page" }));
  expect(screen.getByLabelText("Thought title")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: /^What from yesterday is still with you\?/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Still here from yesterday" }));
  expect(screen.getByLabelText("Thought title")).toHaveValue("");
  expect(screen.getByLabelText("Topic")).toHaveValue("Notes");
});

it("saves the optional background as the person's own thought in Notes and calls nothing else", async () => {
  echo(); vi.mocked(saveEntry).mockResolvedValue({ ok: true });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  const writing = await ready();
  fireEvent.change(writing, { target: { value: "First page" } });
  fireEvent.change(screen.getByLabelText("What you’re tending lately"), { target: { value: "A move, a new job, my father." } });
  expect(screen.getByText(/This is your own writing/)).toHaveTextContent("Nothing is generated from it today.");
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(areas()).toEqual([["garden", "My garden"], ["plot", "Notes"], ["seed", "First page"], ["seed", "What I’m tending"]]);
  expect(vi.mocked(createArea).mock.calls[3][2]).toBe(idOf("Notes"));
  const pages = vi.mocked(saveEntry).mock.calls.map((c) => c[0]);
  expect(pages.map((p) => p.body)).toEqual(["First page", "A move, a new job, my father."]);
  expect(pages[1].seedId).toBe(idOf("What I’m tending"));
  expect(done).toHaveBeenCalledWith(expect.objectContaining({ thoughtId: idOf("First page") }));
});

it("adds a Notes topic for the background when only pack topics were chosen", async () => {
  echo(); vi.mocked(saveEntry).mockResolvedValue({ ok: true });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: /^Places/ }));
  fireEvent.change(screen.getByLabelText("What you’re tending lately"), { target: { value: "The allotment." } });
  fireEvent.click(screen.getByRole("button", { name: "Write later" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(areas()).toEqual([
    ["garden", "My garden"], ["plot", "Notes"],
    ["plot", "Close to home"], ["plot", "Walks"], ["plot", "Places I go back to"],
    ["seed", "What I’m tending"],
  ]);
  expect(saveEntry).toHaveBeenCalledTimes(1);
  expect(vi.mocked(saveEntry).mock.calls[0][0].body).toBe("The allotment.");
});

it("lets write later plant the chosen topics without a page", async () => {
  echo();
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: /What I’m reading/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "To read next" }));
  fireEvent.click(screen.getByRole("button", { name: "Write later" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(areas()).toEqual([
    ["garden", "My garden"],
    ["plot", "On the nightstand"], ["plot", "Lines worth keeping"], ["plot", "Arguments with the author"],
  ]);
  expect(saveEntry).not.toHaveBeenCalled();
  expect(done).toHaveBeenCalledWith({ gardenId: idOf("My garden"), topicId: idOf("On the nightstand"), thoughtId: "" });
});

it("recovers a draft saved before seed packs existed", async () => {
  const store = createStorageBackend(sessionStorage);
  const old = {
    version: 1, completed: false, step: 2, gardenId: garden, topicId: "", thoughtId: "",
    gardenName: "Old notebook", topicName: "Ideas", thoughtTitle: "", body: "Written last week",
    starters: ["Reading"], gardenRequestId: garden, topicRequestId: topic, thoughtRequestId: "",
    starterIds: {}, entryId: "", revisionId: "",
  };
  await store.put({ ...onboardingRecord("alice", "previous-tab", emptyOnboardingDraft()), body: JSON.stringify(old) });
  echo(); vi.mocked(saveEntry).mockResolvedValue({ ok: true });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  await waitFor(() => expect(screen.getByLabelText("Write a first entry")).toHaveValue("Written last week"));
  expect(screen.getByLabelText("Name your garden")).toHaveValue("Old notebook");
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  // The garden was already saved; its topic request id is replayed.
  expect(vi.mocked(createArea).mock.calls.map((c) => c.slice(0, 4))).toEqual([
    ["plot", "Ideas", garden, topic],
    ["seed", "Written last week", topic, expect.any(String)],
  ]);
});

it("recovers opened packs, the chosen question and the background after a reload", async () => {
  const view = render(<FirstRun tenantId="alice" onDone={vi.fn()} />);
  const writing = await ready();
  fireEvent.click(screen.getByRole("button", { name: /^People/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Conversations" }));
  fireEvent.click(screen.getByRole("button", { name: /^What did you leave unsaid/ }));
  fireEvent.change(writing, { target: { value: "To my brother" } });
  fireEvent.change(screen.getByLabelText("What you’re tending lately"), { target: { value: "Family, mostly." } });
  await waitFor(async () => expect((await loadOnboardingDraft("alice", createStorageBackend(sessionStorage)))?.state.background).toBe("Family, mostly."));
  view.unmount();
  echo(); vi.mocked(saveEntry).mockResolvedValue({ ok: true });
  const done = vi.fn();
  const { container } = render(<FirstRun tenantId="alice" onDone={done} />);
  await waitFor(() => expect(screen.getByLabelText("Write a first entry")).toHaveValue("To my brother"));
  expect(screen.getByRole("checkbox", { name: "Conversations" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Things I meant to say" })).toBeChecked();
  expect(screen.getByLabelText("Thought title")).toHaveValue("What did you leave unsaid, and to whom?");
  expect(screen.getByLabelText("What you’re tending lately")).toHaveValue("Family, mostly.");
  expect(container.querySelector("details.first-run-tending")).toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(areas()).toEqual([
    ["garden", "My garden"], ["plot", "Notes"],
    ["plot", "Things I meant to say"], ["plot", "People I’m learning from"],
    ["seed", "What did you leave unsaid, and to whom?"], ["seed", "What I’m tending"],
  ]);
});

it("does not repeat saved topics or a saved page when a later step fails", async () => {
  echo();
  vi.mocked(saveEntry).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, message: "Background failed" }).mockResolvedValueOnce({ ok: true });
  const done = vi.fn();
  render(<FirstRun tenantId="alice" onDone={done} />);
  const writing = await ready();
  fireEvent.click(screen.getByRole("button", { name: /^Mornings/ }));
  fireEvent.change(writing, { target: { value: "Page" } });
  fireEvent.change(screen.getByLabelText("What you’re tending lately"), { target: { value: "Background" } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await screen.findByText("Background failed");
  expect(writing).toBeDisabled();
  const before = vi.mocked(createArea).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(vi.mocked(createArea).mock.calls).toHaveLength(before);
  expect(vi.mocked(saveEntry).mock.calls.map((c) => c[0].body)).toEqual(["Page", "Background", "Background"]);
});
