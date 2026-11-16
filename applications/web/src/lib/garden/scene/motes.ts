import { lerp, seededRandom } from "./hash";

/**
 * Pollen by day, fireflies at night: where each one hangs over the meadow and
 * how it drifts and twinkles. The numbers feed compositor-only CSS animations
 * (transform and opacity, scene.css), so the resting scene runs no script.
 */
export type Mote = {
  /** Place in the field, in percent of its width and height. */
  x: number;
  y: number;
  /** Diameter in CSS pixels. */
  size: number;
  /** How far it wanders, in CSS pixels, and how long one way takes. */
  dx: number;
  dy: number;
  driftSeconds: number;
  /** Zero or negative: half the field starts on the way back. */
  driftDelay: number;
  twinkleSeconds: number;
  twinkleDelay: number;
  /** Opacity when nothing moves (reduced motion, or behind the writing page). */
  rest: number;
};

/*
 * A few shared timings, not one per mote: the compositor moves every mote,
 * but the main thread wakes each time an animation turns over, and motes on
 * the same timing turn over together (see GUST_STEPS in sway.ts).
 */
const DRIFT_SECONDS = [16, 22, 28];
const POLLEN_SECONDS = [3.4, 4.6, 5.8];
const FIREFLY_SECONDS = [5.5, 7, 8.5];

const round = (value: number, places = 2) => Number(value.toFixed(places));
const pick = (list: number[], t: number) => list[Math.min(list.length - 1, Math.floor(t * list.length))];

export function moteField(seed: number, count: number, night: boolean): Mote[] {
  const random = seededRandom(seed ^ 0x51ed);
  return Array.from({ length: count }, () => {
    const radius = lerp(0.8, 2.2, random());
    const driftSeconds = pick(DRIFT_SECONDS, random());
    const twinkleSeconds = pick(night ? FIREFLY_SECONDS : POLLEN_SECONDS, random());
    const late = random() > 0.5;
    const lit = random();
    return {
      x: round(random() * 100),
      y: round(random() * 100),
      size: round(radius * 2 * (night ? 1.1 : 0.8)),
      dx: round(lerp(-18, 54, random()), 0),
      dy: round(lerp(-30, 20, random()), 0),
      driftSeconds,
      // A whole trip late: travelling the other way, turning at the same moments.
      driftDelay: random() > 0.5 ? -driftSeconds : 0,
      twinkleSeconds,
      // Pollen alternates, so a whole cycle late is the opposite brightness;
      // a firefly half a cycle late flashes between the others.
      twinkleDelay: late ? -(night ? twinkleSeconds / 2 : twinkleSeconds) : 0,
      // A firefly is dark most of the time; pollen always catches some light.
      rest: night ? (lit > 0.6 ? round(lerp(0.3, 0.9, random())) : 0) : round(lerp(0.3, 0.7, lit)),
    };
  });
}
