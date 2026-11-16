"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createArea, saveEntry } from "./actions";
import { draftsClearedSince, ensureTabIdentity, openDraftStore, subscribeDraftsCleared, type DraftBackend } from "@/lib/garden/drafts";
import { BACKGROUND_THOUGHT_TITLE, DEFAULT_GARDEN_NAME, DEFAULT_TOPIC_NAME, emptyOnboardingDraft, loadOnboardingDraft, onboardingRecord, titleFromFirstLine, type OnboardingDraft } from "@/lib/garden/onboarding-draft";
import { bedKeyFor, seedTopicFor, type SeedPack } from "./seed-pack-data";
import { SeedPackShelf } from "./seed-pack-shelf";
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

/** The whole method in three lines; the third is the only AI-returned thing here. */
function MethodGlyph({ step }: { step: "write" | "night" | "bloom" }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      {step === "write" && (
        <>
          <path d="M5 19.5c2.4-.4 3.6-1 4.6-2L19 8.1a1.9 1.9 0 0 0-2.7-2.7L6.9 14.8c-1 1-1.5 2.3-1.9 4.7z" />
          <path d="M14.6 7.2l2.7 2.7" />
        </>
      )}
      {step === "night" && (
        <>
          <path d="M18.5 14.2A7.2 7.2 0 0 1 9.3 5a7.4 7.4 0 1 0 9.200 9.200z" />
          <path d="M16.5 4.5v2.600M15.200 5.800h2.600" />
        </>
      )}
      {step === "bloom" && (
        <>
          <path d="M12 21.500v-9" />
          <path d="M12 18c-2.400 0-3.900-1.200-4.500-3.100 2.400-.2 3.900.9 4.500 3.100z" />
          <path d="M12 3.200a2.300 2.300 0 0 1 2.200 3 2.300 2.300 0 0 1 2.100 3.900A2.300 2.300 0 0 1 12 12a2.300 2.300 0 0 1-4.300-1.900 2.300 2.300 0 0 1 2.100-3.900 2.300 2.300 0 0 1 2.200-3z" />
          <circle cx="12" cy="8" r="1.400" />
        </>
      )}
    </svg>
  );
}

