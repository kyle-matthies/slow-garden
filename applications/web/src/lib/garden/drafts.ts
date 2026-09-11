export const DRAFT_STORAGE_PREFIX = "slow-garden:draft:v3:";
export const LEGACY_DRAFT_STORAGE_PREFIX = "slow-garden:draft:v2:";
export const DRAFT_DB_NAME = "slow-garden-drafts";
export const DRAFT_DB_VERSION = 1;
export const DRAFT_STORE_NAME = "drafts";

export type DraftRecord = {
  key: string;
  tenantId: string;
  seedId: string;
  entryId: string;
  scope: "new" | "revise";
  body: string;
  revisionId: string;
  expectedRevisionId: string | null;
  baseBody: string;
  updatedAt: number;
  tabId: string;
};

export const DRAFTS_CLEARED_EVENT = "slow-garden:drafts-cleared";

export function draftKey(
  tenantId: string,
  seedId: string,
  entryId: string | null | undefined,
  tabId: string,
): string {
  return `${tenantId}:${seedId}:${entryId ?? "new"}:${tabId}`;
}

export function findForeignDraft(
  records: DraftRecord[],
  target: {
    tenantId: string;
    seedId: string;
    scope: DraftRecord["scope"];
    entryId?: string | null;
    tabId: string;
  },
): DraftRecord | null {
  return (
    records
      .filter(
        (record) =>
          record.tenantId === target.tenantId &&
          record.seedId === target.seedId &&
          record.scope === target.scope &&
          (target.scope === "new" || record.entryId === target.entryId) &&
          record.tabId !== target.tabId &&
          isDirtyDraft(record),
      )
      .sort(sortByUpdatedAt)[0] ?? null
  );
}

export function isDraftRecord(value: unknown): value is DraftRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.key === "string" &&
    typeof record.tenantId === "string" &&
    typeof record.seedId === "string" &&
    typeof record.entryId === "string" &&
    (record.scope === "new" || record.scope === "revise") &&
    typeof record.body === "string" &&
    typeof record.revisionId === "string" &&
    (record.expectedRevisionId === null ||
      typeof record.expectedRevisionId === "string") &&
    typeof record.baseBody === "string" &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt) &&
    typeof record.tabId === "string"
  );
}

function sortByUpdatedAt(a: DraftRecord, b: DraftRecord): number {
  return b.updatedAt - a.updatedAt;
}

export interface DraftBackend {
  readonly kind: "indexeddb" | "sessionstorage";
  get(key: string): Promise<DraftRecord | null>;
  put(record: DraftRecord): Promise<void>;
  remove(key: string): Promise<void>;
  list(tenantId: string): Promise<DraftRecord[]>;
  clear(tenantId: string): Promise<void>;
}

export function createStorageBackend(storage: Storage): DraftBackend {
  const read = (key: string): DraftRecord | null => {
    const value = storage.getItem(DRAFT_STORAGE_PREFIX + key);
    if (value === null) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      return isDraftRecord(parsed) && parsed.key === key ? parsed : null;
    } catch {
      return null;
    }
  };
  return {
    kind: "sessionstorage",
    async get(key) {
      return read(key);
    },
    async put(record) {
      storage.setItem(
        DRAFT_STORAGE_PREFIX + record.key,
        JSON.stringify(record),
      );
    },
    async remove(key) {
      storage.removeItem(DRAFT_STORAGE_PREFIX + key);
    },
    async list(tenantId) {
      const records: DraftRecord[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(DRAFT_STORAGE_PREFIX)) continue;
        const record = read(key.slice(DRAFT_STORAGE_PREFIX.length));
        if (record?.tenantId === tenantId) records.push(record);
      }
      return records.sort(sortByUpdatedAt);
    },
    async clear(tenantId) {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(DRAFT_STORAGE_PREFIX)) continue;
        const record = read(key.slice(DRAFT_STORAGE_PREFIX.length));
        if (record?.tenantId === tenantId) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function openIndexedDbBackend(
  factory: IDBFactory,
): Promise<DraftBackend> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(DRAFT_STORE_NAME)
        ? request.transaction!.objectStore(DRAFT_STORE_NAME)
        : database.createObjectStore(DRAFT_STORE_NAME, { keyPath: "key" });
      if (!store.indexNames.contains("tenantId"))
        store.createIndex("tenantId", "tenantId", { unique: false });
    };
    request.onblocked = () => reject(new Error("IndexedDB open was blocked"));
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
    request.onsuccess = () => {
      const database = request.result;
      const backend: DraftBackend = {
        kind: "indexeddb",
        async get(key) {
          const transaction = database.transaction(
            DRAFT_STORE_NAME,
            "readonly",
          );
          const result = (await requestResult(
            transaction.objectStore(DRAFT_STORE_NAME).get(key),
          )) as DraftRecord | undefined;
          return result && isDraftRecord(result) && result.key === key
            ? result
            : null;
        },
        async put(record) {
          const transaction = database.transaction(
            DRAFT_STORE_NAME,
            "readwrite",
          );
          const request = transaction.objectStore(DRAFT_STORE_NAME).put(record);
          await Promise.all([
            requestResult(request).then(() => undefined),
            transactionComplete(transaction),
          ]);
        },
        async remove(key) {
          const transaction = database.transaction(
            DRAFT_STORE_NAME,
            "readwrite",
          );
          const request = transaction.objectStore(DRAFT_STORE_NAME).delete(key);
          await Promise.all([
            requestResult(request).then(() => undefined),
            transactionComplete(transaction),
          ]);
        },
        async list(tenantId) {
          const transaction = database.transaction(
            DRAFT_STORE_NAME,
            "readonly",
          );
          const index = transaction
            .objectStore(DRAFT_STORE_NAME)
            .index("tenantId");
          const range =
            typeof IDBKeyRange !== "undefined"
              ? IDBKeyRange.only(tenantId)
              : tenantId;
          const records = (await requestResult(
            index.getAll(range),
          )) as DraftRecord[];
          return records.filter(isDraftRecord).sort(sortByUpdatedAt);
        },
        async clear(tenantId) {
          const records = await backend.list(tenantId);
          for (const record of records) await backend.remove(record.key);
        },
      };
      resolve(backend);
    };
  });
}

