"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { Entry } from "@/lib/garden/types";
import { saveEntry } from "./actions";
import {
  draftKey,
  describeDraftTime,
  getTabId,
  isDirtyDraft,
  LEGACY_DRAFT_STORAGE_PREFIX,
  openDraftStore,
  readLegacySessionDraft,
  type DraftBackend,
  type DraftRecord,
} from "@/lib/garden/drafts";
import "./entry-editor.css";

type Draft = {
  body: string;
  entryId: string;
  revisionId: string;
  expectedRevisionId: string | null;
};

export function EntryEditor({
  tenantId,
  seedId,
  entry,
  onSaved,
  quietPage = false,
  onQuietPageChange,
}: {
  tenantId: string;
  seedId: string;
  entry?: Entry;
  onSaved: (entryId: string) => void;
  quietPage?: boolean;
  onQuietPageChange?: (quiet: boolean) => void;
}) {
  const key = draftKey(tenantId, seedId, entry?.entry_id);
  const baseBody = entry?.body ?? "";
  const [draft, setDraft] = useState<Draft>({
    body: baseBody,
    entryId: entry?.entry_id ?? "",
    revisionId: "",
    expectedRevisionId: entry?.revision_id ?? null,
  });
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [storageKind, setStorageKind] = useState<
    "indexeddb" | "sessionstorage" | "none"
  >("none");
  const [recovered, setRecovered] = useState<DraftRecord | null>(null);
  const [isMac, setIsMac] = useState(false);
  const backendRef = useRef<DraftBackend | null>(null);
  const pendingRecordRef = useRef<DraftRecord | null>(null);
  const writePromiseRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const tabIdRef = useRef("");

  function freshDraft(): Draft {
    return {
      body: baseBody,
      entryId: entry?.entry_id ?? crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      expectedRevisionId: entry?.revision_id ?? null,
    };
  }

  function persist(record: DraftRecord): Promise<void> {
    const backend = backendRef.current;
    if (!backend) return Promise.resolve();
    const write = backend
      .put(record)
      .catch(() => {
        setStorageKind("none");
      })
      .finally(() => {
        if (writePromiseRef.current === write) writePromiseRef.current = null;
      });
    writePromiseRef.current = write;
    return write;
  }

  async function flushPending(): Promise<void> {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const record = pendingRecordRef.current;
    pendingRecordRef.current = null;
    if (record) {
      await persist(record);
    } else if (writePromiseRef.current) {
      await writePromiseRef.current;
    }
  }

  function queuePersist(next: Draft): void {
    const backend = backendRef.current;
    if (!backend || storageKind === "none") return;
    const record: DraftRecord = {
      key,
      tenantId,
      seedId,
      entryId: next.entryId,
      scope: entry ? "revise" : "new",
      body: next.body,
      revisionId: next.revisionId,
      expectedRevisionId: next.expectedRevisionId,
      baseBody,
      updatedAt: Date.now(),
      tabId: tabIdRef.current,
    };
    pendingRecordRef.current = record;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingRecordRef.current = null;
      void persist(record);
    }, 300);
  }

  // Browser draft hydration is intentionally a one-time external-store synchronization.
  useEffect(() => {
    let cancelled = false;
    window.addEventListener("pagehide", flushPending);
    async function loadDraft() {
      let storage: Storage | null = null;
      try {
        storage = sessionStorage;
      } catch {
        storage = null;
      }
      tabIdRef.current = getTabId(storage);
      const initial = freshDraft();
      try {
        const backend = await openDraftStore({
          indexedDB: typeof indexedDB === "undefined" ? null : indexedDB,
          sessionStorage: storage,
        });
        if (cancelled) return;
        backendRef.current = backend;
        setStorageKind(backend?.kind ?? "none");
        let saved = backend ? await backend.get(key) : null;
        const legacy = readLegacySessionDraft(
          storage,
          tenantId,
          seedId,
          entry?.entry_id,
        );
        if (!saved && legacy && backend) {
          saved = {
            key,
            tenantId,
            seedId,
            entryId: legacy.entryId,
            scope: entry ? "revise" : "new",
            body: legacy.body,
            revisionId: legacy.revisionId,
            expectedRevisionId: legacy.expectedRevisionId,
            baseBody,
            updatedAt: Date.now(),
            tabId: tabIdRef.current,
          };
          await backend.put(saved);
          try {
            storage?.removeItem(
              `${LEGACY_DRAFT_STORAGE_PREFIX}${tenantId}:${seedId}:${entry?.entry_id ?? "new"}`,
            );
          } catch {
            // A successful migration should not prevent the editor loading.
          }
        }
        const dirty = !!saved && isDirtyDraft(saved);
        if (saved && !dirty && backend) await backend.remove(key);
        if (saved && dirty && saved.tabId !== tabIdRef.current)
          setRecovered(saved);
        setDraft(
          saved && dirty && saved.tabId === tabIdRef.current
            ? {
                body: saved.body,
                entryId: saved.entryId,
                revisionId: saved.revisionId,
                expectedRevisionId: saved.expectedRevisionId,
              }
            : initial,
        );
      } catch {
        if (!cancelled) setStorageKind("none");
        if (!cancelled) setDraft(initial);
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void loadDraft();
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", flushPending);
      void flushPending();
    };
  // The editor is keyed by entry and hydrates browser storage once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setIsMac(navigator.platform.includes("Mac"));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (ready && draft.body !== baseBody) event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [baseBody, draft.body, ready]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft.body]);

  function change(body: string): void {
    const next = { ...draft, body, revisionId: crypto.randomUUID() };
    setDraft(next);
    setStatus("Not saved yet");
    queuePersist(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey) &&
      !pending &&
      draft.body.trim()
    ) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pending || !draft.body.trim()) return;
    await flushPending();
    setPending(true);
    setStatus("Saving…");
    try {
      const result = await saveEntry({ seedId, ...draft });
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      const backend = backendRef.current;
      if (backend) {
        try {
          await backend.remove(key);
        } catch {
          setStorageKind("none");
        }
      }
      setStatus("Saved");
      if (!entry) setDraft(freshDraft());
      onSaved(draft.entryId);
    } catch {
      setStatus(
        "Connection interrupted. Your draft is still here. Retry when connected.",
      );
    } finally {
      setPending(false);
    }
  }

  async function restore(): Promise<void> {
    if (!recovered) return;
    setDraft({
      body: recovered.body,
      entryId: recovered.entryId,
      revisionId: recovered.revisionId,
      expectedRevisionId: recovered.expectedRevisionId,
    });
    setRecovered(null);
    void persist({ ...recovered, tabId: tabIdRef.current });
  }

  async function discard(): Promise<void> {
    const backend = backendRef.current;
    if (backend) {
      try {
        await backend.remove(key);
      } catch {
        setStorageKind("none");
      }
    }
    setDraft(freshDraft());
    setRecovered(null);
  }

  const stale =
    recovered &&
    entry &&
    recovered.expectedRevisionId !== (entry.revision_id ?? null);
  return (
    <form ref={formRef} className="writing-form" onSubmit={submit}>
      <label
        className="panel-kicker"
        htmlFor={`writing-${entry?.entry_id ?? "new"}`}
      >
        {entry ? "Revise this entry" : "New entry"}
      </label>
      {recovered && (
        <div className="draft-notice" role="status">
          <span>
            Unsaved draft from {describeDraftTime(recovered.updatedAt)}.
            {stale &&
              " This entry has changed since; saving will be rejected until you revise the current version."}
          </span>
          <button type="button" className="plain-button" onClick={restore}>
            Restore draft
          </button>
          <button type="button" className="plain-button" onClick={discard}>
            Discard draft
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="writing-textarea"
        id={`writing-${entry?.entry_id ?? "new"}`}
        aria-label={entry ? "Revise entry" : "New entry"}
        placeholder="A thought, a question, something you’re not ready to name…"
        value={draft.body}
        onChange={(event) => change(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!ready || pending}
        maxLength={20000}
        required
      />
      <div className="writing-footer">
        <button
          className="primary-button"
          disabled={!ready || pending || !draft.body.trim()}
        >
          {pending ? "Saving…" : entry ? "Save revision" : "Save entry"}
        </button>
        <span role="status" aria-live="polite">
          {status}
        </span>
        <span className="writing-shortcut">
          <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>+<kbd>Enter</kbd> saves
        </span>
        {onQuietPageChange && (
          <button
            type="button"
            className="plain-button"
            aria-pressed={quietPage}
            onClick={() => onQuietPageChange(!quietPage)}
          >
            {quietPage ? "Show garden rail" : "Quiet page"}
          </button>
        )}
      </div>
      <p className="form-note">
        {storageKind === "indexeddb"
          ? "Unsaved writing is kept privately in this browser until you save or discard it. AI stays outside your writing."
          : storageKind === "sessionstorage"
            ? "Unsaved writing stays in this tab until saved. AI stays outside your writing."
            : "This browser cannot retain drafts. Keep this page open until saved. AI stays outside your writing."}
      </p>
    </form>
  );
}
