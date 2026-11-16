"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createArea, saveEntry } from "./actions";
import { draftsClearedSince, ensureTabIdentity, openDraftStore, subscribeDraftsCleared, type DraftBackend } from "@/lib/garden/drafts";
import { DEFAULT_GARDEN_NAME, DEFAULT_TOPIC_NAME, emptyOnboardingDraft, loadOnboardingDraft, onboardingRecord, titleFromFirstLine, type OnboardingDraft } from "@/lib/garden/onboarding-draft";
import "./first-run.css";

type FirstRunLocation = {
  gardenId: string;
  topicId: string;
  thoughtId: string;
  entryId?: string;
};

/** Growth drawn in four small stages: seed, sprout, leaf, bud. */
function Sprout({ stage }: { stage: 0 | 1 | 2 | 3 }) {
  return (
    <svg viewBox="0 0 28 34" width="28" height="34" aria-hidden="true" focusable="false">
      <path className="sprout-soil" d="M2 29.5c5-1.6 19-1.6 24 0" />
      {stage === 0 && <ellipse className="sprout-fill" cx="14" cy="26" rx="3.4" ry="2.3" />}
      {stage >= 1 && <path className="sprout-stem" d={stage === 1 ? "M14 29V21" : stage === 2 ? "M14 29V15" : "M14 29V10"} />}
      {stage >= 1 && <path className="sprout-fill" d={stage === 1 ? "M14 22c0-4 3-6 6-6 0 4-3 6-6 6z" : "M14 22c0-4 3.4-6.4 7.4-6.4 0 4.4-3.4 6.4-7.4 6.4z"} />}
      {stage >= 2 && <path className="sprout-fill" d="M14 19c0-4-3.4-6.4-7.4-6.4 0 4.4 3.4 6.4 7.4 6.4z" />}
      {stage === 3 && <path className="sprout-fill" d="M14 11c-2.6-2-2.6-5.6 0-8 2.6 2.4 2.6 6 0 8z" />}
    </svg>
  );
}

const levels = [
  { key: "garden", name: "Garden", gloss: "a place of your own" },
  { key: "topic", name: "Topic", gloss: "a bed of related thoughts" },
  { key: "thought", name: "Thought", gloss: "a thread you return to" },
  { key: "entry", name: "Entry", gloss: "one dated page of writing" },
] as const;

export function FirstRun({
  tenantId,
  onDone,
}: {
  tenantId: string;
  onDone: (location: FirstRunLocation) => void;
}) {
  return <FirstRunSession key={tenantId} tenantId={tenantId} onDone={onDone} />;
}

