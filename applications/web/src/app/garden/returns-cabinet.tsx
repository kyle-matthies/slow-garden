"use client";
import Link from "next/link";
import { useId, useState, type ReactNode, type RefObject } from "react";
import { isThoughtWritable } from "@/lib/garden/writable";
import type { GardenData } from "@/lib/garden/types";
import { PressedSpecimen } from "./scene/pressed-specimen";
import "./returns.css";
import "./cabinet-board.css";

export type PassStatus =
  "queued" | "processing" | "complete" | "failed" | "cancelled" | "withdrawn";
export type BloomKind =
  "connection" | "tension" | "change" | "question" | "echo" | "pattern";
export type BloomResponseKind = "keep" | "correct" | "prune";

export type CabinetPass = {
  id: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  no_output_reason: string | null;
  plot_ids: string[];
};
export type CabinetBloom = {
  id: string;
  pass_id: string;
  kind: string;
  ordinal: number;
  interpretation: string;
  evidence: unknown;
  created_at: string;
};
export type CabinetResponse = {
  id: string;
  bloom_id: string;
  response: string;
  correction: string | null;
  created_at: string;
};
export type Clipping = { revision_id: string; excerpt: string };
/** Where a clipping's source revision stands today, relative to the person's current entries. */
export type ClippingSource = {
  state: "current" | "superseded" | "archived" | "unknown";
  entry_id: string | null;
  seed_id: string | null;
  revision_number: number | null;
  created_at: string | null;
  href: string | null;
  /** True when the owning thought, topic, and garden can still take a new entry. */
  writable: boolean;
};
export type ResolvedClipping = Clipping & { source: ClippingSource };

export type RevisionLocation = {
  entry_id: string;
  seed_id: string;
  revision_number: number;
  created_at: string;
};
/**
 * Resolves each clipping's revision against the person's current entries first,
 * then against located superseded revisions, and builds its exact entry anchor.
 */
export function makeClippingResolver(
  data: Pick<
    GardenData,
    "gardenId" | "gardens" | "plots" | "seeds" | "entries"
  >,
  located: Record<string, RevisionLocation>,
): (clipping: Clipping) => ClippingSource {
  const href = (seedId: string, entryId: string, archived: boolean) => {
    const seed = data.seeds.find((s) => s.id === seedId);
    if (!seed) return null;
    const query = new URLSearchParams({
      garden: data.gardenId,
      topic: seed.plot_id,
      thought: seedId,
    });
    if (archived) query.set("view", "archive");
    return `/garden?${query}#entry-${entryId}`;
  };
  return (clipping) => {
    const current = data.entries.find(
      (e) => e.revision_id === clipping.revision_id,
    );
    if (current)
      return {
        state: current.archived_at ? "archived" : "current",
        entry_id: current.entry_id,
        seed_id: current.seed_id,
        revision_number: current.revision_number,
        created_at: current.created_at,
        href: href(current.seed_id, current.entry_id, !!current.archived_at),
        writable: isThoughtWritable(data, current.seed_id),
      };
    const old = located[clipping.revision_id];
    if (old) {
      const entry = data.entries.find((e) => e.entry_id === old.entry_id);
      return {
        state: entry?.archived_at ? "archived" : "superseded",
        entry_id: old.entry_id,
        seed_id: old.seed_id,
        revision_number: old.revision_number,
        created_at: old.created_at,
        href: href(old.seed_id, old.entry_id, !!entry?.archived_at),
        writable: isThoughtWritable(data, old.seed_id),
      };
    }
    return {
      state: "unknown",
      entry_id: null,
      seed_id: null,
      revision_number: null,
      created_at: null,
      href: null,
      writable: false,
    };
  };
}