export type DraftEnvironment = {
  indexedDB?: IDBFactory | null;
  sessionStorage?: Storage | null;
};

function usableStorage(storage: Storage): boolean {
  const key = `${DRAFT_STORAGE_PREFIX}probe`;
  storage.getItem(key);
  storage.setItem(key, "1");
  storage.removeItem(key);
  return true;
}

export async function openDraftStore(
  env: DraftEnvironment = globalThis as DraftEnvironment,
): Promise<DraftBackend | null> {
  try {
    if (env.indexedDB) return await openIndexedDbBackend(env.indexedDB);
  } catch {
    // Session storage is the deliberate fallback when IndexedDB is unavailable.
  }
  try {
    if (env.sessionStorage && usableStorage(env.sessionStorage))
      return createStorageBackend(env.sessionStorage);
  } catch {
    // Private browsing and disabled storage can throw here.
  }
  return null;
}

export function readLegacySessionDraft(
  storage: Storage | null | undefined,
  tenantId: string,
  seedId: string,
  entryId?: string | null,
): {
  body: string;
  entryId: string;
  revisionId: string;
  expectedRevisionId: string | null;
} | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(
      `${LEGACY_DRAFT_STORAGE_PREFIX}${tenantId}:${seedId}:${entryId ?? "new"}`,
    );
    if (value === null) return null;
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const draft = parsed as Record<string, unknown>;
    if (
      typeof draft.body !== "string" ||
      typeof draft.entryId !== "string" ||
      typeof draft.revisionId !== "string" ||
      (draft.expectedRevisionId !== null &&
        typeof draft.expectedRevisionId !== "string")
    )
      return null;
    return {
      body: draft.body,
      entryId: draft.entryId,
      revisionId: draft.revisionId,
      expectedRevisionId: draft.expectedRevisionId,
    };
  } catch {
    return null;
  }
}

export function clearLegacySessionDrafts(
  storage: Storage | null | undefined,
  tenantId: string,
): void {
  if (!storage) return;
  const prefix = `${LEGACY_DRAFT_STORAGE_PREFIX}${tenantId}:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Sign-out cleanup should not prevent navigation when storage is unavailable.
  }
}

export function getTabId(storage: Storage | null | undefined): string {
  const create = () => crypto.randomUUID();
  if (!storage) return create();
  try {
    const existing = storage.getItem("slow-garden:tab-id");
    if (existing) return existing;
    const id = create();
    storage.setItem("slow-garden:tab-id", id);
    return id;
  } catch {
    return create();
  }
}

export function describeDraftTime(
  updatedAt: number,
  now: number = Date.now(),
): string {
  const elapsed = Math.max(0, now - updatedAt);
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (elapsed < 3_600_000)
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(elapsed / 3_600_000);
  if (elapsed < 86_400_000) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `on ${new Date(updatedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function isDirtyDraft(record: DraftRecord): boolean {
  return record.body.trim() !== "" && record.body !== record.baseBody;
}
