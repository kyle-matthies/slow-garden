/** One gust period for the whole meadow, in seconds. */
export const GUST_SECONDS = 7;
/** Degrees of meadow between one gust and the next. */
export const GUST_WAVELENGTH = 48;

/**
 * How many phases the meadow shares. The compositor moves the plants, but the
 * main thread still wakes each time an animation turns over; plants on the
 * same phase turn over together, so the cost follows this number and not the
 * number of plants.
 */
export const GUST_STEPS = 8;

/**
 * CSS custom properties for a plant's compositor-only sway. Every plant shares
 * one period and is phased by its place in the meadow, so gusts travel across
 * it; flex picks a stiff, ordinary or supple amplitude; jitter (seconds) nudges
 * some plants a phase away from their neighbours so they do not move in lockstep.
 */
export function swayStyle(worldDeg: number, flex: number, jitter = 0) {
  const phase = worldDeg / GUST_WAVELENGTH - jitter / GUST_SECONDS;
  const step = ((Math.round(phase * GUST_STEPS) % GUST_STEPS) + GUST_STEPS) % GUST_STEPS;
  const delay = step === 0 ? 0 : (-step / GUST_STEPS) * GUST_SECONDS;
  return {
    "--sway": `${GUST_SECONDS}s`,
    "--sway-delay": `${delay.toFixed(2)}s`,
    "--sway-name":
      flex > 1.1
        ? "plant-sway-supple"
        : flex < 0.85
          ? "plant-sway-stiff"
          : "plant-sway",
  };
}
