"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
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
    fixtureScenes.find((s) => s.slug === scene) ?? fixtureScenes[0];
  const [passes, setPasses] = useState<CabinetPass[]>(fixturePasses);
  const [responses, setResponses] =
    useState<CabinetResponse[]>(fixtureResponses);
  const [continuation, setContinuation] = useState("");
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
  function continueThought(bloom: CabinetBloom, clipping: ResolvedClipping) {
    setContinuation(buildContinuation(bloom, clipping));
  }

  return (
    <main className="garden-shell" style={{ padding: "24px" }}>
      <p className="cabinet-kicker" style={{ color: "#b9563f" }}>
        Development fixture preview · synthetic data only · never served in
        production
      </p>
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
      <section className="return-cabinet" aria-labelledby="preview-cabinet">
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
        <h2 id="preview-continuation">Continue this thought · draft that would be pre-filled</h2>
        <pre
          className="entry-body"
          style={{ border: "1px solid #d2d8c7", padding: 16, minHeight: 80 }}
        >
          {continuation || "(choose “Continue this thought” on any clipping)"}
        </pre>
      </section>
    </main>
  );
}
