"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { Seed } from "@/lib/garden/types";
import { BLOOM_LABEL, type Tending } from "@/lib/garden/scene/tending";
import { EntryTime } from "./entry-time";
import { LevelGlyph } from "./level-glyphs";

/** Blooms the person has not pruned, newest first. */
export function liveBlooms(tending: Tending) {
  return tending.blooms
    .filter((b) => b.response !== "prune")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The Returns page: everything on it is AI-derived, so it is drawn in the
 * return-gold material and never in the paper used for the person's writing.
 * It shows at most three blooms; the full record below holds every return.
 */
export function ReturnsPage({
  tending,
  seeds,
  tendingActive,
  onOpenThought,
  onSeen,
  children,
}: {
  tending: Tending;
  seeds: Seed[];
  /** Whether tending can run for this account at all. */
  tendingActive: boolean;
  onOpenThought: (seedId: string) => void;
  onSeen: (ids: string[]) => void;
  /** The full record (GardenReturns). */
  children: ReactNode;
}) {
  const blooms = liveBlooms(tending).slice(0, 3);
  // A pass finished here once and tending cannot run now: both are true, so
  // the page says them together and never that nothing was ever read.
  const tendedBefore = Boolean(tending.lastTendedAt);
  const restingNow = tendedBefore && !tendingActive;
  // Remember what was new on arrival, so "New" stays put while it is read.
  const [arrivedNew] = useState(
    () => new Set(blooms.filter((b) => b.isNew).map((b) => b.id)),
  );
  const shown = blooms.map((b) => b.id).join(",");
  useEffect(() => {
    if (shown) onSeen(shown.split(","));
  }, [shown, onSeen]);
  return (
    <div className="returns-page">
      <header className="returns-header">
        <p className="level-eyebrow returns-eyebrow">
          <LevelGlyph level="returns" size={18} />
          <span>Returns</span>
        </p>
        <h1>What the garden returned</h1>
        <p>
          Blooms are AI-derived readings of your saved entries. They are kept
          apart from your writing, each one points at the entries it came
          from, and none of them changes a word you wrote.
        </p>
        {tending.lastTendedAt && (
          <p className="returns-tended">
            Last tended <EntryTime value={tending.lastTendedAt} />
          </p>
        )}
        {restingNow && (
          <p className="returns-standing">
            Tending is not active now. What was returned before stays here to
            read, and nothing new will arrive until tending is active.
          </p>
        )}
      </header>
      {blooms.length === 0 ? (
        <p className="returns-empty">
          {tendingActive
            ? "Nothing has been returned yet. A tending pass can also finish with no bloom when there is nothing worth saying."
            : restingNow
              ? "No bloom is showing. Earlier tending passes are in the full record below."
              : "Nothing has been returned. Tending is not active for this account yet, so no AI has read your writing."}
        </p>
      ) : (
        <ol className="returns-blooms" aria-label="Latest blooms">
          {blooms.map((bloom) => {
            const sources = [
              ...new Set(bloom.evidence.map((e) => e.seedId)),
            ].flatMap((id) => seeds.find((s) => s.id === id) ?? []);
            return (
              <li key={bloom.id} className="returns-bloom">
                <p className="returns-bloom-kind">
                  <LevelGlyph level="returns" size={16} />
                  Bloom · {BLOOM_LABEL[bloom.kind]}
                  {arrivedNew.has(bloom.id) && (
                    <span className="returns-new">New</span>
                  )}
                </p>
                <p className="returns-bloom-text">{bloom.interpretation}</p>
                <p className="returns-bloom-sources">
                  AI-derived from {bloom.evidence.length}{" "}
                  {bloom.evidence.length === 1 ? "entry" : "entries"} of yours
                  {sources.length > 0 && " in "}
                  {/* One sentence in the markup; on a phone the links are
                      laid out two to a row and the punctuation steps aside. */}
                  <span className="returns-source-list">
                    {sources.map((seed, i) => (
                      <span key={seed.id}>
                        {i > 0 && <span className="returns-source-sep">, </span>}
                        <button
                          type="button"
                          onClick={() => onOpenThought(seed.id)}
                        >
                          {seed.title}
                        </button>
                      </span>
                    ))}
                  </span>
                  <span className="returns-source-sep">.</span>
                </p>
              </li>
            );
          })}
        </ol>
      )}
      <section className="returns-cabinet-host" aria-label="The full record">
        <h2>The full record</h2>
        <p>
          Every bloom with its evidence, your responses, and each tending
          pass.
        </p>
        {children}
      </section>
    </div>
  );
}
