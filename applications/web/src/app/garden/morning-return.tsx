"use client";
import { useId } from "react";
import {
  bloomHeadline,
  bloomSeeds,
  type Tending,
} from "@/lib/garden/scene/tending";
import type { Plot, Seed } from "@/lib/garden/types";
import { useSeenTending } from "@/lib/garden/use-seen-tending";
import { KindGlyph } from "./returns-cabinet";
import "./morning-return.css";

/** ADR-008: a tending cycle returns at most three blooms. */
const MAX_BLOOMS = 3;

/**
 * The morning reveal: shown at the top of a garden only while there are blooms
 * the person has not seen. It renders nothing otherwise: no placeholder, no
 * count of days, no prompt to write. Everything on it is AI-derived and says so.
 */
export function MorningReturn(props: {
  tending: Tending;
  seeds: Seed[];
  plots: Plot[];
  onOpenThought(seedId: string): void;
  onOpenReturns(): void;
}) {
  const { seeds, plots, onOpenThought, onOpenReturns } = props;
  const headingId = useId();
  // First-view receipts are bloom IDs only, kept in this browser per garden.
  const scope = plots[0]?.garden_id ?? seeds[0]?.garden_id ?? "garden";
  const { tending, markBloomsSeen } = useSeenTending(scope, props.tending);
  const unseen = tending.blooms.filter(
    (b) => b.isNew && b.response !== "prune",
  );
  if (unseen.length === 0) return null;
  const shown = unseen.slice(0, MAX_BLOOMS);
  const more = unseen.length - shown.length;
  const markSeen = () => markBloomsSeen(unseen.map((b) => b.id));
  return (
    <section className="morning-return" aria-labelledby={headingId}>
      <header className="morning-return-header">
        <svg
          className="morning-return-sun"
          viewBox="0 0 48 28"
          width="48"
          height="28"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3 25h42" />
          <path d="M14 25a10 10 0 0 1 20 0" />
          <path d="M24 9V4M11.5 13.5 8 10M36.5 13.5 40 10M6.5 21H3M45 21h-3.5" />
        </svg>
        <div>
          <p className="morning-return-kicker">
            The garden noticed · AI-derived
          </p>
          <h2 id={headingId}>Overnight, the garden noticed…</h2>
        </div>
      </header>
      <ol className="morning-return-blooms">
        {shown.map((bloom) => {
          const touched = bloomSeeds(bloom)
            .map((id) => seeds.find((s) => s.id === id))
            .filter((s): s is Seed => !!s);
          return (
            <li
              key={bloom.id}
              className="morning-return-bloom"
              data-kind={bloom.kind}
            >
              <span className="morning-return-glyph">
                <KindGlyph kind={bloom.kind} />
              </span>
              <div className="morning-return-body">
                <p className="morning-return-kind">{bloomHeadline(bloom)}</p>
                <p className="morning-return-line">{bloom.interpretation}</p>
                {touched.length > 0 && (
                  <p className="morning-return-touches">
                    <span className="morning-return-touches-label">
                      From your {touched.length === 1 ? "thought" : "thoughts"}
                    </span>
                    {touched.map((seed) => {
                      const plot = plots.find((p) => p.id === seed.plot_id);
                      return (
                        <button
                          key={seed.id}
                          type="button"
                          className="morning-return-thought"
                          onClick={() => onOpenThought(seed.id)}
                        >
                          {seed.title}
                          {plot && (
                            <span className="sr-only"> in {plot.name}</span>
                          )}
                        </button>
                      );
                    })}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <footer className="morning-return-footer">
        {more > 0 && (
          <p className="morning-return-more">
            {more} more in Returns
          </p>
        )}
        <button
          type="button"
          className="morning-return-open"
          onClick={() => {
            markSeen();
            onOpenReturns();
          }}
        >
          Open Returns
        </button>
        <button
          type="button"
          className="morning-return-dismiss"
          onClick={markSeen}
        >
          Dismiss<span className="sr-only"> and mark as seen</span>
        </button>
      </footer>
    </section>
  );
}
