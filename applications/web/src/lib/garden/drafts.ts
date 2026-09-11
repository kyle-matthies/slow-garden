export const DRAFT_STORAGE_PREFIX = "slow-garden:draft:v3:";
export const LEGACY_DRAFT_STORAGE_PREFIX = "slow-garden:draft:v2:";
export const DRAFT_DB_NAME = "slow-garden-drafts";
export const DRAFT_DB_VERSION = 1;
export const DRAFT_STORE_NAME = "drafts";
export const TAB_ID_KEY = "slow-garden:tab-id";
export const LIVE_TABS_KEY = "slow-garden:live-tabs";
export const TAB_HEARTBEAT_MS = 4_000;
export const TAB_STALE_MS = 12_000;
export const DRAFTS_CLEARED_KEY = "slow-garden:drafts-cleared";
export const DRAFTS_CHANNEL = "slow-garden:drafts";

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
  removeIf(key: string, expectedUpdatedAt: number): Promise<boolean>;
  transfer(
    record: DraftRecord,
    from: { key: string; updatedAt: number },
  ): Promise<boolean>;
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
    async removeIf(key, expectedUpdatedAt) {
      const record = read(key);
      if (!record || record.updatedAt !== expectedUpdatedAt) return false;
      storage.removeItem(DRAFT_STORAGE_PREFIX + key);
      return true;
    },
    async transfer(record, from) {
      storage.setItem(
        DRAFT_STORAGE_PREFIX + record.key,
        JSON.stringify(record),
      );
      return (await this.removeIf(from.key, from.updatedAt)) as boolean;
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
        async removeIf(key, expectedUpdatedAt) {
          const transaction = database.transaction(
            DRAFT_STORE_NAME,
            "readwrite",
          );
          const store = transaction.objectStore(DRAFT_STORE_NAME);
          let removed = false;
          await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () =>
              reject(
                transaction.error ??
                  new Error("IndexedDB transaction failed"),
              );
            transaction.onabort = () =>
              reject(
                transaction.error ??
                  new Error("IndexedDB transaction aborted"),
              );
            const request = store.get(key);
            request.onerror = () =>
              reject(request.error ?? new Error("IndexedDB request failed"));
            request.onsuccess = () => {
              const record = request.result as DraftRecord | undefined;
              if (
                record &&
                isDraftRecord(record) &&
                record.updatedAt === expectedUpdatedAt
              ) {
                removed = true;
                const deletion = store.delete(key);
                deletion.onerror = () =>
                  reject(
                    deletion.error ?? new Error("IndexedDB request failed"),
                  );
              }
            };
          });
          return removed;
        },
        async transfer(record, from) {
          const transaction = database.transaction(
            DRAFT_STORE_NAME,
            "readwrite",
          );
          const store = transaction.objectStore(DRAFT_STORE_NAME);
          let removed = false;
          await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () =>
              reject(
                transaction.error ??
                  new Error("IndexedDB transaction failed"),
              );
            transaction.onabort = () =>
              reject(
                transaction.error ??
                  new Error("IndexedDB transaction aborted"),
              );
            const putRequest = store.put(record);
            putRequest.onerror = () =>
              reject(
                putRequest.error ?? new Error("IndexedDB request failed"),
              );
            const sourceRequest = store.get(from.key);
            sourceRequest.onerror = () =>
              reject(
                sourceRequest.error ?? new Error("IndexedDB request failed"),
              );
            sourceRequest.onsuccess = () => {
              const source = sourceRequest.result as DraftRecord | undefined;
              if (
                source &&
                isDraftRecord(source) &&
                source.updatedAt === from.updatedAt
              ) {
                removed = true;
                const deletion = store.delete(from.key);
                deletion.onerror = () =>
                  reject(
                    deletion.error ?? new Error("IndexedDB request failed"),
                  );
              }
            };
          });
          return removed;
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
    const existing = storage.getItem(TAB_ID_KEY);
    if (existing) return existing;
    const id = create();
    storage.setItem(TAB_ID_KEY, id);
    return id;
  } catch {
    return create();
  }
}

type LiveTabs = Record<string, number>;

function readLiveTabs(storage: Storage): LiveTabs {
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(LIVE_TABS_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) => typeof value === "number" && Number.isFinite(value),
      ),
    );
  } catch {
    return {};
  }
}

function pruneLiveTabs(registry: LiveTabs, now: number): LiveTabs {
  const cutoff = now - TAB_STALE_MS;
  return Object.fromEntries(
    Object.entries(registry).filter(([, heartbeat]) => heartbeat >= cutoff),
  );
}

export function claimTabId(
  session: Storage | null | undefined,
  local: Storage | null | undefined,
  now: number = Date.now(),
): string {
  if (!local) return getTabId(session);
  try {
    const existing = session?.getItem(TAB_ID_KEY);
    let candidate = existing || crypto.randomUUID();
    if (!existing) session?.setItem(TAB_ID_KEY, candidate);
    const registry = pruneLiveTabs(readLiveTabs(local), now);
    if (registry[candidate] !== undefined) {
      candidate = crypto.randomUUID();
      session?.setItem(TAB_ID_KEY, candidate);
    }
    registry[candidate] = now;
    local.setItem(LIVE_TABS_KEY, JSON.stringify(registry));
    return candidate;
  } catch {
    return getTabId(session);
  }
}

