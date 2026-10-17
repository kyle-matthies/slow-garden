/** One gust period for the whole meadow, in seconds. */
export const GUST_SECONDS = 7;
/** Degrees of meadow between one gust and the next. */
export const GUST_WAVELENGTH = 48;

/**
 * CSS custom properties for a plant's compositor-only sway. Every plant shares
 * one period and is phased by its place in the meadow, so gusts travel across
 * it; flex picks a stiff, ordinary or supple amplitude; jitter (seconds) keeps
 * neighbours from moving in lockstep.
 */
export function swayStyle(worldDeg: number, flex: number, jitter = 0) {
  const phase = (((worldDeg / GUST_WAVELENGTH) % 1) + 1) % 1;
  return {
    "--sway": `${GUST_SECONDS}s`,
    "--sway-delay": `${(-phase * GUST_SECONDS + jitter).toFixed(2)}s`,
    "--sway-name":
      flex > 1.1
        ? "plant-sway-supple"
        : flex < 0.85
          ? "plant-sway-stiff"
          : "plant-sway",
  };
}
