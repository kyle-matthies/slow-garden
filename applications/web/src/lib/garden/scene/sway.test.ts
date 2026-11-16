import { describe, expect, it } from "vitest";
import { GUST_SECONDS, GUST_STEPS, GUST_WAVELENGTH, swayStyle } from "./sway";

const delay = (deg: number) => parseFloat(swayStyle(deg, 1)["--sway-delay"]);

describe("swayStyle", () => {
  it("shares one gust period across the meadow", () => {
    expect(swayStyle(0, 1)["--sway"]).toBe(`${GUST_SECONDS}s`);
    expect(swayStyle(170, 0.7)["--sway"]).toBe(`${GUST_SECONDS}s`);
  });

  it("phases plants by position so a gust travels across the meadow", () => {
    expect(delay(0)).toBeCloseTo(0);
    expect(delay(GUST_WAVELENGTH / 2)).toBeCloseTo(-GUST_SECONDS / 2, 1);
    // One wavelength along is in step again, including negative angles.
    expect(delay(GUST_WAVELENGTH)).toBeCloseTo(delay(0));
    expect(delay(-GUST_WAVELENGTH / 4)).toBeCloseTo(delay((3 * GUST_WAVELENGTH) / 4));
  });

  it("keeps the whole meadow to a few shared phases, so its animations turn over together", () => {
    // Each distinct phase is another moment the browser's main thread wakes
    // for an animation turning over; a meadow of plants must not add one each.
    const delays = new Set<string>();
    for (let i = 0; i < 400; i++)
      delays.add(swayStyle(i * 7.31 - 900, 1, -(i % 13) * 0.04)["--sway-delay"]);
    expect(delays.size).toBeLessThanOrEqual(GUST_STEPS);
    expect(delays.size).toBeGreaterThan(GUST_STEPS / 2);
    for (const value of delays) {
      const steps = (parseFloat(value) / GUST_SECONDS) * GUST_STEPS;
      expect(steps).toBeCloseTo(Math.round(steps), 1);
      expect(parseFloat(value)).toBeLessThanOrEqual(0);
      expect(parseFloat(value)).toBeGreaterThan(-GUST_SECONDS);
    }
  });

  it("chooses an amplitude from flex", () => {
    expect(swayStyle(0, 0.7)["--sway-name"]).toBe("plant-sway-stiff");
    expect(swayStyle(0, 1)["--sway-name"]).toBe("plant-sway");
    expect(swayStyle(0, 1.3)["--sway-name"]).toBe("plant-sway-supple");
  });
});
