import { afterEach, describe, expect, it } from "vitest";
import { createStorageBackend, LIVE_TABS_KEY, markDraftsCleared, resetTabIdentityForTests } from "./drafts";
import { emptyOnboardingDraft, loadOnboardingDraft, onboardingRecord, parseOnboardingDraft } from "./onboarding-draft";

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
});
