"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createArea, saveEntry } from "./actions";
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
  const [step, setStep] = useState(1);
  const [gardenId, setGardenId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [thoughtId, setThoughtId] = useState("");
  const [gardenName, setGardenName] = useState("");
  const [topicName, setTopicName] = useState("");
  const [thoughtTitle, setThoughtTitle] = useState("");
  const [body, setBody] = useState("");
  const [starters, setStarters] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const gardenRequestId = useRef<string | null>(null);
  const topicRequestId = useRef<string | null>(null);
  const thoughtRequestId = useRef<string | null>(null);
  const starterIds = useRef<Record<string, string>>({});
  const entryId = useRef<string | null>(null);
  const revisionId = useRef<string | null>(null);

  useEffect(() => {
    if (!tenantId || !body) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [tenantId, body]);

  async function submitGarden(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    gardenRequestId.current ??= crypto.randomUUID();
    try {
      const result = await createArea(
        "garden",
        gardenName,
        "",
        gardenRequestId.current,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setGardenId(result.id!);
      setStep(2);
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      setPending(false);
    }
  }

  async function submitTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    topicRequestId.current ??= crypto.randomUUID();
    try {
      const result = await createArea(
        "plot",
        topicName,
        gardenId,
        topicRequestId.current,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const namedTopicId = result.id!;
      setTopicId(namedTopicId);
      const typedTopic = topicName.trim().toLowerCase();
      for (const starterName of starterNames) {
        if (
          !starters.includes(starterName) ||
          starterName.toLowerCase() === typedTopic
        )
          continue;
        starterIds.current[starterName] ??= crypto.randomUUID();
        const starterResult = await createArea(
          "plot",
          starterName,
          gardenId,
          starterIds.current[starterName],
        );
        if (!starterResult.ok) {
          setError(starterResult.message);
          return;
        }
      }
      setStep(3);
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      setPending(false);
    }
  }

  async function submitThought(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    thoughtRequestId.current ??= crypto.randomUUID();
    try {
      const result = await createArea(
        "seed",
        thoughtTitle,
        topicId,
        thoughtRequestId.current,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setThoughtId(result.id!);
      setStep(4);
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      setPending(false);
    }
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    entryId.current ??= crypto.randomUUID();
    revisionId.current ??= crypto.randomUUID();
    try {
      const result = await saveEntry({
        seedId: thoughtId,
        entryId: entryId.current,
        revisionId: revisionId.current,
        body,
        expectedRevisionId: null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone({ gardenId, topicId, thoughtId, entryId: entryId.current });
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      setPending(false);
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
    onDone({ gardenId, topicId, thoughtId });
  }

  return (
    <section className="first-run" aria-labelledby="first-run-title">
      <p className="panel-kicker">First visit</p>
      <h1 id="first-run-title">A place for what’s on your mind.</h1>
      <p>
        A garden holds topics. A topic groups related thoughts. A thought
        collects dated entries, written whenever you return.
      </p>
      <p className="first-run-step" aria-live="polite">
        Step {step} of 4 · {stepLabels[step - 1]}
      </p>

      {step === 1 && (
        <form className="first-run-form" onSubmit={submitGarden} key="garden">
          <div className="field">
            <label htmlFor="first-run-garden">Name your garden</label>
            <p>A separate space. One is plenty to begin.</p>
            <input
              id="first-run-garden"
              value={gardenName}
              onChange={(event) => {
                setGardenName(event.target.value);
                gardenRequestId.current = null;
              }}
              maxLength={120}
              required
              autoFocus
              disabled={pending}
            />
          </div>
          <button className="primary-button" disabled={pending}>
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
              onChange={(event) => {
                setTopicName(event.target.value);
                topicRequestId.current = null;
              }}
              maxLength={120}
              required
              autoFocus
              disabled={pending}
            />
          </div>
          <fieldset className="first-run-starters" disabled={pending}>
            <legend>Add a few starter topics too? Optional.</legend>
            {starterNames.map((starterName) => (
              <label key={starterName}>
                <input
                  type="checkbox"
                  checked={starters.includes(starterName)}
                  onChange={(event) =>
                    setStarters((current) =>
                      event.target.checked
                        ? [...current, starterName]
                        : current.filter((name) => name !== starterName),
                    )
                  }
                />
                {starterName}
              </label>
            ))}
          </fieldset>
          <button className="primary-button" disabled={pending}>
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
              onChange={(event) => {
                setThoughtTitle(event.target.value);
                thoughtRequestId.current = null;
              }}
              maxLength={160}
              required
              autoFocus
              disabled={pending}
            />
          </div>
          <button className="primary-button" disabled={pending}>
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
              onChange={(event) => {
                setBody(event.target.value);
                revisionId.current = crypto.randomUUID();
              }}
              maxLength={20000}
              required
              autoFocus
              placeholder="A thought, a question, something you’re not ready to name…"
              disabled={pending}
            />
            <p>Dated and private. You can revise it later.</p>
          </div>
          <div className="action-row">
            <button className="primary-button" disabled={pending}>
              {pending ? "Saving…" : "Save entry"}
            </button>
            <button
              type="button"
              className="plain-button"
              onClick={writeLater}
              disabled={pending}
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