export function heartbeatTab(
  local: Storage | null | undefined,
  tabId: string,
  now: number = Date.now(),
): void {
  if (!local) return;
  try {
    const registry = pruneLiveTabs(readLiveTabs(local), now);
    registry[tabId] = now;
    local.setItem(LIVE_TABS_KEY, JSON.stringify(registry));
  } catch {
    // A heartbeat failure should not interrupt writing.
  }
}

export function releaseTab(
  local: Storage | null | undefined,
  tabId: string,
): void {
  if (!local) return;
  try {
    const registry = readLiveTabs(local);
    delete registry[tabId];
    local.setItem(LIVE_TABS_KEY, JSON.stringify(registry));
  } catch {
    // A release failure should not interrupt navigation.
  }
}

let pageTabId: string | null = null;
let pageTabLocal: Storage | null = null;
let pageTabHeartbeat: ReturnType<typeof setInterval> | null = null;
let pageTabRelease: (() => void) | null = null;

export function ensureTabIdentity(env: {
  sessionStorage: Storage | null;
  localStorage: Storage | null;
}): string {
  if (pageTabId) return pageTabId;
  pageTabId = claimTabId(env.sessionStorage, env.localStorage);
  pageTabLocal = env.localStorage;
  if (typeof window !== "undefined") {
    pageTabHeartbeat = setInterval(
      () => heartbeatTab(pageTabLocal, pageTabId!),
      TAB_HEARTBEAT_MS,
    );
    pageTabRelease = () => releaseTab(pageTabLocal, pageTabId!);
    window.addEventListener("pagehide", pageTabRelease);
  }
  return pageTabId;
}

export function resetTabIdentityForTests(): void {
  if (pageTabHeartbeat) clearInterval(pageTabHeartbeat);
  if (pageTabRelease && typeof window !== "undefined")
    window.removeEventListener("pagehide", pageTabRelease);
  if (pageTabId) releaseTab(pageTabLocal, pageTabId);
  pageTabId = null;
  pageTabLocal = null;
  pageTabHeartbeat = null;
  pageTabRelease = null;
}

export async function restoreForeignDraft(
  backend: DraftBackend,
  recovered: DraftRecord,
  target: { key: string; tabId: string },
): Promise<"moved" | "copied" | "failed"> {
  try {
    const moved = await backend.transfer(
      {
        ...recovered,
        key: target.key,
        tabId: target.tabId,
        updatedAt: Date.now(),
      },
      { key: recovered.key, updatedAt: recovered.updatedAt },
    );
    return moved ? "moved" : "copied";
  } catch {
    return "failed";
  }
}

export async function discardForeignDraft(
  backend: DraftBackend,
  recovered: DraftRecord,
): Promise<boolean> {
  return backend.removeIf(recovered.key, recovered.updatedAt);
}

export function markDraftsCleared(
  local: Storage | null | undefined,
  tenantId: string,
  now: number = Date.now(),
): void {
  if (!local) return;
  try {
    local.setItem(DRAFTS_CLEARED_KEY, JSON.stringify({ tenantId, at: now }));
  } catch {
    // Sign-out still succeeds if local storage is unavailable.
  }
}

export function draftsClearedSince(
  local: Storage | null | undefined,
  tenantId: string,
  since: number,
): boolean {
  if (!local) return false;
  try {
    const parsed: unknown = JSON.parse(
      local.getItem(DRAFTS_CLEARED_KEY) ?? "null",
    );
    if (!parsed || typeof parsed !== "object") return false;
    const value = parsed as Record<string, unknown>;
    return (
      value.tenantId === tenantId &&
      typeof value.at === "number" &&
      Number.isFinite(value.at) &&
      value.at >= since
    );
  } catch {
    return false;
  }
}

export function broadcastDraftsCleared(tenantId: string): void {
  try {
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent(DRAFTS_CLEARED_EVENT, { detail: { tenantId } }),
      );
  } catch {
    // Broadcast is best effort; the local tombstone remains authoritative.
  }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(DRAFTS_CHANNEL);
      channel.postMessage({ type: "cleared", tenantId });
      channel.close();
    }
  } catch {
    // Broadcast is best effort; the local tombstone remains authoritative.
  }
}

export function subscribeDraftsCleared(
  tenantId: string,
  handler: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onWindowEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ tenantId?: string }>).detail;
    if (!detail || !detail.tenantId || detail.tenantId === tenantId)
      handler();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DRAFTS_CLEARED_KEY || !event.newValue) return;
    try {
      const value: unknown = JSON.parse(event.newValue);
      if (
        value &&
        typeof value === "object" &&
        (value as Record<string, unknown>).tenantId === tenantId
      )
        handler();
    } catch {
      // Ignore malformed tombstones.
    }
  };
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(DRAFTS_CHANNEL)
      : null;
  const onMessage = (event: MessageEvent) => {
    if (
      event.data?.type === "cleared" &&
      event.data.tenantId === tenantId
    )
      handler();
  };
  window.addEventListener(DRAFTS_CLEARED_EVENT, onWindowEvent);
  window.addEventListener("storage", onStorage);
  channel?.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener(DRAFTS_CLEARED_EVENT, onWindowEvent);
    window.removeEventListener("storage", onStorage);
    channel?.removeEventListener("message", onMessage);
    channel?.close();
  };
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
