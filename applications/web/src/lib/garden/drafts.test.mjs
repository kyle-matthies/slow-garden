import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAFT_STORAGE_PREFIX,
  DRAFTS_CLEARED_KEY,
  LEGACY_DRAFT_STORAGE_PREFIX,
  TAB_ID_KEY,
  TAB_STALE_MS,
  broadcastDraftsCleared,
  claimTabId,
  createStorageBackend,
  discardForeignDraft,
  draftKey,
  describeDraftTime,
  draftsClearedSince,
  ensureTabIdentity,
  findForeignDraft,
  getTabId,
  heartbeatTab,
  isDirtyDraft,
  isDraftRecord,
  markDraftsCleared,
  openDraftStore,
  readLegacySessionDraft,
  clearLegacySessionDrafts,
  releaseTab,
  resetTabIdentityForTests,
  restoreForeignDraft,
  subscribeDraftsCleared,
} from "./drafts.ts";

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.failNextSet = false;
  }
  values = new Map();
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    }
    this.values.set(String(key), String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

class FakeRequest {
  result = undefined;
  error = null;
  onsuccess = null;
  onerror = null;
  resolve(result) {
    this.result = result;
    queueMicrotask(() => {
      if (this.error) this.onerror?.();
      else this.onsuccess?.();
    });
  }
  reject(error) {
    this.error = error;
    queueMicrotask(() => this.onerror?.());
  }
}

class FakeStore {
  constructor(database) {
    this.database = database;
    this.records = new Map();
    this.indexes = new Set();
    this.indexNames = { contains: (name) => this.indexes.has(name) };
  }
  createIndex(name) {
    this.indexes.add(name);
    return {};
  }
  get(key, transaction) {
    const request = new FakeRequest();
    transaction.start();
    queueMicrotask(() => {
      if (transaction.failed) {
        request.reject(transaction.error);
        transaction.finish();
        return;
      }
      request.resolve(this.records.get(key) ?? undefined);
      transaction.finish();
    });
    return request;
  }
  put(record, transaction) {
    const request = new FakeRequest();
    transaction.start();
    queueMicrotask(() => {
      if (transaction.failed) {
        request.reject(transaction.error);
        transaction.finish();
        return;
      }
      if (this.database.factory.failNextPut) {
        this.database.factory.failNextPut = false;
        const error = new DOMException("Quota exceeded", "QuotaExceededError");
        request.reject(error);
        transaction.fail(error);
        return;
      }
      this.records.set(record.key, structuredClone(record));
      request.resolve(record);
      transaction.finish();
    });
    return request;
  }
  delete(key, transaction) {
    const request = new FakeRequest();
    transaction.start();
    queueMicrotask(() => {
      if (transaction.failed) {
        request.reject(transaction.error);
        transaction.finish();
        return;
      }
      this.records.delete(key);
      request.resolve(undefined);
      transaction.finish();
    });
    return request;
  }
  index(_name, transaction) {
    return {
      getAll: (tenantId) => {
        const request = new FakeRequest();
        transaction.start();
        queueMicrotask(() => {
          request.resolve(
            [...this.records.values()].filter(
              (record) => record.tenantId === tenantId,
            ),
          );
          transaction.finish();
        });
        return request;
      },
    };
  }
}

class FakeTransaction {
  oncomplete = null;
  onerror = null;
  onabort = null;
  error = null;
  completed = false;
  failed = false;
  pending = 0;
  constructor(store) {
    this.store = store;
  }
  start() {
    this.pending += 1;
  }
  finish() {
    this.pending -= 1;
    if (this.pending === 0 && !this.failed) {
      queueMicrotask(() => {
        if (!this.completed && !this.failed) {
          this.completed = true;
          this.oncomplete?.();
        }
      });
    }
  }
  fail(error) {
    if (this.failed) return;
    this.failed = true;
    this.error = error;
    queueMicrotask(() => {
      this.onerror?.();
      this.onabort?.();
    });
  }
  objectStore() {
    return {
      get: (key) => this.store.get(key, this),
      put: (record) => this.store.put(record, this),
      delete: (key) => this.store.delete(key, this),
      index: (name) => this.store.index(name, this),
    };
  }
  completeSoon() {
    if (this.completed) return;
    this.completed = true;
    queueMicrotask(() => this.oncomplete?.());
  }
}

class FakeDatabase {
  constructor(factory) {
    this.factory = factory;
  }
  stores = new Map();
  objectStoreNames = { contains: (name) => this.stores.has(name) };
  createObjectStore(name) {
    const store = new FakeStore(this);
    this.stores.set(name, store);
    return store;
  }
  transaction(name) {
    return new FakeTransaction(this.stores.get(name));
  }
}

class FakeOpenRequest extends FakeRequest {
  onupgradeneeded = null;
  onblocked = null;
  constructor(database) {
    super();
    this.result = database;
    queueMicrotask(() => {
      this.onupgradeneeded?.();
      this.resolve(this.result);
    });
  }
}

class FakeIDBFactory {
  constructor() {
    this.database = new FakeDatabase(this);
    this.failNextPut = false;
  }
  open() {
    return new FakeOpenRequest(this.database);
  }
}

function record(overrides = {}) {
  return {
    key: "tenant-a:seed-a:entry-a",
    tenantId: "tenant-a",
    seedId: "seed-a",
    entryId: "entry-a",
    scope: "revise",
    body: "A thought",
    revisionId: "revision-a",
    expectedRevisionId: "base-a",
    baseBody: "",
    updatedAt: 100,
    tabId: "tab-a",
    ...overrides,
  };
}

test("draft keys and runtime validation", () => {
  assert.equal(
    draftKey("tenant", "seed", undefined, "tab"),
    "tenant:seed:new:tab",
  );
  assert.equal(draftKey("tenant", "seed", null, "tab"), "tenant:seed:new:tab");
  assert.equal(
    draftKey("tenant", "seed", "entry", "tab-2"),
    "tenant:seed:entry:tab-2",
  );
  assert.notEqual(
    draftKey("tenant", "seed", "entry", "tab-a"),
    draftKey("tenant", "seed", "entry", "tab-b"),
  );
  assert.equal(isDraftRecord(record()), true);
  assert.equal(isDraftRecord({ ...record(), expectedRevisionId: 4 }), false);
  assert.equal(isDraftRecord({ ...record(), updatedAt: "100" }), false);
  assert.equal(isDraftRecord({ ...record(), scope: "other" }), false);
  assert.equal(isDraftRecord({ body: "missing fields" }), false);
  assert.equal(isDraftRecord(null), false);
  assert.equal(isDraftRecord("record"), false);
});

test("session storage backend isolates tenants and ignores invalid entries", async () => {
  const storage = new MemoryStorage();
  const backend = createStorageBackend(storage);
  const first = record({ updatedAt: 100 });
  const second = record({
    key: "tenant-a:seed-a:entry-b",
    entryId: "entry-b",
    updatedAt: 200,
  });
  await backend.put(first);
  await backend.put(second);
  await backend.put(
    record({ key: "tenant-b:seed-b:entry-c", tenantId: "tenant-b" }),
  );
  storage.setItem(`${DRAFT_STORAGE_PREFIX}bad`, "{not json");
  storage.setItem(
    `${DRAFT_STORAGE_PREFIX}foreign`,
    JSON.stringify({ foreign: true }),
  );
  storage.setItem("other-app:key", JSON.stringify(first));
  assert.deepEqual(await backend.get(first.key), first);
  assert.deepEqual(await backend.list("tenant-a"), [second, first]);
  assert.deepEqual(await backend.list("tenant-b"), [
    record({ key: "tenant-b:seed-b:entry-c", tenantId: "tenant-b" }),
  ]);
  await backend.remove(first.key);
  assert.equal(await backend.get(first.key), null);
  await backend.clear("tenant-b");
  assert.equal((await backend.list("tenant-b")).length, 0);
  assert.equal((await backend.list("tenant-a")).length, 1);
  assert.equal(storage.getItem(`${DRAFT_STORAGE_PREFIX}bad`), "{not json");
});

test("indexeddb backend round trips, lists, removes, and clears", async () => {
  const backend = await openDraftStore({ indexedDB: new FakeIDBFactory() });
  assert.equal(backend?.kind, "indexeddb");
  const first = record({ updatedAt: 100 });
  const second = record({
    key: "tenant-a:seed-a:entry-b",
    entryId: "entry-b",
    updatedAt: 200,
  });
  await backend.put(first);
  await backend.put(second);
  await backend.put(
    record({ key: "tenant-b:seed-b:entry-c", tenantId: "tenant-b" }),
  );
  assert.deepEqual(await backend.get(first.key), first);
  assert.deepEqual(await backend.list("tenant-a"), [second, first]);
  await backend.remove(first.key);
  assert.equal(await backend.get(first.key), null);
  await backend.clear("tenant-b");
  assert.equal((await backend.list("tenant-b")).length, 0);
});

test("draft store fallback and unavailable environments", async () => {
  const storage = new MemoryStorage();
  const broken = {
    open() {
      throw new Error("blocked");
    },
  };
  assert.equal(
    (await openDraftStore({ indexedDB: broken, sessionStorage: storage })).kind,
    "sessionstorage",
  );
  assert.equal(await openDraftStore({}), null);
  assert.equal(
    await openDraftStore({ indexedDB: null, sessionStorage: null }),
    null,
  );
});

test("legacy migration helpers only read and clear the requested tenant", () => {
  const storage = new MemoryStorage();
  const key = `${LEGACY_DRAFT_STORAGE_PREFIX}tenant-a:seed-a:new`;
  const parsed = {
    body: "old draft",
    entryId: "entry-a",
    revisionId: "revision-a",
    expectedRevisionId: null,
  };
  storage.setItem(key, JSON.stringify(parsed));
  storage.setItem(
    `${LEGACY_DRAFT_STORAGE_PREFIX}tenant-a:seed-a:entry-a`,
    JSON.stringify(parsed),
  );
  storage.setItem(
    `${LEGACY_DRAFT_STORAGE_PREFIX}tenant-b:seed-b:new`,
    JSON.stringify(parsed),
  );
  assert.deepEqual(
    readLegacySessionDraft(storage, "tenant-a", "seed-a"),
    parsed,
  );
  storage.setItem(key, JSON.stringify({ body: 4 }));
  assert.equal(readLegacySessionDraft(storage, "tenant-a", "seed-a"), null);
  clearLegacySessionDrafts(storage, "tenant-a");
  assert.equal(storage.getItem(key), null);
  assert.notEqual(
    storage.getItem(`${LEGACY_DRAFT_STORAGE_PREFIX}tenant-b:seed-b:new`),
    null,
  );
});

test("draft time labels, dirty detection, and stable tab ids", () => {
  const now = 1_000_000;
  assert.equal(describeDraftTime(now - 59_000, now), "just now");
  assert.equal(describeDraftTime(now - 5 * 60_000, now), "5 minutes ago");
  assert.equal(describeDraftTime(now - 2 * 3_600_000, now), "2 hours ago");
  assert.match(describeDraftTime(now - 2 * 86_400_000, now), /^on /);
  assert.equal(isDirtyDraft(record({ body: " ", baseBody: "" })), false);
  assert.equal(isDirtyDraft(record({ body: "same", baseBody: "same" })), false);
  assert.equal(isDirtyDraft(record({ body: "changed", baseBody: "" })), true);
  const storage = new MemoryStorage();
  assert.equal(getTabId(storage), getTabId(storage));
});

test("tabs keep separate draft records and recover each other's dirty work", async () => {
  const backend = createStorageBackend(new MemoryStorage());
  const a = record({ key: draftKey("tenant-a", "seed-a", "entry-a", "tab-a") });
  const b = record({
    key: draftKey("tenant-a", "seed-a", "entry-a", "tab-b"),
    tabId: "tab-b",
    body: "B thought",
    updatedAt: 200,
  });
  await backend.put(a);
  await backend.put(b);
  await backend.remove(a.key);
  assert.deepEqual(await backend.get(b.key), b);
  assert.equal(await backend.get(a.key), null);

  const records = await backend.list("tenant-a");
  const target = {
    tenantId: "tenant-a",
    seedId: "seed-a",
    scope: "revise",
    entryId: "entry-a",
    tabId: "tab-a",
  };
  assert.deepEqual(findForeignDraft(records, target), b);
  assert.equal(findForeignDraft(records, { ...target, tabId: "tab-b" }), null);
  assert.equal(
    findForeignDraft(records, { ...target, entryId: "entry-z" }),
    null,
  );
  assert.equal(findForeignDraft([{ ...b, body: b.baseBody }], target), null);
  const newA = { ...b, scope: "new", entryId: "fresh-1" };
  assert.deepEqual(
    findForeignDraft([newA], { ...target, scope: "new", entryId: "fresh-2" }),
    newA,
  );
});

async function backendFixtures() {
  const storage = new MemoryStorage();
  const factory = new FakeIDBFactory();
  return [
    {
      name: "sessionstorage",
      backend: createStorageBackend(storage),
      fail: () => {
        storage.failNextSet = true;
      },
    },
    {
      name: "indexeddb",
      backend: await openDraftStore({ indexedDB: factory }),
      fail: () => {
        factory.failNextPut = true;
      },
    },
  ];
}

function foreignRecord() {
  return record({
    key: draftKey("tenant-a", "seed-a", "entry-a", "foreign"),
    tabId: "foreign",
    body: "foreign writing",
    updatedAt: 1_000,
  });
}

test("failed foreign restore leaves the original record in both backends", async () => {
  for (const fixture of await backendFixtures()) {
    const recovered = foreignRecord();
    await fixture.backend.put(recovered);
    fixture.fail();
    assert.equal(
      await restoreForeignDraft(fixture.backend, recovered, {
        key: draftKey("tenant-a", "seed-a", "entry-a", "current"),
        tabId: "current",
      }),
      "failed",
      fixture.name,
    );
    assert.deepEqual(await fixture.backend.get(recovered.key), recovered);
    assert.equal((await fixture.backend.list("tenant-a")).length, 1);
  }
});

test("foreign restore copies newer source and moves unchanged source", async () => {
  for (const fixture of await backendFixtures()) {
    const recovered = foreignRecord();
    const target = {
      key: draftKey("tenant-a", "seed-a", "entry-a", "current"),
      tabId: "current",
    };
    await fixture.backend.put(recovered);
    await fixture.backend.put({
      ...recovered,
      body: "newer foreign writing",
      updatedAt: recovered.updatedAt + 1_000,
    });
    assert.equal(
      await restoreForeignDraft(fixture.backend, recovered, target),
      "copied",
      fixture.name,
    );
    assert.equal(
      (await fixture.backend.get(recovered.key)).body,
      "newer foreign writing",
    );
    assert.equal((await fixture.backend.get(target.key)).body, recovered.body);

    await fixture.backend.remove(target.key);
    await fixture.backend.put(recovered);
    assert.equal(
      await restoreForeignDraft(fixture.backend, recovered, target),
      "moved",
      fixture.name,
    );
    assert.equal(await fixture.backend.get(recovered.key), null);
    assert.equal((await fixture.backend.get(target.key)).body, recovered.body);
  }
});

test("foreign discard is conditional and preserves newer writing", async () => {
  for (const fixture of await backendFixtures()) {
    const recovered = foreignRecord();
    await fixture.backend.put(recovered);
    await fixture.backend.put({
      ...recovered,
      body: "newer foreign writing",
      updatedAt: recovered.updatedAt + 1_000,
    });
    assert.equal(await discardForeignDraft(fixture.backend, recovered), false);
    assert.equal(
      (await fixture.backend.get(recovered.key)).body,
      "newer foreign writing",
    );
    assert.equal(await discardForeignDraft(fixture.backend, await fixture.backend.get(recovered.key)), true);
    assert.equal(await fixture.backend.get(recovered.key), null);
  }
});

test("live tab identity reuses released or stale ids and separates duplicates", async () => {
  const now = 10_000;
  const staleSession = new MemoryStorage({ [TAB_ID_KEY]: "tab-x" });
  const local = new MemoryStorage({
    "slow-garden:live-tabs": JSON.stringify({
      "tab-x": now - TAB_STALE_MS - 1,
    }),
  });
  assert.equal(claimTabId(staleSession, local, now), "tab-x");

  const openerSession = new MemoryStorage({ [TAB_ID_KEY]: "tab-x" });
  const sharedLocal = new MemoryStorage();
  const tabA = claimTabId(openerSession, sharedLocal, now);
  const copiedSession = new MemoryStorage(
    Object.fromEntries(openerSession.values),
  );
  const tabB = claimTabId(copiedSession, sharedLocal, now + 10);
  assert.notEqual(tabA, tabB);
  assert.equal(draftKey("tenant", "seed", "entry", tabA) === draftKey("tenant", "seed", "entry", tabB), false);
  assert.equal(copiedSession.getItem(TAB_ID_KEY), tabB);

  heartbeatTab(sharedLocal, tabB, now + 20);
  releaseTab(sharedLocal, tabB);
  assert.equal(claimTabId(copiedSession, sharedLocal, now + 30), tabB);

  const backend = createStorageBackend(new MemoryStorage());
  const keyA = draftKey("tenant", "seed", "entry", tabA);
  const keyB = draftKey("tenant", "seed", "entry", tabB);
  await backend.put(record({ key: keyA, tabId: tabA }));
  await backend.put(record({ key: keyB, tabId: tabB }));
  assert.equal(await backend.removeIf(keyB, 100), true);
  assert.notEqual(await backend.get(keyA), null);
  assert.equal(await backend.get(keyB), null);
  const snapshotA = record({
    key: keyA,
    tabId: tabA,
    updatedAt: 100,
  });
  await backend.put(record({ key: keyB, tabId: tabB, updatedAt: 200 }));
  assert.equal(await discardForeignDraft(backend, snapshotA), true);
  assert.notEqual(await backend.get(keyB), null);

  resetTabIdentityForTests();
  const identitySession = new MemoryStorage();
  const identityLocal = new MemoryStorage();
  const first = ensureTabIdentity({
    sessionStorage: identitySession,
    localStorage: identityLocal,
  });
  assert.equal(
    ensureTabIdentity({
      sessionStorage: new MemoryStorage(),
      localStorage: new MemoryStorage(),
    }),
    first,
  );
  resetTabIdentityForTests();
});

test("sign-out tombstones notify subscribers and block deferred writes", async () => {
  const now = 50_000;
  const local = new MemoryStorage();
  markDraftsCleared(local, "tenant-a", now);
  assert.equal(draftsClearedSince(local, "tenant-a", now - 1), true);
  assert.equal(draftsClearedSince(local, "tenant-a", now + 1), false);
  assert.equal(draftsClearedSince(local, "tenant-b", now - 1), false);

  const previousWindow = globalThis.window;
  const previousChannel = globalThis.BroadcastChannel;
  const fakeWindow = new EventTarget();
  globalThis.window = fakeWindow;
  globalThis.BroadcastChannel = undefined;
  try {
    let calls = 0;
    const unsubscribe = subscribeDraftsCleared("tenant-a", () => {
      calls += 1;
    });
    const event = new Event("storage");
    Object.defineProperties(event, {
      key: { value: DRAFTS_CLEARED_KEY },
      newValue: {
        value: JSON.stringify({ tenantId: "tenant-a", at: now }),
      },
    });
    fakeWindow.dispatchEvent(event);
    assert.equal(calls, 1);
    unsubscribe();
    fakeWindow.dispatchEvent(event);
    assert.equal(calls, 1);
    broadcastDraftsCleared("tenant-a");
  } finally {
    globalThis.window = previousWindow;
    globalThis.BroadcastChannel = previousChannel;
  }

  const backend = createStorageBackend(new MemoryStorage());
  const pending = record({ tenantId: "tenant-a", updatedAt: now + 1 });
  await backend.put(pending);
  markDraftsCleared(local, "tenant-a", now + 2);
  await backend.clear("tenant-a");
  if (!draftsClearedSince(local, "tenant-a", now + 1))
    await backend.put({ ...pending, body: "must not return" });
  assert.equal((await backend.list("tenant-a")).length, 0);
});
