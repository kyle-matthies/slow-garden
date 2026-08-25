import { useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  Cross2Icon,
  LayersIcon,
  MixIcon,
  Pencil2Icon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { BottomSheet, KeyboardTextarea, MobileScroll, useKeyboard } from "./mobile";

type View = "meadow" | "cabinet";
type Response = "kept" | "corrected" | "pruned" | null;

const sources = [
  { date: "May 11", kind: "Journal", revision: "v1", excerpt: "Leave room before naming the solution." },
  { date: "May 12", kind: "Journal", revision: "v2", excerpt: "What changes once this becomes a roadmap?" },
  { date: "May 13", kind: "Conversation", revision: "v3", excerpt: "The form should not interrupt the idea." },
];

function GardenHeader({ view, onView }: { view: View; onView: (view: View) => void }) {
  return (
    <header className="garden-header">
      <div className="wordmark-row">
        <MixIcon className="wordmark-mark" aria-hidden="true" />
        <h1>Slow Garden</h1>
      </div>
      <p>Next tending <span aria-hidden="true">·</span> Sunday</p>
      <div className="mode-switch" role="tablist" aria-label="Garden view">
        {(["meadow", "cabinet"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={view === mode}
            className={view === mode ? "is-active" : ""}
            onClick={() => onView(mode)}
          >
            {mode === "meadow" ? "Meadow" : "Cabinet"}
          </button>
        ))}
      </div>
    </header>
  );
}

function Meadow({ onCabinet, onPlant, plantedSeed }: { onCabinet: () => void; onPlant: () => void; plantedSeed: string }) {
  return (
    <div className="meadow-screen" data-testid="meadow-screen">
      <GardenHeader view="meadow" onView={(view) => view === "cabinet" && onCabinet()} />

      <section className="meadow-stage" aria-label="Garden neighborhood">
        <button className="distant-flower distant-flower-left" type="button" aria-label="Possible question, one source" />
        <button className="distant-flower distant-flower-right" type="button" aria-label="Possible tension, two sources" />

        <article className="selected-bloom" aria-labelledby="selected-bloom-title">
          <span className="eyebrow"><MixIcon aria-hidden="true" /> Selected bloom</span>
          <h2 id="selected-bloom-title">The work gets clearer when I leave it alone</h2>
          <div className="source-count"><LayersIcon aria-hidden="true" /> 3 source revisions</div>
          <button type="button" className="review-button" onClick={onCabinet}>
            <MixIcon aria-hidden="true" /> Review clipping
          </button>
        </article>

        <div className="seed-marker seed-one"><span>May 11</span><small>Journal</small></div>
        <div className="seed-marker seed-two"><span>May 12</span><small>Journal</small></div>
        <div className="seed-marker seed-three"><span>May 13</span><small>Conversation</small></div>

        {plantedSeed && (
          <div className="new-seed" role="status">
            <span>Just planted</span>
            <p>{plantedSeed}</p>
          </div>
        )}

        <button type="button" className="plant-button" onClick={onPlant} aria-label="Plant a seed">
          <span><PlusIcon aria-hidden="true" /></span>
          Plant a seed
        </button>
      </section>
    </div>
  );
}

function Cabinet({ onMeadow, response, onRespond }: { onMeadow: () => void; response: Response; onRespond: (response: Exclude<Response, null>) => void }) {
  const responseCopy = useMemo(() => {
    if (response === "kept") return "Kept in your garden";
    if (response === "corrected") return "Correction noted for the next tending";
    if (response === "pruned") return "Pruned without changing your source notes";
    return null;
  }, [response]);

  return (
    <div className="cabinet-screen" data-testid="cabinet-screen">
      <GardenHeader view="cabinet" onView={(view) => view === "meadow" && onMeadow()} />

      <main className="cabinet-content">
        <div className="cabinet-board">
          <article className="specimen-card" aria-labelledby="cabinet-title">
            <span className="eyebrow"><MixIcon aria-hidden="true" /> Selected bloom</span>
            <h2 id="cabinet-title">The work gets clearer when I leave it alone</h2>
            <img src="/assets/slow-garden/pressed-cosmos.png" alt="Pressed white cosmos specimen" draggable="false" />
            <div className="specimen-meta"><i>Cosmos bipinnatus</i><span>Collected · May</span></div>
          </article>

          <section className="source-section" aria-labelledby="source-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Evidence</span>
                <h3 id="source-heading">Source clippings</h3>
              </div>
              <span className="source-pill"><LayersIcon aria-hidden="true" /> 3</span>
            </div>

            <div className="source-stack">
              {sources.map((source) => (
                <article className="source-card" key={source.date}>
                  <span className="source-label">Source seed</span>
                  <p className="source-date">{source.date} <span aria-hidden="true">·</span> {source.kind}</p>
                  <blockquote>{source.excerpt}</blockquote>
                  <footer><span>{source.revision}</span><span>{source.date}</span></footer>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className="meaning-card" aria-label="Connection and uncertainty">
          <div>
            <MixIcon aria-hidden="true" />
            <p><strong>Connection · 3 sources</strong><span>This thought echoes across time.</span></p>
          </div>
          <div>
            <LayersIcon aria-hidden="true" />
            <p><strong>Uncertainty</strong><span>A pattern to consider, not a conclusion.</span></p>
          </div>
        </section>

        <section className="response-area" aria-label="Respond to this bloom">
          <div className="response-buttons">
            <button type="button" className={response === "kept" ? "selected keep" : "keep"} onClick={() => onRespond("kept")}><CheckIcon aria-hidden="true" />Keep</button>
            <button type="button" className={response === "corrected" ? "selected correct" : "correct"} onClick={() => onRespond("corrected")}><Pencil2Icon aria-hidden="true" />Correct</button>
            <button type="button" className={response === "pruned" ? "selected prune" : "prune"} onClick={() => onRespond("pruned")}><Cross2Icon aria-hidden="true" />Prune</button>
          </div>
          {responseCopy && <p className="response-receipt" role="status">{responseCopy}</p>}
          <button type="button" className="return-button" onClick={onMeadow}><ArrowLeftIcon aria-hidden="true" /> Return to meadow</button>
        </section>
      </main>
    </div>
  );
}

export default function Prototype() {
  const keyboard = useKeyboard();
  const [view, setView] = useState<View>("meadow");
  const [plantOpen, setPlantOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [plantedSeed, setPlantedSeed] = useState("");
  const [response, setResponse] = useState<Response>(null);

  const plant = () => {
    const nextSeed = draft.trim();
    if (!nextSeed) return;
    keyboard.hide();
    setPlantedSeed(nextSeed);
    setDraft("");
    setPlantOpen(false);
  };

  return (
    <>
      <MobileScroll className={`app-screen ${view === "meadow" ? "meadow-scroll" : "cabinet-scroll"}`}>
        {view === "meadow" ? (
          <Meadow onCabinet={() => setView("cabinet")} onPlant={() => setPlantOpen(true)} plantedSeed={plantedSeed} />
        ) : (
          <Cabinet onMeadow={() => setView("meadow")} response={response} onRespond={setResponse} />
        )}
      </MobileScroll>

      <BottomSheet
        open={plantOpen}
        onOpenChange={setPlantOpen}
        title="Plant a seed"
        description="Leave it unfinished. The garden can hold the thought without answering it."
        snap={0.62}
      >
        <div className="plant-sheet">
          <label htmlFor="seed-draft">What are you noticing?</label>
          <KeyboardTextarea
            id="seed-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="A fragment, question, or observation…"
            rows={5}
            autoFocus
          />
          <button type="button" onClick={plant} disabled={!draft.trim()}><PlusIcon aria-hidden="true" /> Plant quietly</button>
        </div>
      </BottomSheet>
    </>
  );
}