export const KIND_LABELS: Record<BloomKind, string> = {
  connection: "Possible connection",
  tension: "Possible tension",
  change: "Possible change",
  question: "Open question",
  echo: "Possible echo",
  pattern: "Possible pattern",
};
export function kindLabel(kind: string): string {
  return kind in KIND_LABELS
    ? KIND_LABELS[kind as BloomKind]
    : "AI interpretation";
}
export function parseEvidence(evidence: unknown): Clipping[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.filter(
    (e): e is Clipping =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as Clipping).revision_id === "string" &&
      typeof (e as Clipping).excerpt === "string",
  );
}
export const PASS_LABELS: Record<PassStatus, string> = {
  queued: "Waiting",
  processing: "Tending",
  complete: "Returned",
  failed: "Did not return",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
};
export function passLabel(status: string): string {
  return status in PASS_LABELS ? PASS_LABELS[status as PassStatus] : status;
}
export function bloomFreshness(
  clippings: ResolvedClipping[],
): "current" | "historical" {
  return clippings.length > 0 &&
    clippings.every((c) => c.source.state === "current")
    ? "current"
    : "historical";
}
export function formatDate(value: string | null): string {
  if (!value) return "";
  const t = Date.parse(value);
  return Number.isNaN(t)
    ? value
    : new Date(t).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
export function formatMorning(value: string | null): string {
  if (!value) return "";
  const t = Date.parse(value);
  return Number.isNaN(t)
    ? value
    : new Date(t).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
}

/**
 * One drawn glyph per bloom kind, so a kind is recognisable by shape as well as
 * by its written label. Decorative: the label beside it always names the kind.
 */
export function KindGlyph({ kind }: { kind: string }) {
  return (
    <svg
      className="kind-glyph"
      data-kind={kind}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "connection" ? (
        <>
          <circle cx="6" cy="16.5" r="3" />
          <circle cx="18" cy="7.5" r="3" />
          <path d="M8.4 14.7 15.6 9.3" />
        </>
      ) : kind === "tension" ? (
        <>
          <path d="M10 12H3.5M6.5 8.5 3 12l3.5 3.5" />
          <path d="M14 12h6.5M17.5 8.5 21 12l-3.5 3.5" />
          <path d="M12 9.5v5" strokeDasharray="1 2.2" />
        </>
      ) : kind === "change" ? (
        <>
          <circle cx="5.5" cy="16" r="2.5" />
          <circle cx="18.5" cy="16" r="2.5" fill="currentColor" />
          <path d="M5.5 11.5a6.5 6.5 0 0 1 12.4-1.8" />
          <path d="M18.7 6.2 17.9 9.7 14.5 8.7" />
        </>
      ) : kind === "question" ? (
        <>
          <path d="M8.5 9a3.6 3.6 0 1 1 5.6 3c-1.2.8-2.1 1.5-2.1 3.2" />
          <circle cx="12" cy="19" r="0.9" fill="currentColor" />
        </>
      ) : kind === "echo" ? (
        <>
          <circle cx="5.5" cy="12" r="1.7" fill="currentColor" />
          <path d="M10 8.5a5 5 0 0 1 0 7" />
          <path d="M13.7 6a8.5 8.5 0 0 1 0 12" />
          <path d="M17.4 3.7a12 12 0 0 1 0 16.6" opacity="0.550" />
        </>
      ) : kind === "pattern" ? (
        <>
          <circle cx="6" cy="7" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="18" cy="17" r="1.8" />
          <circle cx="18" cy="7" r="1.8" opacity="0.550" />
          <circle cx="6" cy="17" r="1.8" opacity="0.550" />
        </>
      ) : (
        <path d="M12 4v16M4 12h16M6.5 6.5l11 11M17.5 6.5l-11 11" />
      )}
    </svg>
  );
}

export function responseLabel(response: string): string {
  return response === "keep"
    ? "Kept"
    : response === "correct"
      ? "Corrected"
      : response === "prune"
        ? "Pruned"
        : response;
}

export type ReturnCabinetProps = {
  passes: CabinetPass[];
  blooms: CabinetBloom[];
  responses: CabinetResponse[];
  resolveClipping: (clipping: Clipping) => ClippingSource;
  onRespond: (
    bloomId: string,
    response: BloomResponseKind,
    correction: string,
  ) => Promise<void> | void;
  onCancel: (passId: string) => Promise<void> | void;
  onContinue: (bloom: CabinetBloom, clipping: ResolvedClipping) => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  headingId: string;
  disabled?: boolean;
  children?: ReactNode;
};

