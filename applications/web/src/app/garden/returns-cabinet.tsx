"use client";
import Link from "next/link";
import { useId, useState, type ReactNode, type RefObject } from "react";
import { isThoughtWritable } from "@/lib/garden/writable";
import type { GardenData } from "@/lib/garden/types";
import "./returns.css";

export type PassStatus =
  "queued" | "processing" | "complete" | "failed" | "cancelled" | "withdrawn";
export type BloomKind = "connection" | "tension" | "change" | "question";
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
 * The Cabinet: one place to inspect what returned, why it appeared, and what the
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
  return (
    <div className="cabinet">
      <header className="cabinet-header">
        <p className="cabinet-kicker">Cabinet</p>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          Returns
        </h2>
        <p className="cabinet-lede">
          What the garden offered after you invited a reflection. Everything
          here is AI-derived and stays apart from your writing. A return with
          nothing in it is a complete return.
        </p>
      </header>
      {children}
      {passes.length === 0 ? (
        <p className="cabinet-empty">
          No returns yet. Nothing has been read, and nothing is waiting.
        </p>
      ) : (
        <ol className="cabinet-passes" aria-label="Returns, newest first">
          {passes.map((pass) => (
            <li key={pass.id}>
              <PassDrawer
                pass={pass}
                blooms={blooms
                  .filter((b) => b.pass_id === pass.id)
                  .sort((a, b) => a.ordinal - b.ordinal)}
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

function PassDrawer({
  pass,
  blooms,
  responses,
  resolveClipping,
  onRespond,
  onCancel,
  onContinue,
  disabled,
}: {
  pass: CabinetPass;
  blooms: CabinetBloom[];
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
  return (
    <article
      className="cabinet-pass"
      data-status={pass.status}
      aria-labelledby={headingId}
    >
      <h3 id={headingId} className="cabinet-pass-heading">
        <span className="cabinet-pass-status">{passLabel(pass.status)}</span>
        <span className="cabinet-pass-date">
          {" · "}
          Invited{" "}
          <time dateTime={pass.created_at}>{formatDate(pass.created_at)}</time>
        </span>
        {countText && (
          <span className="cabinet-pass-count">
            {" · "}
            {countText}
          </span>
        )}
      </h3>
      {pass.status === "queued" && (
        <p className="cabinet-note">
          Waiting to be read. You can leave; a return may take up to 24 hours.
        </p>
      )}
      {pass.status === "processing" && (
        <p className="cabinet-note">
          Being read now. Nothing is shown until the whole return is ready.
        </p>
      )}
      {pass.status === "complete" && count === 0 && (
        <p className="cabinet-note">
          {pass.no_output_reason ??
            "No new reflection this time. Your thoughts can rest."}
        </p>
      )}
      {pass.status === "failed" && (
        <p className="cabinet-note">
          No reflection was published. Your writing is safe; you can invite a
          new pass whenever you like.
        </p>
      )}
      {pass.status === "cancelled" && (
        <p className="cabinet-note">
          You cancelled this before it returned. Nothing was kept from it.
        </p>
      )}
      {pass.status === "withdrawn" && (
        <p className="cabinet-note">
          Withdrawn after its topic permissions changed. Its blooms are no
          longer shown.
        </p>
      )}
      {active && (
        <button
          type="button"
          className="plain-button"
          disabled={disabled}
          onClick={() => onCancel(pass.id)}
        >
          Cancel this reflection
        </button>
      )}
      {count > 0 && (
        <ol className="cabinet-blooms" aria-label="Blooms in this return">
          {blooms.map((bloom) => (
            <li key={bloom.id}>
              <BloomSpecimen
                bloom={bloom}
                withdrawn={pass.status === "withdrawn"}
                responses={responses
                  .filter((r) => r.bloom_id === bloom.id)
                  .sort(
                    (a, b) =>
                      Date.parse(b.created_at) - Date.parse(a.created_at),
                  )}
                resolveClipping={resolveClipping}
                onRespond={onRespond}
                onContinue={onContinue}
                disabled={disabled}
              />
            </li>
          ))}
        </ol>
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
  return (
    <article
      className="cabinet-bloom"
      data-kind={bloom.kind}
      data-freshness={freshness}
      aria-label={name}
    >
      <header className="cabinet-bloom-header">
        <p className="cabinet-bloom-kind">
          <span className="cabinet-derived-mark" aria-hidden="true">
            ❦
          </span>{" "}
          {label}
          <span className="sr-only"> · AI-derived</span>
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
      <section
        className="cabinet-clippings"
        aria-labelledby={`${id}-clippings`}
      >
        <h4 id={`${id}-clippings`} className="cabinet-subheading">
          Why this appeared ·{" "}
          {clippings.length === 0
            ? "no clippings were attached"
            : `${clippings.length} exact ${clippings.length === 1 ? "clipping" : "clippings"} from your writing`}
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
      </section>
      <section
        className="cabinet-responses"
        aria-labelledby={`${id}-responses`}
      >
        <h4 id={`${id}-responses`} className="cabinet-subheading">
          Your response
        </h4>
        {latest ? (
          <div className="cabinet-prior">
            <p>
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
            </p>
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
        ) : (
          <p className="cabinet-note">
            {withdrawn
              ? "This bloom was withdrawn; no response is needed."
              : "Not yet. Keep it, correct it in your words, or prune it."}
          </p>
        )}
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
              Correct
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled || busy !== null}
              aria-pressed={latest?.response === "prune"}
              onClick={() => respond("prune")}
            >
              {busy === "prune" ? "Pruning…" : "Prune"}
            </button>
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
      </section>
    </article>
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
      <blockquote className="cabinet-clipping-body entry-body">
        {clipping.excerpt}
      </blockquote>
      <figcaption className="cabinet-clipping-caption">
        <span className="cabinet-user-mark">Your words</span>
        {" · "}
        {source.href ? (
          <Link href={source.href} className="text-link">
            {where}
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
        {onContinue && source.seed_id && source.state !== "unknown" && (
          <>
            {" · "}
            {source.writable ? (
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
            )}
          </>
        )}
      </figcaption>
    </figure>
  );
}