function FirstRunSession({ tenantId, onDone }: {
  tenantId: string;
  onDone: (location: FirstRunLocation) => void;
}) {
  const [draft, setDraft] = useState(emptyOnboardingDraft);
  const { gardenId, topicId, thoughtId, gardenName, topicName, thoughtTitle, body } = draft;
  const current = useRef(draft);
  const [ready, setReady] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [storageNote, setStorageNote] = useState("");
  const [recovered, setRecovered] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const backend = useRef<DraftBackend | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const tab = useRef("");
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const invalidated = useRef(false);
  const busy = useRef(false);
  const finished = useRef(false);
  const startedAt = useRef(0);
  const disabled = pending || !ready || signedOut || completed;

  function localStorageOrNull() {
    try { return window.localStorage; } catch { return null; }
  }

  useEffect(() => {
    let cancelled = false;
    startedAt.current = Date.now();
    const unsubscribe = subscribeDraftsCleared(tenantId, () => {
      invalidated.current = true;
      setSignedOut(true);
      current.current = emptyOnboardingDraft();
      setDraft(current.current);
      setStorageNote("Signed out. This browser’s unfinished setup was cleared.");
    });
    void (async () => {
      try {
        let session: Storage | null = null;
        let local: Storage | null = null;
        try { session = window.sessionStorage; } catch {}
        try { local = window.localStorage; } catch {}
        tab.current = ensureTabIdentity({ sessionStorage: session, localStorage: local });
        const store = await openDraftStore();
        const saved = await loadOnboardingDraft(tenantId, store, true, tab.current);
        if (cancelled || invalidated.current || draftsClearedSince(local, tenantId, startedAt.current)) return;
        backend.current = store;
        if (saved) {
          current.current = saved.state;
          setDraft(saved.state);
          setRecovered(true);
        }
        setStorageNote(store
          ? store.kind === "indexeddb" ? "Unfinished setup is backed up in this browser until you finish or sign out." : "Unfinished setup is backed up in this tab until you finish or sign out."
          : "Draft backup is unavailable. Keep this page open until you save your entry.");
      } catch {
        // Never overwrite an existing checkpoint after a failed recovery read.
        backend.current = null;
        setStorageNote("Draft backup could not be opened. Keep this page open until you save your entry.");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; unsubscribe(); };
  }, [tenantId]);

  function persist(next: OnboardingDraft) {
    const record = onboardingRecord(tenantId, tab.current, next);
    const work = queue.current.then(async () => {
      if (!backend.current || invalidated.current || finished.current || draftsClearedSince(localStorageOrNull(), tenantId, startedAt.current)) return;
      await backend.current.put(record);
      if (invalidated.current || draftsClearedSince(localStorageOrNull(), tenantId, startedAt.current)) {
        await backend.current.removeIf(record.key, record.updatedAt);
        return;
      }
    }).catch(() => {
      setStorageNote("Draft backup is unavailable. Keep this page open until you save your entry.");
    });
    queue.current = work;
    return work;
  }

  function updateDraft(patch: Partial<OnboardingDraft>) {
    const next = { ...current.current, ...patch };
    current.current = next;
    setDraft(next);
    void persist(next);
    return next;
  }

  async function finish(location: FirstRunLocation) {
    // Drain queued writes before marking completion. Recovered foreign records
    // are copies: another tab's checkpoint is never deleted or hidden.
    // Keep a content-free completion marker in the ordinary draft backend so
    // an older tab's checkpoint cannot reopen setup on the next visit.
    await persist({ ...emptyOnboardingDraft(), completed: true });
    finished.current = true;
    setCompleted(true);
    if (!invalidated.current) onDone(location);
  }

  function begin(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!ready || busy.current || invalidated.current) return false;
    busy.current = true;
    setPending(true);
    setError("");
    return true;
  }

  function end() { busy.current = false; setPending(false); }

  useEffect(() => {
    // The shortest path to a first word: the page is ready to be written on.
    if (ready) root.current?.querySelector<HTMLTextAreaElement>("form textarea")?.focus();
  }, [ready]);

  useEffect(() => {
    if (!tenantId || !body) return;
    const protect = (event: BeforeUnloadEvent) => {
      if (finished.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [tenantId, body]);

  /**
   * Save whatever is still missing, in order. Every id is persisted before its
   * request, so a failure or reload replays the same idempotent calls.
   */
  async function plant(upTo: "topic" | "entry") {
    let d = current.current;
    d = updateDraft({
      gardenRequestId: d.gardenRequestId || crypto.randomUUID(),
      topicRequestId: d.topicRequestId || crypto.randomUUID(),
      topicName: d.topicName.trim() ? d.topicName : DEFAULT_TOPIC_NAME,
      ...(upTo === "entry" ? {
        thoughtRequestId: d.thoughtRequestId || crypto.randomUUID(),
        thoughtTitle: d.thoughtTitle.trim() ? d.thoughtTitle : titleFromFirstLine(d.body),
        entryId: d.entryId || crypto.randomUUID(),
        revisionId: d.revisionId || crypto.randomUUID(),
      } : {}),
    });
    await queue.current;
    if (invalidated.current) return;
    if (!d.gardenId) {
      const result = await createArea("garden", d.gardenName, "", d.gardenRequestId);
      if (!result.ok) { setError(result.message); return; }
      d = updateDraft({ gardenId: result.id!, step: 2 });
    }
    if (!d.topicId) {
      const result = await createArea("plot", d.topicName, d.gardenId, d.topicRequestId);
      if (!result.ok) { setError(result.message); return; }
      d = updateDraft({ topicId: result.id!, step: 3 });
    }
    if (upTo === "topic") {
      await finish({ gardenId: d.gardenId, topicId: d.topicId, thoughtId: d.thoughtId });
      return;
    }
    if (!d.thoughtId) {
      const result = await createArea("seed", d.thoughtTitle, d.topicId, d.thoughtRequestId);
      if (!result.ok) { setError(result.message); return; }
      d = updateDraft({ thoughtId: result.id!, step: 4 });
    }
    const result = await saveEntry({
      seedId: d.thoughtId,
      entryId: d.entryId,
      revisionId: d.revisionId,
      body: d.body,
      expectedRevisionId: null,
    });
    if (!result.ok) { setError(result.message); return; }
    await finish({ gardenId: d.gardenId, topicId: d.topicId, thoughtId: d.thoughtId, entryId: d.entryId });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    if (!begin(event)) return;
    try {
      await plant("entry");
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      end();
    }
  }

  async function writeLater() {
    if (
      body &&
      !window.confirm(
        "Leave without saving this entry? Your writing here will be lost.",
      )
    )
      return;
    if (!begin()) return;
    try {
      await plant("topic");
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      end();
    }
  }

  // Seed, sprout, leaf, bud: one stage for each thing safely saved.
  const saved = completed ? 4 : thoughtId ? 3 : topicId ? 2 : gardenId ? 1 : 0;
  const derivedTitle = thoughtTitle.trim() || (body.trim() ? titleFromFirstLine(body) : "");
  const values = {
    garden: gardenName.trim() || DEFAULT_GARDEN_NAME,
    topic: topicName.trim() || DEFAULT_TOPIC_NAME,
    thought: derivedTitle || "named after your first line",
    entry: "today, in your words",
  };
  const progress = !pending
    ? ""
    : saved === 0 ? "Planting your garden…"
    : saved === 1 ? "Garden saved. Making its first topic…"
    : saved === 2 ? "Topic saved. Starting the thought…"
    : "Thought saved. Keeping your entry…";

  return (
    <section ref={root} className="first-run" aria-labelledby="first-run-title">
      <div className="first-run-intro">
        <p className="panel-kicker">First visit</p>
        <h1 id="first-run-title">Begin with one thought.</h1>
        <p className="first-run-lede">
          Write it the way it is: unfinished is fine. Nothing interrupts you
          here, and nothing rewrites it later.
        </p>

        <figure className="first-run-model" aria-labelledby="first-run-model-title">
          <figcaption id="first-run-model-title">Where your words will live</figcaption>
          <ol>
            {levels.map((level, index) => (
              <li key={level.key} data-level={level.key} data-saved={index < saved || undefined}>
                <Sprout stage={index as 0 | 1 | 2 | 3} />
                <span className="first-run-level">
                  <strong>{level.name}</strong>
                  <span className="first-run-level-value">{values[level.key]}</span>
                  <small>{level.gloss}</small>
                </span>
              </li>
            ))}
          </ol>
        </figure>
      </div>

      <form className="first-run-sheet" onSubmit={submit}>
        <div className="first-run-garden-name">
          <label htmlFor="first-run-garden">Name your garden</label>
          <input
            id="first-run-garden"
            value={gardenName}
            onChange={(event) => updateDraft({ gardenName: event.target.value, gardenRequestId: "" })}
            maxLength={120}
            required
            disabled={disabled || !!gardenId}
          />
        </div>

        <div className="first-run-page">
          <label htmlFor="first-run-writing">Write a first entry</label>
          <textarea
            id="first-run-writing"
            className="first-run-writing"
            value={body}
            onChange={(event) => updateDraft({ body: event.target.value, revisionId: crypto.randomUUID() })}
            maxLength={20000}
            required
            placeholder="A thought, a question, something unfinished…"
            disabled={disabled}
          />
        </div>

        <details className="first-run-more">
          <summary>Change the topic or title</summary>
          <div className="first-run-more-fields">
            <div className="field">
              <label htmlFor="first-run-topic">Topic</label>
              <input
                id="first-run-topic"
                value={topicName}
                onChange={(event) => updateDraft({ topicName: event.target.value, topicRequestId: "" })}
                maxLength={120}
                disabled={disabled || !!topicId}
              />
            </div>
            <div className="field">
              <label htmlFor="first-run-thought">Thought title</label>
              <input
                id="first-run-thought"
                value={thoughtTitle}
                onChange={(event) => updateDraft({ thoughtTitle: event.target.value, thoughtRequestId: "" })}
                maxLength={160}
                placeholder="Left blank, your first line becomes the title"
                disabled={disabled || !!thoughtId}
              />
            </div>
          </div>
          <p>You can add more topics and thoughts once you’re inside.</p>
        </details>

        <div className="action-row first-run-actions">
          <button className="primary-button" disabled={disabled}>
            {pending ? "Saving…" : "Save entry"}
          </button>
          <button
            type="button"
            className="plain-button"
            onClick={writeLater}
            disabled={disabled}
          >
            Write later
          </button>
        </div>
        <p className="first-run-status" role="status">{error || progress}</p>
        <p className="first-run-backup" role="status">
          {!ready ? "Checking for unfinished setup…" : recovered ? `Your unfinished setup has been recovered. ${storageNote}` : storageNote}
        </p>
        <p className="form-note">
          Private to your account. Dated when you save it; you can revise it later.
        </p>
      </form>
    </section>
  );
}