/**
 * Returns: one place to inspect what came back, why it appeared, and what the
 * person already said about it. Pure presentation; all persistence is delegated.
 */
export function ReturnCabinet({
  passes,
  blooms,
  responses,
  resolveClipping,
  onRespond,
  onCancel,
  onContinue,
  headingRef,
  headingId,
  disabled = false,
  children,
}: ReturnCabinetProps) {
  const byPass = (id: string) =>
    blooms
      .filter((b) => b.pass_id === id)
      .sort((a, b) => a.ordinal - b.ordinal);
  // The newest return that carries blooms stays open; older ones fold away.
  const openId = passes.find((p) => byPass(p.id).length > 0)?.id;
  return (
    <div className="cabinet">
      <header className="cabinet-header">
        <p className="cabinet-kicker">The full record</p>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          Returns
        </h2>
        <p className="cabinet-lede">
          What the garden offered after you invited a reflection. Everything
          here is AI-derived and stays apart from your writing. A return with
          nothing in it is a complete return.
        </p>
        <ul className="cabinet-legend" aria-label="How to read a return">
          <li data-author="garden">
            <span className="cabinet-legend-swatch" aria-hidden="true" />
            <span>
              <strong>The garden noticed</strong> · AI-derived, never fact
            </span>
          </li>
          <li data-author="you">
            <span className="cabinet-legend-swatch" aria-hidden="true" />
            <span>
              <strong>Your words</strong> · exactly as you wrote them
            </span>
          </li>
        </ul>
      </header>
      {children}
      {passes.length === 0 ? (
        <div className="cabinet-quiet cabinet-empty">
          <QuietGlyph tone="rest" />
          <p className="cabinet-quiet-title">No returns yet</p>
          <p>Nothing has been read, and nothing is waiting.</p>
        </div>
      ) : (
        <ol className="cabinet-passes" aria-label="Returns, newest first">
          {passes.map((pass) => (
            <li key={pass.id}>
              <PassDrawer
                pass={pass}
                blooms={byPass(pass.id)}
                defaultOpen={pass.id === openId}
                responses={responses}
                resolveClipping={resolveClipping}
                onRespond={onRespond}
                onCancel={onCancel}
                onContinue={onContinue}
                disabled={disabled}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A small drawn mark for passes that carry no blooms. Decorative only. */
function QuietGlyph({
  tone,
}: {
  tone: "rest" | "waiting" | "tending" | "ended";
}) {
  return (
    <svg
      className="cabinet-quiet-glyph"
      data-tone={tone}
      viewBox="0 0 48 32"
      width="48"
      height="32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 27h40" />
      {tone === "rest" && (
        <>
          <path d="M24 27V15" />
          <path d="M24 15c-3.5-1-5-4-4-8 3 .6 5 3 4 8Z" />
          <path d="M24 15c3.5-1 5-4 4-8-3 .6-5 3-4 8Z" />
          <path d="M24 22c-3 0-5-1.5-6-4M24 24c3 0 5-1.5 6-4" />
        </>
      )}
      {tone === "waiting" && (
        <>
          <path d="M24 27v-6" />
          <path d="M24 21c-2.5 0-4-1.5-4.5-4 2.5 0 4 1.5 4.5 4Z" />
          <path d="M24 21c2.5 0 4-1.5 4.5-4-2.5 0-4 1.5-4.5 4Z" />
        </>
      )}
      {tone === "tending" && (
        <>
          <path d="M15 27a9 9 0 0 1 18 0" />
          <path d="M24 12V8M13.5 16.5l-2.8-2.8M34.5 16.5l2.8-2.8" />
        </>
      )}
      {tone === "ended" && (
        <>
          <path d="M24 27v-9" />
          <path d="M24 18c-1-3 0-5.5 2-7" strokeDasharray="1.5 2.5" />
        </>
      )}
    </svg>
  );
}

function PassDrawer({
  pass,
  blooms,
  defaultOpen,
  responses,
  resolveClipping,
  onRespond,
  onCancel,
  onContinue,
  disabled,
}: {
  pass: CabinetPass;
  blooms: CabinetBloom[];
  defaultOpen: boolean;
  responses: CabinetResponse[];
  resolveClipping: (clipping: Clipping) => ClippingSource;
  onRespond: ReturnCabinetProps["onRespond"];
  onCancel: ReturnCabinetProps["onCancel"];
  onContinue: ReturnCabinetProps["onContinue"];
  disabled: boolean;
}) {
  const headingId = useId();
  const active = pass.status === "queued" || pass.status === "processing";
  const count = blooms.length;
  const countText =
    pass.status === "complete"
      ? count === 0
        ? "Nothing new to offer"
        : `${count} ${count === 1 ? "bloom" : "blooms"}`
      : null;
  const answered = blooms.filter((b) =>
    responses.some((r) => r.bloom_id === b.id),
  ).length;
  const returned = pass.status === "complete" && pass.finished_at;
  const heading = (
    <h3 id={headingId} className="cabinet-pass-heading">
      <span className="cabinet-pass-status" data-status={pass.status}>
        <span className="cabinet-pass-dot" aria-hidden="true" />
        {passLabel(pass.status)}
      </span>
      <span className="cabinet-pass-morning">
        <span className="sr-only"> · </span>
        <time dateTime={returned ? pass.finished_at! : pass.created_at}>
          {formatMorning(returned ? pass.finished_at : pass.created_at)}
        </time>
      </span>
      <span className="cabinet-pass-date">
        <span className="sr-only"> · </span>
        Invited{" "}
        <time dateTime={pass.created_at}>{formatDate(pass.created_at)}</time>
      </span>
      {countText && (
        <span className="cabinet-pass-count">
          {" · "}
          {countText}
          {count > 0 && pass.status === "complete" && (
            <>
              {" · "}
              {answered === count
                ? "all answered"
                : `${count - answered} awaiting your response`}
            </>
          )}
        </span>
      )}
    </h3>
  );
  const bloomList = count > 0 && (
    <ol className="cabinet-blooms" aria-label="Blooms in this return">
      {blooms.map((bloom) => (
        <li key={bloom.id}>
          <BloomSpecimen
            bloom={bloom}
            withdrawn={pass.status === "withdrawn"}
            responses={responses
              .filter((r) => r.bloom_id === bloom.id)
              .sort(
                (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
              )}
            resolveClipping={resolveClipping}
            onRespond={onRespond}
            onContinue={onContinue}
            disabled={disabled}
          />
        </li>
      ))}
    </ol>
  );
  const notes = (
    <>
      {pass.status === "queued" && (
        <div className="cabinet-quiet">
          <QuietGlyph tone="waiting" />
          <p className="cabinet-note">
            Waiting to be read. You can leave; a return may take up to 24
            hours.
          </p>
        </div>
      )}
      {pass.status === "processing" && (
        <div className="cabinet-quiet">
          <QuietGlyph tone="tending" />
          <p className="cabinet-note">
            Being read now. Nothing is shown until the whole return is ready.
          </p>
        </div>
      )}
      {pass.status === "complete" && count === 0 && (
        <div className="cabinet-quiet" data-complete="true">
          <QuietGlyph tone="rest" />
          <p className="cabinet-quiet-title">Nothing new to offer</p>
          <p className="cabinet-note">
            {pass.no_output_reason ??
              "No new reflection this time. Your thoughts can rest."}
          </p>
          <p className="cabinet-quiet-foot">
            This return is complete. Nothing is owed.
          </p>
        </div>
      )}
      {pass.status === "failed" && (
        <div className="cabinet-quiet">
          <QuietGlyph tone="ended" />
          <p className="cabinet-note">
            No reflection was published. Your writing is safe; you can invite a
            new pass whenever you like.
          </p>
        </div>
      )}
      {pass.status === "cancelled" && (
        <div className="cabinet-quiet">
          <QuietGlyph tone="ended" />
          <p className="cabinet-note">
            You cancelled this before it returned. Nothing was kept from it.
          </p>
        </div>
      )}
      {pass.status === "withdrawn" && (
        <div className="cabinet-quiet">
          <QuietGlyph tone="ended" />
          <p className="cabinet-note">
            Withdrawn after its topic permissions changed. Its blooms are no
            longer shown.
          </p>
        </div>
      )}
      {active && (
        <button
          type="button"
          className="secondary-button cabinet-cancel"
          disabled={disabled}
          onClick={() => onCancel(pass.id)}
        >
          Cancel this reflection
        </button>
      )}
    </>
  );
  return (
    <article
      className="cabinet-pass"
      data-status={pass.status}
      data-blooms={count}
      aria-labelledby={headingId}
    >
      {count > 0 ? (
        <details className="cabinet-pass-fold" open={defaultOpen}>
          <summary>
            {heading}
            <span className="cabinet-fold-cue" aria-hidden="true" />
          </summary>
          {notes}
          {bloomList}
        </details>
      ) : (
        <>
          {heading}
          {notes}
        </>
      )}
    </article>
  );
}

function BloomSpecimen({
  bloom,
  withdrawn,
  responses,
  resolveClipping,
  onRespond,
  onContinue,
  disabled,
}: {
  bloom: CabinetBloom;
  withdrawn: boolean;
  responses: CabinetResponse[];
  resolveClipping: (clipping: Clipping) => ClippingSource;
  onRespond: ReturnCabinetProps["onRespond"];
  onContinue: ReturnCabinetProps["onContinue"];
  disabled: boolean;
}) {
  const id = useId();
  const [correction, setCorrection] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState<BloomResponseKind | null>(null);
  const [status, setStatus] = useState("");
  const clippings: ResolvedClipping[] = parseEvidence(bloom.evidence).map(
    (c) => ({ ...c, source: resolveClipping(c) }),
  );
  const freshness = bloomFreshness(clippings);
  const latest = responses[0];
  const label = kindLabel(bloom.kind);
  const name = [
    label,
    `${clippings.length} ${clippings.length === 1 ? "clipping" : "clippings"}`,
    withdrawn
      ? "withdrawn"
      : freshness === "historical"
        ? "historical"
        : "current",
    latest
      ? responseLabel(latest.response).toLowerCase()
      : "awaiting your response",
  ].join(", ");
  async function respond(kind: BloomResponseKind) {
    setBusy(kind);
    setStatus("");
    try {
      await onRespond(bloom.id, kind, correction);
      if (kind === "correct") {
        setCorrecting(false);
        setCorrection("");
      }
      setStatus(
        kind === "keep"
          ? "Kept."
          : kind === "prune"
            ? "Pruned. It will not be repeated."
            : "Correction saved in your words.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error && error.message
          ? error.message
          : "Could not save your response. Please retry.",
      );
    } finally {
      setBusy(null);
    }
  }
  const specimenSeed =
    clippings.find((c) => c.source.seed_id)?.source.seed_id ?? bloom.id;
  return (
    <article
      className="cabinet-bloom"
      data-kind={bloom.kind}
      data-freshness={freshness}
      data-response={withdrawn ? "withdrawn" : (latest?.response ?? "none")}
      aria-label={name}
    >
      <div className="cabinet-board">
        <div className="cabinet-specimen-frame">
          <div className="cabinet-specimen-card">
            <p className="cabinet-author" data-author="garden">
              The garden noticed
              <span className="sr-only"> · AI-derived</span>
            </p>
            <header className="cabinet-bloom-header">
              <p className="cabinet-bloom-kind">
                <span className="cabinet-kind-badge">
                  <KindGlyph kind={bloom.kind} />
                </span>
                {label}
              </p>
              <p className="cabinet-bloom-state">
                {withdrawn ? (
                  <span className="cabinet-badge" data-tone="withdrawn">
                    Withdrawn
                  </span>
                ) : freshness === "historical" ? (
                  <span className="cabinet-badge" data-tone="stale">
                    Historical · a source has changed
                  </span>
                ) : (
                  <span className="cabinet-badge" data-tone="current">
                    Sources unchanged
                  </span>
                )}
              </p>
            </header>
            <p className="cabinet-interpretation">{bloom.interpretation}</p>
            <PressedSpecimen seedId={specimenSeed} collected={bloom.created_at} />
          </div>
        </div>
        {/* A labelled group, not a landmark: every bloom has one with the same name. */}
        <div
          role="group"
          className="cabinet-clippings"
          aria-labelledby={`${id}-clippings`}
        >
          <h4 id={`${id}-clippings`} className="cabinet-subheading">
            <span className="cabinet-author" data-author="you">
              Your words
            </span>
            <span className="cabinet-subheading-why">
              Why this appeared ·{" "}
              {clippings.length === 0
                ? "no clippings were attached"
                : `${clippings.length} exact ${clippings.length === 1 ? "clipping" : "clippings"} from your writing`}
            </span>
          </h4>
          {clippings.length > 0 && (
            <ol className="cabinet-clipping-list">
              {clippings.map((c, i) => (
                <li key={`${c.revision_id}-${i}`}>
                  <ClippingCard
                    clipping={c}
                    onContinue={
                      withdrawn ? undefined : () => onContinue(bloom, c)
                    }
                    disabled={disabled}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <div
        role="group"
        className="cabinet-responses"
        aria-labelledby={`${id}-responses`}
      >
        <div className="cabinet-response-bar">
          <div className="cabinet-response-state">
            <h4 id={`${id}-responses`} className="cabinet-subheading">
              Your response
            </h4>
            {latest ? (
              <p className="cabinet-response-now" data-response={latest.response}>
                <ResponseGlyph kind={latest.response} />
                <strong>{responseLabel(latest.response)}</strong>{" "}
                <time dateTime={latest.created_at}>
                  {formatDate(latest.created_at)}
                </time>
                {latest.correction && (
                  <>
                    {" · "}
                    <span className="cabinet-user-mark">in your words</span>
                  </>
                )}
                {latest.response === "prune" && (
                  <span className="cabinet-response-effect">
                    {" · "}It will not be repeated
                  </span>
                )}
              </p>
            ) : (
              <p className="cabinet-note cabinet-response-now">
                {withdrawn
                  ? "This bloom was withdrawn; no response is needed."
                  : "Not yet. Keep it, correct it in your words, or prune it."}
              </p>
            )}
          </div>
          {!withdrawn && (
            <div
              className="cabinet-actions"
              role="group"
              aria-label={`Respond to ${label.toLowerCase()}`}
            >
              <button
                type="button"
                className="secondary-button"
                disabled={disabled || busy !== null}
                aria-pressed={latest?.response === "keep"}
                onClick={() => respond("keep")}
              >
                <ResponseGlyph kind="keep" />
                {busy === "keep" ? "Keeping…" : "Keep"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled || busy !== null}
                aria-expanded={correcting}
                aria-controls={`${id}-correct`}
                onClick={() => setCorrecting((v) => !v)}
              >
                <ResponseGlyph kind="correct" />
                Correct
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled || busy !== null}
                aria-pressed={latest?.response === "prune"}
                onClick={() => respond("prune")}
              >
                <ResponseGlyph kind="prune" />
                {busy === "prune" ? "Pruning…" : "Prune"}
              </button>
            </div>
          )}
        </div>
        {latest && (latest.correction || responses.length > 1) && (
          <div className="cabinet-prior">
            {latest.correction && (
              <blockquote className="cabinet-correction entry-body">
                {latest.correction}
              </blockquote>
            )}
            {responses.length > 1 && (
              <details>
                <summary>
                  Earlier{" "}
                  {responses.length - 1 === 1 ? "response" : "responses"} (
                  {responses.length - 1})
                </summary>
                <ul>
                  {responses.slice(1).map((r) => (
                    <li key={r.id}>
                      {responseLabel(r.response)} ·{" "}
                      <time dateTime={r.created_at}>
                        {formatDate(r.created_at)}
                      </time>
                      {r.correction ? ` — ${r.correction}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {!withdrawn && correcting && (
          <form
            id={`${id}-correct`}
            className="cabinet-correct-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (correction.trim()) respond("correct");
            }}
          >
            <label htmlFor={`${id}-correction`}>
              Your correction, in your own words
            </label>
            <textarea
              id={`${id}-correction`}
              maxLength={2000}
              autoCapitalize="sentences"
              autoCorrect="on"
              spellCheck
              autoComplete="off"
              enterKeyHint="enter"
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              disabled={disabled || busy !== null}
              required
            />
            <div className="cabinet-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={disabled || busy !== null || !correction.trim()}
              >
                {busy === "correct" ? "Saving…" : "Save correction"}
              </button>
              <button
                type="button"
                className="plain-button"
                onClick={() => setCorrecting(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <p role="status" aria-live="polite" className="cabinet-status">
          {status}
        </p>
      </div>
    </article>
  );
}

function ResponseGlyph({ kind }: { kind: string }) {
  return (
    <svg
      className="cabinet-response-glyph"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "keep" ? (
        <path d="M3 8.5 6.5 12 13 4.5" />
      ) : kind === "correct" ? (
        <path d="M3 13l.6-3L10.5 3l2.5 2.5L6 12.5 3 13ZM9 4.5 11.5 7" />
      ) : (
        <>
          <circle cx="4.5" cy="11.5" r="1.8" />
          <circle cx="11.5" cy="11.5" r="1.8" />
          <path d="M5.5 10 11 3M10.5 10 5 3" />
        </>
      )}
    </svg>
  );
}

function ClippingCard({
  clipping,
  onContinue,
  disabled,
}: {
  clipping: ResolvedClipping;
  onContinue?: () => void;
  disabled: boolean;
}) {
  const { source } = clipping;
  const where =
    source.state === "unknown"
      ? "Source revision no longer available"
      : [
          source.created_at
            ? `Your entry of ${formatDate(source.created_at)}`
            : "Your entry",
          source.revision_number !== null
            ? `revision ${source.revision_number}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <figure className="cabinet-clipping" data-state={source.state}>
      <svg className="cabinet-paperclip" viewBox="0 0 16 40" aria-hidden="true">
        <path d="M11 9v20a4 4 0 0 1-8 0V7a5 5 0 0 1 10 0v21a2 2 0 0 1-4 0V10" />
      </svg>
      <blockquote className="cabinet-clipping-body entry-body">
        {clipping.excerpt}
      </blockquote>
      <figcaption className="cabinet-clipping-caption">
        <span className="cabinet-clipping-source">
          <span className="cabinet-user-mark">Your words</span>
          {" · "}
          {source.href ? (
            <Link href={source.href} className="text-link">
              {where}
              <span className="cabinet-link-arrow" aria-hidden="true">
                {" "}
                →
              </span>
            </Link>
          ) : (
            <span>{where}</span>
          )}
          {source.state === "superseded" && (
            <>
              {" · "}
              <span className="cabinet-badge" data-tone="stale">
                Revised since
              </span>
            </>
          )}
          {source.state === "archived" && (
            <>
              {" · "}
              <span className="cabinet-badge" data-tone="stale">
                Archived
              </span>
            </>
          )}
          {source.state === "unknown" && (
            <>
              {" · "}
              <span className="cabinet-badge" data-tone="withdrawn">
                Unlinked
              </span>
            </>
          )}
        </span>
        {onContinue &&
          source.seed_id &&
          source.state !== "unknown" &&
          (source.writable ? (
            <button
              type="button"
              className="plain-button cabinet-continue"
              disabled={disabled}
              onClick={onContinue}
            >
              Continue this thought
            </button>
          ) : (
            <span className="cabinet-source-note">
              Restore the thought to continue it
            </span>
          ))}
      </figcaption>
    </figure>
  );
}
