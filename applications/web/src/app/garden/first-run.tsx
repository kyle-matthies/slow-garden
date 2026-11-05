"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createArea, saveEntry } from "./actions";
import { draftsClearedSince, ensureTabIdentity, openDraftStore, subscribeDraftsCleared, type DraftBackend } from "@/lib/garden/drafts";
import { emptyOnboardingDraft, loadOnboardingDraft, onboardingRecord, type OnboardingDraft } from "@/lib/garden/onboarding-draft";
import "./first-run.css";

type FirstRunLocation = {
  gardenId: string;
  topicId: string;
  thoughtId: string;
  entryId?: string;
};

const starterNames = ["Reading", "Work", "Questions"];
const stepLabels = ["Garden", "Topic", "Thought", "Write"];

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
  const { step, gardenId, topicId, thoughtId, gardenName, topicName, thoughtTitle, body, starters } = draft;
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

  function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy.current || invalidated.current) return false;
    busy.current = true;
    setPending(true);
    setError("");
    return true;
  }

  function end() { busy.current = false; setPending(false); }

  useEffect(() => {
    if (ready) root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("form input:not([type=checkbox]), form textarea")?.focus();
  }, [ready, step]);

  useEffect(() => {
    if (!tenantId || !body) return;
    const protect = (event: BeforeUnloadEvent) => {
      if (finished.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [tenantId, body]);

  async function submitGarden(event: FormEvent<HTMLFormElement>) {
    if (!begin(event)) return;
    const next = updateDraft({ gardenRequestId: current.current.gardenRequestId || crypto.randomUUID() });
    await queue.current;
    if (invalidated.current) { end(); return; }
    try {
      const result = await createArea(
        "garden",
        gardenName,
        "",
        next.gardenRequestId,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      updateDraft({ gardenId: result.id!, step: 2 });
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      end();
    }
  }

  async function submitTopic(event: FormEvent<HTMLFormElement>) {
    if (!begin(event)) return;
    const ids = { ...current.current.starterIds };
    for (const name of starters) ids[name] ??= crypto.randomUUID();
    const next = updateDraft({ topicRequestId: current.current.topicRequestId || crypto.randomUUID(), starterIds: ids });
    await queue.current;
    if (invalidated.current) { end(); return; }
    try {
      const result = await createArea(
        "plot",
        topicName,
        gardenId,
        next.topicRequestId,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const namedTopicId = result.id!;
      updateDraft({ topicId: namedTopicId });
      const typedTopic = topicName.trim().toLowerCase();
      for (const starterName of starterNames) {
        if (
          !starters.includes(starterName) ||
          starterName.toLowerCase() === typedTopic
        )
          continue;
        const starterResult = await createArea(
          "plot",
          starterName,
          gardenId,
          next.starterIds[starterName],
        );
        if (!starterResult.ok) {
          setError(starterResult.message);
          return;
        }
      }
      updateDraft({ step: 3 });
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      end();
    }
  }

  async function submitThought(event: FormEvent<HTMLFormElement>) {
    if (!begin(event)) return;
    const next = updateDraft({ thoughtRequestId: current.current.thoughtRequestId || crypto.randomUUID() });
    await queue.current;
    if (invalidated.current) { end(); return; }
    try {
      const result = await createArea(
        "seed",
        thoughtTitle,
        topicId,
        next.thoughtRequestId,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      updateDraft({ thoughtId: result.id!, step: 4 });
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      end();
    }
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    if (!begin(event)) return;
    const next = updateDraft({ entryId: current.current.entryId || crypto.randomUUID(), revisionId: current.current.revisionId || crypto.randomUUID() });
    await queue.current;
    if (invalidated.current) { end(); return; }
    try {
      const result = await saveEntry({
        seedId: thoughtId,
        entryId: next.entryId,
        revisionId: next.revisionId,
        body,
        expectedRevisionId: null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await finish({ gardenId, topicId, thoughtId, entryId: next.entryId });
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      end();
    }
  }

  function writeLater() {
    if (
      body &&
      !window.confirm(
        "Leave without saving this entry? Your writing here will be lost.",
      )
    )
      return;
    void finish({ gardenId, topicId, thoughtId });
  }

  return (
    <section ref={root} className="first-run" aria-labelledby="first-run-title">
      <p className="panel-kicker">First visit</p>
      <h1 id="first-run-title">A place for what’s on your mind.</h1>
      <p>
        A garden holds topics. A topic groups related thoughts. A thought
        collects dated entries, written whenever you return.
      </p>
      <p className="first-run-step" aria-live="polite">
        Step {step} of 4 · {stepLabels[step - 1]}
      </p>
      <p className="first-run-backup" role="status">
        {!ready ? "Checking for unfinished setup…" : recovered ? `Your unfinished setup has been recovered. ${storageNote}` : storageNote}
      </p>

      {step === 1 && (
        <form className="first-run-form" onSubmit={submitGarden} key="garden">
          <div className="field">
            <label htmlFor="first-run-garden">Name your garden</label>
            <p>A separate space. One is plenty to begin.</p>
            <input
              id="first-run-garden"
              value={gardenName}
              onChange={(event) => updateDraft({ gardenName: event.target.value, gardenRequestId: "" })}
              maxLength={120}
              required
              autoFocus
              disabled={disabled}
            />
          </div>
          <button className="primary-button" disabled={disabled}>
            {pending ? "Saving…" : "Continue"}
          </button>
          <p role="status">{error}</p>
          <p className="form-note">
            Private by default. AI stays outside your writing.
          </p>
        </form>
      )}

      {step === 2 && (
        <form className="first-run-form" onSubmit={submitTopic} key="topic">
          <div className="field">
            <label htmlFor="first-run-topic">Name a first topic</label>
            <p>
              Topics group related thoughts — e.g. Work, Reading, Questions.
            </p>
            <input
              id="first-run-topic"
              value={topicName}
              onChange={(event) => updateDraft({ topicName: event.target.value, topicRequestId: "" })}
              maxLength={120}
              required
              autoFocus
              disabled={disabled}
            />
          </div>
          <fieldset className="first-run-starters" disabled={disabled}>
            <legend>Add a few starter topics too? Optional.</legend>
            {starterNames.map((starterName) => (
              <label key={starterName}>
                <input
                  type="checkbox"
                  checked={starters.includes(starterName)}
                  onChange={(event) =>
                    updateDraft({ starters: event.target.checked
                      ? [...starters, starterName]
                      : starters.filter((name) => name !== starterName) })
                  }
                />
                {starterName}
              </label>
            ))}
          </fieldset>
          <button className="primary-button" disabled={disabled}>
            {pending ? "Saving…" : "Continue"}
          </button>
          <p role="status">{error}</p>
          <p className="form-note">
            Private by default. AI stays outside your writing.
          </p>
        </form>
      )}

      {step === 3 && (
        <form className="first-run-form" onSubmit={submitThought} key="thought">
          <div className="field">
            <label htmlFor="first-run-thought">Name a first thought</label>
            <p>
              A thought is a named thread you can return to. A question works
              well.
            </p>
            <input
              id="first-run-thought"
              value={thoughtTitle}
              onChange={(event) => updateDraft({ thoughtTitle: event.target.value, thoughtRequestId: "" })}
              maxLength={160}
              required
              autoFocus
              disabled={disabled}
            />
          </div>
          <button className="primary-button" disabled={disabled}>
            {pending ? "Saving…" : "Continue"}
          </button>
          <p role="status">{error}</p>
          <p className="form-note">
            Private by default. AI stays outside your writing.
          </p>
        </form>
      )}

      {step === 4 && (
        <form className="first-run-form" onSubmit={submitEntry} key="write">
          <div className="field">
            <label htmlFor="first-run-writing">Write a first entry</label>
            <textarea
              id="first-run-writing"
              className="first-run-writing"
              value={body}
              onChange={(event) => updateDraft({ body: event.target.value, revisionId: crypto.randomUUID() })}
              maxLength={20000}
              required
              autoFocus
              placeholder="A thought, a question, something you’re not ready to name…"
              disabled={disabled}
            />
            <p>Dated and private. You can revise it later.</p>
          </div>
          <div className="action-row">
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
          <p role="status">{error}</p>
          <p className="form-note">
            Private by default. AI stays outside your writing.
          </p>
        </form>
      )}
    </section>
  );
}
