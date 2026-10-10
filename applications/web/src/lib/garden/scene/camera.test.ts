import { describe, expect, it } from "vitest";
import {
  bedAngles,
  grassParallax,
  grassY,
  isVisible,
  nearestAngle,
  nearestBed,
  plantY,
  rowParallax,
  wrap,
} from "./camera";

describe("camera", () => {
  it("wraps angles into -180..180", () => {
    expect(wrap(190)).toBe(-170);
    expect(wrap(-190)).toBe(170);
    expect(wrap(720)).toBe(0);
  });

  it("turns the short way round", () => {
    expect(nearestAngle(350, 10)).toBe(370);
    expect(nearestAngle(10, 350)).toBe(-10);
  });

  it("spaces beds around the ring and finds the nearest", () => {
    expect(bedAngles(4)).toEqual([0, 90, 180, 270]);
    expect(nearestBed(80, bedAngles(4))).toBe(1);
    expect(nearestBed(-30, bedAngles(4))).toBe(0);
    expect(nearestBed(320, bedAngles(4))).toBe(0);
  });

  it("knows what is in view", () => {
    expect(isVisible(0, 0, 80, 10)).toBe(true);
    expect(isVisible(180, 0, 80, 10)).toBe(false);
    expect(isVisible(50, 0, 80, 10)).toBe(true);
  });

  it("moves a plant with the grass at its base", () => {
    for (const p of [0, 0.3, 0.6, 1]) {
      const d = Math.pow((plantY(p) - 0.015) / 0.985, 1 / 1.35);
      expect(grassY(d)).toBeCloseTo(plantY(p), 6);
      expect(rowParallax(p)).toBeCloseTo(grassParallax(d), 6);
    }
    expect(rowParallax(1)).toBeGreaterThan(rowParallax(0));
  });
});
