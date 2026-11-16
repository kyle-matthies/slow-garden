/**
 * How finely the meadow's canvases are drawn, and how that is chosen.
 *
 * The scene does not draw at rest, so it cannot learn what a device can
 * afford by watching frames go by. Instead it settles once, in a short burst
 * of frames shortly after the first paint and before anyone touches it; it
 * keeps adjusting while the camera moves; and it remembers where it settled,
 * so a later visit starts there without the burst.
 */
export type Level = {
  /** Share of the live grass drawn, 0.35 to 1. */
  quality: number;
  /** Canvas backing-store multiplier, 0.5 to 1; lowered only at the grass floor. */
  resolution: number;
};

export const FULL: Level = { quality: 1, resolution: 1 };
export const FLOOR: Level = { quality: 0.35, resolution: 0.5 };

export const atFloor = (level: Level) =>
  level.quality <= FLOOR.quality && level.resolution <= FLOOR.resolution;

/** One step cheaper: thin the grass, then soften the canvas. */
export function stepDown(level: Level): Level {
  if (level.quality > FLOOR.quality)
    return { ...level, quality: Math.max(FLOOR.quality, level.quality * 0.7) };
  if (level.resolution > FLOOR.resolution)
    return { ...level, resolution: Math.max(FLOOR.resolution, level.resolution * 0.75) };
  return level;
}

/** One step richer: sharpen the canvas, then thicken the grass. */
export function stepUp(level: Level): Level {
  if (level.resolution < 1)
    return { ...level, resolution: Math.min(1, level.resolution / 0.75) };
  if (level.quality < 1) return { ...level, quality: Math.min(1, level.quality * 1.15) };
  return level;
}

export type Verdict = "fast" | "fine" | "slow" | "far-over";

/**
 * Judge a window of frames by its 90th-percentile drawing cost and frame
 * interval, both in ms. Rasterising happens after drawing, so the interval is
 * the honest signal for it.
 */
export function judge(cost90: number, pace90: number): Verdict {
  if (cost90 > 16 || pace90 > 30) return "far-over";
  if (cost90 > 8 || pace90 > 24) return "slow";
  if (cost90 < 3.5 && pace90 < 18) return "fast";
  return "fine";
}

/** Frames per window while settling; a camera move uses 60. */
export const SETTLE_FRAMES = 8;
/** The most windows a settling burst may take: about a second at 30 frames a second. */
export const SETTLE_WINDOWS = 5;

/**
 * One window of the settling burst. It only ever lowers quality (raising it
 * is left to real camera moves, which have more frames to judge by), steps
 * twice when far over, and stops at the first window that is not slow.
 */
export function settle(
  level: Level,
  verdict: Verdict,
  windowsLeft: number,
): { level: Level; windowsLeft: number } {
  if (verdict === "fast" || verdict === "fine") return { level, windowsLeft: 0 };
  const next = verdict === "far-over" ? stepDown(stepDown(level)) : stepDown(level);
  return { level: next, windowsLeft: atFloor(next) ? 0 : Math.max(0, windowsLeft - 1) };
}

export const QUALITY_KEY = "slow-garden:meadow-quality:v1";
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** Decorative preference only: two numbers and the screen area they were found for. */
export function remember(storage: Storage | undefined, level: Level, area: number) {
  try {
    storage?.setItem(
      QUALITY_KEY,
      JSON.stringify({ q: level.quality, r: level.resolution, a: Math.round(area) }),
    );
  } catch {
    // Private mode or a full store: the next visit settles again.
  }
}

export function recall(storage: Storage | undefined, area: number): Level | null {
  try {
    const stored = JSON.parse(storage?.getItem(QUALITY_KEY) ?? "null") as {
      q?: unknown;
      r?: unknown;
      a?: unknown;
    } | null;
    if (!stored) return null;
    const { q, r, a } = stored;
    if (typeof q !== "number" || typeof r !== "number" || typeof a !== "number") return null;
    if (!(q >= FLOOR.quality && q <= 1 && r >= FLOOR.resolution && r <= 1)) return null;
    // A much larger or smaller canvas costs differently: settle afresh.
    if (!(a > 0) || area / a > 1.25 || a / area > 1.25) return null;
    return { quality: q, resolution: r };
  } catch {
    return null;
  }
}
