import { expect, it } from "vitest";
import { moteField } from "./motes";

it("places the same pollen for the same garden, inside the field", () => {
  const field = moteField(42, 36, false);
  expect(field).toEqual(moteField(42, 36, false));
  expect(field).toHaveLength(36);
  expect(moteField(43, 36, false)).not.toEqual(field);
  for (const mote of field) {
    expect(mote.x).toBeGreaterThanOrEqual(0);
    expect(mote.x).toBeLessThanOrEqual(100);
    expect(mote.y).toBeGreaterThanOrEqual(0);
    expect(mote.y).toBeLessThanOrEqual(100);
    expect(mote.size).toBeGreaterThan(1);
    expect(mote.rest).toBeGreaterThan(0);
    expect(mote.rest).toBeLessThanOrEqual(1);
    expect(mote.twinkleDelay).toBeLessThanOrEqual(0);
    expect(mote.driftDelay).toBeLessThanOrEqual(0);
  }
});

it("shows fewer, larger and mostly dark fireflies at night, and never more than asked", () => {
  const day = moteField(42, 18, false);
  const night = moteField(42, 18, true);
  expect(night).toHaveLength(18);
  expect(night[0].size).toBeGreaterThan(day[0].size);
  expect(night.some((m) => m.rest === 0)).toBe(true);
});

it("shares a handful of timings across the field, however many motes there are", () => {
  // Each distinct timing is another moment the main thread wakes for an
  // animation turning over (see sway.ts); the field must not add one per mote.
  for (const night of [false, true]) {
    const field = moteField(7, 200, night);
    const twinkles = new Set(field.map((m) => `${m.twinkleSeconds}/${m.twinkleDelay}`));
    const drifts = new Set(field.map((m) => `${m.driftSeconds}/${m.driftDelay}`));
    expect(twinkles.size).toBeLessThanOrEqual(6);
    expect(twinkles.size).toBeGreaterThan(2);
    expect(drifts.size).toBeLessThanOrEqual(6);
  }
});
