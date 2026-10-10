"use client";
import { m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Entry, Seed } from "@/lib/garden/types";
import { describeGrowth } from "@/lib/garden/scene/growth";
import type { ScenePlantModel } from "@/lib/garden/scene/model";
import {
  MARK_LABEL,
  bloomHeadline,
  monthsApart,
  type TendingBloom,
} from "@/lib/garden/scene/tending";
import { EntryTime } from "../entry-time";
import { LivingPlant } from "./living-plant";

const EXCERPT = 280;

function excerpt(body: string) {
  return body.length > EXCERPT ? `${body.slice(0, EXCERPT).trimEnd()}…` : body;
}

/**
 * A plant brought forward: the thought's latest slips in the person's own words,
 * then, clearly apart, anything tending has noticed. Nothing here edits writing;
 * "Write" opens the quiet page.
 */
export function PlantFocus({
  plant,
  topicName,
  entries,
  seedsById,
  night,
  reduced,
  canWrite,
  onWrite,
  onClose,
  onRespondMark,
  onReviewBlooms,
}: {
  plant: ScenePlantModel;
  topicName: string;
  entries: Entry[];
  seedsById: Map<string, Seed>;
  night: boolean;
  reduced: boolean;
  canWrite: boolean;
  onWrite: () => void;
  onClose: () => void;
  /** Keep or prune a tending mark; resolves with an error message, if any. */
  onRespondMark?: (markId: string, response: "keep" | "prune") => Promise<string | null>;
  /** Open the Cabinet where blooms are reviewed in full. */
  onReviewBlooms?: () => void;
}) {
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  async function respond(markId: string, response: "keep" | "prune") {
    if (!onRespondMark) return;
    setPending(markId);
    setStatus("");
    const error = await onRespondMark(markId, response);
    setPending(null);
    setStatus(error ?? (response === "prune" ? "Pruned. It won't be suggested again." : "Kept."));
  }
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [plant.seed.id]);
  const { seed, growth, genome, marks, blooms } = plant;
  const latest = entries
    .filter((e) => !e.archived_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 3);
  const motion = reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15 },
      }
    : {
        initial: { opacity: 0, y: 28, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 18, scale: 0.98 },
        transition: { type: "spring" as const, stiffness: 210, damping: 26 },
      };
  return (
    <m.section
      className="plant-focus"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`focus-${seed.id}`}
      {...motion}
    >
      <div className="focus-specimen" aria-hidden="true">
        <LivingPlant
          genome={genome}
          stage={growth.stage}
          vigor={growth.vigor}
          night={night}
          fit
        />
        <p className="focus-latin">{genome.species.latin}</p>
      </div>
      <div className="focus-body">
        <p className="scene-kicker">Thought · {topicName}</p>
        <h2 id={`focus-${seed.id}`} ref={heading} tabIndex={-1}>
          {seed.title}
        </h2>
        <p className="focus-meta">
          {describeGrowth(growth)}
          {growth.lastWrittenAt && (
            <>
              {" · last written "}
              <EntryTime value={growth.lastWrittenAt} />
            </>
          )}
        </p>
        {latest.length > 0 ? (
          <ol className="focus-slips" aria-label="Latest entries, your words">
            {latest.map((e, i) => (
              <m.li
                key={e.entry_id}
                className="slip"
                initial={
                  reduced
                    ? false
                    : { opacity: 0, y: 14, rotate: i % 2 ? 1.2 : -1.2 }
                }
                animate={{ opacity: 1, y: 0, rotate: i % 2 ? 0.5 : -0.5 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : {
                        delay: 0.08 + i * 0.07,
                        type: "spring",
                        stiffness: 190,
                        damping: 22,
                      }
                }
              >
                <EntryTime value={e.created_at} />
                <p>{excerpt(e.body)}</p>
              </m.li>
            ))}
          </ol>
        ) : (
          <p className="focus-empty">
            No entries yet. This thought is waiting for its first words.
          </p>
        )}
        {(marks.length > 0 || blooms.length > 0) && (
          <section className="focus-tending" aria-label="From tending">
            <h3>
              <span aria-hidden="true">❦ </span>From tending
            </h3>
            <p className="tending-note">
              Derived from your writing. Your words above are unchanged.
            </p>
            {marks.length > 0 && (
              <ul className="tending-tags">
                {marks.map((mark) => (
                  <li key={mark.id} className={`tending-tag tag-${mark.kind}`}>
                    <span className="tag-kind">{MARK_LABEL[mark.kind]}</span>
                    {mark.kind === "theme" ? (
                      <span className="tag-label">{mark.label}</span>
                    ) : (
                      <q>{mark.evidence[0]?.excerpt ?? mark.label}</q>
                    )}
                    {mark.response === "keep" ? (
                      <span className="tag-kept">Kept</span>
                    ) : (
                      onRespondMark && (
                        <span className="tag-actions">
                          <button
                            type="button"
                            className="tag-action"
                            disabled={pending === mark.id}
                            aria-label={`Keep ${MARK_LABEL[mark.kind].toLowerCase()} ${mark.label}`.trim()}
                            onClick={() => respond(mark.id, "keep")}
                          >
                            Keep
                          </button>
                          <button
                            type="button"
                            className="tag-action"
                            disabled={pending === mark.id}
                            aria-label={`Prune ${MARK_LABEL[mark.kind].toLowerCase()} ${mark.label}`.trim()}
                            onClick={() => respond(mark.id, "prune")}
                          >
                            Prune
                          </button>
                        </span>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
            {blooms.map((bloom) => (
              <BloomNote
                key={bloom.id}
                bloom={bloom}
                seedId={seed.id}
                seedsById={seedsById}
              />
            ))}
            {blooms.length > 0 && onReviewBlooms && (
              <button
                type="button"
                className="plain-button review-cabinet"
                onClick={onReviewBlooms}
              >
                Review clippings in the Cabinet
              </button>
            )}
            <p className="tending-status" role="status">
              {status}
            </p>
          </section>
        )}
        <div className="focus-actions">
          <button type="button" className="primary-button" onClick={onWrite}>
            {canWrite ? "Write in this thought" : "Read this thought"}
          </button>
          <button type="button" className="plain-button" onClick={onClose}>
            Back to the garden
          </button>
        </div>
      </div>
    </m.section>
  );
}

function BloomNote({
  bloom,
  seedId,
  seedsById,
}: {
  bloom: TendingBloom;
  seedId: string;
  seedsById: Map<string, Seed>;
}) {
  const others = [...new Set(bloom.evidence.map((e) => e.seedId))]
    .filter((id) => id !== seedId)
    .map((id) => seedsById.get(id)?.title)
    .filter(Boolean);
  const older =
    bloom.kind === "echo"
      ? [...bloom.evidence].sort((a, b) =>
          a.writtenAt.localeCompare(b.writtenAt),
        )[0]
      : null;
  return (
    <article
      className={`tending-bloom bloom-${bloom.kind}${bloom.isNew ? " is-new" : ""}`}
    >
      <p className="tag-kind">
        {bloomHeadline(bloom)}
        {bloom.isNew && <span className="bloom-new"> · New</span>}
      </p>
      <p className="bloom-text">{bloom.interpretation}</p>
      {older && monthsApart(bloom.evidence) > 0 && (
        <blockquote className="echo-slip">
          <EntryTime value={older.writtenAt} />
          <p>{older.excerpt}</p>
        </blockquote>
      )}
      <p className="bloom-sources">
        Cites {bloom.evidence.length}{" "}
        {bloom.evidence.length === 1 ? "passage" : "passages"}
        {others.length > 0 && <> · also in {others.join(", ")}</>}
      </p>
    </article>
  );
}
