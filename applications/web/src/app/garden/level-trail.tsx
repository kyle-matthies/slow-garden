import type { ReactNode } from "react";
import { LevelGlyph, LEVEL_NAME, type Level } from "./level-glyphs";
import "./level-trail.css";

export type TrailStep = {
  level: Level;
  /** The person's own name for this place; the level name when omitted. */
  name?: string;
  /** Omitted for the current step, which is not a link. */
  onOpen?: () => void;
};

const ORDER: Level[] = ["gardens", "garden", "topic", "thought", "entry"];

/**
 * The depth trail: the only breadcrumb, shown in both Meadow and Pages.
 * Every level is drawn, from All gardens down to Entry. Levels above the current
 * one are buttons, the current one is marked, and levels below are faint so the
 * person can see how deep they are and how much further the garden goes.
 */
export function LevelTrail({
  steps,
  place,
  children,
}: {
  steps: TrailStep[];
  /** A side room of the garden (Returns, Archive, Timeline) shown as the last step. */
  place?: { name: string; returns?: boolean };
  children?: ReactNode;
}) {
  const current = steps[steps.length - 1];
  const parent = place ? current : steps[steps.length - 2];
  const reached = new Set(steps.map((s) => s.level));
  // Levels below the current one. Entries live on their thought's page.
  const below = place
    ? []
    : ORDER.filter((l) => !reached.has(l) && ORDER.indexOf(l) > ORDER.indexOf(current.level));
  return (
    <div className="level-trail-bar">
      <nav className="level-trail garden-breadcrumb" aria-label="Where you are">
        {parent?.onOpen && (
          <button
            type="button"
            className="level-trail-back"
            onClick={parent.onOpen}
            aria-label={`Back to ${parent.name ?? LEVEL_NAME[parent.level]}`}
          >
            <span aria-hidden="true">‹</span>
          </button>
        )}
        <ol>
          {steps.map((step, i) => {
            const isCurrent = !place && i === steps.length - 1;
            const label = step.name ?? LEVEL_NAME[step.level];
            return (
              <li
                key={step.level}
                className="level-trail-step"
                data-level={step.level}
                data-current={isCurrent || undefined}
              >
                {isCurrent || !step.onOpen ? (
                  <span
                    className="level-trail-here"
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    <LevelGlyph level={step.level} />
                    <span className="level-trail-text">
                      {step.name && (
                        <span className="level-trail-level">
                          {LEVEL_NAME[step.level]}
                        </span>
                      )}
                      <span className="level-trail-name">{label}</span>
                    </span>
                  </span>
                ) : (
                  <button type="button" onClick={step.onOpen}>
                    <LevelGlyph level={step.level} />
                    <span className="level-trail-name">
                      {step.name && (
                        <span className="sr-only">
                          {LEVEL_NAME[step.level]}:{" "}
                        </span>
                      )}
                      {label}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
          {place && (
            <li
              className="level-trail-step"
              data-current
              data-returns={place.returns || undefined}
            >
              <span className="level-trail-here" aria-current="page">
                {place.returns && <LevelGlyph level="returns" />}
                <span className="level-trail-text">
                  <span className="level-trail-name">{place.name}</span>
                </span>
              </span>
            </li>
          )}
          {below.map((level) => (
            <li
              key={level}
              className="level-trail-step level-trail-below"
              aria-hidden="true"
              title={LEVEL_NAME[level]}
            >
              <LevelGlyph level={level} />
            </li>
          ))}
        </ol>
      </nav>
      {children && <div className="level-trail-aside">{children}</div>}
    </div>
  );
}