const method = [
  { key: "write", name: "Write", gloss: "A page whenever you have one. Nothing interrupts you." },
  { key: "night", name: "Leave it overnight", gloss: "With tending on, the topics you allow are read while you sleep." },
  { key: "bloom", name: "Wake to a bloom", gloss: "At most three, each quoting your own words. Some mornings, none." },
] as const;

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
  const { gardenId, topicId, thoughtId, gardenName, topicName, thoughtTitle, body, packs, beds, writeIn, background } = draft;
  const current = useRef(draft);
  const [ready, setReady] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [storageNote, setStorageNote] = useState("");
  const [recovered, setRecovered] = useState(false);
  const [tendingOpen, setTendingOpen] = useState(false);
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
          if (saved.state.background) setTendingOpen(true);
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
    // On touch screens the page waits to be tapped, so a keyboard does not
    // cover the seed packs before the person has seen them.
    let fine = true;
    try { fine = window.matchMedia?.("(pointer: fine)").matches ?? true; } catch {}
    if (ready && fine) root.current?.querySelector<HTMLTextAreaElement>(".first-run-writing")?.focus();
  }, [ready]);

  useEffect(() => {
    if (!tenantId || (!body && !background)) return;
    const protect = (event: BeforeUnloadEvent) => {
      if (finished.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [tenantId, body, background]);

  function togglePack(pack: SeedPack) {
    const d = current.current;
    if (d.packs.includes(pack.id)) {
      // Closing a packet puts back every topic that has not been saved yet.
      const keep = d.beds.filter((b) => !b.key.startsWith(`${pack.id}/`) || b.id);
      if (keep.some((b) => b.key.startsWith(`${pack.id}/`))) return;
      const dropsPage = !keep.some((b) => b.key === d.writeIn);
      updateDraft({
        packs: d.packs.filter((id) => id !== pack.id),
        beds: keep,
        ...(d.writeIn && dropsPage ? clearedQuestion(d) : {}),
      });
      return;
    }
    updateDraft({
      packs: [...d.packs, pack.id],
      beds: [...d.beds, ...pack.topics.map((topic, index) => ({
        key: bedKeyFor(pack.id, index), name: topic.name, on: true, requestId: "", id: "",
      }))],
    });
  }

  /** Taking a question off the page also takes its title, unless the person rewrote it. */
  function clearedQuestion(d: OnboardingDraft): Partial<OnboardingDraft> {
    const asked = seedTopicFor(d.writeIn)?.topic.question;
    return { writeIn: "", ...(asked && d.thoughtTitle === asked && !d.thoughtId ? { thoughtTitle: "", thoughtRequestId: "" } : {}) };
  }

  function toggleBed(key: string) {
    const d = current.current;
    const bed = d.beds.find((b) => b.key === key);
    if (!bed || bed.id) return;
    updateDraft({
      beds: d.beds.map((b) => b.key === key ? { ...b, on: !b.on } : b),
      ...(bed.on && d.writeIn === key ? clearedQuestion(d) : {}),
    });
  }

  /**
   * The question heads the page as the thought's title. It is never written
   * into the entry: the body stays exactly what the person types.
   */
  function startFrom(key: string, question: string) {
    const d = current.current;
    if (d.thoughtId) return;
    if (d.writeIn === key) { updateDraft(clearedQuestion(d)); return; }
    updateDraft({ writeIn: key, thoughtTitle: question, thoughtRequestId: "" });
    const page = root.current?.querySelector<HTMLTextAreaElement>(".first-run-writing");
    page?.focus({ preventScroll: true });
    let still = false;
    try { still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch {}
    root.current?.querySelector(".first-run-sheet")?.scrollIntoView?.({ block: "nearest", behavior: still ? "auto" : "smooth" });
  }

  /**
   * Save whatever is still missing, in order. Every id is persisted before its
   * request, so a failure or reload replays the same idempotent calls.
   */
  async function plant(upTo: "topic" | "entry") {
    let d = current.current;
    const page = upTo === "entry" ? d.beds.find((b) => b.on && b.key === d.writeIn) : undefined;
    const tending = d.background.trim();
    const ownName = d.topicName.trim() ? d.topicName : DEFAULT_TOPIC_NAME;
    const ownIsNotes = ownName.trim().toLowerCase() === DEFAULT_TOPIC_NAME.toLowerCase();
    // The person's own topic exists when the page (or the background) lives
    // there, or when no seed-pack topic was kept: a garden never starts empty.
    const needOwn = !!d.topicId || (upTo === "entry" && !page) || !d.beds.some((b) => b.on) || (!!tending && ownIsNotes);
    const needNotes = !!tending && !ownIsNotes;
    const fresh = () => crypto.randomUUID();
    d = updateDraft({
      gardenRequestId: d.gardenRequestId || fresh(),
      topicName: ownName,
      ...(needOwn ? { topicRequestId: d.topicRequestId || fresh() } : {}),
      beds: d.beds.map((b) => b.on && !b.requestId ? { ...b, requestId: fresh() } : b),
      ...(needNotes ? { notesRequestId: d.notesRequestId || fresh() } : {}),
      ...(upTo === "entry" ? {
        thoughtRequestId: d.thoughtRequestId || fresh(),
        thoughtTitle: d.thoughtTitle.trim() ? d.thoughtTitle : titleFromFirstLine(d.body),
        entryId: d.entryId || fresh(),
        revisionId: d.revisionId || fresh(),
      } : {}),
      ...(tending ? {
        tendingRequestId: d.tendingRequestId || fresh(),
        tendingEntryId: d.tendingEntryId || fresh(),
        tendingRevisionId: d.tendingRevisionId || fresh(),
      } : {}),
    });
    await queue.current;
    if (invalidated.current) return;
    const fail = (message?: string) => { setError(message ?? "Could not save. Please retry."); };
    if (!d.gardenId) {
      const result = await createArea("garden", d.gardenName, "", d.gardenRequestId);
      if (!result.ok) return fail(result.message);
      d = updateDraft({ gardenId: result.id!, step: 2 });
    }
    if (needOwn && !d.topicId) {
      const result = await createArea("plot", d.topicName, d.gardenId, d.topicRequestId);
      if (!result.ok) return fail(result.message);
      d = updateDraft({ topicId: result.id!, step: 3 });
    }
    for (const bed of d.beds) {
      if (!bed.on || bed.id) continue;
      const result = await createArea("plot", bed.name, d.gardenId, bed.requestId);
      if (!result.ok) return fail(result.message);
      d = updateDraft({ beds: d.beds.map((b) => b.key === bed.key ? { ...b, id: result.id! } : b), step: Math.max(d.step, 3) });
    }
    if (needNotes && !d.notesId) {
      const result = await createArea("plot", DEFAULT_TOPIC_NAME, d.gardenId, d.notesRequestId);
      if (!result.ok) return fail(result.message);
      d = updateDraft({ notesId: result.id!, step: Math.max(d.step, 3) });
    }
    const pageTopicId = page ? d.beds.find((b) => b.key === page.key)!.id : d.topicId;
    if (upTo === "entry") {
      if (!d.thoughtId) {
        const result = await createArea("seed", d.thoughtTitle, pageTopicId, d.thoughtRequestId);
        if (!result.ok) return fail(result.message);
        d = updateDraft({ thoughtId: result.id!, step: 4 });
      }
      if (!d.entrySaved) {
        const result = await saveEntry({
          seedId: d.thoughtId,
          entryId: d.entryId,
          revisionId: d.revisionId,
          body: d.body,
          expectedRevisionId: null,
        });
        if (!result.ok) return fail(result.message);
        d = updateDraft({ entrySaved: true });
      }
    }
    if (tending) {
      // The background is the person's own writing: an ordinary thought with
      // an ordinary dated page. Nothing reads it here and nothing is generated.
      if (!d.tendingThoughtId) {
        const result = await createArea("seed", BACKGROUND_THOUGHT_TITLE, ownIsNotes ? d.topicId : d.notesId, d.tendingRequestId);
        if (!result.ok) return fail(result.message);
        d = updateDraft({ tendingThoughtId: result.id! });
      }
      const result = await saveEntry({
        seedId: d.tendingThoughtId,
        entryId: d.tendingEntryId,
        revisionId: d.tendingRevisionId,
        body: d.background,
        expectedRevisionId: null,
      });
      if (!result.ok) return fail(result.message);
    }
    if (upTo === "entry") {
      await finish({ gardenId: d.gardenId, topicId: pageTopicId, thoughtId: d.thoughtId, entryId: d.entryId });
      return;
    }
    const landing = d.topicId || d.beds.find((b) => b.id)?.id || d.notesId;
    await finish({ gardenId: d.gardenId, topicId: landing, thoughtId: d.thoughtId });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    if (!begin(event)) return;
    try {
      // With nothing written, the one button plants what was chosen instead.
      await plant(current.current.body.trim() ? "entry" : "topic");
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
  const keptBeds = beds.filter((b) => b.on);
  const pageBed = keptBeds.find((b) => b.key === writeIn);
  const anyTopicSaved = !!topicId || !!draft.notesId || beds.some((b) => b.id);
  const saved = completed ? 4 : thoughtId ? 3 : anyTopicSaved ? 2 : gardenId ? 1 : 0;
  const derivedTitle = thoughtTitle.trim() || (body.trim() ? titleFromFirstLine(body) : "");
  const ownTopic = topicName.trim() || DEFAULT_TOPIC_NAME;
  const others = keptBeds.length - (pageBed ? 1 : 0);
  const values = {
    garden: gardenName.trim() || DEFAULT_GARDEN_NAME,
    topic: `${pageBed ? pageBed.name : ownTopic}${others ? ` + ${others} more` : ""}`,
    thought: derivedTitle || "named after your first line",
    entry: "today, in your words",
  };
  // One button. With nothing written but something chosen, it plants that.
  const plantsOnly = !body.trim() && (keptBeds.length > 0 || !!background.trim());
  const progress = !pending
    ? ""
    : saved === 0 ? "Planting your garden…"
    : saved === 1 ? "Garden saved. Making its topics…"
    : saved === 2 ? (plantsOnly ? "Topics saved. Finishing…" : "Topics saved. Starting the thought…")
    : "Thought saved. Keeping your entry…";

  return (
    <section ref={root} className="first-run" aria-labelledby="first-run-title">
      <div className="first-run-intro">
        <div className="first-run-head">
          <p className="panel-kicker">First visit</p>
          <h1 id="first-run-title">Begin with one thought.</h1>
          <p className="first-run-lede">
            A blank page is enough. Write it the way it is; nothing interrupts
            you here, and nothing rewrites it later.
          </p>
          <button
            type="button"
            className="plain-button first-run-jump"
            onClick={() => {
              const shelf = root.current?.querySelector<HTMLElement>(".seed-packs h2");
              let still = false;
              try { still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch {}
              shelf?.focus({ preventScroll: true });
              shelf?.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
            }}
          >
            Or start from a seed pack ↓
          </button>
        </div>

        <ol className="first-run-method" aria-label="How Slow Garden works">
          {method.map((step) => (
            <li key={step.key} data-step={step.key}>
              <MethodGlyph step={step.key} />
              <span>
                <strong>{step.name}</strong>
                <small>{step.gloss}</small>
              </span>
            </li>
          ))}
        </ol>

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

      <form className="first-run-sheet" onSubmit={submit} aria-label="Plant your own">
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
          {pageBed && (
            <div className="first-run-prompt">
              <p id="first-run-prompt-text">
                <span className="first-run-prompt-bed">In {pageBed.name}</span>
                <span className="first-run-prompt-title">{thoughtTitle.trim() || "Untitled"}</span>
              </p>
              <button
                type="button"
                className="plain-button"
                onClick={() => updateDraft(clearedQuestion(current.current))}
                disabled={disabled || !!thoughtId}
                aria-label="Remove this question and write in a blank page"
              >
                Remove
              </button>
            </div>
          )}
          <textarea
            id="first-run-writing"
            className="first-run-writing"
            value={body}
            onChange={(event) => updateDraft({ body: event.target.value, revisionId: crypto.randomUUID() })}
            maxLength={20000}
            required={!plantsOnly}
            aria-describedby={pageBed ? "first-run-prompt-text" : undefined}
            placeholder={pageBed ? "The question is only a title. Start anywhere…" : "A thought, a question, something unfinished…"}
            disabled={disabled || draft.entrySaved}
          />
        </div>

        <div className="action-row first-run-actions">
          <button className="primary-button" disabled={disabled}>
            {pending ? "Saving…" : plantsOnly ? "Start my garden" : "Save entry"}
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
        {keptBeds.length > 0 && (
          <p className="first-run-plan">
            {body.trim() ? "Also plants " : "Plants "}
            {keptBeds.length === 1 ? "one topic" : `${keptBeds.length} topics`} from your seed packs
            {body.trim() ? `; this page goes in ${pageBed ? pageBed.name : ownTopic}.` : ". Anything you write here is saved with them."}
          </p>
        )}

        <details className="first-run-more first-run-tending" open={tendingOpen} onToggle={(event) => setTendingOpen(event.currentTarget.open)}>
          <summary>
            Tell the garden what you’re tending lately <span className="first-run-optional">optional</span>
          </summary>
          <div className="field">
            <label htmlFor="first-run-background">What you’re tending lately</label>
            <textarea
              id="first-run-background"
              value={background}
              onChange={(event) => updateDraft({ background: event.target.value, tendingRevisionId: crypto.randomUUID() })}
              maxLength={20000}
              rows={3}
              placeholder="Work, people, projects, questions: whatever has your attention."
              disabled={disabled}
              aria-describedby="first-run-background-note"
            />
          </div>
          <p id="first-run-background-note">
            This is your own writing. It is saved as a thought titled
            “{BACKGROUND_THOUGHT_TITLE}” in a Notes topic, where you can read,
            edit or archive it like any other. Nothing is generated from it
            today. Overnight tending, when it is switched on, reads only topics
            you set to “Tending on”; Notes starts with tending off, like every
            topic.
          </p>
        </details>

        <details className="first-run-more">
          <summary>Change the topic or title</summary>
          <div className="first-run-more-fields">
            <div className="field">
              <label htmlFor="first-run-topic">Topic</label>
              <input
                id="first-run-topic"
                value={pageBed ? pageBed.name : topicName}
                onChange={(event) => updateDraft({ topicName: event.target.value, topicRequestId: "" })}
                maxLength={120}
                disabled={disabled || !!topicId || !!pageBed}
                aria-describedby={pageBed ? "first-run-topic-note" : undefined}
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
          <p id="first-run-topic-note">
            {pageBed
              ? "This page sits in the seed-pack topic you chose. Remove the question to use your own topic."
              : "You can add more topics and thoughts once you’re inside."}
          </p>
        </details>

        <p className="first-run-backup" role="status">
          {!ready ? "Checking for unfinished setup…" : recovered ? `Your unfinished setup has been recovered. ${storageNote}` : storageNote}
        </p>
        <p className="form-note">
          Private to your account. Dated when you save it; you can revise it later.
        </p>
      </form>

      <SeedPackShelf
        packs={packs}
        beds={beds}
        writeIn={pageBed ? writeIn : ""}
        disabled={disabled}
        pageLocked={!!thoughtId}
        onTogglePack={togglePack}
        onToggleBed={toggleBed}
        onStart={startFrom}
      />
    </section>
  );
}
