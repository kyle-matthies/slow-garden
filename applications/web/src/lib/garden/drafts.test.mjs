import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAFT_STORAGE_PREFIX,
  LEGACY_DRAFT_STORAGE_PREFIX,
  createStorageBackend,
  draftKey,
  describeDraftTime,
  findForeignDraft,
  getTabId,
  isDirtyDraft,
  isDraftRecord,
  openDraftStore,
  readLegacySessionDraft,
  clearLegacySessionDrafts,
} from "./drafts.ts";

class MemoryStorage {
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
  constructor() {
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
    queueMicrotask(() => {
      request.resolve(this.records.get(key) ?? undefined);
      transaction.completeSoon();
    });
    return request;
  }
  put(record, transaction) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      this.records.set(record.key, structuredClone(record));
      request.resolve(record);
      transaction.completeSoon();
    });
    return request;
  }
  delete(key, transaction) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      this.records.delete(key);
      request.resolve(undefined);
      transaction.completeSoon();
    });
    return request;
  }
  index() {
    return {
      getAll: (tenantId) => {
        const request = new FakeRequest();
        queueMicrotask(() => {
          request.resolve(
            [...this.records.values()].filter(
              (record) => record.tenantId === tenantId,
            ),
          );
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
  constructor(store) {
    this.store = store;
  }
  objectStore() {
    return {
      get: (key) => this.store.get(key, this),
      put: (record) => this.store.put(record, this),
      delete: (key) => this.store.delete(key, this),
      index: (name) => this.store.index(name),
    };
  }
  completeSoon() {
    if (this.completed) return;
    this.completed = true;
    queueMicrotask(() => this.oncomplete?.());
  }
}

class FakeDatabase {
  stores = new Map();
  objectStoreNames = { contains: (name) => this.stores.has(name) };
  createObjectStore(name) {
    const store = new FakeStore();
    this.stores.set(name, store);
    return store;
  }
  transaction(name) {
    return new FakeTransaction(this.stores.get(name));
  }
}

class FakeOpenRequest extends FakeRequest {
  result = new FakeDatabase();
  onupgradeneeded = null;
  onblocked = null;
  constructor() {
    super();
    queueMicrotask(() => {
      this.onupgradeneeded?.();
      this.resolve(this.result);
    });
  }
}

class FakeIDBFactory {
  open() {
    return new FakeOpenRequest();
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
