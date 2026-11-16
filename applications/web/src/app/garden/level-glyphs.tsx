import type { ReactNode } from "react";

/**
 * One glyph per level of the garden (market readiness plan, "The level system").
 * The same five drawings appear in the depth trail and in each page's eyebrow,
 * so a level is recognisable by shape before any text is read.
 */
export type Level = "gardens" | "garden" | "topic" | "thought" | "entry";

export const LEVEL_NAME: Record<Level, string> = {
  gardens: "All gardens",
  garden: "Garden",
  topic: "Topic",
  thought: "Thought",
  entry: "Entry",
};

const paths: Record<Level | "returns", ReactNode> = {
  // Horizon: a low sun on a flat line.
  gardens: (
    <>
      <path d="M2 15h20" />
      <path d="M7 15a5 5 0 0 1 10 0" />
      <path d="M12 6V4M5.6 8.6 4.2 7.2M18.4 8.6l1.4-1.4" />
      <path d="M6 19h12" />
    </>
  ),
  // Hill: one rise of ground with a second behind it.
  garden: (
    <>
      <path d="M2 19c3-8 7-11 10-11s7 4 10 11" />
      <path d="M13.5 9.2C15 6.6 16.6 5.5 18 5.5c1.6 0 3 1.6 4 4.5" />
      <path d="M2 19h20" />
    </>
  ),
  // Bed: a framed plot of soil with three seedlings.
  topic: (
    <>
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7.5 13V9.5M12 13V7M16.5 13V9.5" />
      <path d="M7.5 10.5c-1.6 0-2.4-.8-2.4-2 1.6 0 2.4.8 2.4 2ZM12 8.5c1.8 0 2.8-1 2.8-2.4-1.8 0-2.8 1-2.8 2.4ZM16.5 10.5c1.6 0 2.4-.8 2.4-2-1.6 0-2.4.8-2.4 2Z" />
    </>
  ),
  // Plant: a single stem with two leaves and a bud.
  thought: (
    <>
      <path d="M12 21V8" />
      <path d="M12 14c-3.4 0-5.4-1.8-5.4-4.8 3.4 0 5.4 1.8 5.4 4.8ZM12 11.5c3.2 0 5-1.7 5-4.5-3.2 0-5 1.7-5 4.5Z" />
      <circle cx="12" cy="5.5" r="2" />
      <path d="M8 21h8" />
    </>
  ),
  // Page: a sheet with a folded corner and ruled lines.
  entry: (
    <>
      <path d="M6 3h8.5L19 7.5V21H6Z" />
      <path d="M14.5 3v4.5H19" />
      <path d="M9 12h7M9 15h7M9 18h4.5" />
    </>
  ),
  // Returns: an open bloom. Drawn in return-gold by its callers.
  returns: (
    <>
      <circle cx="12" cy="12" r="2.4" />
      <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2 18 18M18 6l-2.8 2.8M8.8 15.2 6 18" />
    </>
  ),
};

export function LevelGlyph({
  level,
  size = 20,
  className = "",
}: {
  level: Level | "returns";
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`level-glyph ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[level]}
    </svg>
  );
}

/** The eyebrow every level page opens with: glyph, then the level's name. */
export function LevelEyebrow({
  level,
  children,
}: {
  level: Level;
  children?: ReactNode;
}) {
  return (
    <p className="level-eyebrow" data-level={level}>
      <LevelGlyph level={level} size={18} />
      <span>{LEVEL_NAME[level]}</span>
      {children && <span className="level-eyebrow-note">{children}</span>}
    </p>
  );
}
