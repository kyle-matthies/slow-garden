"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReturnCabinet,
  makeClippingResolver,
  type BloomResponseKind,
  type CabinetBloom,
  type CabinetPass,
  type CabinetResponse,
  type ResolvedClipping,
} from "../returns-cabinet";
import { buildContinuation } from "../returns-continue";
import { MorningReturn } from "../morning-return";
import { useSeenTending } from "@/lib/garden/use-seen-tending";
import { syntheticGarden, syntheticTending } from "../meadow-preview/fixtures";
import { EntryEditor } from "../entry-editor";
import { queueContinuation } from "@/lib/garden/continuation";
import {
  fixtureBlooms,
  fixtureGarden,
  fixturePasses,
  fixtureResponses,
  fixtureRevisionIndex,
  fixtureScenes,
} from "../returns-fixtures";

export function ReturnsPreview() {
  const scene = useSearchParams().get("scene") ?? "all";
  const current =
    fixtureScenes.find((s) => s.slug === scene) ??
    fixtureScenes.find((s) => s.slug === "all")!;
  const [passes, setPasses] = useState<CabinetPass[]>(fixturePasses);
  const [responses, setResponses] =
    useState<CabinetResponse[]>(fixtureResponses);
  const [editor, setEditor] = useState<{ seedId: string; generation: number } | null>(null);
  const [note, setNote] = useState("");
  const heading = useRef<HTMLHeadingElement | null>(null);
  const resolveClipping = useMemo(
    () => makeClippingResolver(fixtureGarden, fixtureRevisionIndex),
    [],
  );
  const shown = passes.filter((p) => current.passIds.includes(p.id));

  function respond(
    bloomId: string,
    response: BloomResponseKind,
    correction: string,
  ) {
    setResponses((prior) => [
      {
        id: crypto.randomUUID(),
        bloom_id: bloomId,
        response,
        correction: response === "correct" ? correction : null,
        created_at: new Date().toISOString(),
      },
      ...prior,
    ]);
  }
  function cancel(passId: string) {
    setPasses((prior) =>
      prior.map((p) =>
        p.id === passId
          ? { ...p, status: "cancelled", finished_at: new Date().toISOString() }
          : p,
      ),
    );
  }
  // Same handoff as the live container: queue the quoted clipping, then
  // (re)mount the real new-entry editor for that thought so it appends the
  // continuation to whatever draft is already waiting.
  function continueThought(bloom: CabinetBloom, clipping: ResolvedClipping) {
    const seedId = clipping.source.seed_id;
    if (!seedId || !clipping.source.writable) return;
    let storage: Storage | null = null;
    try {
      storage = sessionStorage;
    } catch {
      storage = null;
    }
    const stored = queueContinuation(
      storage,
      fixtureGarden.tenantId,
      seedId,
      buildContinuation(bloom, clipping),
    );
    setNote(
      stored
        ? "A new entry is waiting with the clipping quoted. The rest is yours."
        : "This browser cannot hold a draft; copy the clipping by hand.",
    );
    if (!stored) return;
    setEditor((prior) => ({ seedId, generation: (prior?.generation ?? 0) + 1 }));
  }
  useEffect(() => {
    if (!editor) return;
    // The editor keeps its textarea disabled until the draft has hydrated.
    let tries = 0;
    const id = setInterval(() => {
      const area = document.getElementById("writing-new");
      if (area instanceof HTMLTextAreaElement && !area.disabled) {
        area.focus();
        clearInterval(id);
      } else if (++tries > 20) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [editor]);
  const editorSeed = fixtureGarden.seeds.find((s) => s.id === editor?.seedId);

  return (
    <main className="garden-shell" style={{ padding: "24px" }}>
      <h1 className="cabinet-kicker" style={{ color: "var(--tend)", margin: "0 0 1em" }}>
        Development fixture preview · synthetic data only · never served in
        production
      </h1>
      <nav aria-label="Fixture scenes">
        <ul className="action-row" style={{ listStyle: "none", padding: 0 }}>
          {fixtureScenes.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/garden/returns-preview?scene=${s.slug}`}
                className={s.slug === current.slug ? "primary-button" : "secondary-button"}
                aria-current={s.slug === current.slug ? "page" : undefined}
                style={{ minHeight: 36, padding: "0 14px", fontSize: "0.9rem" }}
              >
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p>{current.description}</p>
      {current.slug === "morning" && <MorningPreview />}
      <section
        className="return-cabinet"
        aria-labelledby="preview-cabinet"
        hidden={current.slug === "morning"}
      >
        <ReturnCabinet
          headingId="preview-cabinet"
          headingRef={heading}
          passes={shown}
          blooms={fixtureBlooms}
          responses={responses}
          resolveClipping={resolveClipping}
          onRespond={respond}
          onCancel={cancel}
          onContinue={continueThought}
        >
          <p className="cabinet-note">
            Responses and cancellations here change only this page. Entry links
            point at the fixture garden and will not resolve.
          </p>
        </ReturnCabinet>
      </section>
      <section aria-labelledby="preview-continuation">
        <h2 id="preview-continuation">
          Continue this thought · the real new-entry editor
          {editorSeed ? ` for “${editorSeed.title}”` : ""}
        </h2>
        {note && <p role="status">{note}</p>}
        {editor && editorSeed ? (
          <>
            <p className="cabinet-note">
              This is the workspace editor bound to the fixture thought. Drafts
              persist in this browser; saving cannot succeed here because there
              is no garden behind the fixtures.
            </p>
            <EntryEditor
              key={`${editor.seedId}:${editor.generation}`}
              tenantId={fixtureGarden.tenantId}
              seedId={editor.seedId}
              onSaved={() => setNote("Saved (unexpected in the fixture preview).")}
            />
          </>
        ) : (
          <p>(choose “Continue this thought” on any clipping whose thought can be continued)</p>
        )}
      </section>
    </main>
  );
}

/** Synthetic garden and tending only; receipts live in this browser. */
function MorningPreview() {
  const garden = useMemo(() => syntheticGarden(3, 12), []);
  const source = useMemo(() => syntheticTending(garden, "full"), [garden]);
  const { tending, markBloomsSeen } = useSeenTending("returns-preview", source);
  const [note, setNote] = useState("");
  return (
    <section aria-label="Morning return preview" style={{ padding: "12px 0 32px" }}>
      <MorningReturn
        tending={tending}
        onSeen={markBloomsSeen}
        seeds={garden.seeds}
        plots={garden.plots}
        onOpenThought={(id) =>
          setNote(
            `Would open the thought “${garden.seeds.find((s) => s.id === id)?.title ?? id}”.`,
          )
        }
        onOpenReturns={() => setNote("Would open Returns.")}
      />
      <p role="status" className="cabinet-note" style={{ textAlign: "center" }}>
        {note}
      </p>
      <p style={{ textAlign: "center" }}>
        <button
          type="button"
          className="plain-button"
          style={{ minHeight: 44 }}
          onClick={() => {
            try {
              for (const key of Object.keys(window.localStorage))
                if (key.startsWith("slow-garden:seen-blooms:"))
                  window.localStorage.removeItem(key);
            } catch {
              // Nothing to clear when storage is blocked.
            }
            window.dispatchEvent(new Event("slow-garden:blooms-seen"));
            setNote("");
          }}
        >
          Fixture only · show the reveal again
        </button>
      </p>
    </section>
  );
}
