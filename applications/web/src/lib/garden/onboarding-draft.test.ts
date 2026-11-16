import { afterEach, describe, expect, it } from "vitest";
import { createStorageBackend, LIVE_TABS_KEY, markDraftsCleared, resetTabIdentityForTests } from "./drafts";
import { emptyOnboardingDraft, loadOnboardingDraft, onboardingRecord, parseOnboardingDraft, titleFromFirstLine } from "./onboarding-draft";

afterEach(() => { resetTabIdentityForTests(); sessionStorage.clear(); localStorage.clear(); });

describe("onboarding checkpoint", () => {
  it("loads only the requested tenant and ignores incomplete/tampered state", async () => {
    const store = createStorageBackend(sessionStorage);
    const draft = { ...emptyOnboardingDraft(), gardenName: "First garden" };
    await store.put(onboardingRecord("alice", "tab", draft));
    expect((await loadOnboardingDraft("alice", store))?.state.gardenName).toBe("First garden");
    expect(await loadOnboardingDraft("bob", store)).toBeNull();
    expect(parseOnboardingDraft(JSON.stringify({ ...draft, step: 4 }))).toBeNull();
    expect(parseOnboardingDraft(JSON.stringify({ ...draft, gardenRequestId: "invalid" }))).toBeNull();
  });

  it("uses the ordinary draft backend so normal sign-out clearing removes it", async () => {
    const store = createStorageBackend(sessionStorage);
    await store.put(onboardingRecord("alice", "tab", emptyOnboardingDraft()));
    await store.put(onboardingRecord("bob", "tab", emptyOnboardingDraft()));
    await store.clear("alice");
    expect(await loadOnboardingDraft("alice", store)).toBeNull();
    expect(await loadOnboardingDraft("bob", store)).not.toBeNull();
  });

  it("never restores completed setup or a checkpoint older than sign-out", async () => {
    const store = createStorageBackend(sessionStorage);
    const record = onboardingRecord("alice", "tab", emptyOnboardingDraft());
    await store.put(record);
    markDraftsCleared(localStorage, "alice", record.updatedAt + 1);
    expect(await loadOnboardingDraft("alice", store)).toBeNull();
    localStorage.clear();
    await store.put(onboardingRecord("alice", "tab", { ...emptyOnboardingDraft(), completed: true }));
    expect(await loadOnboardingDraft("alice", store)).toBeNull();
  });

  it("chooses the newest valid checkpoint regardless of backend order and honors its own completion", async () => {
    const store = createStorageBackend(sessionStorage);
    const old = { ...onboardingRecord("alice", "a", { ...emptyOnboardingDraft(), gardenName: "Old" }), updatedAt: 10 };
    const newer = { ...onboardingRecord("alice", "b", { ...emptyOnboardingDraft(), gardenName: "New" }), updatedAt: 20 };
    const unordered = { ...store, list: async () => [old, newer] };
    expect((await loadOnboardingDraft("alice", unordered))?.state.gardenName).toBe("New");
    newer.body = JSON.stringify({ ...emptyOnboardingDraft(), completed: true });
    expect(await loadOnboardingDraft("alice", unordered, false, "b")).toBeNull();
  });

  it("preserves A's unchanged writing when B completes and prefers each tab's own state", async () => {
    const store = createStorageBackend(sessionStorage);
    const a = { ...onboardingRecord("alice", "tab-a", { ...emptyOnboardingDraft(), body: "A's original unsaved words" }), updatedAt: 10 };
    const b = { ...onboardingRecord("alice", "tab-b", { ...emptyOnboardingDraft(), completed: true }), updatedAt: 20 };
    await store.put(a); await store.put(b);
    localStorage.setItem(LIVE_TABS_KEY, JSON.stringify({ "tab-a": Date.now() }));
    expect(await loadOnboardingDraft("alice", store, false, "new-tab")).toBeNull();
    expect(await loadOnboardingDraft("alice", store, false, "tab-b")).toBeNull();
    expect((await loadOnboardingDraft("alice", store, false, "tab-a"))?.state.body).toBe("A's original unsaved words");
    expect((await store.get(a.key))?.body).toBe(a.body);
  });

  it("starts with sensible names and titles a thought from the person's own first line", () => {
    expect(emptyOnboardingDraft()).toMatchObject({ gardenName: "My garden", topicName: "Notes", thoughtTitle: "", body: "" });
    expect(titleFromFirstLine("\n  Why this again?  \nsecond line")).toBe("Why this again?");
    expect(titleFromFirstLine("   ")).toBe("First thought");
    const long = titleFromFirstLine("I keep saying I want a quieter job and then I volunteer for the loudest project every time");
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long).toBe("I keep saying I want a quieter job and then I volunteer for…");
  });

  it("upgrades a checkpoint written before seed packs, keeping every word and id", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const old = {
      version: 1, completed: false, step: 2, gardenId: id, topicId: "", thoughtId: "",
      gardenName: "Old notebook", topicName: "Ideas", thoughtTitle: "A question", body: "Kept words",
      starters: ["Reading", "Work"], gardenRequestId: id, topicRequestId: "", thoughtRequestId: "",
      starterIds: { Reading: id }, entryId: "", revisionId: "",
    };
    const upgraded = parseOnboardingDraft(JSON.stringify(old));
    expect(upgraded).toMatchObject({
      version: 2, step: 2, gardenId: id, gardenName: "Old notebook", topicName: "Ideas",
      thoughtTitle: "A question", body: "Kept words", packs: [], beds: [], writeIn: "", background: "", entrySaved: false,
    });
    expect(upgraded).not.toHaveProperty("starters");
    expect(parseOnboardingDraft(JSON.stringify({ ...old, starters: ["Anything"] }))).toBeNull();
    expect(parseOnboardingDraft(JSON.stringify({ ...old, version: 3 }))).toBeNull();
  });

  it("round-trips chosen topics and background, and rejects tampered ones", async () => {
    const id = "10000000-0000-4000-8000-000000000002";
    const bed = { key: "mornings/0", name: "Before the day starts", on: true, requestId: id, id: "" };
    const draft = { ...emptyOnboardingDraft(), packs: ["mornings"], beds: [bed], writeIn: "mornings/0", thoughtTitle: "A question?", background: "What has my attention" };
    const store = createStorageBackend(sessionStorage);
    await store.put(onboardingRecord("alice", "tab", draft));
    expect((await loadOnboardingDraft("alice", store))?.state).toEqual(draft);
    const bad = (patch: object) => parseOnboardingDraft(JSON.stringify({ ...draft, ...patch }));
    expect(bad({ writeIn: "people/0" })).toBeNull();
    expect(bad({ beds: [{ ...bed, name: "n".repeat(121) }] })).toBeNull();
    expect(bad({ beds: [{ ...bed, requestId: "nope" }] })).toBeNull();
    expect(bad({ beds: [bed, bed] })).toBeNull();
    expect(bad({ beds: [{ ...bed, key: "../x" }] })).toBeNull();
    expect(bad({ packs: ["Not A Pack"] })).toBeNull();
    expect(bad({ background: "b".repeat(20001) })).toBeNull();
    // A saved pack topic satisfies the "a topic exists" checkpoint.
    expect(bad({ step: 3, gardenId: id, beds: [{ ...bed, id }] })).not.toBeNull();
    expect(bad({ step: 3, gardenId: id })).toBeNull();
  });
});
