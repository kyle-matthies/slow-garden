import { describe, expect, it } from "vitest";
import { GUST_SECONDS, GUST_WAVELENGTH, swayStyle } from "./sway";

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

  it("chooses an amplitude from flex", () => {
    expect(swayStyle(0, 0.7)["--sway-name"]).toBe("plant-sway-stiff");
    expect(swayStyle(0, 1)["--sway-name"]).toBe("plant-sway");
    expect(swayStyle(0, 1.3)["--sway-name"]).toBe("plant-sway-supple");
  });
});
